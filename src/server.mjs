import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { loadProject, validateProject, packageRoot, projectPath } from './core.mjs';
import { addVisual, mediaMime, maxMediaBytes } from './visuals.mjs';
import { compareModels, contractSnapshot, snapshotProject } from '../viewer/diff.js';
export { compareModels } from '../viewer/diff.js';

const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/diff.js': ['diff.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/vendor/mermaid.min.js': ['vendor/mermaid.min.js', 'text/javascript'] };
export async function model(root) {
  const project = await loadProject(root);
  return { ...project, issues: await validateProject(project) };
}
async function readBaseline(file,required=false) {
  try { const value=JSON.parse(await readFile(file,'utf8'));snapshotProject(value);return contractSnapshot(value,{label:value.label??'Saved baseline',createdAt:value.createdAt??null}); }
  catch(error) { if(error.code==='ENOENT'&&!required)return null;throw error; }
}

export function createHandler(root, {against}={}) {
  const baselineFile=path.resolve(root,against??'.bive/baseline.json');
  return async (request, response) => {
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('cache-control', 'no-store');
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? '')) { response.writeHead(403).end(); return; }
    try {
      if(request.method==='POST'&&url.pathname==='/api/baseline'){
        if(against){response.writeHead(409,{'content-type':'application/json'}).end(JSON.stringify({error:'This comparison uses --against. Start a new viewer without it to save an iteration baseline.'}));return;}
        if(request.headers.origin!=='http://'+request.headers.host){response.writeHead(403).end();return;}
        if(!(request.headers['content-type']??'').startsWith('application/json')){response.writeHead(415).end();return;}
        let bytes=0;for await(const chunk of request){bytes+=chunk.length;if(bytes>1024){response.writeHead(413).end();return;}}
        const baseline=contractSnapshot(await model(root));
        await mkdir(path.dirname(baselineFile),{recursive:true});
        const directory=await projectPath(root,'.bive'),temporary=path.join(directory,'.baseline-'+randomUUID()+'.tmp');
        await writeFile(temporary,JSON.stringify(baseline,null,2)+'\n',{flag:'wx'});await rename(temporary,baselineFile);
        response.writeHead(201,{'content-type':'application/json'}).end(JSON.stringify(baseline));return;
      }
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
        const previous=await readBaseline(baselineFile,Boolean(against));
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ available: Boolean(previous), changes: previous ? compareModels(previous, await model(root)) : [] })); return;
      }
      if(url.pathname==='/api/baseline'){
        response.setHeader('x-bive-baseline-readonly',String(Boolean(against)));
        response.setHeader('content-type','application/json');response.end(JSON.stringify(await readBaseline(baselineFile,Boolean(against))));return;
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
export async function serve(root, port = 4317, options={}) {
  const server = createServer(createHandler(root,options));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}

export async function exportViewer(root, destination, {against}={}) {
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
  const baseline=await readBaseline(path.resolve(root,against??'.bive/baseline.json'),Boolean(against));
  await writeFile(path.join(destination,'baseline.json'),JSON.stringify(baseline));
  const [html, css, js, mermaid, diff] = await Promise.all(['index.html', 'style.css', 'app.js', 'vendor/mermaid.min.js','diff.js'].map(name => readFile(path.join(packageRoot, 'viewer', name), 'utf8')));
  const bundled=js.replace("import { compareModels, contractSnapshot, snapshotProject, canonical } from './diff.js';",()=>diff.replace(/^export /gm,''));
  const safeJson = value => JSON.stringify(value).replaceAll('<', '\\u003c');
  const standalone = html.replace('<link rel="stylesheet" href="/style.css">', () => `<style>${css}</style>`)
    .replace('<script src="/vendor/mermaid.min.js"></script>', () => `<script>${mermaid.replace(/<\/script/gi, '<\\/script')}</script>`)
    .replace('<script type="module" src="/app.js"></script>', () => `<script id="bive-model" type="application/json">${safeJson(project)}</script><script id="bive-media" type="application/json">${safeJson(media)}</script><script id="bive-baseline" type="application/json">${safeJson(baseline)}</script><script type="module">${bundled.replace(/<\/script/gi, '<\\/script')}</script>`);
  await writeFile(path.join(destination, 'viewer.html'), standalone);
}
