// Pure contract model helpers and comparison, shared by the CLI, server and browser.
const unordered = new Set([
  'links',
  'required',
  'enum',
  'type',
  'rules',
  'operations',
  'examples',
  'sources',
  'testNames',
  'x-mhproto-rules',
  'x-clauses',
]);
export function canonical(value, key = '', parents = []) {
  const path = [...parents, key];
  const literal =
    path.some(
      (part, i) =>
        ['example', 'default', 'const', 'value'].includes(part) && path[i - 1] !== 'properties',
    ) || path.some((part, i) => part === 'body' && ['request', 'response'].includes(path[i - 1]));
  if (Array.isArray(value)) {
    const items = value.map((v) => canonical(v, '', path));
    return !literal && unordered.has(key)
      ? items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      : items;
  }
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => [k, canonical(value[k], k, path)]),
    );
  return value;
}
// Entity view. Every interface adapter normalises its source into entities:
// { adapter, file, kind, id, title, summary, rules, links, data }.
// OpenAPI keeps its original capability fields (openapi, operations, transitions,
// nonTransitions) as the in-memory view the viewer renders. Its entities are always
// derived from that view, so the two cannot disagree; serialised snapshots store
// entities instead and the view is rebuilt when they are read.
const openapiView = ['openapi', 'operations', 'transitions', 'nonTransitions'];
const linkedRules = (op) => [
  ...new Set(
    [
      ...(op.rules ?? []),
      ...(op['x-preconditions'] ?? []).map((x) => x.fails?.clause),
      ...Object.values(op.responses ?? {}).flatMap((r) =>
        (r['x-error-codes'] ?? []).map((x) => x.clause),
      ),
    ].filter(Boolean),
  ),
];
// Rules shown and packed with an operation: its contract links plus presentation groups.
export function operationRuleIds(cap, op) {
  const p = cap.presentation?.operations?.[op.operationId] ?? {};
  return [
    ...new Set([
      ...linkedRules(op),
      ...[...(p.rules ?? []), ...(p.ruleGroups ?? []).flatMap((g) => g.rules ?? [])].filter(
        Boolean,
      ),
    ]),
  ];
}
// `kind:id` or `capability/kind:id`; objects pass through.
export function entityLink(value) {
  if (value && typeof value === 'object') return value;
  const match = /^(?:([a-z][a-z0-9-]*)\/)?([a-z][a-z0-9-]*):(.+)$/.exec(String(value));
  return match
    ? { ...(match[1] ? { capability: match[1] } : {}), kind: match[2], id: match[3] }
    : { kind: '', id: String(value) };
}
export function openapiEntities({ operations = [], document, file }) {
  return [
    ...operations.map((op) => ({
      adapter: 'openapi',
      file,
      kind: 'operation',
      id: op.operationId,
      title: `${op.method} ${op.path}`,
      ...(op.summary ? { summary: op.summary } : {}),
      rules: linkedRules(op),
      links: (op['x-mhproto-links'] ?? []).map(entityLink),
      data: op,
    })),
    ...Object.entries(document?.components?.schemas ?? {}).map(([name, schema]) => ({
      adapter: 'openapi',
      file,
      kind: 'schema',
      id: name,
      title: name,
      rules: [],
      links: [],
      data: { name, schema },
    })),
  ];
}
export function entitiesOf(cap) {
  const others = (cap?.entities ?? []).filter((e) => e.adapter !== 'openapi');
  if (!cap?.openapi) return others;
  return [
    ...openapiEntities({
      operations: cap.operations,
      document: cap.openapi,
      file: cap.files?.interface,
    }),
    ...others,
  ];
}
export function interfacesOf(cap) {
  return (
    cap?.interfaces ?? (cap?.openapi ? [{ adapter: 'openapi', file: cap.files?.interface }] : [])
  ).map((item) => (item.adapter === 'openapi' ? { ...item, document: cap.openapi } : item));
}
function withOpenapiView(cap) {
  if (cap.openapi || !Array.isArray(cap.interfaces)) return cap;
  const document = cap.interfaces.find((i) => i.adapter === 'openapi')?.document;
  if (!document) return cap;
  return {
    ...cap,
    openapi: document,
    operations: cap.entities
      .filter((e) => e.adapter === 'openapi' && e.kind === 'operation')
      .map((e) => e.data),
    transitions: document['x-phase-transitions'] ?? [],
    nonTransitions: document['x-phase-unchanged-by'] ?? [],
  };
}
export function snapshotProject(value) {
  const wrapped = ['mhproto-snapshot', 'bive-snapshot'].includes(value?.format);
  // Version 1 stored the OpenAPI view; version 2 stores interfaces and entities.
  if (wrapped && ![1, 2].includes(value.version))
    throw new Error('Unsupported MHProto snapshot version.');
  const project = wrapped ? value.project : value;
  if (
    !project ||
    !Array.isArray(project.capabilities) ||
    !project.capabilities.length ||
    typeof project.name !== 'string'
  )
    throw new Error('Choose a MHProto snapshot JSON or exported preview HTML.');
  const ids = new Set();
  for (const cap of project.capabilities) {
    if (
      !cap ||
      typeof cap.id !== 'string' ||
      ids.has(cap.id) ||
      !Array.isArray(cap.rules) ||
      !Array.isArray(cap.examples) ||
      !Array.isArray(cap.checks) ||
      (cap.openapi ? !Array.isArray(cap.operations) : !Array.isArray(cap.entities))
    )
      throw new Error('The baseline does not contain a valid MHProto contract.');
    ids.add(cap.id);
  }
  return wrapped && value.version === 2
    ? { ...project, capabilities: project.capabilities.map(withOpenapiView) }
    : project;
}
export function contractSnapshot(
  value,
  { label = 'Iteration baseline', createdAt = new Date().toISOString() } = {},
) {
  const project = snapshotProject(value);
  // Detach nested schemas and visuals: later viewer edits must not move the baseline.
  return JSON.parse(
    JSON.stringify({
      format: 'mhproto-snapshot',
      version: 2,
      label,
      createdAt,
      project: {
        name: project.name,
        system: project.system ?? '',
        visuals: project.visuals ?? [],
        capabilities: project.capabilities.map(({ evidence, digest, ...cap }) => ({
          ...Object.fromEntries(Object.entries(cap).filter(([key]) => !openapiView.includes(key))),
          interfaces: interfacesOf(cap),
          entities: entitiesOf(cap),
        })),
      },
    }),
  );
}
const status = (a, b) => (a === undefined ? 'added' : b === undefined ? 'removed' : 'changed');
export function fieldChanges(before, after, path = []) {
  if (
    JSON.stringify(canonical(before, path.at(-1), path.slice(0, -1))) ===
    JSON.stringify(canonical(after, path.at(-1), path.slice(0, -1)))
  )
    return [];
  const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
  if (object(before) && object(after))
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .sort()
      .flatMap((key) => fieldChanges(before[key], after[key], [...path, key]));
  return [
    {
      path,
      status: status(before, after),
      beforePresent: before !== undefined,
      afterPresent: after !== undefined,
      before: before ?? null,
      after: after ?? null,
    },
  ];
}
function behaviourText(text = '') {
  let rule = false,
    fence;
  return text
    .replaceAll('\r\n', '\n')
    .split('\n')
    .filter((line) => {
      const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker) {
        if (!fence) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
        rule = false;
        return true;
      }
      if (fence) return true;
      if (/^\s*-\s+\*\*[A-Z][A-Z0-9-]*-\d+\*\*/.test(line)) {
        rule = true;
        return false;
      }
      if (rule && /^\s{2,}\S/.test(line)) return false;
      rule = false;
      return true;
    })
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
export function compareModels(beforeValue, afterValue) {
  const before = snapshotProject(beforeValue),
    after = snapshotProject(afterValue),
    changes = [];
  const add = (capability, kind, id, a, b) => {
    const fields = fieldChanges(a, b);
    if (fields.length)
      changes.push({
        capability,
        kind,
        id,
        status: status(a, b),
        before: a ?? null,
        after: b ?? null,
        fields,
      });
  };
  const compare = (capability, kind, oldItems, newItems, key) => {
    const oldMap = new Map(oldItems.map((x) => [x[key], x])),
      newMap = new Map(newItems.map((x) => [x[key], x]));
    for (const id of new Set([...oldMap.keys(), ...newMap.keys()]))
      add(capability, kind, id, oldMap.get(id), newMap.get(id));
  };
  add(
    null,
    'system',
    'system',
    { name: before.name, system: before.system ?? '' },
    { name: after.name, system: after.system ?? '' },
  );
  const oldCaps = new Map(before.capabilities.map((c) => [c.id, c])),
    newCaps = new Map(after.capabilities.map((c) => [c.id, c]));
  const openapiGlobals = (doc) => {
    const { paths, components, ...api } = doc,
      { schemas, ...shared } = components ?? {};
    const pathItems = Object.fromEntries(
      Object.entries(paths ?? {}).map(([url, item]) => [
        url,
        Object.fromEntries(
          Object.entries(item).filter(
            ([key]) =>
              ![
                'get',
                'post',
                'put',
                'patch',
                'delete',
                'options',
                'head',
                'trace',
                'parameters',
              ].includes(key),
          ),
        ),
      ]),
    );
    return { ...api, components: shared, pathItems };
  };
  const feature = (cap) => {
    if (!cap) return undefined;
    const { operations, ruleTitles, ...presentation } = cap.presentation ?? {};
    const others = interfacesOf(cap).filter((i) => i.adapter !== 'openapi');
    return {
      title: cap.title ?? cap.id,
      description: cap.description ?? '',
      url: cap.url ?? '',
      behaviour: behaviourText(cap.prose),
      ...(cap.openapi
        ? {
            api: openapiGlobals(cap.openapi),
            transitions: cap.transitions ?? [],
            nonTransitions: cap.nonTransitions ?? [],
          }
        : {}),
      ...(others.length
        ? {
            interfaces: Object.fromEntries(
              others.map((i) => [i.adapter, { file: i.file, meta: i.meta ?? null }]),
            ),
          }
        : {}),
      presentation,
      files: cap.files ?? {},
      sources: cap.sources ?? [],
      gaps: cap.gaps ?? [],
    };
  };
  const rules = (cap) =>
    (cap?.rules ?? []).map((r) => ({ ...r, title: cap.presentation?.ruleTitles?.[r.id] ?? r.id }));
  // What a reviewer compares for each entity. OpenAPI keeps its established shapes.
  const comparable = (cap, entity) =>
    entity.adapter === 'openapi' && entity.kind === 'operation'
      ? { ...entity.data, presentation: cap.presentation?.operations?.[entity.id] ?? {} }
      : entity.adapter === 'openapi'
        ? entity.data
        : {
            title: entity.title,
            summary: entity.summary,
            rules: entity.rules,
            links: entity.links,
            data: entity.data,
          };
  const entities = (cap) =>
    entitiesOf(cap).map((entity) => ({
      kind: entity.kind,
      id: entity.id,
      value: comparable(cap, entity),
    }));
  for (const id of new Set([...oldCaps.keys(), ...newCaps.keys()])) {
    const a = oldCaps.get(id),
      b = newCaps.get(id);
    add(id, 'feature', id, feature(a), feature(b));
    compare(id, 'rule', rules(a), rules(b), 'id');
    const oldEntities = a ? entities(a) : [],
      newEntities = b ? entities(b) : [];
    for (const kind of new Set([...oldEntities, ...newEntities].map((e) => e.kind))) {
      const pick = (list) =>
        list.filter((e) => e.kind === kind).map((e) => ({ id: e.id, value: e.value }));
      const oldMap = new Map(pick(oldEntities).map((e) => [e.id, e.value])),
        newMap = new Map(pick(newEntities).map((e) => [e.id, e.value]));
      for (const entityId of new Set([...oldMap.keys(), ...newMap.keys()]))
        add(id, kind, entityId, oldMap.get(entityId), newMap.get(entityId));
    }
    compare(id, 'example', a?.examples ?? [], b?.examples ?? [], 'id');
    compare(id, 'check', a?.checks ?? [], b?.checks ?? [], 'id');
    compare(
      id,
      'visual',
      (before.visuals ?? []).filter((v) => v.target?.capability === id),
      (after.visuals ?? []).filter((v) => v.target?.capability === id),
      'id',
    );
  }
  return changes;
}
