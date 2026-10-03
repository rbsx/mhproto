import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
export const source = {
  version: '12.1.0',
  commit: '21f72f07ea22c0af48a3149c550654e80d8e40cb',
  url: 'https://codeload.github.com/mermaid-js/mermaid/tar.gz/21f72f07ea22c0af48a3149c550654e80d8e40cb',
  sha256: 'cf77817caa304a941833e673bf2dd099767aa2ac2be3cc7e4ed9b2f42848bb81',
};
export const hash = (bytes, algorithm = 'sha256', encoding = 'hex') =>
  createHash(algorithm).update(bytes).digest(encoding);

// Build in a fresh directory with dependencies resolved by the committed lockfile.
// Upstream source and its schema/Jison plugins are unchanged; dependency versions
// are selected here rather than using the vulnerable upstream prebuilt artifact.
export async function buildMermaid(directory, archivePath) {
  await mkdir(directory, { recursive: true });
  const archive = path.join(directory, 'source.tgz');
  if (archivePath) await copyFile(archivePath, archive);
  else {
    const response = await fetch(source.url);
    assert.equal(response.status, 200, 'Upstream source download');
    await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  }
  assert.equal(hash(await readFile(archive)), source.sha256, 'Pinned upstream source archive');
  const work = path.join(directory, 'source');
  await mkdir(work);
  const prefix = 'mermaid-' + source.commit;
  await exec(
    'tar',
    [
      '-xzf',
      archive,
      '--strip-components=1',
      '-C',
      work,
      prefix + '/packages/mermaid/src',
      prefix + '/packages/mermaid/package.json',
      prefix + '/packages/mermaid/tsconfig.json',
      prefix + '/tsconfig.json',
      prefix + '/LICENSE',
      prefix + '/.build',
      prefix + '/.esbuild',
    ],
    { maxBuffer: 2_000_000 },
  );
  for (const file of ['package.json', 'package-lock.json'])
    await copyFile(path.join(root, 'tools/mermaid', file), path.join(work, file));
  await exec('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: work,
    maxBuffer: 2_000_000,
  });
  const { build } = await import(
    pathToFileURL(path.join(work, 'node_modules/esbuild/lib/main.js'))
  );
  await build({
    absWorkingDir: work,
    entryPoints: ['.esbuild/jisonPlugin.ts', '.esbuild/jsonSchemaPlugin.ts'],
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    outdir: path.join(work, 'plugins'),
  });
  const { jisonPlugin } = await import(pathToFileURL(path.join(work, 'plugins/jisonPlugin.js')));
  const { jsonSchemaPlugin } = await import(
    pathToFileURL(path.join(work, 'plugins/jsonSchemaPlugin.js'))
  );
  const base = path.join(work, 'packages/mermaid');
  const result = await build({
    absWorkingDir: base,
    entryPoints: ['src/mermaid.ts'],
    bundle: true,
    minify: true,
    keepNames: true,
    platform: 'browser',
    target: ['es2024', 'safari17.4', 'ios17.4', 'chrome121', 'edge121', 'firefox123', 'node22.12'],
    tsconfig: 'tsconfig.json',
    resolveExtensions: ['.ts', '.js', '.json', '.jison', '.yaml'],
    external: ['require', 'fs', 'path'],
    plugins: [jisonPlugin, jsonSchemaPlugin],
    sourcemap: 'external',
    outfile: path.join(work, 'mermaid.min.js'),
    metafile: true,
    globalName: '__esbuild_esm_mermaid_nm["mermaid"]',
    format: 'iife',
    define: {
      'injected.includeLargeFeatures': 'true',
      'injected.profiling': 'false',
      'injected.version': JSON.stringify(source.version),
      'import.meta.vitest': 'undefined',
    },
    footer: { js: 'globalThis["mermaid"] = __esbuild_esm_mermaid_nm["mermaid"].default;' },
  });
  const inputs = Object.keys(result.metafile.inputs);
  // The committed input paths also prove which parser chunks need recursive inspection.
  assert.ok(inputs.every((input) => !path.isAbsolute(input) && !input.includes('\\')));
  const evidence = { inputs: inputs.sort(), packages: [], parserChunks: [] };
  const lock = JSON.parse(await readFile(path.join(work, 'package-lock.json'), 'utf8'));
  const packages = new Set();
  for (const input of inputs) {
    const absolute = path.resolve(base, input);
    const relative = path.relative(work, absolute).split(path.sep).join('/');
    if (!relative.startsWith('node_modules/')) continue;
    const marker = relative.lastIndexOf('node_modules/');
    const segments = relative.slice(marker + 'node_modules/'.length).split('/');
    const name = segments[0].startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
    const packagePath = relative.slice(0, marker + 'node_modules/'.length) + name;
    const entry = lock.packages[packagePath];
    assert.ok(entry?.version, 'Locked build input ' + input);
    packages.add(name + '@' + entry.version);
    if (name === '@mermaid-js/parser' && relative.endsWith('.mjs')) {
      const mapBytes = await readFile(absolute + '.map');
      const map = JSON.parse(mapBytes);
      evidence.parserChunks.push({
        file: relative.slice(packagePath.length + 1),
        sha256: hash(await readFile(absolute)),
        mapSha256: hash(mapBytes),
      });
      for (const sourcePath of map.sources) {
        const match = sourcePath.match(/\/\.pnpm\/([^/]+)\/node_modules\//);
        if (match) packages.add(match[1].split('_')[0].replaceAll('+', '/'));
      }
    }
  }
  // vscode-uri's webpack map flattens these sources; the license verifier checks identity.
  packages.add('vscode-uri@3.1.0');
  packages.add('path-browserify@1.0.1');
  packages.add('mermaid@' + source.version);
  evidence.packages = [...packages].sort();
  evidence.parserChunks.sort((a, b) => a.file.localeCompare(b.file));
  await writeFile(
    path.join(directory, 'build-evidence.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  );
  return {
    work,
    evidence,
    bundle: await readFile(path.join(work, 'mermaid.min.js'), 'utf8'),
    license: await readFile(path.join(work, 'LICENSE'), 'utf8'),
  };
}

export function wrapMermaid(bundle, license, notice) {
  assert.ok(!license.includes('*/') && !notice.includes('*/'), 'Notices fit the JS comment');
  return (
    '/*\n' +
    license.trimEnd() +
    '\n*/\n(function(){\n' +
    bundle +
    '\n})();\n\n/*\n' +
    notice.trimEnd() +
    '\n*/\n'
  );
}
