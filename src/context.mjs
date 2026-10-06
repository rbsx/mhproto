// Scoped, deterministic retrieval. Images, logs and repeated schemas stay outside packets.
import { builtinRegistry } from './plugins.mjs';
import { entitiesOf, entityLink, interfacesOf, openapiView } from '../viewer/diff.js';
export { operationRuleIds } from '../viewer/diff.js';

const pick = (value, keys) =>
  Object.fromEntries(keys.filter((k) => value[k] !== undefined).map((k) => [k, value[k]]));
function evidence(cap, check) {
  if (!cap.evidence) return 'unchecked';
  if (cap.evidence.stale || cap.evidence.changedDuringRun) return 'stale';
  return cap.evidence.results.find((r) => r.id === check.id)?.status ?? 'unchecked';
}
const summary = (entity) => pick(entity, ['kind', 'id', 'title', 'summary']);
const operationsOf = (cap) => openapiView(cap)?.operations ?? [];
const otherEntities = (cap) => entitiesOf(cap).filter((e) => e.adapter !== 'openapi');
// Sections every packet can contain, whatever the interface.
function select(fields, sections, hidden = ['sources']) {
  const selected = sections
    ? sections.split(',')
    : Object.keys(fields).filter((key) => !hidden.includes(key));
  if (selected.some((k) => !(k in fields)))
    throw new Error('Sections: ' + Object.keys(fields).join(','));
  return Object.fromEntries(selected.map((k) => [k, fields[k]]));
}
function packetContext(project, cap, entity, visualMetadata, sections) {
  const examplesFor = (e) =>
    cap.examples.filter((x) => x.rules?.some((id) => e.rules.includes(id)));
  const checksFor = (e) => {
    const examples = examplesFor(e);
    return cap.checks
      .filter(
        (c) =>
          c.rules?.some((id) => e.rules.includes(id)) ||
          c.examples?.some((id) => examples.some((x) => x.id === id)),
      )
      .map((c) => ({ ...pick(c, ['id', 'title', 'rules', 'examples']), status: evidence(cap, c) }));
  };
  const visuals = (e) =>
    visualMetadata.filter(
      (v) => v.target.capability === cap.id && v.target.kind === e.kind && v.target.id === e.id,
    );
  const context = {
    project,
    capability: cap,
    interface: interfacesOf(cap).find((i) => i.adapter === entity.adapter),
    visualMetadata,
    evidence: (check) => evidence(cap, check),
    rules: (ids) => cap.rules.filter((r) => ids.includes(r.id)),
    examples: (e) =>
      examplesFor(e).map((x) => pick(x, ['id', 'title', 'rules', 'given', 'when', 'then'])),
    checks: checksFor,
    visuals,
    sources: (e) => ({ file: e.file, implementation: cap.sources ?? [] }),
    select: (fields, options = {}) => select(fields, sections, options.hidden),
    defaults: (e) => ({
      definition: e.data,
      links: e.links.map((link) => {
        const target = link.capability
          ? project.capabilities.find((c) => c.id === link.capability)
          : cap;
        const found =
          target && entitiesOf(target).find((x) => x.kind === link.kind && x.id === link.id);
        return { ...link, ...(found?.title ? { title: found.title } : {}) };
      }),
      linkedFrom: project.capabilities.flatMap((other) =>
        entitiesOf(other)
          .filter((x) =>
            x.links.some(
              (l) => (l.capability ?? other.id) === cap.id && l.kind === e.kind && l.id === e.id,
            ),
          )
          .map((x) => ({
            ...(other.id !== cap.id ? { capability: other.id } : {}),
            ...summary(x),
          })),
      ),
      behaviour: { rules: cap.rules.filter((r) => e.rules.includes(r.id)) },
      examples: context.examples(e),
      checks: checksFor(e),
      visuals: visuals(e),
      sources: context.sources(e),
    }),
  };
  return context;
}
function entityPacket(project, cap, entity, visualMetadata, sections) {
  const registry = project.registry ?? builtinRegistry();
  const context = packetContext(project, cap, entity, visualMetadata, sections);
  const packet = registry.adapters.get(entity.adapter)?.adapter.packet;
  return packet
    ? packet(entity, context)
    : { entity: summary(entity), ...context.select(context.defaults(entity)) };
}

export function contextPacket(project, options = {}) {
  const selectors = ['operation', 'entity', 'rule', 'schema', 'example', 'check', 'visual'].filter(
    (k) => options[k],
  );
  if (selectors.length > 1)
    throw new Error(
      'Choose one selector: operation, entity, rule, schema, example, check or visual',
    );
  const visualMetadata = (project.visuals ?? []).map((v) =>
    pick(v, ['id', 'title', 'caption', 'kind', 'target', 'file', 'url', 'mime', 'sha256']),
  );
  if (options.visual) {
    const visual = visualMetadata.find((v) => v.id === options.visual);
    if (!visual) throw new Error(`Unknown visual: ${options.visual}`);
    return {
      project: project.name,
      visual,
      instruction: 'Open the local file or design link only when the visual is needed.',
    };
  }
  const anyOthers = project.capabilities.some((c) => otherEntities(c).length);
  if (!options.capability && !selectors.length)
    return {
      project: project.name,
      features: project.capabilities.map((c) => ({
        id: c.id,
        title: c.title,
        url: c.url,
        operations: operationsOf(c).map((o) =>
          pick(o, ['operationId', 'method', 'path', 'summary']),
        ),
        ...(otherEntities(c).length ? { entities: otherEntities(c).map(summary) } : {}),
      })),
      read: anyOthers
        ? 'mhproto context --capability ID --operation ID or --entity KIND:ID; use --rule, --schema, --example, --check or --visual for detail.'
        : 'mhproto context --capability ID --operation ID; use --rule, --schema, --example, --check or --visual for detail.',
    };
  const linked = options.entity ? entityLink(options.entity) : null;
  if (linked?.capability && options.capability && linked.capability !== options.capability)
    throw new Error('--entity names a different capability than --capability');
  const capability = linked?.capability ?? options.capability;
  const cap = capability
    ? project.capabilities.find((c) => c.id === capability)
    : project.capabilities.length === 1
      ? project.capabilities[0]
      : null;
  if (!cap) throw new Error('Select a known --capability ID');
  const base = { project: project.name, capability: cap.id, digest: cap.digest };
  const target = linked
    ? linked
    : options.operation
      ? { kind: 'operation', id: options.operation }
      : options.schema
        ? { kind: 'schema', id: options.schema }
        : null;
  if (target) {
    if (!target.kind) throw new Error('Use --entity KIND:ID, for example --entity table:orders');
    const entity = entitiesOf(cap).find((e) => e.kind === target.kind && e.id === target.id);
    if (!entity) throw new Error(`Unknown ${target.kind}: ${target.id}`);
    return { ...base, ...entityPacket(project, cap, entity, visualMetadata, options.section) };
  }
  if (selectors.length) {
    const kind = selectors[0],
      id = options[kind];
    const item = cap[kind === 'rule' ? 'rules' : kind === 'example' ? 'examples' : 'checks'].find(
      (x) => x.id === id,
    );
    if (item === undefined) throw new Error(`Unknown ${kind}: ${id}`);
    const result = {
      ...base,
      [kind]: item,
      visuals: visualMetadata.filter(
        (v) => v.target.capability === cap.id && v.target.kind === kind && v.target.id === id,
      ),
    };
    if (kind === 'check')
      result.evidence = {
        status: evidence(cap, item),
        ...pick(cap.evidence?.results.find((r) => r.id === id) ?? {}, [
          'error',
          'missing',
          'skipped',
          'durationMs',
        ]),
      };
    return result;
  }
  return {
    ...base,
    ...pick(cap, ['title', 'description', 'url']),
    operations: operationsOf(cap).map((o) => pick(o, ['operationId', 'method', 'path', 'summary'])),
    ...(otherEntities(cap).length ? { entities: otherEntities(cap).map(summary) } : {}),
    rules: cap.rules.map((r) => r.id),
    examples: cap.examples.map((e) => ({ id: e.id, title: e.title })),
    visuals: visualMetadata.filter(
      (v) => v.target.capability === cap.id && v.target.kind === 'feature',
    ),
    sources: cap.files,
  };
}
export function encodeContext(packet, maxChars = 12000) {
  if (!Number.isInteger(maxChars) || maxChars < 100)
    throw new Error('--max-chars must be an integer of at least 100');
  const text = JSON.stringify(packet);
  if (text.length > maxChars)
    throw new Error(
      `Context is ${text.length} characters, above budget ${maxChars}. Select --section or a specific --rule/--schema/--example/--check, or increase --max-chars. No content was truncated.`,
    );
  return text;
}
