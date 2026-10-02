import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { visualsFile, targetError, safeDesignUrl, mediaMime } from './visuals.mjs';
import { projectPath } from './paths.mjs';
import { assertShape } from './config.mjs';
export { projectPath } from './paths.mjs';

const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']);
export const packageRoot = path.resolve(import.meta.dirname, '..');

export async function readProject(root, relative) {
  return readFile(await projectPath(root, relative), 'utf8');
}

export function extractRules(markdown) {
  const rules = [];
  let current, fence;
  for (const line of markdown.split('\n')) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      current = undefined;
      continue;
    }
    if (fence) continue;
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
  const directories = new Set();
  async function visit(relative) {
    const absolute = await projectPath(root, relative);
    if ((await stat(absolute)).isDirectory()) {
      if (directories.has(absolute)) return;
      directories.add(absolute);
      for (const name of (await readdir(absolute)).sort()) {
        if (
          ['node_modules', '.git', 'dist', '.mhproto', '.env'].includes(name) ||
          name.startsWith('.env.')
        )
          continue;
        await visit(path.join(relative, name));
      }
    } else files.add(relative);
  }
  for (const input of inputs) await visit(input);
  for (const file of [...files].sort())
    hash
      .update(file + '\0')
      .update(await readFile(await projectPath(root, file)))
      .update('\0');
  return hash.digest('hex');
}

export function operationList(doc) {
  return Object.entries(doc.paths ?? {}).flatMap(([url, rawItem]) => {
    const item = resolveObject(doc, rawItem);
    return Object.entries(item)
      .filter(([method]) => methods.has(method))
      .map(([method, op]) => {
        const parameters = new Map();
        for (const list of [item.parameters ?? [], op.parameters ?? []]) {
          const seen = new Set();
          for (const raw of list) {
            const param = resolveObject(doc, raw),
              key = JSON.stringify([param.in, param.name]);
            if (seen.has(key))
              throw new Error(
                `Duplicate parameter ${param.name} at ${method.toUpperCase()} ${url}`,
              );
            seen.add(key);
            parameters.set(key, param);
          }
        }
        return {
          ...op,
          method: method.toUpperCase(),
          path: url,
          parameters: [...parameters.values()],
          requestBody: op.requestBody ? resolveObject(doc, op.requestBody) : undefined,
          responses: Object.fromEntries(
            Object.entries(op.responses ?? {}).map(([status, response]) => [
              status,
              resolveObject(doc, response),
            ]),
          ),
          rules: op['x-mhproto-rules'] ?? op['x-clauses'] ?? [],
        };
      });
  });
}

export function localRef(doc, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/'))
    throw new Error(`External reference unsupported in V0: ${ref}`);
  let node = doc;
  for (const part of decodeURIComponent(ref.slice(2)).split('/')) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
    node = node && Object.hasOwn(node, key) ? node[key] : undefined;
  }
  if (node === undefined) throw new Error(`Unresolved reference: ${ref}`);
  return node;
}

export function resolveObject(doc, object, seen = new Set()) {
  if (!object?.$ref) return object;
  if (seen.has(object.$ref)) throw new Error(`Cyclic OpenAPI object reference: ${object.$ref}`);
  const next = new Set(seen).add(object.$ref);
  const resolved = resolveObject(doc, localRef(doc, object.$ref), next);
  if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved))
    throw new Error(`OpenAPI object reference must resolve to an object: ${object.$ref}`);
  return {
    ...resolved,
    ...Object.fromEntries(
      ['summary', 'description'].filter((k) => Object.hasOwn(object, k)).map((k) => [k, object[k]]),
    ),
  };
}

export function schemaValidator(doc) {
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true });
  addFormats(ajv);
  const compiled = new Map();
  return (schema, data) => {
    if (!compiled.has(schema)) {
      const wrapper =
        typeof schema === 'boolean' ? schema : { ...schema, components: doc.components ?? {} };
      compiled.set(schema, ajv.compile(wrapper));
    }
    const validate = compiled.get(schema);
    return validate(data)
      ? []
      : validate.errors.map((e) => `${e.instancePath || '/'} ${e.message}`);
  };
}

async function loadCapability(root, definition, system) {
  const prose = await readProject(root, definition.spec);
  const doc = assertShape(
    'openapi',
    parse(await readProject(root, definition.interface)),
    definition.interface,
  );
  const examples = assertShape(
    'examples',
    parse(await readProject(root, definition.examples)),
    definition.examples,
  ).examples;
  const checks = assertShape(
    'checks',
    parse(await readProject(root, definition.checks)),
    definition.checks,
  ).checks;
  const digest = await fingerprint(root, [
    'mhproto.yaml',
    ...(system ? [system] : []),
    definition.spec,
    definition.interface,
    definition.examples,
    definition.checks,
    ...(definition.sources ?? []),
    ...checks.flatMap((c) => c.files ?? []),
  ]);
  let evidence;
  try {
    const file = `.mhproto/evidence/${definition.id}.json`;
    evidence = assertShape('evidence', JSON.parse(await readProject(root, file)), file);
    if (evidence.capability !== definition.id)
      throw new Error(`${file}: evidence belongs to another capability`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return {
    ...definition,
    prose,
    rules: extractRules(prose),
    openapi: doc,
    operations: operationList(doc),
    files: {
      spec: definition.spec,
      interface: definition.interface,
      examples: definition.examples,
      checks: definition.checks,
    },
    transitions: doc['x-phase-transitions'] ?? [],
    nonTransitions: doc['x-phase-unchanged-by'] ?? [],
    examples,
    checks,
    digest,
    evidence: evidence ? { ...evidence, stale: evidence.digest !== digest } : null,
  };
}

export async function loadProject(root = process.cwd()) {
  root = path.resolve(root);
  const config = assertShape(
    'config',
    parse(await readProject(root, 'mhproto.yaml')),
    'mhproto.yaml',
  );
  const ids = new Set();
  for (const cap of config.capabilities) {
    if (!/^[a-z][a-z0-9-]*$/.test(cap.id) || ids.has(cap.id))
      throw new Error(`Invalid or duplicate capability id: ${cap.id}`);
    ids.add(cap.id);
  }
  let visuals = [];
  try {
    visuals = parse(await readProject(root, visualsFile))?.visuals;
    if (!Array.isArray(visuals)) throw new Error('visuals.yaml requires a visuals array');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return {
    root,
    name: config.name ?? path.basename(root),
    visuals,
    system: config.system ? await readProject(root, config.system) : '',
    capabilities: await Promise.all(
      config.capabilities.map((c) => loadCapability(root, c, config.system)),
    ),
  };
}

export async function validateProject(project) {
  const issues = [];
  const issue = (cap, level, message) => issues.push({ capability: cap.id, level, message });
  const visualIds = new Set();
  for (const visual of project.visuals ?? []) {
    if (!visual || typeof visual !== 'object') {
      issue({ id: 'visuals' }, 'error', 'Visual entry must be an object');
      continue;
    }
    const cap = { id: visual.target?.capability ?? 'visuals' };
    if (
      typeof visual.id !== 'string' ||
      !/^[A-Za-z0-9._-]+$/.test(visual.id) ||
      visualIds.has(visual.id)
    )
      issue(cap, 'error', 'Invalid or duplicate visual id');
    visualIds.add(visual.id);
    const problem = targetError(project, visual.target);
    if (problem) issue(cap, 'error', problem);
    if (typeof visual.title !== 'string' || !visual.title.trim() || visual.title.length > 200)
      issue(cap, 'error', 'Visual requires a title (up to 200 characters)');
    if (Boolean(visual.file) === Boolean(visual.url))
      issue(cap, 'error', 'Visual requires exactly one file or design URL');
    if (visual.url && !safeDesignUrl(visual.url)) issue(cap, 'error', 'Design link must use HTTPS');
    if (visual.file) {
      try {
        await projectPath(project.root, visual.file);
        const mime = mediaMime(visual.file);
        if (!mime) issue(cap, 'error', 'Unsupported visual file');
        else if (visual.mime && visual.mime !== mime)
          issue(cap, 'error', 'Visual MIME disagrees with file extension');
      } catch (error) {
        issue(cap, 'error', error.message);
      }
    }
  }
  for (const cap of project.capabilities) {
    const rules = new Set(),
      operations = new Set(),
      examples = new Set(),
      checkIds = new Set();
    for (const rule of cap.rules) {
      if (rules.has(rule.id)) issue(cap, 'error', `Duplicate rule ${rule.id}`);
      rules.add(rule.id);
    }
    if (!rules.size) issue(cap, 'error', 'No rules found: use - **CAP-RULE-1** text');
    if (
      cap.openapi?.openapi !== '3.1.0' &&
      cap.openapi?.openapi !== '3.1.1' &&
      cap.openapi?.openapi !== '3.1.2'
    )
      issue(cap, 'error', 'V0 supports OpenAPI 3.1 JSON Schema contracts');
    if (!cap.openapi?.info?.title || !cap.openapi?.info?.version)
      issue(cap, 'error', 'OpenAPI info.title and info.version are required');
    let validates;
    try {
      validates = schemaValidator(cap.openapi);
    } catch (error) {
      issue(cap, 'error', error.message);
    }
    const cite = (id, context) => {
      if (!rules.has(id)) issue(cap, 'error', `${context} references missing rule ${id}`);
    };
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (typeof node.$ref === 'string') {
        try {
          localRef(cap.openapi, node.$ref);
        } catch (e) {
          issue(cap, 'error', e.message);
        }
      }
      for (const value of Object.values(node)) walk(value);
    };
    walk(cap.openapi);
    const validateData = (schema, data, context) => {
      if (schema === undefined || !validates) return;
      try {
        for (const error of validates(schema, data)) issue(cap, 'error', `${context}: ${error}`);
      } catch (error) {
        issue(cap, 'error', `${context}: ${error.message}`);
      }
    };
    const validateMedia = (media, context) => {
      if (media.schema !== undefined) {
        try {
          validates?.(media.schema, undefined);
        } catch (error) {
          issue(cap, 'error', `${context} schema: ${error.message}`);
        }
      }
      if ('example' in media) validateData(media.schema, media.example, context);
      for (const [name, raw] of Object.entries(media.examples ?? {})) {
        try {
          const example = resolveObject(cap.openapi, raw);
          if (Object.hasOwn(example, 'value'))
            validateData(media.schema, example.value, `${context} example ${name}`);
        } catch (error) {
          issue(cap, 'error', `${context} example ${name}: ${error.message}`);
        }
      }
    };
    for (const [name, schema] of Object.entries(cap.openapi.components?.schemas ?? {})) {
      try {
        validates?.(schema, undefined);
      } catch (e) {
        issue(cap, 'error', `Schema ${name}: ${e.message}`);
      }
    }
    for (const op of cap.operations) {
      if (!op.operationId || operations.has(op.operationId))
        issue(cap, 'error', `Missing or duplicate operationId at ${op.method} ${op.path}`);
      operations.add(op.operationId);
      if (!op.responses || !Object.keys(op.responses).length)
        issue(cap, 'error', `${op.operationId} has no responses`);
      for (const id of op.rules) cite(id, op.operationId);
      if (!op.rules.length) issue(cap, 'warning', `${op.operationId} has no behaviour links`);
      for (const param of op.path.matchAll(/\{([^}]+)\}/g)) {
        if (
          !op.parameters.some((p) => p.in === 'path' && p.name === param[1] && p.required === true)
        )
          issue(cap, 'error', `${op.operationId} is missing required path parameter ${param[1]}`);
      }
      for (const condition of op['x-preconditions'] ?? [])
        if (condition.fails?.clause) cite(condition.fails.clause, op.operationId);
      for (const param of op.parameters)
        validateMedia(param, `${op.operationId} ${param.in} parameter ${param.name}`);
      for (const [status, response] of Object.entries(op.responses ?? {})) {
        const item = resolveObject(cap.openapi, response);
        for (const e of item?.['x-error-codes'] ?? [])
          if (e.clause) cite(e.clause, `${op.operationId}/${status}`);
        for (const media of Object.values(item?.content ?? {}))
          validateMedia(media, `${op.operationId} response ${status}`);
      }
      for (const media of Object.values(op.requestBody?.content ?? {}))
        validateMedia(media, `${op.operationId} request`);
    }
    for (const transition of [...cap.transitions, ...cap.nonTransitions])
      if (transition.clause) cite(transition.clause, 'Transition');
    for (const id of cap.presentation?.operationOrder ?? [])
      if (!operations.has(id))
        issue(cap, 'error', `Presentation references missing operation ${id}`);
    for (const [id, presentation] of Object.entries(cap.presentation?.operations ?? {})) {
      if (!operations.has(id))
        issue(cap, 'error', `Presentation references missing operation ${id}`);
      for (const rule of [
        ...(presentation.rules ?? []),
        ...(presentation.ruleGroups ?? []).flatMap((g) => g.rules ?? []),
      ])
        cite(rule, `Presentation ${id}`);
      for (const diagram of presentation.diagrams ?? [])
        if (typeof diagram.title !== 'string' || typeof diagram.source !== 'string')
          issue(cap, 'error', `Presentation ${id}: diagrams require title and source strings`);
    }
    for (const example of cap.examples) {
      if (!example.id || examples.has(example.id))
        issue(cap, 'error', `Missing or duplicate example id ${example.id}`);
      examples.add(example.id);
      if (!example.given || !example.when || !example.then)
        issue(cap, 'error', `${example.id} requires given, when and then`);
      for (const id of example.rules ?? []) cite(id, example.id);
      for (const id of example.operations ?? [])
        if (!operations.has(id))
          issue(cap, 'error', `${example.id} references missing operation ${id}`);
      if (example.request) {
        const op = cap.operations.find((o) => o.operationId === example.request.operation);
        if (!op) issue(cap, 'error', `${example.id} request references missing operation`);
        else {
          const schema = resolveObject(cap.openapi, op.requestBody)?.content?.['application/json']
            ?.schema;
          if (schema !== undefined)
            validateData(schema, example.request.body, example.id + ' request');
          if (example.response) {
            const code = String(example.response.status);
            const response =
              op.responses?.[code] ?? op.responses?.[code[0] + 'XX'] ?? op.responses?.default;
            if (!response) issue(cap, 'error', `${example.id} has undeclared response status`);
            else
              validateData(
                response.content?.['application/json']?.schema,
                example.response.body,
                example.id + ' response',
              );
          }
        }
      }
    }
    for (const check of cap.checks) {
      if (!check.id || checkIds.has(check.id))
        issue(cap, 'error', `Missing or duplicate check id ${check.id}`);
      checkIds.add(check.id);
      if (
        !Array.isArray(check.command) ||
        !check.command.length ||
        check.command.some((v) => typeof v !== 'string')
      )
        issue(cap, 'error', `${check.id}: command must be an argv array`);
      else if (!check.command[0])
        issue(cap, 'error', `${check.id}: command executable cannot be empty`);
      if (check.runner && !['command', 'node-test'].includes(check.runner))
        issue(cap, 'error', `${check.id}: unsupported runner`);
      if (
        check.runner === 'node-test' &&
        (!Array.isArray(check.testNames) || !check.testNames.length)
      )
        issue(cap, 'error', `${check.id}: node-test requires testNames (exact test names)`);
      for (const id of check.rules ?? []) cite(id, check.id);
      for (const id of check.examples ?? [])
        if (!examples.has(id)) issue(cap, 'error', `${check.id} references missing example ${id}`);
      for (const file of check.files ?? []) {
        try {
          await projectPath(project.root, file);
        } catch (e) {
          issue(cap, 'error', `${check.id}: ${e.message}`);
        }
      }
    }
    for (const rule of cap.rules)
      if (!cap.checks.some((c) => c.rules?.includes(rule.id)))
        issue(cap, 'warning', `${rule.id} has no linked executable check`);
    for (const example of cap.examples)
      if (!cap.checks.some((c) => c.examples?.includes(example.id)))
        issue(cap, 'warning', `${example.id} has no linked executable check`);
    if (cap.evidence?.stale)
      issue(
        cap,
        'warning',
        'Verification evidence is stale; spec or tracked implementation changed',
      );
  }
  return issues;
}
