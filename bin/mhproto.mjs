#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { loadProject, validateProject, packageRoot } from '../src/core.mjs';
import { verifyCapability } from '../src/verify.mjs';
import { compareModels, exportViewer, model, serve } from '../src/server.mjs';
import { contextPacket, encodeContext } from '../src/context.mjs';
import { contractSnapshot } from '../viewer/diff.js';

const args = process.argv.slice(2);
const command = args.shift() ?? 'help';
function option(name, fallback) {
  const index = args.indexOf('--' + name);
  return index >= 0 ? args[index + 1] : fallback;
}
const root = path.resolve(option('root', process.cwd()));
const has = name => args.includes('--' + name);

async function installSkills(agent = 'codex') {
  if (!['codex', 'claude', 'all'].includes(agent)) throw new Error('--agent must be codex, claude or all');
  const destinations = agent === 'all' ? ['.agents/skills', '.claude/skills'] : [agent === 'claude' ? '.claude/skills' : '.agents/skills'];
  for (const destination of destinations) {
    for (const name of await readdir(path.join(packageRoot, 'skills'))) {
      await cp(path.join(packageRoot, 'skills', name), path.join(root, destination, name), { recursive: true, force: false, errorOnExist: true });
    }
    console.log(`Installed five MHProto skills in ${destination}`);
  }
}

async function init() {
  const files = {
    'mhproto.yaml': 'version: 1\nname: My app\nsystem: mhproto/system.md\ncapabilities:\n  - id: example\n    title: Example capability\n    spec: mhproto/capabilities/example/spec.md\n    interface: mhproto/interfaces/openapi.yaml\n    examples: mhproto/capabilities/example/examples.yaml\n    checks: mhproto/capabilities/example/checks.yaml\n    sources: []\n',
    'mhproto/system.md': '# System map\n\nReplace this with the app’s capabilities, owners and dependencies.\n',
    'mhproto/capabilities/example/spec.md': '# Example capability\n\nStatus: draft — replace this scaffold before implementing.\n\n## Purpose\nDescribe the capability and its boundaries.\n\n## Rules\n- **EXAMPLE-B-1** Reading status returns the current service status.\n\n## States and permissions\nDocument transitions, permissions, failures and recovery.\n',
    'mhproto/interfaces/openapi.yaml': 'openapi: 3.1.0\ninfo:\n  title: Example API\n  version: "1"\npaths:\n  /status:\n    get:\n      operationId: getStatus\n      x-mhproto-rules: [EXAMPLE-B-1]\n      responses:\n        "200":\n          description: Current status\n          content:\n            application/json:\n              schema:\n                type: object\n                required: [status]\n                additionalProperties: false\n                properties:\n                  status: { type: string, enum: [ready] }\n              example: { status: ready }\n',
    'mhproto/capabilities/example/examples.yaml': 'examples:\n  - id: EXAMPLE-E-1\n    title: Read service status\n    rules: [EXAMPLE-B-1]\n    operations: [getStatus]\n    given: The service is ready.\n    when: A client reads its status.\n    then: The response says ready.\n',
    'mhproto/capabilities/example/checks.yaml': '# Add argv commands and rule/example references. No tests are assumed to exist.\nchecks: []\n',
  };
  // Preflight all destinations; never overwrite an existing contract.
  for (const file of Object.keys(files)) {
    try { await readFile(path.join(root, file)); throw new Error(`Refusing to overwrite ${file}`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  for (const [file, contents] of Object.entries(files)) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), contents, { flag: 'wx' }); }
  if (!has('no-skills')) await installSkills(option('agent', 'codex'));
  console.log('Initialised MHProto. Replace the example capability; run mhproto check and mhproto view.');
}

try {
  if (command === 'init') await init();
  else if (command === 'skills') await installSkills(option('agent', 'codex'));
  else if (command === 'check') {
    const project = await loadProject(root), issues = await validateProject(project);
    if (has('json')) console.log(JSON.stringify({ name: project.name, issues }, null, 2));
    else {
      console.log(`${project.name}: ${project.capabilities.length} capability, ${project.capabilities.reduce((n,c) => n+c.rules.length,0)} rules, ${project.capabilities.reduce((n,c) => n+c.operations.length,0)} operations`);
      for (const issue of issues) console.log(`${issue.level.toUpperCase()} [${issue.capability}] ${issue.message}`);
      console.log(`${issues.filter(i=>i.level==='error').length} errors, ${issues.filter(i=>i.level==='warning').length} warnings`);
    }
    if (issues.some(i => i.level === 'error')) process.exitCode = 1;
  } else if (command === 'context') {
    const options = Object.fromEntries(['capability','operation','rule','schema','example','check','visual','section'].map(k => [k, option(k)]));
    const output = encodeContext(contextPacket(await loadProject(root), options), Number(option('max-chars', '12000')));
    console.log(output);
    if (has('stats')) console.error(JSON.stringify({ characters: output.length, bytes: Buffer.byteLength(output), note: 'Exact text sizes; model token counts vary.' }));
  } else if (command === 'inspect') console.log(JSON.stringify(await model(root), null, 2));
  else if (command === 'verify') {
    const project = await loadProject(root), issues = await validateProject(project);
    if (issues.some(i => i.level === 'error')) throw new Error('Contract validation failed; run mhproto check');
    const selected = option('capability');
    const caps = project.capabilities.filter(c => !selected || c.id === selected);
    if (!caps.length) throw new Error(`Unknown capability: ${selected}`);
    for (const cap of caps) {
      if (!cap.checks.length) { console.log(`${cap.id}: no checks configured; evidence remains unchecked`); continue; }
      console.log(`Running ${cap.checks.length} checks for ${cap.id}`);
      const result = await verifyCapability(project, cap, r => {
        console.log(`${r.status.toUpperCase()} ${r.id} (${r.durationMs}ms)`);
        if (r.status === 'failing') console.log([r.error, r.stderr.slice(-1500), ...r.missing.map(t => 'Missing test: '+t), ...r.skipped.map(t => 'Skipped test: '+t)].filter(Boolean).join('\n'));
      });
      if (result.results.some(r => r.status === 'failing') || result.changedDuringRun) process.exitCode = 1;
    }
  } else if (command === 'view') {
    await loadProject(root);
    const port = Number(option('port', '4317'));
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
    const server = await serve(root, port, {against:option('against')});
    console.log(`MHProto viewer: http://127.0.0.1:${server.address().port}`);
    console.log('Local browser view. Visual attachments save to mhproto/visuals.yaml; source edits refresh automatically.');
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
  } else if (command === 'snapshot') {
    const destination = path.resolve(root, option('out', '.mhproto/baseline.json'));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, JSON.stringify(contractSnapshot(await model(root),{label:option('label','Iteration baseline')}), null, 2)+'\n');
    console.log(`Saved baseline: ${destination}`);
  } else if (command === 'diff') {
    const before = JSON.parse(await readFile(path.resolve(root, option('against', '.mhproto/baseline.json')), 'utf8'));
    console.log(JSON.stringify(compareModels(before, await model(root)), null, 2));
  } else if (command === 'build') {
    const destination = path.resolve(root, option('out', '.mhproto/viewer'));
    await exportViewer(root, destination, {against:option('against')});
    console.log(`Exported viewer: ${destination}. Open viewer.html directly or serve this folder over HTTP.`);
  } else if (command === 'help' || has('help')) {
    const { version } = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    console.log(`MHProto ${version}\n\nCommands: init, skills, check, context, inspect, verify, view, snapshot, diff, build\n\nOptions: --root PATH, --json (check), --capability ID (verify/context), --port PORT (view),\n         --operation ID|--rule ID|--schema NAME|--example ID|--check ID|--visual ID (context),\n         --section request,response,behaviour,errors,examples,checks,visuals,sources (context),\n         --max-chars N, --stats (context),\n         --agent codex|claude|all (init/skills), --no-skills (init),\n         --out PATH (snapshot/build), --label TEXT (snapshot), --against PATH (diff/view/build)`);
  }
  else throw new Error(`Unknown command: ${command}`);
} catch (error) { console.error(`MHProto: ${error.message}`); process.exitCode = 1; }
