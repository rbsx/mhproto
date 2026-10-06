// Built-in OpenAPI 3.1 support, written against the public plugin API.
import { definePlugin, shapeAsserter } from '../../plugin.mjs';
import { openapiEntities, operationRuleIds } from '../../../viewer/diff.js';
import { localRef, methods, operationList, resolveObject, schemaValidator } from './document.mjs';

const text = { type: 'string', minLength: 1 };
const texts = { type: 'array', items: text, uniqueItems: true };
const object = (properties, required = []) => ({ type: 'object', properties, required });
const schema = { anyOf: [{ type: 'object' }, { type: 'boolean' }] };
const reference = object({ $ref: text }, ['$ref']);
const media = object({
  schema,
  examples: { type: 'object', additionalProperties: { type: 'object' } },
});
const content = { type: 'object', additionalProperties: media };
const parameter = {
  anyOf: [
    reference,
    object(
      {
        name: text,
        in: { enum: ['path', 'query', 'header', 'cookie'] },
        schema,
        required: { type: 'boolean' },
      },
      ['name', 'in'],
    ),
  ],
};
const parameters = { type: 'array', items: parameter };
const body = object({ content, required: { type: 'boolean' } });
const response = object({ content, 'x-error-codes': { type: 'array', items: { type: 'object' } } });
const operation = object({
  operationId: text,
  parameters,
  requestBody: body,
  responses: { type: 'object', additionalProperties: response },
  'x-mhproto-rules': texts,
  'x-clauses': texts,
  'x-mhproto-links': texts,
  'x-preconditions': { type: 'array', items: { type: 'object' } },
});
const pathItem = object({
  parameters,
  ...Object.fromEntries([...methods].map((method) => [method, operation])),
});
const assertOpenapi = shapeAsserter(
  object({
    openapi: text,
    info: { type: 'object' },
    paths: { type: 'object', additionalProperties: pathItem },
    components: object({ schemas: { type: 'object', additionalProperties: schema } }),
  }),
);

const validators = new WeakMap();
function validatorFor(document) {
  if (!validators.has(document)) validators.set(document, schemaValidator(document));
  return validators.get(document);
}
const findOperation = (cap, id) => cap.operations.find((o) => o.operationId === id);

function validate({ document: doc }, ctx) {
  const cap = ctx.capability;
  if (!['3.1.0', '3.1.1', '3.1.2'].includes(doc?.openapi))
    ctx.error('V0 supports OpenAPI 3.1 JSON Schema contracts');
  if (!doc?.info?.title || !doc?.info?.version)
    ctx.error('OpenAPI info.title and info.version are required');
  let validates;
  try {
    validates = validatorFor(doc);
  } catch (error) {
    ctx.error(error.message);
  }
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.$ref === 'string') {
      try {
        localRef(doc, node.$ref);
      } catch (e) {
        ctx.error(e.message);
      }
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(doc);
  const validateData = (schema, data, context) => {
    if (schema === undefined || !validates) return;
    try {
      for (const error of validates(schema, data)) ctx.error(`${context}: ${error}`);
    } catch (error) {
      ctx.error(`${context}: ${error.message}`);
    }
  };
  const validateMedia = (media, context) => {
    if (media.schema !== undefined) {
      try {
        validates?.(media.schema, undefined);
      } catch (error) {
        ctx.error(`${context} schema: ${error.message}`);
      }
    }
    if ('example' in media) validateData(media.schema, media.example, context);
    for (const [name, raw] of Object.entries(media.examples ?? {})) {
      try {
        const example = resolveObject(doc, raw);
        if (Object.hasOwn(example, 'value'))
          validateData(media.schema, example.value, `${context} example ${name}`);
      } catch (error) {
        ctx.error(`${context} example ${name}: ${error.message}`);
      }
    }
  };
  for (const [name, schema] of Object.entries(doc.components?.schemas ?? {})) {
    try {
      validates?.(schema, undefined);
    } catch (e) {
      ctx.error(`Schema ${name}: ${e.message}`);
    }
  }
  // Operation IDs and rule links are checked by core for every entity.
  for (const op of cap.operations) {
    if (!op.responses || !Object.keys(op.responses).length)
      ctx.error(`${op.operationId} has no responses`);
    for (const param of op.path.matchAll(/\{([^}]+)\}/g)) {
      if (!op.parameters.some((p) => p.in === 'path' && p.name === param[1] && p.required === true))
        ctx.error(`${op.operationId} is missing required path parameter ${param[1]}`);
    }
    for (const param of op.parameters)
      validateMedia(param, `${op.operationId} ${param.in} parameter ${param.name}`);
    for (const [status, response] of Object.entries(op.responses ?? {})) {
      const item = resolveObject(doc, response);
      for (const media of Object.values(item?.content ?? {}))
        validateMedia(media, `${op.operationId} response ${status}`);
    }
    for (const media of Object.values(op.requestBody?.content ?? {}))
      validateMedia(media, `${op.operationId} request`);
  }
  for (const transition of [...cap.transitions, ...cap.nonTransitions])
    if (transition.clause) ctx.cite(transition.clause, 'Transition');
}

function validateExample(example, ctx) {
  const cap = ctx.capability,
    op = example.request && findOperation(cap, example.request.operation);
  if (!op) return;
  let validates;
  try {
    validates = validatorFor(cap.openapi);
  } catch {
    return; // Reported by validate().
  }
  const validateData = (schema, data, context) => {
    if (schema === undefined) return;
    try {
      for (const error of validates(schema, data)) ctx.error(`${context}: ${error}`);
    } catch (error) {
      ctx.error(`${context}: ${error.message}`);
    }
  };
  const schema = resolveObject(cap.openapi, op.requestBody)?.content?.['application/json']?.schema;
  if (schema !== undefined) validateData(schema, example.request.body, example.id + ' request');
  if (example.response) {
    const code = String(example.response.status);
    const response =
      op.responses?.[code] ?? op.responses?.[code[0] + 'XX'] ?? op.responses?.default;
    if (!response) ctx.error(`${example.id} has undeclared response status`);
    else
      validateData(
        response.content?.['application/json']?.schema,
        example.response.body,
        example.id + ' response',
      );
  }
}

// Context packets. Images, logs and repeated schemas stay outside packets.
const pick = (value, keys) =>
  Object.fromEntries(keys.filter((k) => value[k] !== undefined).map((k) => [k, value[k]]));
export const schemaRefs = (value) => {
  const names = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const match = node.$ref?.match(/^#\/components\/schemas\/([^/]+)(?:\/.*)?$/);
    if (match) names.add(decodeURIComponent(match[1]).replaceAll('~1', '/').replaceAll('~0', '~'));
    for (const item of Object.values(node)) visit(item);
  };
  visit(value);
  return [...names];
};
function rootSchema(cap, value) {
  const name = value?.$ref?.match(/^#\/components\/schemas\/([^/]+)$/)?.[1];
  if (!name) return value;
  const schema = localRef(cap.openapi, value.$ref);
  return {
    name: decodeURIComponent(name).replaceAll('~1', '/').replaceAll('~0', '~'),
    ...(typeof schema === 'boolean' ? { schema } : schema),
    ...Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$ref')),
  };
}
function schemaPacket(entity, ctx) {
  return {
    schema: entity.data.schema,
    visuals: ctx.visuals(entity),
    referencedSchemas: schemaRefs(entity.data.schema),
  };
}
function operationPacket(entity, ctx) {
  const cap = ctx.capability,
    op = entity.data;
  const p = cap.presentation?.operations?.[op.operationId] ?? {},
    ids = operationRuleIds(cap, op);
  const grouped = new Set((p.ruleGroups ?? []).flatMap((g) => g.rules ?? []));
  const examples = cap.examples.filter((e) => e.operations?.includes(op.operationId));
  const request = {
    parameters: (op.parameters ?? []).map((p) =>
      Object.fromEntries(
        Object.entries(p).filter(([key]) => !['example', 'examples'].includes(key)),
      ),
    ),
    body: rootSchema(cap, op.requestBody?.content?.['application/json']?.schema),
    required: op.requestBody?.required,
  };
  const response = Object.fromEntries(
    Object.entries(op.responses ?? {})
      .filter(([status]) => /^2/.test(status))
      .map(([status, r]) => [
        status,
        {
          description: r.description,
          schema: rootSchema(cap, r.content?.['application/json']?.schema),
        },
      ]),
  );
  const errorResponses = Object.entries(op.responses ?? {}).filter(
    ([status]) => !/^2/.test(status),
  );
  const errorSchemas = [
    ...new Map(
      errorResponses
        .map(([, r]) => rootSchema(cap, r.content?.['application/json']?.schema))
        .filter((schema) => schema !== undefined)
        .map((s) => [JSON.stringify(s), s]),
    ).values(),
  ];
  const fields = {
    request,
    response,
    behaviour: {
      rules: cap.rules.filter((r) => ids.includes(r.id) && !grouped.has(r.id)),
      preconditions: (op['x-preconditions'] ?? []).map((x) =>
        pick(x, ['needs', 'requires', 'description', 'fails']),
      ),
      deferredGroups: (p.ruleGroups ?? []).map((g) => ({
        title: g.title,
        rules: g.rules,
        read: 'Fetch each --rule ID before changing this behaviour.',
      })),
    },
    errors: {
      cases: errorResponses.flatMap(([status, r]) =>
        (r['x-error-codes'] ?? [{ when: r.description }]).map((e) => ({ status, ...e })),
      ),
      schemas: errorSchemas,
    },
    examples: examples.map((e) => pick(e, ['id', 'title', 'rules', 'given', 'when', 'then'])),
    checks: cap.checks
      .filter(
        (c) =>
          c.rules?.some((id) => ids.includes(id)) ||
          c.examples?.some((id) => examples.some((e) => e.id === id)),
      )
      .map((c) => ({
        ...pick(c, ['id', 'title', 'rules', 'examples']),
        status: ctx.evidence(c),
      })),
    visuals: ctx.visualMetadata.filter(
      (v) =>
        v.target.capability === cap.id &&
        ((v.target.id === op.operationId &&
          ['operation', 'request', 'response', 'field'].includes(v.target.kind)) ||
          (v.target.kind === 'schema' && schemaRefs(op).includes(v.target.id)) ||
          (v.target.kind === 'rule' && ids.includes(v.target.id)) ||
          (v.target.kind === 'example' && examples.some((e) => e.id === v.target.id))),
    ),
    sources: { ...cap.files, implementation: cap.sources },
  };
  const result = {
    operation: pick(op, ['operationId', 'method', 'path', 'summary']),
    // Only operations that declare x-mhproto-links carry this field.
    ...(entity.links.length ? { links: ctx.defaults(entity).links } : {}),
    ...ctx.select(fields),
  };
  const refs = schemaRefs({
    request: result.request,
    response: result.response,
    errors: result.errors,
  });
  if (refs.length) result.referencedSchemas = refs;
  return result;
}

// Visual targets: operation/request/response/field by operationId, schema by name.
function resolve(cap, schema) {
  let current = schema,
    seen = new Set();
  while (current?.$ref) {
    if (seen.has(current.$ref)) return {};
    seen.add(current.$ref);
    let value = cap.openapi;
    for (const part of current.$ref.slice(2).split('/'))
      value = value?.[part.replaceAll('~1', '/').replaceAll('~0', '~')];
    current = value;
  }
  return current ?? {};
}
function propertyAt(cap, schema, parts) {
  const s = resolve(cap, schema);
  if (!parts.length) return s;
  if (s.anyOf || s.oneOf || s.allOf)
    return (s.anyOf ?? s.oneOf ?? s.allOf)
      .map((item) => propertyAt(cap, item, parts))
      .find((schema) => schema != null);
  const [part, ...rest] = parts;
  const child = part === '*' ? s.items : s.properties?.[part];
  return child !== undefined ? propertyAt(cap, child, rest) : null;
}
function visualTarget(target, { capability: cap }) {
  if (target.kind === 'schema')
    return Object.hasOwn(cap.openapi.components?.schemas ?? {}, target.id)
      ? null
      : 'Visual references an unknown schema';
  if (!['operation', 'request', 'response', 'field'].includes(target.kind)) return undefined;
  const op = findOperation(cap, target.id);
  if (!op) return 'Visual references an unknown operation';
  if (target.kind === 'response' && target.status && !op.responses?.[target.status])
    return 'Visual references an unknown response';
  if (target.kind === 'field') {
    if (
      !['request', 'response'].includes(target.scope) ||
      typeof target.path !== 'string' ||
      !target.path.startsWith('/')
    )
      return 'Field visual requires request/response scope and a JSON pointer';
    let schema;
    if (target.scope === 'response')
      schema =
        op.responses?.[target.status ?? Object.keys(op.responses).find((s) => /^2/.test(s))]
          ?.content?.['application/json']?.schema;
    else
      schema = {
        type: 'object',
        properties: {
          body: op.requestBody?.content?.['application/json']?.schema,
          ...Object.fromEntries(
            ['path', 'query', 'header', 'cookie'].map((location) => [
              location,
              {
                type: 'object',
                properties: Object.fromEntries(
                  (op.parameters ?? [])
                    .filter((p) => p.in === location)
                    .map((p) => [p.name, p.schema]),
                ),
              },
            ]),
          ),
        },
      };
    if (
      propertyAt(
        cap,
        schema,
        target.path
          .slice(1)
          .split('/')
          .map((p) => p.replaceAll('~1', '/').replaceAll('~0', '~')),
      ) == null
    )
      return 'Visual references an unknown field';
  }
  return null;
}

export default definePlugin(() => ({
  name: 'openapi',
  kinds: {
    operation: { label: 'API', plural: 'Endpoints' },
    schema: { label: 'Type', plural: 'Types', linkRequired: false },
  },
  interfaces: {
    openapi: {
      async load({ file, readYaml }) {
        const document = assertOpenapi(await readYaml(file), file);
        return {
          document,
          entities: openapiEntities({ operations: operationList(document), document, file }),
        };
      },
      validate,
      validateExample,
      packet: (entity, ctx) =>
        entity.kind === 'operation' ? operationPacket(entity, ctx) : schemaPacket(entity, ctx),
      visualTarget,
    },
  },
}));
