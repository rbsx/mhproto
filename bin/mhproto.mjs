#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile, cp, lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { loadProject, validateProject, packageRoot, readProject } from '../src/core.mjs';
import { assertShape } from '../src/config.mjs';
import { defaultPresets, describeRegistry, loadPlugins } from '../src/plugins.mjs';
import { verifyCapability } from '../src/verify.mjs';
import { compareModels, exportViewer, model, serve } from '../src/server.mjs';
import { contextPacket, encodeContext } from '../src/context.mjs';
import { contractSnapshot } from '../viewer/diff.js';
import { atomicWrite, writePath } from '../src/paths.mjs';

let command = 'help',
  root = process.cwd();
const options = new Map();
const option = (name, fallback) => options.get(name) ?? fallback;
const has = (name) => options.has(name);
function parseArguments() {
  const args = process.argv.slice(2);
  command = args[0] && !args[0].startsWith('-') ? args.shift() : 'help';
  const allowed = {
    init: ['agent', 'no-skills', 'minimal'],
    skills: ['agent', 'only', 'remove', 'check'],
    plugins: ['json'],
    check: ['json'],
    inspect: [],
    context: [
      'capability',
      'operation',
      'entity',
      'rule',
      'schema',
      'example',
      'check',
      'visual',
      'section',
      'max-chars',
      'stats',
    ],
    verify: ['capability'],
    view: ['port', 'against'],
    snapshot: ['out', 'label'],
    diff: ['against'],
    build: ['out', 'against'],
    help: [],
  };
  if (!Object.hasOwn(allowed, command)) throw new Error(`Unknown command: ${command}`);
  const flags = new Set([
    'help',
    'json',
    'no-skills',
    'stats',
    'minimal',
    ...(command === 'skills' ? ['check'] : []),
  ]);
  const valid = new Set(['root', 'help', ...allowed[command]]);
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, '');
    if (!args[i].startsWith('--') || !valid.has(key))
      throw new Error(`Unknown option for ${command}: ${args[i]}`);
    if (options.has(key)) throw new Error(`Option --${key} was supplied twice`);
    if (flags.has(key)) options.set(key, true);
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Option --${key} requires a value`);
      options.set(key, value);
    }
  }
  if (has('help')) command = 'help';
  root = path.resolve(option('root', process.cwd()));
}

async function readConfig() {
  try {
    return assertShape('config', parse(await readProject(root, 'mhproto.yaml')), 'mhproto.yaml');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function skillDirectories(agent) {
  if (!['codex', 'claude', 'all'].includes(agent))
    throw new Error('--agent must be codex, claude or all');
  return agent === 'all'
    ? ['.agents/skills', '.claude/skills']
    : [agent === 'claude' ? '.claude/skills' : '.agents/skills'];
}

// Built-in skills plus those contributed by the project's plugins.
async function availableSkills() {
  const skills = (await readdir(path.join(packageRoot, 'skills')))
    .sort()
    .map((name) => ({ name, path: path.join(packageRoot, 'skills', name), plugin: null }));
  const config = await readConfig();
  if (config)
    for (const skill of (await loadPlugins(root, config)).skills) {
      if (skills.some((s) => s.name === skill.name))
        throw new Error(
          `Plugin ${skill.plugin} provides skill ${skill.name}, which MHProto already has`,
        );
      skills.push(skill);
    }
  return skills;
}

function chooseSkills(available, list) {
  return [...new Set(list.split(',').map((name) => name.trim()))].map((name) => {
    const skill = available.find((s) => s.name === name || s.name === 'mhproto-' + name);
    if (!skill)
      throw new Error(
        `Unknown skill ${name}. Available: ${available.map((s) => s.name).join(', ')}`,
      );
    return skill;
  });
}

const exists = (file) =>
  lstat(file).then(
    () => true,
    (error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );

async function treeFiles(directory, prefix = '') {
  const files = new Map();
  for (const entry of (await readdir(path.join(directory, prefix), { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory())
      for (const item of await treeFiles(directory, relative)) files.set(...item);
    else files.set(relative, await readFile(path.join(directory, relative), 'utf8'));
  }
  return files;
}

// Installs what is missing and never overwrites an installed skill.
async function installSkills(agent = 'codex', only) {
  const available = await availableSkills();
  const format = available.find((s) => s.name === 'mhproto-format');
  let chosen = only ? chooseSkills(available, only) : available;
  // Every skill reads the shared format reference.
  if (chosen.length && !chosen.includes(format)) chosen = [format, ...chosen];
  let installed = 0;
  const kept = [];
  for (const directory of skillDirectories(agent))
    for (const skill of chosen) {
      const relative = path.join(directory, skill.name),
        destination = await writePath(root, relative);
      if (await exists(destination)) {
        kept.push(relative);
        continue;
      }
      await cp(skill.path, destination, { recursive: true, force: false, errorOnExist: true });
      installed++;
    }
  console.log(
    `Installed ${installed} MHProto skill${installed === 1 ? '' : 's'} for ${agent}` +
      (kept.length ? `; kept ${kept.length} already installed (${kept.join(', ')})` : ''),
  );
}

async function removeSkills(agent, list) {
  const available = await availableSkills(),
    chosen = chooseSkills(available, list);
  for (const directory of skillDirectories(agent)) {
    const remaining = [];
    for (const skill of available)
      if (
        !chosen.includes(skill) &&
        (await exists(await writePath(root, path.join(directory, skill.name))))
      )
        remaining.push(skill.name);
    if (
      chosen.some((s) => s.name === 'mhproto-format') &&
      remaining.some((n) => n !== 'mhproto-format')
    )
      throw new Error(`Other skills in ${directory} read mhproto-format; remove them first`);
  }
  const removed = [];
  for (const directory of skillDirectories(agent))
    for (const skill of chosen) {
      const relative = path.join(directory, skill.name),
        destination = await writePath(root, relative);
      if (!(await exists(destination))) continue;
      await rm(destination, { recursive: true });
      removed.push(relative);
    }
  console.log(
    removed.length ? `Removed ${removed.join(', ')}` : 'No matching skills were installed',
  );
}

async function checkSkills(agent) {
  for (const directory of skillDirectories(agent))
    for (const skill of await availableSkills()) {
      const relative = path.join(directory, skill.name),
        destination = await writePath(root, relative);
      let status = 'missing';
      if (await exists(destination)) {
        const [packaged, installed] = await Promise.all([
          treeFiles(skill.path),
          treeFiles(destination),
        ]);
        status =
          packaged.size === installed.size &&
          [...packaged].every(([file, text]) => installed.get(file) === text)
            ? 'current'
            : 'differs';
      }
      console.log(
        `${status.padEnd(8)} ${relative}${skill.plugin ? ` (plugin ${skill.plugin})` : ''}`,
      );
    }
  console.log(
    '"differs" means edited locally or from another MHProto version; nothing was changed.',
  );
}

async function showPlugins() {
  const config = (await readConfig()) ?? {};
  const registry = await loadPlugins(root, config),
    described = describeRegistry(registry);
  if (has('json')) {
    console.log(
      JSON.stringify({ presets: config.presets ?? defaultPresets, ...described }, null, 2),
    );
    return;
  }
  console.log(
    `Presets: ${(config.presets ?? defaultPresets).map((p) => (Array.isArray(p) ? p[0] : p)).join(', ') || 'none'}${config.presets ? '' : ' (default)'}`,
  );
  for (const plugin of described.plugins) {
    console.log(`\n${plugin.name} (${plugin.source})`);
    if (plugin.interfaces.length) console.log(`  interfaces: ${plugin.interfaces.join(', ')}`);
    if (plugin.kinds.length)
      console.log(
        `  kinds: ${plugin.kinds.map((k) => `${k} (${described.kinds[k].label})`).join(', ')}`,
      );
    if (plugin.skills.length) console.log(`  skills: ${plugin.skills.join(', ')}`);
    if (plugin.viewer) console.log('  viewer: yes');
  }
}

async function init() {
  await mkdir(root, { recursive: true });
  if (!has('no-skills')) skillDirectories(option('agent', 'codex'));
  const files = {
    'mhproto.yaml':
      'version: 1\nname: My app\nsystem: mhproto/system.md\ncapabilities:\n  - id: example\n    title: Example capability\n    spec: mhproto/capabilities/example/spec.md\n    interface: mhproto/interfaces/openapi.yaml\n    examples: mhproto/capabilities/example/examples.yaml\n    checks: mhproto/capabilities/example/checks.yaml\n    sources: []\n',
    'mhproto/system.md':
      '# System map\n\nReplace this with the app’s capabilities, owners and dependencies.\n',
    'mhproto/capabilities/example/spec.md':
      '# Example capability\n\nStatus: draft — replace this scaffold before implementing.\n\n## Purpose\nDescribe the capability and its boundaries.\n\n## Rules\n- **EXAMPLE-B-1** Reading status returns the current service status.\n\n## States and permissions\nDocument transitions, permissions, failures and recovery.\n',
    'mhproto/interfaces/openapi.yaml':
      'openapi: 3.1.0\ninfo:\n  title: Example API\n  version: "1"\npaths:\n  /status:\n    get:\n      operationId: getStatus\n      x-mhproto-rules: [EXAMPLE-B-1]\n      responses:\n        "200":\n          description: Current status\n          content:\n            application/json:\n              schema:\n                type: object\n                required: [status]\n                additionalProperties: false\n                properties:\n                  status: { type: string, enum: [ready] }\n              example: { status: ready }\n',
    'mhproto/capabilities/example/examples.yaml':
      'examples:\n  - id: EXAMPLE-E-1\n    title: Read service status\n    rules: [EXAMPLE-B-1]\n    operations: [getStatus]\n    given: The service is ready.\n    when: A client reads its status.\n    then: The response says ready.\n',
    'mhproto/capabilities/example/checks.yaml':
      '# Add argv commands and rule/example references. No tests are assumed to exist.\nchecks: []\n',
  };
  if (has('minimal')) {
    // Only the required parts; add an interface, examples and checks when needed.
    files['mhproto.yaml'] =
      'version: 1\nname: My app\nsystem: mhproto/system.md\ncapabilities:\n  - id: example\n    title: Example capability\n    spec: mhproto/capabilities/example/spec.md\n';
    for (const file of Object.keys(files))
      if (
        !['mhproto.yaml', 'mhproto/system.md', 'mhproto/capabilities/example/spec.md'].includes(
          file,
        )
      )
        delete files[file];
  }
  // Preflight all destinations; never overwrite an existing contract.
  for (const file of Object.keys(files)) {
    try {
      await lstat(await writePath(root, file));
      throw new Error(`Refusing to overwrite ${file}`);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  for (const [file, contents] of Object.entries(files))
    await writeFile(await writePath(root, file), contents, { flag: 'wx' });
  if (!has('no-skills')) await installSkills(option('agent', 'codex'));
  if (has('minimal'))
    console.log(
      'Initialised a minimal MHProto contract: rules only. Add interface, examples and checks to the capability when you need them.',
    );
  else
    console.log(
      'Initialised MHProto. Replace the example capability; run mhproto check and mhproto view.',
    );
}

try {
  parseArguments();
  if (command === 'init') await init();
  else if (command === 'skills') {
    if ([has('only'), has('remove'), has('check')].filter(Boolean).length > 1)
      throw new Error('Choose one of --only, --remove or --check');
    if (has('remove')) await removeSkills(option('agent', 'codex'), option('remove'));
    else if (has('check')) await checkSkills(option('agent', 'codex'));
    else await installSkills(option('agent', 'codex'), option('only'));
  } else if (command === 'plugins') await showPlugins();
  else if (command === 'check') {
    const project = await loadProject(root),
      issues = await validateProject(project);
    if (has('json')) console.log(JSON.stringify({ name: project.name, issues }, null, 2));
    else {
      const counts = new Map();
      let operations = 0;
      for (const cap of project.capabilities)
        for (const entity of cap.entities)
          if (entity.adapter === 'openapi') operations += entity.kind === 'operation' ? 1 : 0;
          else counts.set(entity.kind, (counts.get(entity.kind) ?? 0) + 1);
      console.log(
        `${project.name}: ${project.capabilities.length} capability, ${project.capabilities.reduce((n, c) => n + c.rules.length, 0)} rules, ${operations} operations` +
          [...counts]
            .map(([kind, n]) => `, ${n} ${project.kinds[kind].plural.toLowerCase()}`)
            .join(''),
      );
      for (const issue of issues)
        console.log(`${issue.level.toUpperCase()} [${issue.capability}] ${issue.message}`);
      console.log(
        `${issues.filter((i) => i.level === 'error').length} errors, ${issues.filter((i) => i.level === 'warning').length} warnings`,
      );
    }
    if (issues.some((i) => i.level === 'error')) process.exitCode = 1;
  } else if (command === 'context') {
    const options = Object.fromEntries(
      [
        'capability',
        'operation',
        'entity',
        'rule',
        'schema',
        'example',
        'check',
        'visual',
        'section',
      ].map((k) => [k, option(k)]),
    );
    const output = encodeContext(
      contextPacket(await loadProject(root), options),
      Number(option('max-chars', '12000')),
    );
    console.log(output);
    if (has('stats'))
      console.error(
        JSON.stringify({
          characters: output.length,
          bytes: Buffer.byteLength(output),
          note: 'Exact text sizes; model token counts vary.',
        }),
      );
  } else if (command === 'inspect') console.log(JSON.stringify(await model(root), null, 2));
  else if (command === 'verify') {
    const project = await loadProject(root),
      issues = await validateProject(project);
    if (issues.some((i) => i.level === 'error'))
      throw new Error('Contract validation failed; run mhproto check');
    const selected = option('capability');
    const caps = project.capabilities.filter((c) => !selected || c.id === selected);
    if (!caps.length) throw new Error(`Unknown capability: ${selected}`);
    for (const cap of caps) {
      if (!cap.checks.length) {
        console.log(`${cap.id}: no checks configured; evidence remains unchecked`);
        continue;
      }
      console.log(`Running ${cap.checks.length} checks for ${cap.id}`);
      const result = await verifyCapability(project, cap, (r) => {
        console.log(`${r.status.toUpperCase()} ${r.id} (${r.durationMs}ms)`);
        if (r.status === 'failing')
          console.log(
            [
              r.error,
              r.stderr.slice(-1500),
              ...r.missing.map((t) => 'Missing test: ' + t),
              ...r.skipped.map((t) => 'Skipped test: ' + t),
              ...r.todo.map((t) => 'TODO test: ' + t),
            ]
              .filter(Boolean)
              .join('\n'),
          );
      });
      if (result.results.some((r) => r.status === 'failing') || result.changedDuringRun)
        process.exitCode = 1;
    }
  } else if (command === 'view') {
    await loadProject(root);
    const port = Number(option('port', '4317'));
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
    const server = await serve(root, port, { against: option('against') });
    console.log(`MHProto viewer: http://127.0.0.1:${server.address().port}`);
    console.log(
      'Local browser view. Visual attachments save to mhproto/visuals.yaml; source edits refresh automatically.',
    );
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.on(signal, () => server.close(() => process.exit(0)));
  } else if (command === 'snapshot') {
    const destination = path.resolve(root, option('out', '.mhproto/baseline.json'));
    const relative = path.relative(root, destination);
    const data =
      JSON.stringify(
        contractSnapshot(await model(root), { label: option('label', 'Iteration baseline') }),
        null,
        2,
      ) + '\n';
    if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
      await atomicWrite(root, relative, data);
    else {
      await mkdir(path.dirname(destination), { recursive: true });
      await atomicWrite(path.dirname(destination), path.basename(destination), data);
    }
    console.log(`Saved baseline: ${destination}`);
  } else if (command === 'diff') {
    const before = JSON.parse(
      await readFile(path.resolve(root, option('against', '.mhproto/baseline.json')), 'utf8'),
    );
    console.log(JSON.stringify(compareModels(before, await model(root)), null, 2));
  } else if (command === 'build') {
    const destination = path.resolve(root, option('out', '.mhproto/viewer'));
    await exportViewer(root, destination, { against: option('against') });
    console.log(
      `Exported viewer: ${destination}. Open viewer.html directly or serve this folder over HTTP.`,
    );
  } else if (command === 'help' || has('help')) {
    const { version } = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    console.log(
      `MHProto ${version}\n\nCommands: init, skills, plugins, check, context, inspect, verify, view, snapshot, diff, build\n\nOptions: --root PATH, --json (check/plugins), --capability ID (verify/context), --port PORT (view),\n         --operation ID|--entity KIND:ID|--rule ID|--schema NAME|--example ID|--check ID|--visual ID (context),\n         --section NAME,... (context), --max-chars N, --stats (context),\n         --agent codex|claude|all (init/skills), --no-skills, --minimal (init),\n         --only NAME,... | --remove NAME,... | --check (skills),\n         --out PATH (snapshot/build), --label TEXT (snapshot), --against PATH (diff/view/build)`,
    );
  } else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(`MHProto: ${error.message}`);
  process.exitCode = 1;
}
