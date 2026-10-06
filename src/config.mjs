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
// A plugin list entry: `name` or `[name, options]`, as in Babel.
const pluginEntry = {
  anyOf: [
    text,
    {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: [text, { type: 'object' }],
      additionalItems: false,
    },
  ],
};
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
  config: strictObject(
    {
      version: { const: 1 },
      name: text,
      system: text,
      presets: { type: 'array', items: pluginEntry },
      plugins: { type: 'array', items: pluginEntry },
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
            interfaces: {
              type: 'array',
              items: strictObject({ adapter: text, file: text, options: { type: 'object' } }, [
                'adapter',
                'file',
              ]),
            },
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
          ['id', 'spec'],
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
  Object.entries(shapes).map(([name, schema]) => [name, shapeAsserter(schema)]),
);

export function assertShape(name, value, file) {
  return validators[name](value, file);
}

// Returns (value, file) => value, throwing one readable error that names the file.
export function shapeAsserter(schema, validator = ajv) {
  const validates = validator.compile(schema);
  return (value, file) => assertWith(validates, value, file);
}

function assertWith(validates, value, file) {
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
