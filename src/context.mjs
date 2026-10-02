// Scoped, deterministic retrieval. Images, logs and repeated schemas stay outside packets.
export function operationRuleIds(cap, op) {
  const p = cap.presentation?.operations?.[op.operationId] ?? {};
  return [...new Set([...(op.rules ?? []), ...(op['x-preconditions'] ?? []).map(x => x.fails?.clause), ...Object.values(op.responses ?? {}).flatMap(r => (r['x-error-codes'] ?? []).map(x => x.clause)), ...(p.rules ?? []), ...(p.ruleGroups ?? []).flatMap(g => g.rules ?? [])].filter(Boolean))];
}
const pick = (value, keys) => Object.fromEntries(keys.filter(k => value[k] !== undefined).map(k => [k, value[k]]));
const schemaRefs = value => [...new Set([...JSON.stringify(value).matchAll(/#\/components\/schemas\/([^"\\]+)/g)].map(m => m[1]))];
function rootSchema(cap, value) {
  const name = value?.$ref?.match(/^#\/components\/schemas\/(.+)$/)?.[1];
  return name ? { name, ...cap.openapi.components.schemas[name] } : value;
}
function evidence(cap, check) {
  if (!cap.evidence) return 'unchecked';
  if (cap.evidence.stale || cap.evidence.changedDuringRun) return 'stale';
  return cap.evidence.results.find(r => r.id === check.id)?.status ?? 'unchecked';
}
export function contextPacket(project, options = {}) {
  const selectors = ['operation', 'rule', 'schema', 'example', 'check', 'visual'].filter(k => options[k]);
  if (selectors.length > 1) throw new Error('Choose one selector: operation, rule, schema, example, check or visual');
  const visualMetadata = (project.visuals ?? []).map(v => pick(v, ['id', 'title', 'caption', 'kind', 'target', 'file', 'url', 'mime', 'sha256']));
  if (options.visual) {
    const visual = visualMetadata.find(v => v.id === options.visual);
    if (!visual) throw new Error(`Unknown visual: ${options.visual}`);
    return { project: project.name, visual, instruction: 'Open the local file or design link only when the visual is needed.' };
  }
  if (!options.capability && !selectors.length) return {
    project: project.name,
    features: project.capabilities.map(c => ({ id: c.id, title: c.title, url: c.url, operations: c.operations.map(o => pick(o, ['operationId', 'method', 'path', 'summary'])) })),
    read: 'mhproto context --capability ID --operation ID; use --rule, --schema, --example, --check or --visual for detail.',
  };
  const cap = options.capability ? project.capabilities.find(c => c.id === options.capability) : project.capabilities.length === 1 ? project.capabilities[0] : null;
  if (!cap) throw new Error('Select a known --capability ID');
  const base = { project: project.name, capability: cap.id, digest: cap.digest };
  if (selectors.length && !options.operation) {
    const kind = selectors[0], id = options[kind];
    const item = kind === 'schema' ? cap.openapi.components?.schemas?.[id] : cap[kind === 'rule' ? 'rules' : kind === 'example' ? 'examples' : 'checks'].find(x => x.id === id);
    if (!item) throw new Error(`Unknown ${kind}: ${id}`);
    const result = { ...base, [kind]: item, visuals: visualMetadata.filter(v => v.target.capability === cap.id && v.target.kind === kind && v.target.id === id) };
    if (kind === 'check') result.evidence = { status: evidence(cap, item), ...pick(cap.evidence?.results.find(r => r.id === id) ?? {}, ['error', 'missing', 'skipped', 'durationMs']) };
    if (kind === 'schema') result.referencedSchemas = schemaRefs(item);
    return result;
  }
  if (!options.operation) return {
    ...base, ...pick(cap, ['title', 'description', 'url']),
    operations: cap.operations.map(o => pick(o, ['operationId', 'method', 'path', 'summary'])),
    rules: cap.rules.map(r => r.id), examples: cap.examples.map(e => ({ id: e.id, title: e.title })),
    visuals: visualMetadata.filter(v => v.target.capability === cap.id && v.target.kind === 'feature'),
    sources: cap.files,
  };
  const op = cap.operations.find(o => o.operationId === options.operation);
  if (!op) throw new Error(`Unknown operation: ${options.operation}`);
  const p = cap.presentation?.operations?.[op.operationId] ?? {}, ids = operationRuleIds(cap, op);
  const grouped = new Set((p.ruleGroups ?? []).flatMap(g => g.rules ?? []));
  const examples = cap.examples.filter(e => e.operations?.includes(op.operationId));
  const request = { parameters: op.parameters ?? [], body: rootSchema(cap, op.requestBody?.content?.['application/json']?.schema), required: op.requestBody?.required };
  const response = Object.fromEntries(Object.entries(op.responses ?? {}).filter(([status]) => /^2/.test(status)).map(([status, r]) => [status, { description: r.description, schema: rootSchema(cap, r.content?.['application/json']?.schema) }]));
  const errorResponses = Object.entries(op.responses ?? {}).filter(([status]) => !/^2/.test(status));
  const errorSchemas = [...new Map(errorResponses.map(([,r]) => rootSchema(cap,r.content?.['application/json']?.schema)).filter(Boolean).map(s => [JSON.stringify(s),s])).values()];
  const fields = {
    request, response,
    behaviour: { rules: cap.rules.filter(r => ids.includes(r.id) && !grouped.has(r.id)), preconditions: (op['x-preconditions'] ?? []).map(x => pick(x, ['needs', 'requires', 'description', 'fails'])), deferredGroups: (p.ruleGroups ?? []).map(g => ({ title: g.title, rules: g.rules, read: 'Fetch each --rule ID before changing this behaviour.' })) },
    errors: { cases: errorResponses.flatMap(([status, r]) => (r['x-error-codes'] ?? [{ when: r.description }]).map(e => ({ status, ...e }))), schemas: errorSchemas },
    examples: examples.map(e => pick(e, ['id', 'title', 'rules', 'given', 'when', 'then'])),
    checks: cap.checks.filter(c => c.rules?.some(id => ids.includes(id)) || c.examples?.some(id => examples.some(e => e.id === id))).map(c => ({ ...pick(c, ['id', 'title', 'rules', 'examples']), status: evidence(cap, c) })),
    visuals: visualMetadata.filter(v => v.target.capability === cap.id && ((v.target.id === op.operationId && ['operation', 'request', 'response', 'field'].includes(v.target.kind)) || (v.target.kind === 'schema' && schemaRefs(op).includes(v.target.id)) || (v.target.kind === 'rule' && ids.includes(v.target.id)) || (v.target.kind === 'example' && examples.some(e => e.id === v.target.id)))),
    sources: { ...cap.files, implementation: cap.sources },
  };
  const selected = options.section ? options.section.split(',') : ['request', 'response', 'behaviour', 'errors', 'examples', 'checks', 'visuals'];
  if (selected.some(k => !(k in fields))) throw new Error('Sections: request,response,behaviour,errors,examples,checks,visuals,sources');
  const result = { ...base, operation: pick(op, ['operationId', 'method', 'path', 'summary']), ...Object.fromEntries(selected.map(k => [k, fields[k]])) };
  const refs = schemaRefs({ request: result.request, response: result.response, errors: result.errors });
  if (refs.length) result.referencedSchemas = refs;
  return result;
}
export function encodeContext(packet, maxChars = 12000) {
  if (!Number.isInteger(maxChars) || maxChars < 100) throw new Error('--max-chars must be an integer of at least 100');
  const text = JSON.stringify(packet);
  if (text.length > maxChars) throw new Error(`Context is ${text.length} characters, above budget ${maxChars}. Select --section or a specific --rule/--schema/--example/--check, or increase --max-chars. No content was truncated.`);
  return text;
}
