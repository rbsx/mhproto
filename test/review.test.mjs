import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, symlink, readdir } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { parse, stringify } from 'yaml';
import { temporaryDirectory } from './helpers.mjs';
import {
  loadProject,
  validateProject,
  packageRoot,
  schemaValidator,
  operationList,
} from '../src/core.mjs';
import { contextPacket } from '../src/context.mjs';
import { runCheck, verifyCapability } from '../src/verify.mjs';
import { exportViewer } from '../src/server.mjs';
import { compareModels } from '../viewer/diff.js';

const cli = path.join(packageRoot, 'bin/mhproto.mjs');
async function fixture() {
  const root = await temporaryDirectory(path.join(os.tmpdir(), 'mhproto-review-'));
  execFileSync(process.execPath, [cli, 'init', '--root', root, '--no-skills']);
  return root;
}
async function edit(root, file, change) {
  const data = parse(await readFile(path.join(root, file), 'utf8'));
  change(data);
  await writeFile(path.join(root, file), stringify(data));
}

test('TODO tests cannot count as passing verification evidence', async () => {
  const root = await fixture();
  await writeFile(
    path.join(root, 'todo.mjs'),
    "import {test} from 'node:test';test.todo('pending');test('unfinished',{todo:true},()=>{throw Error('not implemented')});",
  );
  for (const name of ['pending', 'unfinished']) {
    const result = await runCheck(
      {
        id: name,
        runner: 'node-test',
        testNames: [name],
        command: [
          process.execPath,
          '--test',
          '--test-reporter',
          '{mhprotoNodeReporter}',
          'todo.mjs',
        ],
      },
      root,
    );
    assert.equal(result.status, 'failing');
    assert.deepEqual(result.todo, [name]);
  }
});

test('only complete terminal reporter events satisfy expected test names', async () => {
  const root = await fixture();
  const result = await runCheck(
    {
      id: 'event',
      runner: 'node-test',
      testNames: ['case'],
      command: [
        process.execPath,
        '-e',
        `console.log(JSON.stringify({type:'test:start',name:'case'}))`,
      ],
    },
    root,
  );
  assert.equal(result.status, 'failing');
  assert.match(result.error, /reporter/);
  const unicode = await runCheck(
    {
      id: 'unicode',
      runner: 'node-test',
      testNames: ['🧪'],
      command: [
        process.execPath,
        '-e',
        `const b=Buffer.from(JSON.stringify({type:'test:pass',name:'🧪'})+'\\n');const i=b.indexOf(0xf0)+1;process.stdout.write(b.subarray(0,i));setTimeout(()=>process.stdout.write(b.subarray(i)),20)`,
      ],
    },
    root,
  );
  assert.equal(unicode.status, 'passing');
});

test('boolean schemas and inline schemas without payload examples are checked', async () => {
  assert.ok(schemaValidator({})(false, { reject: true }).length);
  assert.deepEqual(schemaValidator({})(true, { allow: true }), []);
  const root = await fixture();
  await edit(root, 'mhproto/interfaces/openapi.yaml', (doc) => {
    const media = doc.paths['/status'].get.responses['200'].content['application/json'];
    media.schema = false;
    doc.paths['/status'].get.requestBody = {
      content: { 'application/json': { schema: { type: 'invalid-type' } } },
    };
  });
  const issues = await validateProject(await loadProject(root));
  assert.ok(issues.some((i) => i.message.includes('schema is false')));
  assert.ok(issues.some((i) => i.message.includes('request schema')));
});

test('local OpenAPI object references, parameter overrides and escaped type names survive context retrieval', async () => {
  const root = await fixture();
  await edit(root, 'mhproto/interfaces/openapi.yaml', (doc) => {
    doc.components = {
      parameters: { Id: { name: 'id', in: 'query', schema: { type: 'string' } } },
      requestBodies: {
        Body: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/A~1B' } } },
        },
      },
      responses: {
        Result: {
          description: 'Result',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/A~1B' } } },
        },
      },
      schemas: {
        'A/B': { type: 'object', properties: { value: { type: 'string' } } },
        Forbidden: false,
      },
    };
    const item = doc.paths['/status'];
    item.parameters = [{ $ref: '#/components/parameters/Id' }];
    item.get.parameters = [
      { name: 'id', in: 'query', required: true, schema: { type: 'integer' } },
    ];
    item.get.requestBody = { $ref: '#/components/requestBodies/Body' };
    item.get.responses = {
      200: { $ref: '#/components/responses/Result' },
      404: {
        description: 'No payload permitted',
        content: { 'application/json': { schema: false } },
      },
    };
  });
  const project = await loadProject(root),
    op = project.capabilities[0].operations[0];
  assert.equal(op.parameters.length, 1);
  assert.equal(op.parameters[0].schema.type, 'integer');
  const packet = contextPacket(project, { operation: 'getStatus' });
  assert.equal(packet.request.body.name, 'A/B');
  assert.equal(packet.response['200'].schema.properties.value.type, 'string');
  assert.deepEqual(packet.errors.schemas, [false]);
  assert.equal(contextPacket(project, { schema: 'Forbidden' }).schema, false);
  assert.equal((await validateProject(project)).filter((i) => i.level === 'error').length, 0);
  assert.throws(
    () =>
      operationList({
        paths: {
          '/x': {
            parameters: [
              { name: 'id', in: 'query' },
              { name: 'id', in: 'query' },
            ],
            get: {},
          },
        },
      }),
    /Duplicate parameter/,
  );
});

test('named media examples and response wildcards are validated', async () => {
  const root = await fixture();
  await edit(root, 'mhproto/interfaces/openapi.yaml', (doc) => {
    const op = doc.paths['/status'].get;
    const response = op.responses['200'];
    delete op.responses['200'];
    op.responses['2XX'] = response;
    response.content['application/json'].examples = { bad: { value: { status: 123 } } };
  });
  await edit(root, 'mhproto/capabilities/example/examples.yaml', (doc) => {
    doc.examples[0].request = { operation: 'getStatus' };
    doc.examples[0].response = { status: 201, body: { status: 'ready' } };
  });
  const issues = await validateProject(await loadProject(root));
  assert.ok(
    issues.some((i) => i.message.includes('example bad') && i.message.includes('must be string')),
  );
  assert.ok(!issues.some((i) => i.message.includes('undeclared response')));
});

test('configuration, system rules and declared check files invalidate old evidence', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'check.mjs'), '// version one\n');
  await edit(
    root,
    'mhproto/capabilities/example/checks.yaml',
    (doc) =>
      (doc.checks = [
        { id: 'check', files: ['check.mjs'], command: [process.execPath, '-e', 'process.exit(0)'] },
      ]),
  );
  for (const file of ['check.mjs', 'mhproto/system.md', 'mhproto.yaml']) {
    const project = await loadProject(root);
    await verifyCapability(project, project.capabilities[0]);
    await writeFile(
      path.join(root, file),
      (await readFile(path.join(root, file), 'utf8')) + '\n# Changed\n',
    );
    assert.equal((await loadProject(root)).capabilities[0].evidence.stale, true, file);
  }
});

test('generated evidence and exports refuse escaping symlinks', async () => {
  const root = await fixture(),
    outside = await temporaryDirectory(path.join(os.tmpdir(), 'mhproto-outside-'));
  await symlink(outside, path.join(root, '.mhproto'));
  const project = await loadProject(root);
  await assert.rejects(verifyCapability(project, project.capabilities[0]), /escapes project/);
  assert.deepEqual(await readdir(outside), []);
  await writeFile(path.join(outside, 'index.html'), 'keep');
  const output = await temporaryDirectory(path.join(os.tmpdir(), 'mhproto-export-'));
  await symlink(path.join(outside, 'index.html'), path.join(output, 'index.html'));
  await assert.rejects(exportViewer(root, output), /escapes project/);
  assert.equal(await readFile(path.join(outside, 'index.html'), 'utf8'), 'keep');
  await assert.rejects(exportViewer(root, root), /separate directory/);
  const alias = path.join(outside, 'project');
  await symlink(root, alias);
  await assert.rejects(exportViewer(root, alias), /separate directory/);
});

test('portable exports preserve evidence summaries without captured logs or machine paths', async () => {
  const root = await fixture();
  await edit(root, 'mhproto/capabilities/example/checks.yaml', (doc) => {
    doc.checks = [{ id: 'ready', command: [process.execPath, '-e', 'process.exit(0)'] }];
  });
  const project = await loadProject(root);
  await verifyCapability(project, project.capabilities[0]);
  const evidenceFile = path.join(root, '.mhproto/evidence/example.json');
  const evidence = JSON.parse(await readFile(evidenceFile, 'utf8'));
  const captured = 'captured-private-output-sentinel';
  Object.assign(evidence.results[0], {
    stdout: captured,
    stderr: captured,
    error: captured,
    command: [captured],
    tests: [{ type: 'test:pass', name: 'ready', message: captured }],
  });
  await writeFile(evidenceFile, JSON.stringify(evidence));
  const output = await temporaryDirectory(path.join(os.tmpdir(), 'mhproto-portable-'));
  await exportViewer(root, output);
  const portable = JSON.parse(await readFile(path.join(output, 'model.json'), 'utf8'));
  const result = portable.capabilities[0].evidence.results[0];
  assert.equal(result.status, 'passing');
  assert.equal(typeof result.durationMs, 'number');
  assert.deepEqual(result.tests, [{ type: 'test:pass', name: 'ready' }]);
  assert.equal(portable.root, undefined);
  const html = await readFile(path.join(output, 'viewer.html'), 'utf8');
  assert.ok(!html.includes(captured));
  assert.ok(!html.includes(root));
  assert.equal(portable.capabilities[0].checks[0].command[0], process.execPath);
});

test('CLI help never executes work and invalid options fail before scaffolding', async () => {
  const root = await temporaryDirectory(path.join(os.tmpdir(), 'mhproto-cli-'));
  for (const args of [['--help'], ['verify', '--help', '--root', root]]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Commands:/);
  }
  for (const args of [
    ['init', '--root', root, '--agent', 'unknown'],
    ['init', '--root', root, '--wat'],
    ['init', '--root'],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.ok(!result.stderr.includes('TypeError'));
  }
  assert.ok(!(await readdir(root)).includes('mhproto.yaml'));
});

test('malformed metadata is rejected with a source-file diagnostic', async () => {
  const root = await fixture();
  await edit(root, 'mhproto/capabilities/example/checks.yaml', (doc) => {
    doc.checks = [
      { id: 'valid', description: 'Document what this check establishes.', command: ['node'] },
    ];
  });
  await loadProject(root);
  await edit(
    root,
    'mhproto/capabilities/example/checks.yaml',
    (doc) => (doc.checks = [{ id: 'bad', command: ['node'], timeoutMs: 0 }]),
  );
  await assert.rejects(loadProject(root), /checks.yaml.*timeoutMs/);
});

test('comparison keeps payload array order and observes path-level metadata', async () => {
  const project = await loadProject(await fixture()),
    after = structuredClone(project);
  project.capabilities[0].examples[0].request = {
    operation: 'getStatus',
    body: { rules: ['first', 'second'] },
  };
  after.capabilities[0].examples[0].request = {
    operation: 'getStatus',
    body: { rules: ['second', 'first'] },
  };
  after.capabilities[0].openapi.paths['/status'].description = 'New path-level behaviour';
  const changes = compareModels(project, after);
  assert.ok(changes.some((c) => c.kind === 'example'));
  assert.ok(
    changes.some((c) => c.kind === 'feature' && c.fields.some((f) => f.path.includes('pathItems'))),
  );
});

test('fenced rule examples are prose, not extra normative rules or invisible diffs', async () => {
  const root = await fixture(),
    file = 'mhproto/capabilities/example/spec.md';
  const before = await loadProject(root);
  await writeFile(
    path.join(root, file),
    (await readFile(path.join(root, file), 'utf8')) +
      '\n```markdown\n- **EXAMPLE-B-99** An example of the rule format.\n```\n',
  );
  const after = await loadProject(root);
  assert.equal(after.capabilities[0].rules.length, 1);
  const changes = compareModels(before, after);
  assert.ok(
    changes.some((c) => c.kind === 'feature' && c.fields.some((f) => f.path.includes('behaviour'))),
  );
  assert.ok(!changes.some((c) => c.kind === 'rule'));
});
