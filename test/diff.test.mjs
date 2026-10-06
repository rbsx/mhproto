import { temporaryDirectory as mkdtemp, editOpenapi } from './helpers.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { JSDOM } from 'jsdom';
import { packageRoot } from '../src/core.mjs';
import { model, createHandler, exportViewer } from '../src/server.mjs';
import { compareModels, contractSnapshot, snapshotProject } from '../viewer/diff.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mhproto-diff-'));
  execFileSync(process.execPath, [
    path.join(packageRoot, 'bin/mhproto.mjs'),
    'init',
    '--root',
    root,
    '--no-skills',
  ]);
  return { root, project: await model(root) };
}
async function request(
  root,
  url,
  { method = 'GET', origin = 'http://127.0.0.1:4317', body = '{}', against } = {},
) {
  const req = Readable.from(method === 'POST' ? [Buffer.from(body)] : []);
  req.url = url;
  req.method = method;
  req.headers = { host: '127.0.0.1:4317', origin, 'content-type': 'application/json' };
  const result = { status: 200, body: '' },
    res = {
      setHeader() {},
      writeHead(status) {
        result.status = status;
        return this;
      },
      end(value = '') {
        result.body = String(value);
        return this;
      },
    };
  await createHandler(root, { against })(req, res);
  return result;
}

test('comparison ignores runtime evidence, key ordering and unordered contract sets', async () => {
  const { project } = await fixture(),
    after = structuredClone(project);
  const cap = after.capabilities[0],
    old = project.capabilities[0];
  const components = {
    schemas: {
      Sample: {
        type: 'object',
        required: ['a', 'b'],
        properties: { a: { type: 'string' }, b: { type: 'string', enum: ['x', 'y'] } },
      },
    },
  };
  editOpenapi(old, ({ openapi }) => (openapi.components = structuredClone(components)));
  editOpenapi(cap, ({ openapi }) => {
    openapi.components = structuredClone(components);
    openapi.components.schemas.Sample = {
      properties: { b: { enum: ['y', 'x'], type: 'string' }, a: { type: 'string' } },
      required: ['b', 'a'],
      type: 'object',
    };
  });
  after.root = '/different';
  after.issues = [{ level: 'warning' }];
  cap.digest = 'changed';
  cap.evidence = { finishedAt: 'later', stale: true, results: [{ status: 'failing' }] };
  assert.deepEqual(compareModels(project, after), []);
  assert.equal(JSON.stringify(project).includes('changed'), false);
});

test('comparison covers behaviour, API globals, nested types, examples, checks and visual metadata', async () => {
  const { project } = await fixture(),
    after = structuredClone(project),
    cap = after.capabilities[0];
  cap.description = 'Loads status';
  editOpenapi(cap, ({ openapi }) => (openapi.security = [{ token: [] }]));
  cap.presentation = { operations: { getStatus: { behaviour: 'Retry safely' } } };
  cap.rules.push({ id: 'EXAMPLE-B-2', text: 'New rule' });
  cap.prose += '\n- **EXAMPLE-B-2** New rule\n';
  editOpenapi(project.capabilities[0], ({ openapi }) => {
    openapi.components = {
      schemas: {
        Sample: {
          type: 'object',
          properties: { score: { type: 'number', minimum: 0 }, optional: { default: null } },
        },
      },
    };
  });
  editOpenapi(cap, ({ openapi }) => {
    openapi.components = {
      schemas: {
        Sample: {
          type: 'object',
          properties: { score: { type: 'number', minimum: 1 }, optional: { default: false } },
        },
      },
    };
  });
  cap.examples = [];
  cap.checks.push({ id: 'NEW-V-1', rules: ['EXAMPLE-B-2'], command: ['node', 'check.mjs'] });
  after.visuals = [
    {
      id: 'design',
      title: 'New design',
      target: { capability: cap.id, kind: 'feature' },
      url: 'https://example.com/design',
    },
  ];
  const changes = compareModels(project, after),
    type = changes.find((c) => c.kind === 'schema');
  assert.deepEqual(
    type.fields.map((f) => f.path),
    [
      ['schema', 'properties', 'optional', 'default'],
      ['schema', 'properties', 'score', 'minimum'],
    ],
  );
  assert.equal(type.fields[0].before, null);
  assert.equal(type.fields[0].beforePresent, true);
  for (const kind of ['feature', 'operation', 'rule', 'schema', 'example', 'check', 'visual'])
    assert.ok(
      changes.some((c) => c.kind === kind),
      kind,
    );
  assert.ok(
    changes.find((c) => c.kind === 'feature').fields.some((f) => f.path.includes('security')),
  );
  assert.ok(
    !changes.find((c) => c.kind === 'feature').fields.some((f) => f.path.includes('behaviour')),
    'Rules are compared once, separately from surrounding prose',
  );
  assert.equal(changes.find((c) => c.kind === 'example').status, 'removed');
});

test('snapshots omit execution evidence, support legacy baselines and reject malformed versions', async () => {
  const { project } = await fixture();
  project.capabilities[0].evidence = { huge: 'logs' };
  const saved = contractSnapshot(project, { label: 'Iteration 1', createdAt: '2026-10-01' });
  assert.equal(saved.project.root, undefined);
  assert.equal(saved.project.capabilities[0].evidence, undefined);
  assert.equal(saved.project.capabilities[0].digest, undefined);
  assert.deepEqual(compareModels(saved, project), []);
  assert.equal(saved.version, 2);
  assert.equal(saved.project.capabilities[0].operations, undefined);
  assert.deepEqual(
    saved.project.capabilities[0].entities.map((e) => [e.kind, e.id]),
    [['operation', 'getStatus']],
  );
  assert.equal(snapshotProject(project), project);
  assert.throws(() => snapshotProject({ ...saved, version: 3 }), /Unsupported/);
  assert.throws(() => snapshotProject({ name: 'Bad', capabilities: [{}] }), /valid MHProto/);
  project.capabilities[0].rules[0].text = 'Later edit';
  project.visuals.push({
    id: 'new',
    title: 'New visual',
    target: { capability: 'example', kind: 'feature' },
    url: 'https://example.com',
  });
  assert.notEqual(saved.project.capabilities[0].rules[0].text, 'Later edit');
  assert.equal(saved.project.visuals.length, 0);
  assert.ok(compareModels(saved, project).some((c) => c.kind === 'visual' && c.status === 'added'));
});

test('baseline API persists the current spec only for same-origin writes and supports an explicit comparison', async () => {
  const { root } = await fixture();
  assert.equal(JSON.parse((await request(root, '/api/baseline')).body), null);
  assert.equal(
    (await request(root, '/api/baseline', { method: 'POST', origin: 'https://outside.test' }))
      .status,
    403,
  );
  const saved = await request(root, '/api/baseline', { method: 'POST' });
  assert.equal(saved.status, 201);
  assert.equal(JSON.parse(saved.body).format, 'mhproto-snapshot');
  assert.equal(JSON.parse((await request(root, '/api/diff')).body).changes.length, 0);
  const file = path.join(root, 'mhproto/capabilities/example/spec.md');
  await writeFile(
    file,
    (await readFile(file, 'utf8')) + '\n- **EXAMPLE-B-2** Added after the baseline.\n',
  );
  assert.ok(
    JSON.parse((await request(root, '/api/diff')).body).changes.some(
      (c) => c.kind === 'rule' && c.id === 'EXAMPLE-B-2',
    ),
  );
  const alternate = path.join(root, 'iteration.json');
  await writeFile(alternate, saved.body);
  assert.equal(
    (await request(root, '/api/baseline', { method: 'POST', against: alternate })).status,
    409,
  );
  assert.equal(
    JSON.parse((await request(root, '/api/baseline', { against: alternate })).body).format,
    'mhproto-snapshot',
  );
});

test('standalone export embeds the selected baseline and runs its shared comparison without network access', async () => {
  const { root, project } = await fixture(),
    before = structuredClone(project);
  before.capabilities[0].rules = [];
  const baseline = path.join(root, 'iteration.json');
  await writeFile(
    baseline,
    JSON.stringify(contractSnapshot(before, { label: 'Previous iteration' })),
  );
  const destination = path.join(root, 'export');
  await exportViewer(root, destination, { against: baseline });
  const html = await readFile(path.join(destination, 'viewer.html'), 'utf8'),
    dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://mhproto.test/#/changes' });
  dom.window.fetch = () => {
    throw new Error('Export must not fetch');
  };
  dom.window.scrollTo = () => {};
  dom.window.mermaid = { initialize() {}, render: async () => ({ svg: '<svg></svg>' }) };
  for (const script of dom.window.document.querySelectorAll('script:not([type]):not([src])'))
    dom.window.eval(script.textContent);
  await dom.window.eval(
    `(async()=>{${html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]}\n})()`,
  );
  assert.equal(dom.window.document.querySelector('h1').textContent, 'Changes');
  assert.ok(dom.window.document.querySelector('.changes-list').textContent.includes('Added'));
  assert.ok(
    dom.window.document.querySelector('#content').textContent.includes('Previous iteration'),
  );
  assert.equal(dom.window.document.querySelectorAll('[data-add-visual]').length, 0);
  dom.window.close();
});
