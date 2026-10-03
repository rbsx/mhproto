import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = path.join(root, 'viewer/vendor');
const manifest = JSON.parse(await readFile(path.join(vendor, 'manifest.json'), 'utf8'));
const inventory = JSON.parse(await readFile(path.join(vendor, 'bundled-packages.json'), 'utf8'));
const hash = (data, algorithm = 'sha256', encoding = 'hex') =>
  createHash(algorithm).update(data).digest(encoding);
const temporary = await mkdtemp(path.join(tmpdir(), 'mhproto-mermaid-'));

try {
  let archive = process.argv[2] ? path.resolve(process.argv[2]) : null;
  if (!archive) {
    const { stdout } = await exec(
      'npm',
      ['pack', 'mermaid@11.16.1', '--ignore-scripts', '--json', '--pack-destination', temporary],
      { maxBuffer: 2_000_000 },
    );
    archive = path.join(temporary, JSON.parse(stdout)[0].filename);
  }
  assert.equal(
    'sha512-' + hash(await readFile(archive), 'sha512', 'base64'),
    manifest.registryArtifact.integrity,
    'Archive does not match the pinned npm integrity',
  );
  const extract = async (file) =>
    (await exec('tar', ['-xOf', archive, 'package/' + file], { maxBuffer: 20_000_000 })).stdout;
  const bundle = await extract('dist/mermaid.min.js');
  const sourceMap = await extract('dist/mermaid.min.js.map');
  const license = await extract('LICENSE');
  assert.equal(hash(bundle), manifest.registryArtifact.bundleSha256, 'Upstream bundle hash');
  assert.equal(hash(sourceMap), manifest.registryArtifact.sourceMapSha256, 'Source map hash');
  assert.equal(
    (await readFile(path.join(vendor, 'LICENSE'), 'utf8')).trim(),
    license.trim(),
    'Mermaid license differs from the official archive',
  );

  // Keep the upstream lexical namespace private and expose its API to the offline viewer.
  const exportLine =
    'globalThis["mermaid"] = globalThis.__esbuild_esm_mermaid_nm["mermaid"].default;';
  assert.equal(bundle.split(exportLine).length, 2, 'Expected one upstream export line');
  let wrapped =
    '/*\n' +
    license.trimEnd() +
    '\n*/\n(function(){\n' +
    bundle.replace(
      exportLine,
      'globalThis["mermaid"] = __esbuild_esm_mermaid_nm["mermaid"].default;',
    ) +
    '\n})();\n';
  if (manifest.licenseInventoryComplete) {
    const licenses = JSON.parse(
      await readFile(path.join(vendor, manifest.licenseInventory), 'utf8'),
    );
    assert.equal(licenses.complete, true, 'License inventory status');
    const notice = await readFile(path.join(vendor, licenses.noticeFile), 'utf8');
    assert.equal(hash(notice), manifest.noticeSha256, 'Notice appendix hash');
    assert.equal(hash(notice), licenses.noticeSha256, 'Inventory notice hash');
    assert.ok(!notice.includes('*/'), 'Notice must fit inside the appended comment');
    for (const record of [
      ...licenses.packages.flatMap((entry) => entry.notices),
      ...licenses.supplementalNotices,
    ]) {
      assert.equal(
        hash(await readFile(path.join(vendor, record.file))),
        record.sha256,
        record.file,
      );
    }
    wrapped += '\n/*\n' + notice.trimEnd() + '\n*/\n';
  }
  assert.equal(
    wrapped,
    await readFile(path.join(vendor, 'mermaid.min.js'), 'utf8'),
    'Vendored bytes',
  );
  assert.equal(hash(wrapped), manifest.sha256, 'Vendored hash');

  const packages = [
    ...new Set(
      JSON.parse(sourceMap)
        .sources.filter((source) => source.includes('/.pnpm/'))
        .map((source) =>
          source
            .match(/\/\.pnpm\/([^/]+)\/node_modules\//)[1]
            .split('_')[0]
            .replaceAll('+', '/'),
        ),
    ),
  ].sort();
  assert.deepEqual(packages, inventory.packages, 'Bundled package version inventory');
  console.log(
    `Verified official Mermaid 11.16.1 archive, bundle, license, local wrapper and ${packages.length} bundled package versions.`,
  );
  console.log(
    manifest.licenseInventoryComplete
      ? 'Complete recorded license inventory and inline notices verified. See bundled-audit.json for the separate security release gate.'
      : 'The complete bundled license review remains open; this check does not clear that gate.',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
