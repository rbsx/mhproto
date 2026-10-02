import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { packageRoot } from '../src/core.mjs';
import { model } from '../src/server.mjs';
import { contractSnapshot } from '../viewer/diff.js';

export async function createBrowserFixture(root) {
  execFileSync(process.execPath, [
    path.join(packageRoot, 'bin/mhproto.mjs'),
    'init',
    '--root',
    root,
    '--no-skills',
  ]);
  const configFile = path.join(root, 'mhproto.yaml');
  const config = parse(await readFile(configFile, 'utf8'));
  config.name = 'Browser fixture';
  Object.assign(config.capabilities[0], {
    title: 'Status',
    description: 'Loads the service status and its owner. An authorised client can update it.',
    url: '/status',
    presentation: {
      operations: {
        getStatus: {
          diagrams: [
            {
              title: 'Read status',
              source:
                'flowchart TD\n A["Request"] --> B{"Available?"}\n B -->|Yes|C["Status"]\n B -->|No|D["Error"]',
            },
          ],
        },
      },
    },
  });
  await writeFile(configFile, stringify(config));
  const interfaceFile = path.join(root, 'mhproto/interfaces/openapi.yaml');
  const doc = parse(await readFile(interfaceFile, 'utf8'));
  doc.components = {
    schemas: {
      Status: {
        type: 'object',
        required: ['status', 'owner'],
        properties: {
          status: { type: 'string', enum: ['ready', 'busy'] },
          owner: { anyOf: [{ $ref: '#/components/schemas/User' }, { type: 'null' }] },
        },
      },
      User: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' }, name: { type: 'string' } },
      },
    },
  };
  const get = doc.paths['/status'].get;
  get.summary = 'Read service status';
  get.parameters = [{ name: 'id', in: 'query', schema: { type: 'string' } }];
  const response = get.responses['200'].content['application/json'];
  response.schema = { $ref: '#/components/schemas/Status' };
  response.example = { status: 'ready', owner: null };
  doc.paths['/status'].post = {
    operationId: 'setStatus',
    summary: 'Update service status',
    'x-mhproto-rules': ['EXAMPLE-B-1'],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Status' } } },
    },
    responses: structuredClone(get.responses),
  };
  await writeFile(interfaceFile, stringify(doc));
  await mkdir(path.join(root, '.mhproto'));
  await writeFile(
    path.join(root, '.mhproto/baseline.json'),
    JSON.stringify(contractSnapshot(await model(root), { label: 'Before owner email' })),
  );
  doc.components.schemas.User.properties.email = { type: 'string', format: 'email' };
  await writeFile(interfaceFile, stringify(doc));
}
