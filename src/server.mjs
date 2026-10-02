import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadProject, validateProject, packageRoot, projectPath } from './core.mjs';
import { addVisual, mediaMime, maxMediaBytes } from './visuals.mjs';

const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/vendor/mermaid.min.js': ['vendor/mermaid.min.js', 'text/javascript'] };
export async function model(root) {
  const project = await loadProject(root);
  return { ...project, issues: await validateProject(project) };
}
export function compareModels(before, after) {
  const changes = [];
  const compare = (cap, kind, oldItems, newItems, key) => {
    const oldMap = new Map(oldItems.map(x => [x[key], x]));
    const newMap = new Map(newItems.map(x => [x[key], x]));
    for (const id of new Set([...oldMap.keys(), ...newMap.keys()])) {
      const a = oldMap.get(id), b = newMap.get(id);
      if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ capability: cap, kind, id, status: !a ? 'added' : !b ? 'removed' : 'changed', before: a ?? null, after: b ?? null });
    }
  };
  const oldCaps = new Map(before.capabilities.map(c => [c.id, c]));
  const newCaps = new Map(after.capabilities.map(c => [c.id, c]));
  for (const id of new Set([...oldCaps.keys(), ...newCaps.keys()])) {
    const a = oldCaps.get(id), b = newCaps.get(id);
    compare(id, 'rule', a?.rules ?? [], b?.rules ?? [], 'id');
    compare(id, 'operation', a?.operations ?? [], b?.operations ?? [], 'operationId');
    compare(id, 'example', a?.examples ?? [], b?.examples ?? [], 'id');
    compare(id, 'check', a?.checks ?? [], b?.checks ?? [], 'id');
    compare(id, 'schema', Object.entries(a?.openapi.components?.schemas ?? {}).map(([name, schema]) => ({ name, schema })), Object.entries(b?.openapi.components?.schemas ?? {}).map(([name, schema]) => ({ name, schema })), 'name');
  }
  return changes;
}

export function createHandler(root) {
  return async (request, response) => {
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('cache-control', 'no-store');
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? '')) { response.writeHead(403).end(); return; }
    try {
      if (request.method === 'POST' && url.pathname === '/api/visuals') {
        if (request.headers.origin !== 'http://' + request.headers.host) { response.writeHead(403).end(); return; }
        if (!(request.headers['content-type'] ?? '').startsWith('application/json')) { response.writeHead(415).end(); return; }
        const chunks = []; let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > Math.ceil(maxMediaBytes * 4 / 3) + 8192) { response.writeHead(413).end(); return; }
          chunks.push(chunk);
        }
        let visual;
        try { visual = await addVisual(root, await loadProject(root), JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (error) { response.writeHead(400, {'content-type':'application/json'}).end(JSON.stringify({error:error.message})); return; }
        response.writeHead(201, {'content-type':'application/json'}).end(JSON.stringify(visual)); return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
      if (url.pathname.startsWith('/api/visuals/')) {
        const project = await loadProject(root), id = url.pathname.slice('/api/visuals/'.length);
        const visual = project.visuals.find(v => v.id === id && v.file);
        if (!visual) { response.writeHead(404).end(); return; }
        response.setHeader('content-type', mediaMime(visual.file));
        const bytes = await readFile(await projectPath(root, visual.file));
        response.end(request.method === 'HEAD' ? undefined : bytes); return;
      }
      if (url.pathname === '/api/model') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(await model(root))); return;
      }
      if (url.pathname === '/api/diff') {
        let previous;
        try { previous = JSON.parse(await readFile(path.join(root, '.bive/baseline.json'), 'utf8')); }
        catch (e) { if (e.code !== 'ENOENT') throw e; }
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ available: Boolean(previous), changes: previous ? compareModels(previous, await model(root)) : [] })); return;
      }
      const asset = assets[url.pathname];
      if (!asset) { response.writeHead(404).end(); return; }
      response.setHeader('content-type', asset[1]);
      response.end(await readFile(path.join(packageRoot, 'viewer', asset[0])));
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message }));
    }
  };
}
export async function serve(root, port = 4317) {
  const server = createServer(createHandler(root));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}

export async function exportViewer(root, destination) {
  await mkdir(destination, { recursive: true });
  for (const [name] of Object.values(assets)) {
    await mkdir(path.dirname(path.join(destination, name)), { recursive: true });
    await writeFile(path.join(destination, name), await readFile(path.join(packageRoot, 'viewer', name)));
  }
  const project = await model(root);
  const media = {};
  for (const visual of project.visuals) if (visual.file) {
    const mime = mediaMime(visual.file);
    if (!mime) throw new Error(`Unsupported visual file: ${visual.file}`);
    media[visual.id] = `data:${mime};base64,${(await readFile(await projectPath(root,visual.file))).toString('base64')}`;
  }
  await writeFile(path.join(destination, 'model.json'), JSON.stringify(project, null, 2));
  let baseline;
  try { baseline = JSON.parse(await readFile(path.join(root, '.bive/baseline.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const changes = { available: Boolean(baseline), changes: baseline ? compareModels(baseline, project) : [] };
  const [html, css, js, mermaid] = await Promise.all(['index.html', 'style.css', 'app.js', 'vendor/mermaid.min.js'].map(name => readFile(path.join(packageRoot, 'viewer', name), 'utf8')));
  const safeJson = value => JSON.stringify(value).replaceAll('<', '\\u003c');
  const standalone = html.replace('<link rel="stylesheet" href="/style.css">', () => `<style>${css}</style>`)
    .replace('<script src="/vendor/mermaid.min.js"></script>', () => `<script>${mermaid.replace(/<\/script/gi, '<\\/script')}</script>`)
    .replace('<script type="module" src="/app.js"></script>', () => `<script id="bive-model" type="application/json">${safeJson(project)}</script><script id="bive-media" type="application/json">${safeJson(media)}</script><script id="bive-diff" type="application/json">${safeJson(changes)}</script><script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`);
  await writeFile(path.join(destination, 'viewer.html'), standalone);
}
