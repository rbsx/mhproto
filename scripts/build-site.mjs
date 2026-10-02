import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { JSDOM } from 'jsdom';
import { compareModels } from '../viewer/diff.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'website');
const output = path.join(source, 'dist');
const read = (file) => readFile(path.join(root, file), 'utf8');
const write = async (file, data) => {
  const destination = path.join(output, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, data);
};
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const slug = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const pages = [
  ['doc/guide.md', 'reference', 'Reference guide'],
  ['skills/mhproto-specify/references/format.md', 'format', 'Contract file format'],
  ['doc/context-design.md', 'context', 'Agent context'],
  ['doc/viewer-design.md', 'viewer', 'Viewer design'],
  ['doc/release-review.md', 'release-status', 'Release status'],
];
const routes = new Map(
  pages.flatMap(([file, route]) => [
    [file, '/docs/' + route + '/'],
    [path.basename(file), '/docs/' + route + '/'],
  ]),
);
const shell = await read('website/index.html');
const header = shell.slice(0, shell.indexOf('<main'));
const footer = shell.slice(shell.indexOf('<footer'));

// Rebuild only the generated output, never the authored website or library files.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ['site.css', 'site.js', 'favicon.svg', '_headers', '404.html'])
  await cp(path.join(source, file), path.join(output, file));

for (const [file, route, title] of pages) {
  const dom = new JSDOM(marked.parse(await read(file)));
  const { document } = dom.window;
  const used = new Set();
  for (const heading of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    let id = slug(heading.textContent),
      index = 2;
    while (used.has(id)) id = slug(heading.textContent) + '-' + index++;
    heading.id = id;
    used.add(id);
  }
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (href.startsWith('https://mhproto.ignxt.chatgpt.site'))
      a.setAttribute(
        'href',
        href.replace('https://mhproto.ignxt.chatgpt.site', 'https://mhproto.dev'),
      );
    else if (routes.has(href)) a.setAttribute('href', routes.get(href));
    else if (href === 'CONTRIBUTING.md' || href === '../CONTRIBUTING.md')
      a.setAttribute('href', 'https://github.com/rbsx/mhproto/blob/main/CONTRIBUTING.md');
  }
  for (const table of document.querySelectorAll('table')) {
    const container = document.createElement('div');
    container.className = 'docs-table';
    table.replaceWith(container);
    container.append(table);
  }
  const contents = [...document.querySelectorAll('h2')]
    .map((h) => `<li><a href="#${h.id}">${escape(h.textContent)}</a></li>`)
    .join('');
  const nav = contents
    ? `<nav class="docs-contents" aria-label="On this page"><p>On this page</p><ul>${contents}</ul></nav>`
    : '';
  const h1 = document.querySelector('h1');
  if (h1)
    h1.insertAdjacentHTML(
      'afterend',
      `<p class="docs-back"><a href="/docs/">← Getting started</a></p>${nav}`,
    );
  const top = header
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(title)} · MHProto</title>`)
    .replace('https://mhproto.dev/"', `https://mhproto.dev/docs/${route}/"`)
    .replace('href="#main"', 'href="#main"');
  await write(
    `docs/${route}/index.html`,
    `${top}<main id="main" class="docs wrap">${document.body.innerHTML}</main>${footer}`,
  );
}
await write('docs/index.html', await read('website/docs/index.html'));

const project = JSON.parse(await read('website/demo/model.json'));
const baseline = JSON.parse(await read('website/demo/baseline.json'));
const media = JSON.parse(await read('website/demo/media.json'));
// The committed fixture omits local paths, check commands/environment and runner logs.
for (const data of [project, baseline?.project]) {
  if (!data) continue;
  if ('root' in data) throw new Error('Demo contains a local root');
  for (const cap of data.capabilities ?? []) {
    for (const check of cap.checks ?? [])
      if (check.command || check.env)
        throw new Error('Demo contains executable check configuration');
    for (const result of cap.evidence?.results ?? [])
      for (const key of ['command', 'stdout', 'stderr', 'error'])
        if (key in result) throw new Error('Demo contains captured execution details');
  }
}
const changes = compareModels(baseline, project);
await write(
  'index.html',
  shell.replace('data-change-count></span>', `data-change-count>${changes.length}</span>`),
);
const json = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');
const template = await read('viewer/index.html');
const css = await read('viewer/style.css');
const mermaid = await read('viewer/vendor/mermaid.min.js');
// Share the actual library viewer. Embedded JSON selects its offline-preview mode.
const diff = await read('viewer/diff.js');
const app = (await read('viewer/app.js')).replace(
  /import\s*\{[^}]+\}\s*from\s*['"]\.\/diff\.js['"];?/,
  () => diff.replace(/^export /gm, ''),
);
const demo = template
  .replace(/<link\s+rel="stylesheet"\s+href="\/style\.css"\s*\/?>/, () => `<style>${css}</style>`)
  .replace(
    /<script\s+src="\/vendor\/mermaid\.min\.js"\s*>\s*<\/script>/,
    () => `<script>${mermaid.replace(/<\/script/gi, '<\\/script')}</script>`,
  )
  .replace('href="https://mhproto.dev/"', 'href="/"')
  .replace(
    /<script\s+type="module"\s+src="\/app\.js"\s*>\s*<\/script>/,
    () =>
      `<script id="mhproto-model" type="application/json">${json(project)}</script><script id="mhproto-media" type="application/json">${json(media)}</script><script id="mhproto-baseline" type="application/json">${json(baseline)}</script><script type="module">${app.replace(/<\/script/gi, '<\\/script')}</script>`,
  );
await write('demo/index.html', demo);
for (const file of ['style.css', 'app.js', 'diff.js', 'vendor/mermaid.min.js'])
  await write('demo/' + file, await read('viewer/' + file));
console.log(
  `Built MHProto website: ${pages.length + 1} documentation pages, ${project.capabilities[0].operations.length} demo endpoints, ${changes.length} comparison changes.`,
);
