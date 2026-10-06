import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { visualsFile, targetError, safeDesignUrl, mediaMime } from './visuals.mjs';
import { projectPath } from './paths.mjs';
import { assertShape } from './config.mjs';
import { builtinRegistry, describeRegistry, loadPlugins } from './plugins.mjs';
import { entitiesOf, entityLink, interfacesOf } from '../viewer/diff.js';
export { projectPath } from './paths.mjs';
// Kept for existing imports of these helpers from the package root.
export {
  operationList,
  localRef,
  resolveObject,
  schemaValidator,
} from './plugins/openapi/document.mjs';

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

// `interface: file` is shorthand for `interfaces: [{ adapter: openapi, file }]`.
function interfaceEntries(definition) {
  if (definition.interface && definition.interfaces)
    throw new Error(`${definition.id}: use interface or interfaces, not both`);
  const entries = definition.interface
    ? [{ adapter: 'openapi', file: definition.interface }]
    : (definition.interfaces ?? []);
  const adapters = new Set();
  for (const { adapter } of entries) {
    if (adapters.has(adapter))
      throw new Error(`${definition.id}: list the ${adapter} interface once per capability`);
    adapters.add(adapter);
  }
  return entries;
}

function normaliseEntities(loaded, item, registry, where) {
  if (!loaded || typeof loaded !== 'object' || !Array.isArray(loaded.entities))
    throw new Error(`${where}: load() must return { entities: [...] }`);
  const strings = (value) =>
    value === undefined || (Array.isArray(value) && value.every((v) => typeof v === 'string'));
  const entities = loaded.entities.map((entity) => {
    if (!entity || typeof entity !== 'object')
      throw new Error(`${where}: every entity must be an object`);
    if (!registry.kinds.has(entity.kind))
      throw new Error(`${where}: entity kind "${entity.kind}" is not declared by any plugin`);
    if (!strings(entity.rules)) throw new Error(`${where}: entity rules must be rule ID strings`);
    if (entity.links !== undefined && !Array.isArray(entity.links))
      throw new Error(`${where}: entity links must be an array`);
    return {
      adapter: item.adapter,
      file: item.file,
      kind: entity.kind,
      id: entity.id,
      ...(entity.title !== undefined ? { title: String(entity.title) } : {}),
      ...(entity.summary !== undefined ? { summary: String(entity.summary) } : {}),
      rules: entity.rules ?? [],
      links: (entity.links ?? []).map(entityLink),
      ...(entity.data !== undefined ? { data: entity.data } : {}),
    };
  });
  try {
    JSON.stringify([entities, loaded.meta]);
  } catch {
    throw new Error(`${where}: entities and meta must be plain JSON`);
  }
  return entities;
}

async function loadInterface(root, definition, item, registry) {
  const provider = registry.adapters.get(item.adapter);
  if (!provider)
    throw new Error(
      `${definition.id}: no plugin provides the "${item.adapter}" interface. Add its plugin to mhproto.yaml.`,
    );
  const where = `${definition.id}: ${item.adapter} interface ${item.file}`;
  const readText = (relative) => readProject(root, relative);
  const loaded = await provider.adapter.load({
    root,
    file: item.file,
    options: structuredClone(item.options ?? {}),
    capability: structuredClone(definition),
    readText,
    readYaml: async (relative) => parse(await readText(relative)),
    list: async (relative) => (await readdir(await projectPath(root, relative))).sort(),
  });
  const entities = normaliseEntities(loaded, item, registry, where);
  return {
    adapter: item.adapter,
    file: item.file,
    document: loaded.document,
    meta: loaded.meta,
    entities,
  };
}

async function loadCapability(root, definition, system, registry) {
  const prose = await readProject(root, definition.spec);
  const interfaces = [];
  for (const item of interfaceEntries(definition))
    interfaces.push(await loadInterface(root, definition, item, registry));
  const examples = definition.examples
    ? assertShape(
        'examples',
        parse(await readProject(root, definition.examples)),
        definition.examples,
      ).examples
    : [];
  const checks = definition.checks
    ? assertShape('checks', parse(await readProject(root, definition.checks)), definition.checks)
        .checks
    : [];
  const digest = await fingerprint(root, [
    'mhproto.yaml',
    ...(system ? [system] : []),
    definition.spec,
    ...interfaces.map((i) => i.file),
    ...(definition.examples ? [definition.examples] : []),
    ...(definition.checks ? [definition.checks] : []),
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
  const openapi = interfaces.find((i) => i.adapter === 'openapi');
  return {
    ...definition,
    prose,
    rules: extractRules(prose),
    // The OpenAPI view the viewer renders; its entities are derived from it (entitiesOf).
    ...(openapi
      ? {
          openapi: openapi.document,
          operations: openapi.entities.filter((e) => e.kind === 'operation').map((e) => e.data),
          transitions: openapi.document['x-phase-transitions'] ?? [],
          nonTransitions: openapi.document['x-phase-unchanged-by'] ?? [],
        }
      : {}),
    interfaces: interfaces.map(({ adapter, file, document, meta }) => {
      const item = { adapter, file, ...(meta !== undefined ? { meta } : {}) };
      // Adapter hooks read documents in memory; models and snapshots do not repeat them.
      if (adapter !== 'openapi')
        Object.defineProperty(item, 'document', { value: document, enumerable: false });
      return item;
    }),
    entities: interfaces.filter((i) => i.adapter !== 'openapi').flatMap((i) => i.entities),
    files: {
      spec: definition.spec,
      ...Object.fromEntries(
        interfaces.map((i) => [i.adapter === 'openapi' ? 'interface' : i.adapter, i.file]),
      ),
      ...(definition.examples ? { examples: definition.examples } : {}),
      ...(definition.checks ? { checks: definition.checks } : {}),
    },
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
  const registry = await loadPlugins(root, config);
  let visuals = [];
  try {
    visuals = parse(await readProject(root, visualsFile))?.visuals;
    if (!Array.isArray(visuals)) throw new Error('visuals.yaml requires a visuals array');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const project = {
    root,
    name: config.name ?? path.basename(root),
    visuals,
    system: config.system ? await readProject(root, config.system) : '',
    ...describeRegistry(registry),
    capabilities: await Promise.all(
      config.capabilities.map((c) => loadCapability(root, c, config.system, registry)),
    ),
  };
  Object.defineProperty(project, 'registry', { value: registry });
  return project;
}

export const registryOf = (project) => project.registry ?? builtinRegistry();

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
  const registry = registryOf(project);
  const capabilities = new Map(project.capabilities.map((cap) => [cap.id, cap]));
  const entityKey = (kind, id) => JSON.stringify([kind, id]);
  const entityKeys = new Map(
    project.capabilities.map((cap) => [
      cap.id,
      new Set(entitiesOf(cap).map((e) => entityKey(e.kind, e.id))),
    ]),
  );
  for (const cap of project.capabilities) {
    const rules = new Set(),
      examples = new Set(),
      checkIds = new Set();
    for (const rule of cap.rules) {
      if (rules.has(rule.id)) issue(cap, 'error', `Duplicate rule ${rule.id}`);
      rules.add(rule.id);
    }
    if (!rules.size) issue(cap, 'error', 'No rules found: use - **CAP-RULE-1** text');
    const cite = (id, context) => {
      if (!rules.has(id)) issue(cap, 'error', `${context} references missing rule ${id}`);
    };
    const entities = entitiesOf(cap);
    const hasEntity = (kind, id) => entityKeys.get(cap.id).has(entityKey(kind, id));
    const adapterContext = (item) => ({
      project,
      capability: cap,
      interface: item,
      entities: entities.filter((e) => e.adapter === item.adapter),
      error: (message) => issue(cap, 'error', message),
      warning: (message) => issue(cap, 'warning', message),
      cite,
    });
    const adapters = interfacesOf(cap).map((item) => ({
      item,
      hooks: registry.adapters.get(item.adapter)?.adapter ?? {},
    }));
    for (const { item, hooks } of adapters) {
      try {
        await hooks.validate?.(
          { document: item.document, entities: adapterContext(item).entities, meta: item.meta },
          adapterContext(item),
        );
      } catch (error) {
        issue(cap, 'error', `${item.adapter} interface ${item.file}: ${error.message}`);
      }
    }
    const seen = new Set();
    for (const entity of entities) {
      const key = entityKey(entity.kind, entity.id);
      if (typeof entity.id !== 'string' || !entity.id || seen.has(key))
        issue(
          cap,
          'error',
          `Missing or duplicate ${entity.kind} id at ${entity.title ?? entity.file}`,
        );
      seen.add(key);
      for (const id of entity.rules) cite(id, entity.id);
      if (!entity.rules.length && registry.kinds.get(entity.kind)?.linkRequired !== false)
        issue(cap, 'warning', `${entity.id} has no behaviour links`);
      for (const link of entity.links) {
        const target = link.capability ?? cap.id;
        if (!capabilities.has(target))
          issue(cap, 'error', `${entity.id} links to missing capability ${target}`);
        else if (!entityKeys.get(target).has(entityKey(link.kind, link.id)))
          issue(cap, 'error', `${entity.id} links to missing ${link.kind} ${link.id}`);
      }
    }
    for (const id of cap.presentation?.operationOrder ?? [])
      if (!hasEntity('operation', id))
        issue(cap, 'error', `Presentation references missing operation ${id}`);
    for (const [id, presentation] of Object.entries(cap.presentation?.operations ?? {})) {
      if (!hasEntity('operation', id))
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
        if (!hasEntity('operation', id))
          issue(cap, 'error', `${example.id} references missing operation ${id}`);
      if (example.request && !hasEntity('operation', example.request.operation))
        issue(cap, 'error', `${example.id} request references missing operation`);
      for (const { item, hooks } of adapters)
        hooks.validateExample?.(example, adapterContext(item));
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
  for (const plugin of registry.plugins) {
    const report = (level) => (message, capability) =>
      issue({ id: capability ?? plugin.name }, level, message);
    try {
      await plugin.validate?.(project, { error: report('error'), warning: report('warning') });
    } catch (error) {
      issue({ id: plugin.name }, 'error', `Plugin ${plugin.name}: ${error.message}`);
    }
  }
  return issues;
}
