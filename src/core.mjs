import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);
export const packageRoot = path.resolve(import.meta.dirname, '..');

export async function projectPath(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) throw new Error(`Expected project-relative path: ${relative}`);
  const candidate = path.resolve(root, relative);
  const actual = await realpath(candidate);
  const base = await realpath(root);
  if (actual !== base && !actual.startsWith(base + path.sep)) throw new Error(`Path escapes project: ${relative}`);
  return actual;
}

export async function readProject(root, relative) {
  return readFile(await projectPath(root, relative), 'utf8');
}

export function extractRules(markdown) {
  const rules = [];
  let current;
  for (const line of markdown.split('\n')) {
    const match = /^\s*-\s+\*\*([A-Z][A-Z0-9-]*-\d+)\*\*\s*(.*)$/.exec(line);
    if (match) {
      current = { id: match[1], text: match[2] };
      rules.push(current);
    } else if (current && /^\s{2,}\S/.test(line)) {
      current.text += '\n' + line.trim();
    } else current = undefined;
  }
  return rules;
}

async function fingerprint(root, inputs) {
  const hash = createHash('sha256');
  const files = new Set();
  async function visit(relative) {
    const absolute = await projectPath(root, relative);
    if ((await stat(absolute)).isDirectory()) {
      for (const name of (await readdir(absolute)).sort()) {
        if (['node_modules', '.git', 'dist', '.bive', '.env'].includes(name) || name.startsWith('.env.')) continue;
        await visit(path.join(relative, name));
      }
    } else files.add(relative);
  }
  for (const input of inputs) await visit(input);
  for (const file of [...files].sort()) hash.update(file + '\0').update(await readFile(await projectPath(root, file))).update('\0');
  return hash.digest('hex');
}

export function operationList(doc) {
  return Object.entries(doc.paths ?? {}).flatMap(([url, item]) =>
    Object.entries(item).filter(([method]) => methods.has(method)).map(([method, op]) => ({
      ...op, method: method.toUpperCase(), path: url,
      parameters: [...(item.parameters ?? []), ...(op.parameters ?? [])],
      rules: op['x-bive-rules'] ?? op['x-clauses'] ?? [],
    })));
}

function localRef(doc, ref) {
  if (!ref.startsWith('#/')) throw new Error(`External reference unsupported in V0: ${ref}`);
  let node = doc;
  for (const part of ref.slice(2).split('/')) node = node?.[part.replaceAll('~1', '/').replaceAll('~0', '~')];
  if (node === undefined) throw new Error(`Unresolved reference: ${ref}`);
  return node;
}

function resolveObject(doc, object) {
  return object?.$ref ? localRef(doc, object.$ref) : object;
}

export function schemaValidator(doc) {
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true });
  addFormats(ajv);
  return (schema, data) => {
    const wrapper = { ...schema, components: doc.components ?? {} };
    const validate = ajv.compile(wrapper);
    return validate(data) ? [] : validate.errors.map(e => `${e.instancePath || '/'} ${e.message}`);
  };
}

async function loadCapability(root, definition) {
  const prose = await readProject(root, definition.spec);
  const doc = parse(await readProject(root, definition.interface));
  const examples = parse(await readProject(root, definition.examples))?.examples;
  const checks = parse(await readProject(root, definition.checks))?.checks;
  if (!Array.isArray(examples) || !Array.isArray(checks)) throw new Error('examples and checks must be arrays');
  const digest = await fingerprint(root, [definition.spec, definition.interface, definition.examples, definition.checks, ...(definition.sources ?? [])]);
  let evidence;
  try { evidence = JSON.parse(await readProject(root, `.bive/evidence/${definition.id}.json`)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return {
    ...definition, prose, rules: extractRules(prose), openapi: doc, operations: operationList(doc),
    files: { spec: definition.spec, interface: definition.interface, examples: definition.examples, checks: definition.checks },
    transitions: doc['x-phase-transitions'] ?? [],
    nonTransitions: doc['x-phase-unchanged-by'] ?? [],
    examples, checks, digest,
    evidence: evidence ? { ...evidence, stale: evidence.digest !== digest } : null,
  };
}

export async function loadProject(root = process.cwd()) {
  root = path.resolve(root);
  const config = parse(await readProject(root, 'bive.yaml'));
  if (config?.version !== 1 || !Array.isArray(config.capabilities) || !config.capabilities.length) throw new Error('bive.yaml requires version: 1 and at least one capability');
  const ids = new Set();
  for (const cap of config.capabilities) {
    if (!/^[a-z][a-z0-9-]*$/.test(cap.id) || ids.has(cap.id)) throw new Error(`Invalid or duplicate capability id: ${cap.id}`);
    ids.add(cap.id);
  }
  return {
    root, name: config.name ?? path.basename(root),
    system: config.system ? await readProject(root, config.system) : '',
    capabilities: await Promise.all(config.capabilities.map(c => loadCapability(root, c))),
  };
}

export async function validateProject(project) {
  const issues = [];
  const issue = (cap, level, message) => issues.push({ capability: cap.id, level, message });
  for (const cap of project.capabilities) {
    const rules = new Set(), operations = new Set(), examples = new Set(), checkIds = new Set();
    for (const rule of cap.rules) {
      if (rules.has(rule.id)) issue(cap, 'error', `Duplicate rule ${rule.id}`);
      rules.add(rule.id);
    }
    if (!rules.size) issue(cap, 'error', 'No rules found: use - **CAP-RULE-1** text');
    if (cap.openapi?.openapi !== '3.1.0' && cap.openapi?.openapi !== '3.1.1' && cap.openapi?.openapi !== '3.1.2') issue(cap, 'error', 'V0 supports OpenAPI 3.1 JSON Schema contracts');
    if (!cap.openapi.info?.title || !cap.openapi.info?.version) issue(cap, 'error', 'OpenAPI info.title and info.version are required');
    let validates;
    try { validates = schemaValidator(cap.openapi); }
    catch (error) { issue(cap, 'error', error.message); }
    const cite = (id, context) => { if (!rules.has(id)) issue(cap, 'error', `${context} references missing rule ${id}`); };
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (typeof node.$ref === 'string') { try { localRef(cap.openapi, node.$ref); } catch (e) { issue(cap, 'error', e.message); } }
      for (const value of Object.values(node)) walk(value);
    };
    walk(cap.openapi);
    const validateData = (schema, data, context) => {
      if (!schema || !validates) return;
      try { for (const error of validates(schema, data)) issue(cap, 'error', `${context}: ${error}`); }
      catch (error) { issue(cap, 'error', `${context}: ${error.message}`); }
    };
    for (const [name, schema] of Object.entries(cap.openapi.components?.schemas ?? {})) {
      try { validates?.(schema, undefined); } catch (e) { issue(cap, 'error', `Schema ${name}: ${e.message}`); }
    }
    for (const op of cap.operations) {
      if (!op.operationId || operations.has(op.operationId)) issue(cap, 'error', `Missing or duplicate operationId at ${op.method} ${op.path}`);
      operations.add(op.operationId);
      if (!op.responses || !Object.keys(op.responses).length) issue(cap, 'error', `${op.operationId} has no responses`);
      for (const id of op.rules) cite(id, op.operationId);
      if (!op.rules.length) issue(cap, 'warning', `${op.operationId} has no behaviour links`);
      for (const param of op.path.matchAll(/\{([^}]+)\}/g)) {
        if (!op.parameters.some(p => p.in === 'path' && p.name === param[1] && p.required === true)) issue(cap, 'error', `${op.operationId} is missing required path parameter ${param[1]}`);
      }
      for (const condition of op['x-preconditions'] ?? []) if (condition.fails?.clause) cite(condition.fails.clause, op.operationId);
      for (const [status, response] of Object.entries(op.responses ?? {})) {
        const item = resolveObject(cap.openapi, response);
        for (const e of item?.['x-error-codes'] ?? []) if (e.clause) cite(e.clause, `${op.operationId}/${status}`);
        for (const media of Object.values(item?.content ?? {})) if ('example' in media) validateData(media.schema, media.example, `${op.operationId} response ${status}`);
      }
      for (const media of Object.values(resolveObject(cap.openapi, op.requestBody)?.content ?? {})) if ('example' in media) validateData(media.schema, media.example, `${op.operationId} request`);
    }
    for (const transition of [...cap.transitions, ...cap.nonTransitions]) if (transition.clause) cite(transition.clause, 'Transition');
    for (const example of cap.examples) {
      if (!example.id || examples.has(example.id)) issue(cap, 'error', `Missing or duplicate example id ${example.id}`);
      examples.add(example.id);
      if (!example.given || !example.when || !example.then) issue(cap, 'error', `${example.id} requires given, when and then`);
      for (const id of example.rules ?? []) cite(id, example.id);
      for (const id of example.operations ?? []) if (!operations.has(id)) issue(cap, 'error', `${example.id} references missing operation ${id}`);
      if (example.request) {
        const op = cap.operations.find(o => o.operationId === example.request.operation);
        if (!op) issue(cap, 'error', `${example.id} request references missing operation`);
        else {
          const schema = resolveObject(cap.openapi, op.requestBody)?.content?.['application/json']?.schema;
          if (schema) validateData(schema, example.request.body, example.id + ' request');
          if (example.response) {
            const response = resolveObject(cap.openapi, op.responses?.[String(example.response.status)]);
            if (!response) issue(cap, 'error', `${example.id} has undeclared response status`);
            else validateData(response.content?.['application/json']?.schema, example.response.body, example.id + ' response');
          }
        }
      }
    }
    for (const check of cap.checks) {
      if (!check.id || checkIds.has(check.id)) issue(cap, 'error', `Missing or duplicate check id ${check.id}`);
      checkIds.add(check.id);
      if (!Array.isArray(check.command) || !check.command.length || check.command.some(v => typeof v !== 'string')) issue(cap, 'error', `${check.id}: command must be an argv array`);
      if (check.runner && !['command', 'node-test'].includes(check.runner)) issue(cap, 'error', `${check.id}: unsupported runner`);
      if (check.runner === 'node-test' && (!Array.isArray(check.testNames) || !check.testNames.length)) issue(cap, 'error', `${check.id}: node-test requires testNames (exact test names)`);
      for (const id of check.rules ?? []) cite(id, check.id);
      for (const id of check.examples ?? []) if (!examples.has(id)) issue(cap, 'error', `${check.id} references missing example ${id}`);
      for (const file of check.files ?? []) { try { await projectPath(project.root, file); } catch (e) { issue(cap, 'error', `${check.id}: ${e.message}`); } }
    }
    for (const rule of cap.rules) if (!cap.checks.some(c => c.rules?.includes(rule.id))) issue(cap, 'warning', `${rule.id} has no linked executable check`);
    for (const example of cap.examples) if (!cap.checks.some(c => c.examples?.includes(example.id))) issue(cap, 'warning', `${example.id} has no linked executable check`);
    if (cap.evidence?.stale) issue(cap, 'warning', 'Verification evidence is stale; spec or tracked implementation changed');
  }
  return issues;
}
