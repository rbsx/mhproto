import Ajv from 'ajv';

const text = { type: 'string', minLength: 1 };
const texts = { type: 'array', items: text, uniqueItems: true };
const object = (properties, required = []) => ({ type: 'object', properties, required });
const strictObject = (properties, required = []) => ({
  ...object(properties, required),
  additionalProperties: false,
  patternProperties: { '^x-': {} },
});
const ajv = new Ajv({ allErrors: true });
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
  'x-preconditions': { type: 'array', items: { type: 'object' } },
});
const pathItem = object({
  parameters,
  ...Object.fromEntries(
    ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'].map((method) => [
      method,
      operation,
    ]),
  ),
});
const shapes = {
  evidence: object(
    {
      version: { const: 1 },
      capability: text,
      digest: text,
      finishedAt: text,
      results: {
        type: 'array',
        items: object(
          { id: text, status: { enum: ['passing', 'failing'] }, tests: { type: 'array' } },
          ['id', 'status'],
        ),
      },
    },
    ['version', 'capability', 'digest', 'finishedAt', 'results'],
  ),
  openapi: object({
    openapi: text,
    info: { type: 'object' },
    paths: { type: 'object', additionalProperties: pathItem },
    components: object({ schemas: { type: 'object', additionalProperties: schema } }),
  }),
  config: strictObject(
    {
      version: { const: 1 },
      name: text,
      system: text,
      capabilities: {
        type: 'array',
        minItems: 1,
        items: strictObject(
          {
            id: { ...text, pattern: '^[a-z][a-z0-9-]*$' },
            title: text,
            description: { type: 'string' },
            owner: text,
            spec: text,
            interface: text,
            examples: text,
            checks: text,
            sources: texts,
            gaps: texts,
            url: { ...text, pattern: '^/(?!/)' },
            presentation: strictObject({
              operationOrder: texts,
              ruleTitles: { type: 'object', additionalProperties: text },
              operations: {
                type: 'object',
                additionalProperties: strictObject({
                  description: { type: 'string' },
                  behaviour: { type: 'string' },
                  rules: texts,
                  ruleGroups: {
                    type: 'array',
                    items: strictObject(
                      { title: text, description: { type: 'string' }, rules: texts },
                      ['title', 'rules'],
                    ),
                  },
                  diagrams: {
                    type: 'array',
                    items: strictObject({ title: text, source: text }, ['title', 'source']),
                  },
                }),
              },
            }),
          },
          ['id', 'spec', 'interface', 'examples', 'checks'],
        ),
      },
    },
    ['version', 'capabilities'],
  ),
  examples: strictObject(
    {
      examples: {
        type: 'array',
        items: strictObject(
          {
            id: text,
            title: text,
            rules: texts,
            operations: texts,
            given: text,
            when: text,
            then: text,
            request: strictObject({ operation: text, body: {} }, ['operation']),
            response: strictObject(
              {
                status: { anyOf: [{ type: 'integer', minimum: 100, maximum: 599 }, text] },
                body: {},
              },
              ['status'],
            ),
          },
          ['id', 'given', 'when', 'then'],
        ),
      },
    },
    ['examples'],
  ),
  checks: strictObject(
    {
      checks: {
        type: 'array',
        items: strictObject(
          {
            id: text,
            title: text,
            description: { type: 'string' },
            rules: texts,
            examples: texts,
            files: texts,
            command: {
              type: 'array',
              minItems: 1,
              items: { type: 'string', pattern: '^[^\\u0000]*$' },
            },
            runner: { enum: ['command', 'node-test'] },
            testNames: { ...texts, minItems: 1 },
            timeoutMs: { type: 'integer', minimum: 1, maximum: 2147483647 },
            env: { type: 'object', additionalProperties: { type: 'string' } },
          },
          ['id', 'command'],
        ),
      },
    },
    ['checks'],
  ),
};
const validators = Object.fromEntries(
  Object.entries(shapes).map(([name, schema]) => [name, ajv.compile(schema)]),
);

export function assertShape(name, value, file) {
  const validates = validators[name];
  if (!validates(value))
    throw new Error(
      `${file}: ${validates.errors.map((e) => `${e.instancePath || '/'} ${e.message}${e.params.additionalProperty ? ` (${e.params.additionalProperty})` : ''}`).join('; ')}`,
    );
  // YAML aliases may share nodes, but cycles cannot be represented in exported JSON.
  try {
    JSON.stringify(value);
  } catch {
    throw new Error(`${file}: cyclic or excessively deep input cannot be exported as JSON`);
  }
  return value;
}
