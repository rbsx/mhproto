import { createServer } from 'node:http';
import { readFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { loadProject, validateProject, packageRoot, projectPath } from './core.mjs';
import { addVisual, mediaMime, maxMediaBytes } from './visuals.mjs';
import { atomicWrite, writePath } from './paths.mjs';
import { compareModels, contractSnapshot, snapshotProject } from '../viewer/diff.js';
export { compareModels } from '../viewer/diff.js';

const assets = {
  '/': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'],
  '/diff.js': ['diff.js', 'text/javascript'],
  '/style.css': ['style.css', 'text/css'],
  '/vendor/mermaid.min.js': ['vendor/mermaid.min.js', 'text/javascript'],
};
export async function model(root) {
  const project = await loadProject(root);
  return { ...project, issues: await validateProject(project) };
}
async function readBaseline(file, required = false) {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'));
    snapshotProject(value);
    return contractSnapshot(value, {
      label: value.label ?? 'Saved baseline',
      createdAt: value.createdAt ?? null,
    });
  } catch (error) {
    if (error.code === 'ENOENT' && !required) return null;
    throw error;
  }
}

export function createHandler(root, { against } = {}) {
  const baselineFile = path.resolve(root, against ?? '.mhproto/baseline.json');
  return async (request, response) => {
    response.setHeader(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('cache-control', 'no-store');
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? '')) {
      response.writeHead(403).end();
      return;
    }
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'POST' && url.pathname === '/api/baseline') {
        if (against) {
          response.writeHead(409, { 'content-type': 'application/json' }).end(
            JSON.stringify({
              error:
                'This comparison uses --against. Start a new viewer without it to save an iteration baseline.',
            }),
          );
          return;
        }
        if (request.headers.origin !== 'http://' + request.headers.host) {
          response.writeHead(403).end();
          return;
        }
        if (!(request.headers['content-type'] ?? '').startsWith('application/json')) {
          response.writeHead(415).end();
          return;
        }
        let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > 1024) {
            response.writeHead(413).end();
            return;
          }
        }
        const baseline = contractSnapshot(await model(root));
        await atomicWrite(root, '.mhproto/baseline.json', JSON.stringify(baseline, null, 2) + '\n');
        response
          .writeHead(201, { 'content-type': 'application/json' })
          .end(JSON.stringify(baseline));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/visuals') {
        if (request.headers.origin !== 'http://' + request.headers.host) {
          response.writeHead(403).end();
          return;
        }
        if (!(request.headers['content-type'] ?? '').startsWith('application/json')) {
          response.writeHead(415).end();
          return;
        }
        const chunks = [];
        let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > Math.ceil((maxMediaBytes * 4) / 3) + 8192) {
            response.writeHead(413).end();
            return;
          }
          chunks.push(chunk);
        }
        let visual;
        try {
          visual = await addVisual(
            root,
            await loadProject(root),
            JSON.parse(Buffer.concat(chunks).toString('utf8')),
          );
        } catch (error) {
          response
            .writeHead(400, { 'content-type': 'application/json' })
            .end(JSON.stringify({ error: error.message }));
          return;
        }
        response.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify(visual));
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405).end();
        return;
      }
      if (url.pathname.startsWith('/api/visuals/')) {
        const project = await loadProject(root),
          id = url.pathname.slice('/api/visuals/'.length);
        const visual = project.visuals.find((v) => v.id === id && v.file);
        if (!visual) {
          response.writeHead(404).end();
          return;
        }
        response.setHeader('content-type', mediaMime(visual.file));
        const bytes = await readFile(await projectPath(root, visual.file));
        response.end(request.method === 'HEAD' ? undefined : bytes);
        return;
      }
      if (url.pathname === '/api/model') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(await model(root)));
        return;
      }
      if (url.pathname === '/api/diff') {
        const previous = await readBaseline(baselineFile, Boolean(against));
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            available: Boolean(previous),
            changes: previous ? compareModels(previous, await model(root)) : [],
          }),
        );
        return;
      }
      if (url.pathname === '/api/baseline') {
        response.setHeader('x-mhproto-baseline-readonly', String(Boolean(against)));
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(await readBaseline(baselineFile, Boolean(against))));
        return;
      }
      const asset = assets[url.pathname];
      if (!asset) {
        response.writeHead(404).end();
        return;
      }
      response.setHeader('content-type', asset[1]);
      response.end(await readFile(path.join(packageRoot, 'viewer', asset[0])));
    } catch (error) {
      response
        .writeHead(500, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: error.message }));
    }
  };
}
export async function serve(root, port = 4317, options = {}) {
  const server = createServer(createHandler(root, options));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

export async function exportViewer(root, destination, { against } = {}) {
  const actualRoot = await realpath(root);
  const actualDestination = await realpath(destination).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return path.resolve(destination);
  });
  if (actualDestination === actualRoot)
    throw new Error('Export into a separate directory, not the project root');
  const relative = path.relative(path.resolve(root), path.resolve(destination));
  if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
    await writePath(root, path.join(relative, 'viewer.html'));
  const loaded = await model(root);
  if (loaded.issues.some((issue) => issue.level === 'error'))
    throw new Error('Fix contract validation errors before exporting');
  // Portable exports retain evidence summaries, not captured process output or
  // machine paths. Authored contract data still needs review before sharing.
  const { root: localRoot, ...data } = loaded;
  const keep = (value, keys) =>
    Object.fromEntries(
      keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]),
    );
  const project = {
    ...data,
    capabilities: loaded.capabilities.map((cap) => ({
      ...cap,
      evidence: cap.evidence
        ? {
            ...keep(cap.evidence, [
              'version',
              'capability',
              'digest',
              'finishedAt',
              'changedDuringRun',
              'stale',
            ]),
            results: cap.evidence.results.map((result) => ({
              ...keep(result, [
                'id',
                'status',
                'startedAt',
                'durationMs',
                'exitCode',
                'timedOut',
                'missing',
                'skipped',
                'todo',
                'truncated',
                'rules',
                'examples',
              ]),
              tests: (result.tests ?? []).map((test) =>
                keep(test, ['type', 'name', 'skip', 'todo']),
              ),
            })),
          }
        : null,
    })),
  };
  const media = {};
  for (const visual of project.visuals)
    if (visual.file) {
      const mime = mediaMime(visual.file);
      if (!mime) throw new Error(`Unsupported visual file: ${visual.file}`);
      media[visual.id] =
        `data:${mime};base64,${(await readFile(await projectPath(root, visual.file))).toString('base64')}`;
    }
  const baseline = await readBaseline(
    path.resolve(root, against ?? '.mhproto/baseline.json'),
    Boolean(against),
  );
  const [html, css, js, mermaid, diff] = await Promise.all(
    ['index.html', 'style.css', 'app.js', 'vendor/mermaid.min.js', 'diff.js'].map((name) =>
      readFile(path.join(packageRoot, 'viewer', name), 'utf8'),
    ),
  );
  const bundled = js.replace(/import\s*\{[^}]+\}\s*from\s*['"]\.\/diff\.js['"];?/, () =>
    diff.replace(/^export /gm, ''),
  );
  const safeJson = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');
  const standalone = html
    .replace(/<link\s+rel="stylesheet"\s+href="\/style\.css"\s*\/?>/, () => `<style>${css}</style>`)
    .replace(
      /<script\s+src="\/vendor\/mermaid\.min\.js"\s*>\s*<\/script>/,
      () => `<script>${mermaid.replace(/<\/script/gi, '<\\/script')}</script>`,
    )
    .replace(
      /<script\s+type="module"\s+src="\/app\.js"\s*>\s*<\/script>/,
      () =>
        `<script id="mhproto-model" type="application/json">${safeJson(project)}</script><script id="mhproto-media" type="application/json">${safeJson(media)}</script><script id="mhproto-baseline" type="application/json">${safeJson(baseline)}</script><script type="module">${bundled.replace(/<\/script/gi, '<\\/script')}</script>`,
    );
  if (
    !standalone.includes('id="mhproto-model"') ||
    /<script[^>]+src=/.test(standalone) ||
    /<link[^>]+href="\/style\.css"/.test(standalone)
  )
    throw new Error('Viewer template could not be bundled into a standalone export');
  const output = new Map([
    ['index.html', html],
    ['style.css', css],
    ['app.js', js],
    ['vendor/mermaid.min.js', mermaid],
    ['diff.js', diff],
    ['model.json', JSON.stringify(project, null, 2)],
    ['baseline.json', JSON.stringify(baseline)],
    ['viewer.html', standalone],
  ]);
  await mkdir(destination, { recursive: true });
  // Resolve every output before replacing any existing file.
  for (const name of output.keys()) await writePath(destination, name);
  for (const [name, contents] of output) await atomicWrite(destination, name, contents);
}
