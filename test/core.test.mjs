import { temporaryDirectory as mkdtemp } from './helpers.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, symlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { loadProject, validateProject, projectPath, packageRoot } from '../src/core.mjs';
import { runCheck, verifyCapability } from '../src/verify.mjs';
import { compareModels, exportViewer } from '../src/server.mjs';
import { parse, stringify } from 'yaml';

const cli = path.join(packageRoot, 'bin/mhproto.mjs');
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mhproto-test-'));
  execFileSync(process.execPath, [cli, 'init', '--root', root, '--no-skills']);
  return root;
}
async function editYaml(root, relative, change) {
  const file = path.join(root, relative),
    data = parse(await readFile(file, 'utf8'));
  change(data);
  await writeFile(file, stringify(data));
}
const checksPath = 'mhproto/capabilities/example/checks.yaml';

test('init produces a valid draft and refuses to overwrite it', async () => {
  const root = await fixture(),
    project = await loadProject(root);
  const issues = await validateProject(project);
  assert.equal(issues.filter((i) => i.level === 'error').length, 0);
  assert.ok(issues.some((i) => i.message.includes('no linked executable check')));
  assert.throws(
    () =>
      execFileSync(process.execPath, [cli, 'init', '--root', root, '--no-skills'], {
        stdio: 'pipe',
      }),
    /Command failed/,
  );
});

test('payload mismatch, dangling rules and bad local refs are errors', async () => {
  const root = await fixture();
  await editYaml(root, 'mhproto/interfaces/openapi.yaml', (doc) => {
    const op = doc.paths['/status'].get;
    op['x-mhproto-rules'].push('MISSING-B-2');
    op.responses['200'].content['application/json'].example = { status: 42 };
    doc.components = { schemas: { Broken: { $ref: '#/components/schemas/Unknown' } } };
  });
  await editYaml(
    root,
    'mhproto.yaml',
    (doc) =>
      (doc.capabilities[0].presentation = {
        operations: { missingOperation: { rules: ['MISSING-B-3'] } },
      }),
  );
  const issues = await validateProject(await loadProject(root));
  assert.ok(issues.some((i) => i.message.includes('missing rule MISSING-B-2')));
  assert.ok(issues.some((i) => i.message.includes('must be string')));
  assert.ok(issues.some((i) => i.message.includes('Unresolved reference')));
  assert.ok(issues.some((i) => i.message.includes('missing operation missingOperation')));
  assert.ok(issues.some((i) => i.message.includes('missing rule MISSING-B-3')));
});

test('schema requests and declared response examples are validated', async () => {
  const root = await fixture();
  await editYaml(root, 'mhproto/interfaces/openapi.yaml', (doc) => {
    doc.paths['/status'].get.requestBody = {
      content: {
        'application/json': {
          schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
        },
      },
    };
  });
  await editYaml(root, 'mhproto/capabilities/example/examples.yaml', (doc) => {
    doc.examples[0].request = { operation: 'getStatus', body: { id: 'wrong' } };
    doc.examples[0].response = { status: 418, body: { status: 'ready' } };
  });
  const issues = await validateProject(await loadProject(root));
  assert.ok(issues.some((i) => i.message.includes('must be integer')));
  assert.ok(issues.some((i) => i.message.includes('undeclared response status')));
});

test('project paths cannot escape through traversal or symlinks', async () => {
  const root = await fixture(),
    outside = await mkdtemp(path.join(os.tmpdir(), 'mhproto-outside-'));
  await writeFile(path.join(outside, 'secret'), 'test only');
  await symlink(outside, path.join(root, 'escape'));
  await assert.rejects(projectPath(root, 'escape/secret'), /escapes project/);
  await assert.rejects(projectPath(root, path.join(outside, 'secret')), /project-relative/);
});

test('node reporter requires executed tests and rejects missing/skipped/failing tests', async () => {
  const root = await fixture();
  await writeFile(
    path.join(root, 'checks.mjs'),
    "import {test} from 'node:test';import assert from 'node:assert/strict';test('actual',()=>assert.equal(2+2,4));test.skip('skipped',()=>{});\n",
  );
  const command = [
    process.execPath,
    '--test',
    '--test-reporter',
    '{mhprotoNodeReporter}',
    'checks.mjs',
  ];
  const valid = await runCheck(
    { id: 'good', runner: 'node-test', command, testNames: ['actual'] },
    root,
  );
  assert.equal(valid.status, 'passing');
  const missing = await runCheck(
    { id: 'missing', runner: 'node-test', command, testNames: ['imaginary'] },
    root,
  );
  assert.equal(missing.status, 'failing');
  assert.deepEqual(missing.missing, ['imaginary']);
  const skipped = await runCheck(
    { id: 'skip', runner: 'node-test', command, testNames: ['skipped'] },
    root,
  );
  assert.equal(skipped.status, 'failing');
  assert.deepEqual(skipped.skipped, ['skipped']);
  await writeFile(
    path.join(root, 'checks.mjs'),
    "import {test} from 'node:test';test('actual',()=>{throw new Error('wrong behaviour')});\n",
  );
  const fail = await runCheck(
    { id: 'bad', runner: 'node-test', command, testNames: ['actual'] },
    root,
  );
  assert.equal(fail.status, 'failing');
  assert.ok(fail.tests.some((t) => t.type === 'test:fail'));
});

test('command failures and timeouts are recorded', async () => {
  const root = await fixture();
  const failed = await runCheck(
    { id: 'exit', command: [process.execPath, '-e', 'process.exit(7)'] },
    root,
  );
  assert.equal(failed.exitCode, 7);
  assert.equal(failed.status, 'failing');
  const timeout = await runCheck(
    { id: 'slow', command: [process.execPath, '-e', 'setInterval(()=>{},1000)'], timeoutMs: 80 },
    root,
  );
  assert.equal(timeout.timedOut, true);
  assert.equal(timeout.status, 'failing');
});

test('evidence becomes stale after either a spec or tracked implementation change', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'implementation.mjs'), 'export const value=1;\n');
  await editYaml(
    root,
    'mhproto.yaml',
    (doc) => (doc.capabilities[0].sources = ['implementation.mjs']),
  );
  await editYaml(
    root,
    checksPath,
    (doc) =>
      (doc.checks = [
        {
          id: 'EXAMPLE-V-1',
          command: [process.execPath, '-e', 'process.exit(0)'],
          rules: ['EXAMPLE-B-1'],
          examples: ['EXAMPLE-E-1'],
        },
      ]),
  );
  let p = await loadProject(root);
  await verifyCapability(p, p.capabilities[0]);
  assert.equal((await loadProject(root)).capabilities[0].evidence.stale, false);
  await writeFile(path.join(root, 'implementation.mjs'), 'export const value=2;\n');
  p = await loadProject(root);
  assert.equal(p.capabilities[0].evidence.stale, true);
  await verifyCapability(p, p.capabilities[0]);
  const file = path.join(root, 'mhproto/capabilities/example/spec.md');
  await writeFile(file, (await readFile(file, 'utf8')) + '\nA new failure case.\n');
  assert.equal((await loadProject(root)).capabilities[0].evidence.stale, true);
});

test('baseline diff includes rules and schema changes', async () => {
  const root = await fixture(),
    before = await loadProject(root);
  await editYaml(
    root,
    'mhproto/interfaces/openapi.yaml',
    (doc) => (doc.components = { schemas: { Added: { type: 'string' } } }),
  );
  const file = path.join(root, 'mhproto/capabilities/example/spec.md');
  await writeFile(file, (await readFile(file, 'utf8')) + '\n- **EXAMPLE-B-2** A new rule.\n');
  const changes = compareModels(before, await loadProject(root));
  assert.ok(
    changes.some((c) => c.kind === 'rule' && c.id === 'EXAMPLE-B-2' && c.status === 'added'),
  );
  assert.ok(changes.some((c) => c.kind === 'schema' && c.id === 'Added'));
});

test('standalone viewer escapes embedded data and compiles its bundled script', async () => {
  const root = await fixture();
  const file = path.join(root, 'mhproto/capabilities/example/spec.md');
  await writeFile(file, (await readFile(file, 'utf8')) + '\n</script><script>evil()</script>\n');
  const output = path.join(root, 'export');
  await exportViewer(root, output);
  const html = await readFile(path.join(output, 'viewer.html'), 'utf8');
  assert.ok(html.includes('id="mhproto-model"'));
  assert.ok(!html.includes('</script><script>evil()'));
  assert.ok(html.includes('\\u003c/script>'));
  const embeddedApp = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new Function(`return (async()=>{${embeddedApp}\n})()`));
});
