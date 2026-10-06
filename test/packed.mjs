import os from 'node:os';
import { createServer } from 'node:net';
import { chromium } from 'playwright';
import { mkdtemp, writeFile, readFile, mkdir, readdir, stat, rm } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
const archive = path.resolve(process.argv[2]);
const consumer = await mkdtemp(path.join(os.tmpdir(), 'mhproto-consumer-'));
const artifacts = fileURLToPath(new URL('../test-results/release/', import.meta.url));
try {
  await writeFile(
    path.join(consumer, 'package.json'),
    JSON.stringify(
      { name: 'mhproto-consumer-smoke', version: '1.0.0', private: true, type: 'module' },
      null,
      2,
    ),
  );
  await exec('npm', ['install', '--save-dev', '--ignore-scripts', archive], {
    cwd: consumer,
    maxBuffer: 2_000_000,
  });
  const binary = path.join(consumer, 'node_modules/.bin/mhproto');
  assert.ok((await stat(binary)).mode & 0o111);
  const cli = async (args) => {
    const result = await exec(binary, args, { cwd: consumer, maxBuffer: 5_000_000 });
    return result.stdout;
  };
  const publicImport = await exec(
    process.execPath,
    ['--input-type=module', '-e', "import('mhproto').then(m=>console.log(Object.keys(m)))"],
    { cwd: consumer },
  );
  assert.ok(publicImport.stdout.includes('validateProject'));
  assert.ok((await cli(['--help'])).toLowerCase().includes('mhproto'));
  const app = path.join(consumer, 'app');
  await mkdir(app);
  await cli(['init', '--root', app, '--agent', 'all']);
  for (const dir of ['.agents/skills', '.claude/skills'])
    assert.equal((await readdir(path.join(app, dir))).length, 6);
  const { parse, stringify } = await import(
    pathToFileURL(path.join(consumer, 'node_modules/yaml/dist/index.js'))
  );
  const config = parse(await readFile(path.join(app, 'mhproto.yaml'), 'utf8'));
  config.name = 'Installed tarball';
  config.capabilities[0].title = 'Status';
  config.capabilities[0].description = 'Read the service status and its owner.';
  config.capabilities[0].url = '/status';
  config.capabilities[0].sources = ['status.mjs', 'status.test.mjs'];
  config.capabilities[0].presentation = {
    operations: {
      getStatus: {
        diagrams: [{ title: 'Read status', source: 'flowchart LR\n Request --> Status' }],
      },
    },
  };
  await writeFile(path.join(app, 'mhproto.yaml'), stringify(config));
  const apiFile = path.join(app, 'mhproto/interfaces/openapi.yaml');
  const api = parse(await readFile(apiFile, 'utf8'));
  api.components = {
    schemas: {
      Status: {
        type: 'object',
        required: ['status', 'owner'],
        properties: {
          status: { type: 'string', enum: ['ready'] },
          owner: { $ref: '#/components/schemas/Owner' },
        },
      },
      Owner: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    },
  };
  const response = api.paths['/status'].get.responses['200'].content['application/json'];
  response.schema = { $ref: '#/components/schemas/Status' };
  response.example = { status: 'ready', owner: { id: 'maintainer' } };
  await writeFile(apiFile, stringify(api));
  await writeFile(
    path.join(app, 'status.mjs'),
    'export const status = () => ({status:"ready",owner:{id:"maintainer"}});\n',
  );
  await writeFile(
    path.join(app, 'status.test.mjs'),
    'import test from "node:test";import assert from "node:assert/strict";import {status} from "./status.mjs";test("status contract",()=>assert.deepEqual(status(),{status:"ready",owner:{id:"maintainer"}}));\n',
  );
  await writeFile(
    path.join(app, 'mhproto/capabilities/example/checks.yaml'),
    stringify({
      checks: [
        {
          id: 'EXAMPLE-V-1',
          title: 'Status contract',
          runner: 'node-test',
          command: [
            process.execPath,
            '--test',
            '--test-reporter',
            '{mhprotoNodeReporter}',
            'status.test.mjs',
          ],
          testNames: ['status contract'],
          files: ['status.test.mjs'],
          rules: ['EXAMPLE-B-1'],
          examples: ['EXAMPLE-E-1'],
        },
      ],
    }),
  );
  let issues = JSON.parse(await cli(['check', '--root', app, '--json'])).issues;
  assert.equal(issues.filter((i) => i.level === 'error').length, 0);
  assert.ok(
    (
      await cli(['context', '--root', app, '--capability', 'example', '--operation', 'getStatus'])
    ).includes('EXAMPLE-B-1'),
  );
  await cli(['verify', '--root', app, '--capability', 'example']);
  let model = JSON.parse(await cli(['inspect', '--root', app]));
  assert.equal(model.capabilities[0].evidence.results[0].status, 'passing');
  await cli(['snapshot', '--root', app, '--label', 'Before owner email']);
  api.components.schemas.Owner.properties.email = { type: 'string', format: 'email' };
  await writeFile(apiFile, stringify(api));
  assert.ok((await cli(['diff', '--root', app])).includes('email'));
  model = JSON.parse(await cli(['inspect', '--root', app]));
  assert.equal(model.capabilities[0].evidence.stale, true);
  await cli(['verify', '--root', app, '--capability', 'example']);
  const preview = path.join(consumer, 'review');
  await cli(['build', '--root', app, '--out', preview]);
  const html = await readFile(path.join(preview, 'viewer.html'), 'utf8');
  const notices = await readFile(
    path.join(consumer, 'node_modules/mhproto/viewer/vendor/NOTICE.txt'),
    'utf8',
  );
  assert.ok(html.includes(notices.trimEnd()), 'Offline HTML retains full notices');
  const licenseFiles = await readdir(
    path.join(consumer, 'node_modules/mhproto/viewer/vendor/licenses'),
  );
  assert.ok(licenseFiles.length >= 79);
  const { stdout: packed } = await exec('tar', ['-tzf', archive]);
  assert.ok(
    !packed
      .split('\n')
      .some((f) => /package\/(website|tools|scripts|test|test-results|node_modules)\//.test(f)),
  );
  const state = { consumer, app, binary, preview, licenseFiles: licenseFiles.length };
  console.log(
    'Clean tarball install passed: public import, executable CLI, scaffold, 12 skill copies, validation, scoped context, linked verification, stale evidence, snapshot/diff and offline HTML with complete notices.',
  );
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const child = spawn(state.binary, ['view', '--root', state.app, '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (s) => (output += s));
  child.stderr.on('data', (s) => (output += s));
  const browser = await chromium.launch();
  await mkdir(artifacts, { recursive: true });
  try {
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch('http://127.0.0.1:' + port);
        if (r.ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 950 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const response = await page.goto(
        'http://127.0.0.1:' + port + '/#/features/example/api/getStatus',
      );
      assert.equal(response.status(), 200);
      await page.waitForFunction(
        () => document.querySelector('#content h1')?.textContent === 'GET /status',
      );
      await page.evaluate(() => globalThis.mhprotoReady);
      assert.equal(await page.locator('.diagram-canvas svg').count(), 1);
      await page.getByRole('link', { name: 'Owner', exact: true }).first().click();
      await page.waitForFunction(
        () => document.querySelector('#content h1')?.textContent === 'Owner',
      );
      assert.ok((await page.locator('#content').innerText()).includes('email'));
      await page.goto('http://127.0.0.1:' + port + '/#/changes');
      await page.waitForFunction(
        () => document.querySelector('#content h1')?.textContent === 'Changes',
      );
      assert.ok((await page.locator('#content').innerText()).includes('Owner'));
      await page.screenshot({
        path: path.join(artifacts, 'consumer-' + width + '.png'),
        fullPage: true,
      });
      await page.route('http://**', (r) => r.abort());
      await page.route('https://**', (r) => r.abort());
      await page.goto('file://' + state.preview + '/viewer.html#/features/example/api/getStatus');
      await page.waitForFunction(
        () => document.querySelector('#content h1')?.textContent === 'GET /status',
      );
      await page.evaluate(() => globalThis.mhprotoReady);
      assert.equal(await page.locator('.diagram-canvas svg').count(), 1);
      assert.ok((await page.content()).includes('MHProto offline renderer: Mermaid 12.1.0'));
      await page.getByRole('link', { name: 'Owner', exact: true }).first().click();
      await page.waitForFunction(
        () => document.querySelector('#content h1')?.textContent === 'Owner',
      );
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        'Installed tarball HTTP, diagram, linked type, diff and offline export passed at ' +
          width +
          'px',
      );
    }
  } finally {
    await browser.close();
    child.kill('SIGTERM');
  }
} finally {
  await rm(consumer, { recursive: true, force: true });
}
