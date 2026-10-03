import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const vendor = fileURLToPath(new URL('../viewer/vendor/', import.meta.url));
const inventory = JSON.parse(await readFile(path.join(vendor, 'license-inventory.json'), 'utf8'));
const direct = JSON.parse(await readFile(path.join(vendor, 'bundled-packages.json'), 'utf8'));
const temporary = await mkdtemp(path.join(tmpdir(), 'mhproto-licenses-'));
const archiveCache = new Map();
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') =>
  createHash(algorithm).update(bytes).digest(encoding);
const key = (entry) => entry.package + '@' + entry.version;
const extract = async (archive, file) =>
  (await exec('tar', ['-xOf', archive, file], { encoding: 'buffer', maxBuffer: 25_000_000 }))
    .stdout;

try {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < inventory.packages.length) {
        const entry = inventory.packages[cursor++];
        const cacheKey =
          entry.package.replaceAll('/', '__').replaceAll('@', '') + '-' + entry.version;
        let archive;
        if (process.argv[2])
          archive = path.join(path.resolve(process.argv[2]), cacheKey, 'package.tgz');
        else {
          assert.ok(entry.archive.url.startsWith('https://registry.npmjs.org/'));
          const response = await fetch(entry.archive.url);
          assert.equal(response.status, 200, key(entry));
          archive = path.join(temporary, cacheKey + '.tgz');
          await writeFile(archive, Buffer.from(await response.arrayBuffer()));
        }
        const [algorithm, expected] = entry.archive.integrity.split('-');
        assert.equal(
          hash(await readFile(archive), algorithm, 'base64'),
          expected,
          key(entry) + ' integrity',
        );
        archiveCache.set(key(entry), archive);
        const metadata = JSON.parse(
          (await extract(archive, 'package/package.json')).toString('utf8'),
        );
        assert.equal(metadata.name, entry.package);
        assert.equal(metadata.version, entry.version);
        assert.equal(
          metadata.license ?? null,
          entry.declaredLicense,
          key(entry) + ' license declaration',
        );
        assert.ok(entry.notices.length, key(entry) + ' has retained notices');
        for (const notice of entry.notices) {
          const original = await extract(archive, notice.archivePath);
          assert.equal(hash(original), notice.sha256, key(entry) + ' upstream notice');
          assert.deepEqual(await readFile(path.join(vendor, notice.file)), original, notice.file);
        }
      }
    }),
  );

  // The source-build verifier proves these exact chunks were input to esbuild.
  const evidence = JSON.parse(await readFile(path.join(vendor, 'build-evidence.json')));
  const parser = archiveCache.get('@mermaid-js/parser@2.0.1');
  const nested = new Set();
  const flattened = new Map();
  for (const entry of evidence.parserChunks) {
    const chunk = await extract(parser, 'package/' + entry.file);
    assert.equal(hash(chunk), entry.sha256, entry.file);
    const map = await extract(parser, 'package/' + entry.file + '.map');
    assert.equal(hash(map), entry.mapSha256, entry.file + '.map');
    const parsed = JSON.parse(map.toString('utf8'));
    for (const [i, sourcePath] of parsed.sources.entries()) {
      const match = sourcePath.match(/\/\.pnpm\/([^/]+)\/node_modules\//);
      if (match) nested.add(match[1].split('_')[0].replaceAll('+', '/'));
      if (sourcePath.startsWith('webpack://')) flattened.set(sourcePath, parsed.sourcesContent[i]);
    }
  }
  assert.ok(evidence.parserChunks.length > 0, 'Recursive parser inspection');
  for (const spec of nested)
    assert.ok(evidence.packages.includes(spec), 'Nested package coverage: ' + spec);
  const uriMap = JSON.parse(
    (await extract(archiveCache.get('vscode-uri@3.1.0'), 'package/lib/umd/index.js.map')).toString(
      'utf8',
    ),
  );
  const uriSources = new Map(uriMap.sources.map((source, i) => [source, uriMap.sourcesContent[i]]));
  for (const file of ['platform.ts', 'uri.ts', 'utils.ts']) {
    assert.equal(
      flattened.get('webpack://LIB/src/' + file),
      uriSources.get('webpack://vscode-uri/./src/' + file),
      'vscode-uri/' + file,
    );
  }
  assert.equal(
    flattened.get('webpack://LIB/node_modules/path-browserify/index.js'),
    (await extract(archiveCache.get('path-browserify@1.0.1'), 'package/index.js')).toString('utf8'),
    'path-browserify identity',
  );
  assert.deepEqual(direct.packages, evidence.packages, 'Recorded bundle package inventory');
  assert.deepEqual(
    evidence.packages,
    inventory.packages.map(key).sort(),
    'Complete package coverage',
  );
  for (const notice of inventory.supplementalNotices)
    assert.equal(hash(await readFile(path.join(vendor, notice.file))), notice.sha256);
  assert.equal(
    hash(await readFile(path.join(vendor, inventory.noticeFile))),
    inventory.noticeSha256,
  );
  console.log(
    `Verified ${inventory.packages.length} pinned archives, original license texts, nested parser sources and complete recorded package coverage.`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
