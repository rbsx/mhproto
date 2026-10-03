import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMermaid, hash, source, wrapMermaid } from './mermaid-build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = path.join(root, 'viewer/vendor');
const manifest = JSON.parse(await readFile(path.join(vendor, 'manifest.json'), 'utf8'));
assert.deepEqual(manifest.sourceBuild, source, 'Pinned source identity');
for (const [file, expected] of [
  ['package-lock.json', manifest.buildLockSha256],
  ['package.json', manifest.buildPackageSha256],
])
  assert.equal(
    hash(await readFile(path.join(root, 'tools/mermaid', file))),
    expected,
    'Build configuration ' + file,
  );
const temporary = await mkdtemp(path.join(tmpdir(), 'mhproto-mermaid-'));
try {
  const rebuilt = await buildMermaid(temporary, process.argv[2]);
  assert.equal(
    hash(rebuilt.bundle),
    manifest.unwrappedBundleSha256,
    'Reproduced upstream source build',
  );
  assert.deepEqual(
    rebuilt.evidence,
    JSON.parse(await readFile(path.join(vendor, manifest.buildEvidence))),
    'Complete build input and nested parser evidence',
  );
  assert.equal(
    rebuilt.license,
    await readFile(path.join(vendor, 'LICENSE'), 'utf8'),
    'Mermaid license',
  );
  const inventory = JSON.parse(await readFile(path.join(vendor, manifest.licenseInventory)));
  assert.equal(inventory.complete, true);
  assert.deepEqual(
    inventory.packages.map((p) => p.package + '@' + p.version).sort(),
    rebuilt.evidence.packages,
  );
  const notice = await readFile(path.join(vendor, inventory.noticeFile), 'utf8');
  assert.equal(hash(notice), manifest.noticeSha256);
  assert.equal(hash(notice), inventory.noticeSha256);
  for (const record of [
    ...inventory.packages.flatMap((p) => p.notices),
    ...inventory.supplementalNotices,
  ])
    assert.equal(hash(await readFile(path.join(vendor, record.file))), record.sha256, record.file);
  const wrapped = wrapMermaid(rebuilt.bundle, rebuilt.license, notice);
  assert.equal(hash(wrapped), manifest.sha256, 'Vendored bundle hash');
  assert.equal(
    wrapped,
    await readFile(path.join(vendor, 'mermaid.min.js'), 'utf8'),
    'Reproduced vendored bytes',
  );
  console.log(
    `Reproduced Mermaid ${source.version} from pinned source and locked dependencies; verified ${rebuilt.evidence.packages.length} package versions and all inline notices.`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
