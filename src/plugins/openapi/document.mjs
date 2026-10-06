// OpenAPI 3.1 reading helpers. Pure functions over an already-parsed document.
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const methods = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
  'trace',
]);

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
