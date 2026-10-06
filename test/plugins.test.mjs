import { temporaryDirectory as mkdtemp } from './helpers.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import { JSDOM } from 'jsdom';
import { parse, stringify } from 'yaml';
import { loadProject, validateProject, packageRoot } from '../src/core.mjs';
import { contextPacket } from '../src/context.mjs';
import { targetError } from '../src/visuals.mjs';
import { packageCandidates } from '../src/plugins.mjs';
import { createHandler, exportViewer, model } from '../src/server.mjs';
import { compareModels, contractSnapshot, openapiView, snapshotProject } from '../viewer/diff.js';

const cli = path.join(packageRoot, 'bin/mhproto.mjs');
const run = (root, ...args) =>
  execFileSync(process.execPath, [cli, ...args, '--root', root], { encoding: 'utf8' });
const fails = (root, ...args) => {
  try {
    run(root, ...args);
  } catch (error) {
    return error.stderr.toString();
  }
  throw new Error('Expected the command to fail');
};
async function edit(root, file, change) {
  const target = path.join(root, file),
    data = parse(await readFile(target, 'utf8'));
  change(data);
  await writeFile(target, stringify(data));
}
const schemaSql = `create table services (
  id text primary key,
  name text not null unique
);
-- mhproto: EXAMPLE-B-1
create table status_reads (
  id integer primary key,
  service_id text not null references services(id),
  read_at timestamp not null
);
`;
// A project using the example plugin as an installed npm package.
async function sqlProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mhproto-plugin-'));
  run(root, 'init', '--no-skills');
  await mkdir(path.join(root, 'node_modules'));
  await mkdir(path.join(root, 'db'));
  await symlink(packageRoot, path.join(root, 'node_modules/mhproto'));
  await cp(
    path.join(packageRoot, 'examples/plugin-sql'),
    path.join(root, 'node_modules/mhproto-plugin-sql'),
    { recursive: true },
  );
  await writeFile(path.join(root, 'db/schema.sql'), schemaSql);
  await edit(root, 'mhproto.yaml', (config) => {
    config.plugins = ['sql'];
    const cap = config.capabilities[0];
    cap.interfaces = [
      { adapter: 'openapi', file: cap.interface },
      { adapter: 'sql', file: 'db/schema.sql' },
    ];
    delete cap.interface;
  });
  await edit(root, 'mhproto/interfaces/openapi.yaml', (doc) => {
    doc.paths['/status'].get['x-mhproto-links'] = ['table:status_reads'];
  });
  return root;
}
async function localPlugin(root, file, source) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), source);
}
const flowsPlugin = `export default (api, options) => ({
  name: 'flows',
  kinds: { screen: { label: options.label ?? 'Screen' } },
  interfaces: {
    flows: {
      async load({ file, readYaml }) {
        const doc = await readYaml(file);
        return { entities: doc.screens.map((s) => ({ kind: 'screen', id: s.id, rules: s.rules, links: s.next ?? [] })) };
      },
    },
  },
});
`;

test('plugin names resolve like Babel: built-in, relative path, then mhproto-plugin-* packages', () => {
  assert.deepEqual(packageCandidates('sql', 'plugin'), ['mhproto-plugin-sql', 'sql']);
  assert.deepEqual(packageCandidates('mhproto-plugin-sql', 'plugin'), ['mhproto-plugin-sql']);
  assert.deepEqual(packageCandidates('@team/sql', 'plugin'), [
    '@team/mhproto-plugin-sql',
    '@team/sql',
  ]);
  assert.deepEqual(packageCandidates('@team', 'preset'), ['@team/mhproto-preset']);
  assert.deepEqual(packageCandidates('module:sql', 'plugin'), ['sql']);
});

test('a project assembles presets and plugins, passes options and reports what is loaded', async () => {
  const root = await sqlProject();
  await localPlugin(root, 'tools/flows.mjs', flowsPlugin);
  await writeFile(
    path.join(root, 'mhproto/flows.yaml'),
    stringify({ screens: [{ id: 'home', rules: ['EXAMPLE-B-1'], next: ['operation:getStatus'] }] }),
  );
  await edit(root, 'mhproto.yaml', (config) => {
    config.plugins.push(['./tools/flows.mjs', { label: 'View' }]);
    config.capabilities[0].interfaces.push({ adapter: 'flows', file: 'mhproto/flows.yaml' });
  });
  const listed = JSON.parse(run(root, 'plugins', '--json'));
  assert.deepEqual(listed.presets, ['recommended']);
  assert.deepEqual(
    listed.plugins.map((p) => [p.name, p.interfaces]),
    [
      ['sql', ['sql']],
      ['flows', ['flows']],
      ['openapi', ['openapi']],
    ],
  );
  assert.equal(listed.kinds.screen.label, 'View');
  assert.equal(listed.plugins[0].source, 'node_modules/mhproto-plugin-sql/index.mjs');
  const project = await loadProject(root);
  assert.equal((await validateProject(project)).filter((i) => i.level === 'error').length, 0);
  assert.match(run(root, 'check'), /1 operations, 2 tables, 1 views/);
  // Every adapter, OpenAPI included, contributes entities and meta; documents stay in memory.
  const cap = project.capabilities[0];
  assert.deepEqual(
    cap.entities.map((e) => `${e.adapter}:${e.kind}:${e.id}`),
    [
      'openapi:operation:getStatus',
      'sql:table:services',
      'sql:table:status_reads',
      'flows:screen:home',
    ],
  );
  assert.equal(cap.openapi, undefined);
  assert.equal(cap.interfaces[0].meta.info.title, 'Example API');
  assert.ok(!JSON.stringify(project).includes('create table'));
  assert.ok(!JSON.stringify(project).includes('"paths"'));
  assert.deepEqual(cap.files, {
    spec: 'mhproto/capabilities/example/spec.md',
    interface: 'mhproto/interfaces/openapi.yaml',
    sql: 'db/schema.sql',
    flows: 'mhproto/flows.yaml',
    examples: 'mhproto/capabilities/example/examples.yaml',
    checks: 'mhproto/capabilities/example/checks.yaml',
  });
});

test('plugin and configuration mistakes fail with the name of what to fix', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mhproto-plugin-errors-'));
  run(root, 'init', '--no-skills');
  let serial = 0;
  const attempt = async (source, change, pattern) => {
    // Each attempt gets its own module; Node caches imports by URL.
    const file = `tools/bad-${++serial}.mjs`;
    await localPlugin(root, file, source.replaceAll('./tools/bad.mjs', './' + file));
    const original = await readFile(path.join(root, 'mhproto.yaml'), 'utf8');
    await edit(root, 'mhproto.yaml', (config) => {
      change(config);
      for (const key of ['plugins', 'presets'])
        if (config[key])
          config[key] = config[key].map((p) => (p === './tools/bad.mjs' ? './' + file : p));
    });
    await assert.rejects(loadProject(root), pattern);
    await writeFile(path.join(root, 'mhproto.yaml'), original);
  };
  const use = (config) => (config.plugins = ['./tools/bad.mjs']);
  await attempt(`export default { name: 'bad', interface: {} };`, use, /unknown field "interface"/);
  await attempt(
    `export default { name: 'bad', interfaces: { bad: {} } };`,
    use,
    /needs a load\(\) function/,
  );
  await attempt(
    `export default { name: 'bad', interfaces: { bad: { load() {}, render() {} } } };`,
    use,
    /unknown hook "render"/,
  );
  await attempt(
    `export default { name: 'bad', kinds: { operation: { label: 'Op' } } };`,
    use,
    /"operation" cannot be used as an entity kind/,
  );
  await localPlugin(
    root,
    'tools/tables.mjs',
    `export default { name: 'tables', kinds: { table: { label: 'T' } } };`,
  );
  await attempt(
    `export default { name: 'bad', kinds: { table: { label: 'Table' } } };`,
    (config) => (config.plugins = ['./tools/tables.mjs', './tools/bad.mjs']),
    /"table" is declared by both tables and bad/,
  );
  await attempt(
    `export default { name: 'bad', interfaces: { spec: { load() {} } } };`,
    use,
    /"spec" cannot be used as an interface adapter name/,
  );
  await attempt(
    `export default { name: 'bad', kinds: { rule: { label: 'Rule' } } };`,
    use,
    /"rule" cannot be used as an entity kind/,
  );
  await attempt(
    `export default (api) => { api.assertVersion(2); return { name: 'bad' }; };`,
    use,
    /needs MHProto plugin API 2/,
  );
  await attempt(
    `export default { name: 'bad' };`,
    (config) => (config.plugins = ['./tools/bad.mjs', './tools/bad.mjs']),
    /listed twice/,
  );
  await attempt(
    `export default { name: 'bad' };`,
    (config) => (config.plugins = ['sql']),
    /Cannot find plugin "sql". Install mhproto-plugin-sql or sql/,
  );
  await attempt(
    `export default { name: 'bad', interfaces: { bad: { load: () => ({ entities: [{ kind: 'nope', id: 'x' }] }) } } };`,
    (config) => {
      use(config);
      config.capabilities[0].interfaces = [{ adapter: 'bad', file: 'mhproto.yaml' }];
      delete config.capabilities[0].interface;
    },
    /entity kind "nope" is not declared/,
  );
  await attempt(
    `export default { name: 'bad' };`,
    (config) => (config.capabilities[0].interfaces = [{ adapter: 'sql', file: 'db' }]),
    /use interface or interfaces, not both/,
  );
  await attempt(
    `export default { name: 'bad' };`,
    (config) => (config.presets = []),
    /no plugin provides the "openapi" interface/,
  );
  await attempt(
    // Entries in a preset resolve from the preset's own directory.
    `export default { plugins: [], presets: ['./' + new URL(import.meta.url).pathname.split('/').pop()] };`,
    (config) => (config.presets = ['./tools/bad.mjs']),
    /Preset cycle/,
  );
  await attempt(
    `export default { name: 'bad' };`,
    (config) => (config.plugins = ['/etc/bad.mjs']),
    /project-relative path/,
  );
});

test('a capability needs only an id and rules; absent parts leave no empty UI or files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mhproto-minimal-'));
  run(root, 'init', '--minimal', '--no-skills');
  assert.deepEqual((await readdir(path.join(root, 'mhproto/capabilities/example'))).sort(), [
    'spec.md',
  ]);
  assert.match(run(root, 'check'), /0 errors, 1 warnings/);
  assert.match(run(root, 'check'), /EXAMPLE-B-1 has no linked executable check/);
  const project = await model(root),
    cap = project.capabilities[0];
  assert.deepEqual(cap.files, { spec: 'mhproto/capabilities/example/spec.md' });
  assert.equal(cap.openapi, undefined);
  assert.deepEqual([cap.examples, cap.checks, cap.entities], [[], [], []]);
  assert.deepEqual(contextPacket(project, {}).features[0].operations, []);
  assert.deepEqual(compareModels(contractSnapshot(project), project), []);
  const { doc } = await render(project);
  assert.equal(doc.querySelector('#api'), null);
  assert.ok(doc.querySelector('.checks-section').textContent.includes('1 rule still needs'));
});

test('plugin entities are checked for rules, links and their own source rules', async () => {
  const root = await sqlProject();
  await writeFile(
    path.join(root, 'db/schema.sql'),
    schemaSql.replace('id integer primary key', 'id integer').replace('EXAMPLE-B-1', 'MISSING-1'),
  );
  await edit(root, 'mhproto/interfaces/openapi.yaml', (doc) => {
    doc.paths['/status'].get['x-mhproto-links'] = ['table:status_reads', 'table:missing'];
  });
  const messages = (await validateProject(await loadProject(root))).map((i) => i.message);
  assert.ok(messages.includes('status_reads references missing rule MISSING-1'));
  assert.ok(messages.includes('getStatus links to missing table missing'));
  assert.ok(messages.includes('Table status_reads has no primary key'));
  assert.ok(messages.includes('services has no behaviour links'));
});

test('agents can read any entity, within the same budget and section rules', async () => {
  const project = await loadProject(await sqlProject());
  const packet = contextPacket(project, { entity: 'table:status_reads' });
  assert.deepEqual(
    packet.table.columns.map((c) => c.name),
    ['id', 'service_id', 'read_at'],
  );
  assert.deepEqual(packet.behaviour.rules, [project.capabilities[0].rules[0]]);
  assert.deepEqual(packet.linkedFrom, [
    { kind: 'operation', id: 'getStatus', title: 'GET /status' },
  ]);
  assert.deepEqual(packet.links, [
    { kind: 'table', id: 'services', relation: 'references', title: 'services' },
  ]);
  assert.equal(packet.sources, undefined);
  assert.deepEqual(
    Object.keys(contextPacket(project, { entity: 'table:services', section: 'sources' })),
    ['project', 'capability', 'digest', 'table', 'sources'],
  );
  assert.throws(
    () => contextPacket(project, { entity: 'table:services', section: 'request' }),
    /Sections: links,linkedFrom,behaviour/,
  );
  assert.throws(() => contextPacket(project, { entity: 'table:nope' }), /Unknown table: nope/);
  assert.throws(() => contextPacket(project, { entity: 'nope' }), /--entity KIND:ID/);
  // --operation is the same packet as --entity operation:ID.
  assert.deepEqual(
    contextPacket(project, { operation: 'getStatus' }),
    contextPacket(project, { entity: 'operation:getStatus' }),
  );
  assert.equal(contextPacket(project, {}).features[0].entities.length, 2);
  assert.equal(
    targetError(project, { capability: 'example', kind: 'table', id: 'services' }),
    null,
  );
  assert.match(
    targetError(project, { capability: 'example', kind: 'table', id: 'gone' }),
    /unknown table/,
  );
});

test('plugin entities are compared and survive entity-based snapshots; version 1 baselines still load', async () => {
  const root = await sqlProject(),
    before = await model(root);
  await writeFile(
    path.join(root, 'db/schema.sql'),
    schemaSql.replace('read_at timestamp not null', 'read_at timestamp'),
  );
  const after = await model(root);
  const changes = compareModels(contractSnapshot(before), after);
  assert.deepEqual(
    changes.map((c) => [c.kind, c.id, c.status]),
    [['table', 'status_reads', 'changed']],
  );
  assert.deepEqual(changes[0].fields[0].path, ['data', 'columns']);
  const saved = contractSnapshot(after);
  assert.deepEqual(compareModels(saved, after), []);
  assert.deepEqual(
    saved.project.capabilities[0].entities.map((e) => e.kind),
    ['operation', 'table', 'table'],
  );
  // A version 1 snapshot stored the OpenAPI document and operations, and no entities.
  const legacy = structuredClone(before);
  for (const cap of legacy.capabilities) {
    const { openapi, operations } = openapiView(cap);
    delete cap.interfaces;
    delete cap.entities;
    Object.assign(cap, { openapi, operations, transitions: [], nonTransitions: [] });
  }
  const v1 = { format: 'mhproto-snapshot', version: 1, label: 'Old', project: legacy };
  assert.deepEqual(
    snapshotProject(v1).capabilities[0].entities.map((e) => e.id),
    ['getStatus'],
  );
  assert.deepEqual(
    compareModels(v1, before).map((c) => [c.kind, c.id, c.status]),
    [
      ['feature', 'example', 'changed'],
      ['table', 'services', 'added'],
      ['table', 'status_reads', 'added'],
    ],
  );
});

async function render(project, hash = '') {
  const dom = new JSDOM(await readFile(path.join(packageRoot, 'viewer/index.html'), 'utf8'), {
    runScripts: 'outside-only',
    url: 'https://mhproto.test/' + hash,
  });
  const { window } = dom,
    doc = window.document;
  window.scrollTo = () => {};
  window.mermaid = { initialize() {}, render: async () => ({ svg: '<svg></svg>' }) };
  const element = doc.createElement('script');
  element.id = 'mhproto-model';
  element.type = 'application/json';
  element.textContent = JSON.stringify(project);
  doc.body.append(element);
  const [app, diff] = await Promise.all(
    ['app.js', 'diff.js'].map((name) => readFile(path.join(packageRoot, 'viewer', name), 'utf8')),
  );
  const { bundleViewer } = await import('../src/server.mjs');
  await window.eval(`(async()=>{${bundleViewer(app, diff)}\n})()`);
  return { window, doc };
}

test('exported previews inline plugin renderers and show plugin kinds next to the API', async () => {
  const root = await sqlProject(),
    out = path.join(root, 'export');
  await exportViewer(root, out);
  const html = await readFile(path.join(out, 'viewer.html'), 'utf8');
  assert.ok(html.includes('mhprotoViewerPlugins'));
  assert.ok(!html.includes('node_modules/mhproto-plugin-sql'), 'no plugin source paths');
  assert.ok((await readdir(path.join(out, 'plugins'))).includes('0-sql.js'));
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://mhproto.test/#/features/example',
  });
  const { window } = dom,
    doc = window.document;
  window.fetch = () => {
    throw new Error('Export must not fetch');
  };
  window.scrollTo = () => {};
  window.mermaid = { initialize() {}, render: async () => ({ svg: '<svg></svg>' }) };
  for (const script of doc.querySelectorAll('script:not([type]):not([src])'))
    window.eval(script.textContent);
  await window.eval(
    `(async()=>{${html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]}\n})()`,
  );
  assert.equal(doc.querySelector('#kind-table h2').textContent, 'Tables');
  assert.ok(doc.querySelector('#api .endpoint[data-operation="getStatus"]'));
  const go = async (hash) => {
    const navigation = new Promise((r) => window.addEventListener('hashchange', r, { once: true }));
    window.location.hash = hash;
    await navigation;
    await window.mhprotoReady;
  };
  await go('#/features/example/entities/table/status_reads');
  assert.equal(doc.querySelector('h1').textContent, 'status_reads');
  assert.deepEqual(
    [...doc.querySelectorAll('#content table tbody td code')].map((c) => c.textContent),
    ['id', 'service_id', 'read_at'],
  );
  assert.ok(doc.querySelector('#content').textContent.includes('references services'));
  assert.ok(doc.querySelector('a[href="#/features/example/api/getStatus"]'), 'used by endpoint');
  assert.ok(doc.querySelector('a[href="#/features/example/entities/table/services"]'));
  assert.equal(doc.title, 'status_reads · MHProto');
  // Escaping: plugin data is text, not markup.
  window.mhprotoViewerPlugins[0].kinds.table.section = (_table, ui) =>
    ui.html`<p class="probe">${'<img src=x onerror=alert(1)>'}${false}${null}${undefined}</p>`;
  await go('#/features/example/entities/table/services');
  assert.equal(doc.querySelector('.probe').innerHTML, '&lt;img src=x onerror=alert(1)&gt;');
  // A failing renderer falls back to the plain definition.
  window.mhprotoViewerPlugins[0].kinds.table.section = () => {
    throw new Error('boom');
  };
  await go('#/features/example/entities/table/status_reads');
  assert.match(doc.querySelector('#content .error').textContent, /could not be shown.*boom/);
  assert.ok(doc.querySelector('#content details.disclosure pre'));
  window.location.hash = '';
  dom.window.close();
});

test('the local viewer serves plugin scripts only from the registry', async () => {
  const root = await sqlProject();
  const get = async (url) => {
    const req = Readable.from([]);
    Object.assign(req, { url, method: 'GET', headers: { host: '127.0.0.1:4317' } });
    const result = { status: 200, headers: {} };
    await createHandler(root)(req, {
      setHeader: (k, v) => (result.headers[k] = v),
      writeHead(status) {
        result.status = status;
        return this;
      },
      end(body) {
        result.body = body;
        return this;
      },
    });
    return result;
  };
  const script = await get('/plugins/0-sql.js');
  assert.equal(script.status, 200);
  assert.equal(script.headers['content-type'], 'text/javascript');
  assert.ok(String(script.body).includes('mhprotoViewerPlugins'));
  assert.equal((await get('/plugins/../../package.json')).status, 404);
  assert.equal((await get('/plugins/1-other.js')).status, 404);
  assert.equal(JSON.parse((await get('/api/model')).body).plugins[0].viewer, 'plugins/0-sql.js');
});

test('skills install what is missing, never overwrite, and can be chosen, removed and checked', async () => {
  const root = await sqlProject();
  const claude = (name) => path.join(root, '.claude/skills', name);
  assert.match(run(root, 'skills', '--agent', 'claude', '--only', 'verify,sql'), /Installed 3/);
  assert.deepEqual((await readdir(path.join(root, '.claude/skills'))).sort(), [
    'mhproto-format',
    'mhproto-sql',
    'mhproto-verify',
  ]);
  await writeFile(path.join(claude('mhproto-verify'), 'SKILL.md'), 'Edited locally');
  assert.match(run(root, 'skills', '--agent', 'claude'), /Installed 4.*kept 3/);
  assert.equal(
    await readFile(path.join(claude('mhproto-verify'), 'SKILL.md'), 'utf8'),
    'Edited locally',
  );
  const report = run(root, 'skills', '--agent', 'claude', '--check');
  assert.match(report, /differs\s+\.claude\/skills\/mhproto-verify/);
  assert.match(report, /current\s+\.claude\/skills\/mhproto-sql \(plugin sql\)/);
  assert.match(
    fails(root, 'skills', '--agent', 'claude', '--remove', 'format'),
    /remove them first/,
  );
  assert.match(fails(root, 'skills', '--agent', 'claude', '--only', 'nope'), /Unknown skill nope/);
  assert.match(
    run(root, 'skills', '--agent', 'claude', '--remove', 'implement,verify'),
    /Removed .*mhproto-implement, .*mhproto-verify/,
  );
  assert.match(
    run(root, 'skills', '--agent', 'claude', '--check'),
    /missing\s+\.claude\/skills\/mhproto-verify/,
  );
  // Every bundled skill reads the shared format reference, which is always installed with them.
  for (const name of await readdir(path.join(packageRoot, 'skills'))) {
    const text = await readFile(path.join(packageRoot, 'skills', name, 'SKILL.md'), 'utf8');
    if (name !== 'mhproto-format') assert.ok(text.includes('../mhproto-format/SKILL.md'), name);
    assert.ok(!text.includes('mhproto-specify/references'), name);
  }
});

test('presets resolve their own entries, and dual ESM/CommonJS packages load as ESM', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mhproto-resolve-'));
  run(root, 'init', '--no-skills');
  const write = async (file, text) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  };
  // The preset's plugins live in its own node_modules and folder, not the project's.
  const preset = 'node_modules/mhproto-preset-team';
  await write(
    `${preset}/package.json`,
    JSON.stringify({ name: 'mhproto-preset-team', main: 'index.mjs' }),
  );
  await write(`${preset}/index.mjs`, `export default { plugins: ['dual', './local.mjs'] };`);
  await write(`${preset}/local.mjs`, `export default { name: 'local' };`);
  const dual = `${preset}/node_modules/mhproto-plugin-dual`;
  await write(
    `${dual}/package.json`,
    JSON.stringify({
      name: 'mhproto-plugin-dual',
      exports: { import: './index.mjs', require: './index.cjs' },
    }),
  );
  await write(`${dual}/index.mjs`, `export default { name: 'dual' };`);
  await write(
    `${dual}/index.cjs`,
    `Object.defineProperty(exports, '__esModule', { value: true }); exports.default = { name: 'dual-cjs' };`,
  );
  await edit(root, 'mhproto.yaml', (config) => (config.presets = ['recommended', 'team']));
  assert.deepEqual(
    JSON.parse(run(root, 'plugins', '--json')).plugins.map((p) => p.name),
    ['openapi', 'dual', 'local'],
  );
});

test('a throwing example hook is reported, not fatal', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mhproto-hook-'));
  run(root, 'init', '--no-skills');
  await localPlugin(
    root,
    'tools/strict.mjs',
    `export default { name: 'strict', interfaces: { strict: {
      load: () => ({ entities: [] }),
      async validateExample() { throw new Error('boom'); },
    } } };`,
  );
  await edit(root, 'mhproto.yaml', (config) => {
    config.plugins = ['./tools/strict.mjs'];
    config.capabilities[0].interfaces = [
      { adapter: 'openapi', file: config.capabilities[0].interface },
      { adapter: 'strict', file: 'mhproto.yaml' },
    ];
    delete config.capabilities[0].interface;
  });
  const messages = (await validateProject(await loadProject(root))).map((i) => i.message);
  assert.ok(messages.includes('strict interface mhproto.yaml: EXAMPLE-E-1: boom'), messages);
});

test('links across capabilities appear in packets on both sides', async () => {
  const root = await sqlProject();
  await edit(root, 'mhproto.yaml', (config) => {
    const cap = config.capabilities[0];
    config.capabilities.push({
      id: 'db',
      spec: cap.spec,
      interfaces: [cap.interfaces.pop()],
    });
  });
  await edit(root, 'mhproto/interfaces/openapi.yaml', (doc) => {
    doc.paths['/status'].get['x-mhproto-links'] = ['db/table:status_reads'];
  });
  const project = await loadProject(root);
  assert.equal((await validateProject(project)).filter((i) => i.level === 'error').length, 0);
  const packet = contextPacket(project, { entity: 'db/table:status_reads' });
  assert.equal(packet.capability, 'db');
  assert.deepEqual(packet.linkedFrom, [
    { capability: 'example', kind: 'operation', id: 'getStatus', title: 'GET /status' },
  ]);
  assert.deepEqual(
    contextPacket(project, { capability: 'example', operation: 'getStatus' }).links,
    [{ capability: 'db', kind: 'table', id: 'status_reads', title: 'status_reads' }],
  );
  assert.throws(
    () => contextPacket(project, { capability: 'example', entity: 'db/table:status_reads' }),
    /different capability/,
  );
});

test('snapshots with malformed entities are rejected before rendering', async () => {
  const project = await model(await sqlProject());
  const saved = contractSnapshot(project);
  saved.project.capabilities[0].entities[1].kind = '"><img src=x onerror=alert(1)>';
  assert.throws(() => snapshotProject(saved), /valid MHProto contract/);
});
