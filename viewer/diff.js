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
// { adapter, file, kind, id, title, summary, rules, links, data }, plus interface-wide
// `meta`. OpenAPI is stored the same way: operations and named schemas are entities,
// and the rest of the document is its meta.
const isOpenapi = (item) => item.adapter === 'openapi';
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
// The interface-wide part of an OpenAPI document: everything except operations and
// named schemas, which are entities.
export function openapiGlobals(doc) {
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
}
// Earlier models and version 1 snapshots kept the OpenAPI document and operations on
// the capability; the first version 2 snapshots kept the whole document on the interface.
function normaliseCapability(cap) {
  if (cap.openapi) {
    const { openapi: document, operations, transitions, nonTransitions, ...rest } = cap;
    const file = cap.files?.interface;
    const item = { adapter: 'openapi', file, meta: openapiGlobals(document) };
    const interfaces = cap.interfaces ?? [{ adapter: 'openapi', file }];
    return {
      ...rest,
      interfaces: interfaces.map((i) => (isOpenapi(i) ? item : i)),
      entities: [
        ...openapiEntities({ operations, document, file }),
        ...(cap.entities ?? []).filter((e) => !isOpenapi(e)),
      ],
    };
  }
  // Loaded models keep documents as non-enumerable, in-memory properties.
  const stored = (i) => isOpenapi(i) && Object.prototype.propertyIsEnumerable.call(i, 'document');
  if (!cap.interfaces?.some(stored)) return cap;
  return {
    ...cap,
    interfaces: cap.interfaces.map((i) =>
      stored(i) ? { adapter: 'openapi', file: i.file, meta: openapiGlobals(i.document) } : i,
    ),
  };
}
export function entitiesOf(cap) {
  if (!cap) return [];
  return (cap.openapi ? normaliseCapability(cap).entities : cap.entities) ?? [];
}
export function interfacesOf(cap) {
  if (!cap) return [];
  return (cap.openapi ? normaliseCapability(cap).interfaces : cap.interfaces) ?? [];
}
// The OpenAPI document and operations as OpenAPI code reads them, rebuilt from meta
// and entities. Rebuilt objects share entity data, so schema identity is stable.
const views = new WeakMap();
export function openapiView(cap) {
  const item = interfacesOf(cap).find(isOpenapi);
  if (!item) return null;
  const entities = entitiesOf(cap);
  const cached = views.get(entities);
  if (cached?.item === item) return cached.view;
  const { pathItems, components, ...api } = item.meta ?? {};
  const own = entities.filter(isOpenapi);
  const document = {
    ...api,
    paths: pathItems ?? {},
    components: {
      ...components,
      schemas: Object.fromEntries(
        own.filter((e) => e.kind === 'schema').map((e) => [e.id, e.data.schema]),
      ),
    },
  };
  const view = {
    file: item.file,
    openapi: document,
    operations: own.filter((e) => e.kind === 'operation').map((e) => e.data),
    transitions: document['x-phase-transitions'] ?? [],
    nonTransitions: document['x-phase-unchanged-by'] ?? [],
  };
  views.set(entities, { item, view });
  return view;
}
export function snapshotProject(value) {
  const wrapped = ['mhproto-snapshot', 'bive-snapshot'].includes(value?.format);
  // Version 1 stored the OpenAPI document on capabilities; version 2 stores interfaces and entities.
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
      (cap.openapi ? !Array.isArray(cap.operations) : !Array.isArray(cap.entities)) ||
      (cap.entities ?? []).some(
        (e) =>
          !/^[a-z][a-z0-9-]*$/.test(e?.kind) || !Array.isArray(e.rules) || !Array.isArray(e.links),
      )
    )
      throw new Error('The baseline does not contain a valid MHProto contract.');
    ids.add(cap.id);
  }
  const capabilities = project.capabilities.map(normaliseCapability);
  return capabilities.every((cap, i) => cap === project.capabilities[i])
    ? project
    : { ...project, capabilities };
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
        capabilities: project.capabilities.map(({ evidence, digest, ...cap }) => cap),
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
  const feature = (cap) => {
    if (!cap) return undefined;
    const { operations, ruleTitles, ...presentation } = cap.presentation ?? {};
    const openapi = interfacesOf(cap).find(isOpenapi),
      others = interfacesOf(cap).filter((i) => !isOpenapi(i));
    return {
      title: cap.title ?? cap.id,
      description: cap.description ?? '',
      url: cap.url ?? '',
      behaviour: behaviourText(cap.prose),
      ...(openapi
        ? {
            api: openapi.meta,
            transitions: openapi.meta['x-phase-transitions'] ?? [],
            nonTransitions: openapi.meta['x-phase-unchanged-by'] ?? [],
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
    const compareKind = (kind) => {
      const pick = (list) =>
        new Map(list.filter((e) => e.kind === kind).map((e) => [e.id, e.value]));
      const oldMap = pick(oldEntities),
        newMap = pick(newEntities);
      for (const entityId of new Set([...oldMap.keys(), ...newMap.keys()]))
        add(id, kind, entityId, oldMap.get(entityId), newMap.get(entityId));
    };
    // OpenAPI types keep their established place after examples and checks.
    const kinds = [...new Set([...oldEntities, ...newEntities].map((e) => e.kind))];
    for (const kind of kinds) if (kind !== 'schema') compareKind(kind);
    compare(id, 'example', a?.examples ?? [], b?.examples ?? [], 'id');
    compare(id, 'check', a?.checks ?? [], b?.checks ?? [], 'id');
    if (kinds.includes('schema')) compareKind('schema');
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
