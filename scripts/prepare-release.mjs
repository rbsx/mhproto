import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from './mermaid-build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(await readFile(path.join(root, 'package.json')));
assert.ok(!metadata.private, 'Release metadata must permit publication');
assert.match(metadata.version, /-preview\.\d+$/, 'Prepare an explicit preview version');
assert.equal(metadata.publishConfig.tag, 'next');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
assert.equal(
  git('status', '--porcelain'),
  '',
  'Commit reviewed source before preparing an archive',
);
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  assert.equal(result.status, 0, command + ' ' + args.join(' '));
};
for (const args of [
  ['run', 'check'],
  ['audit'],
  ['audit', 'signatures'],
  ['run', 'verify:vendor'],
  ['run', 'audit:vendor'],
  ['ci', '--prefix', 'tools/mermaid', '--ignore-scripts'],
  ['audit', '--prefix', 'tools/mermaid'],
  ['run', 'test:browser'],
])
  run('npm', args);
const destination = path.join(root, 'artifacts/release');
await mkdir(destination, { recursive: true });
const packed = JSON.parse(
  execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', destination], {
    cwd: root,
    encoding: 'utf8',
  }),
)[0];
assert.ok(
  !packed.files.some((f) =>
    /^(website|tools|scripts|test|test-results|node_modules|artifacts)\//.test(f.path),
  ),
  'Excluded source/dev files',
);
const archive = path.join(destination, packed.filename);
run(process.execPath, ['test/packed.mjs', archive]);
const bytes = await readFile(archive);
assert.equal('sha512-' + hash(bytes, 'sha512', 'base64'), packed.integrity);
const report = {
  name: metadata.name,
  version: metadata.version,
  tag: metadata.publishConfig.tag,
  preparedAt: new Date().toISOString(),
  commit: git('rev-parse', 'HEAD'),
  filename: packed.filename,
  sha256: hash(bytes),
  integrity: packed.integrity,
  size: packed.size,
  unpackedSize: packed.unpackedSize,
  files: packed.files,
  checks: [
    'format and 58 tests',
    'npm audit and registry signatures',
    'clean Mermaid source rebuild and original notices',
    '79-version bundled audit',
    'renderer build dependency audit',
    'desktop/mobile browser flows',
    'clean tarball consumer CLI and HTTP/offline browsers',
  ],
  published: false,
};
await writeFile(
  path.join(destination, 'release-manifest.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(`Prepared ${archive}\nSHA-256: ${report.sha256}\nNo registry publication performed.`);
