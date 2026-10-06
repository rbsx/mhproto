import {
  compareModels,
  contractSnapshot,
  snapshotProject,
  canonical,
  entitiesOf,
  openapiView,
  operationRuleIds,
} from './diff.js';
const $ = (selector) => document.querySelector(selector);
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const prose = (value) =>
  escape(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
const raw = (value) => `<pre>${escape(JSON.stringify(value, null, 2))}</pre>`;
const embedded = $('#mhproto-model') ? JSON.parse($('#mhproto-model').textContent) : null;
const media = $('#mhproto-media') ? JSON.parse($('#mhproto-media').textContent) : {};
let previewChanged = false;
const disclosure = (title, body, open = false) =>
  `<details class="disclosure"${open ? ' open' : ''}><summary>${escape(title)}</summary><div>${body}</div></details>`;
let project,
  signature,
  query = new URLSearchParams(location.search).get('search') ?? '',
  generation = 0,
  diagramSerial = 0,
  diagramQueue = Promise.resolve();
const featureUrl = (cap) => '#/features/' + encodeURIComponent(cap.id);
const checkUrl = (cap, check) => featureUrl(cap) + '/checks/' + encodeURIComponent(check.id);
// Viewer scripts from plugins register with (globalThis.mhprotoViewerPlugins ??= []).push(…).
const viewerPlugins = () => (globalThis.mhprotoViewerPlugins ?? []).filter(Boolean);
// Run a plugin hook; a failing plugin is reported and skipped, never blanks the viewer.
function call(plugin, hook, ...args) {
  try {
    return plugin[hook]?.(...args);
  } catch (error) {
    console.error(`MHProto viewer plugin ${plugin.name ?? '?'}: ${hook} failed`, error);
    return undefined;
  }
}
// The first plugin answer to a hook. `undefined` means "not mine"; `null` is an answer.
function ask(hook, ...args) {
  for (const plugin of viewerPlugins()) {
    const answer = call(plugin, hook, ...args);
    if (answer !== undefined) return answer;
  }
  return null;
}
// Built-in routes plugins cannot replace.
const shellPages = new Set(['changes', 'checks', 'entities', 'sources']);
// Entities that get the generic sections and pages; plugins with their own pages own theirs.
const pluginEntities = (cap) => {
  const owned = new Set(viewerPlugins().flatMap((p) => p.ownsKinds ?? []));
  return cap ? entitiesOf(cap).filter((e) => !owned.has(e.kind)) : [];
};
const kindInfo = (kind) => project?.kinds?.[kind] ?? { label: kind, plural: kind };
const entityUrl = (cap, entity, rule) =>
  featureUrl(cap) +
  '/entities/' +
  encodeURIComponent(entity.kind) +
  '/' +
  encodeURIComponent(entity.id) +
  (rule ? '?rule=' + encodeURIComponent(rule) : '');
const viewerRenderers = () => Object.assign({}, ...viewerPlugins().map((p) => p.kinds ?? {}));
const trusted = Symbol('html');
const markup = (value) => ({ [trusted]: true, value: String(value) });
// What plugin renderers receive. `text`, `model` and `state` serve page-level hooks.
let services;
const pluginUi = () =>
  (services ??= Object.freeze({
    ...ui,
    text: Object.freeze({
      escape,
      prose,
      clean,
      pre: raw,
      disclosure,
      featureUrl,
      checkUrl,
      entityUrl,
      target,
      attachment: attachmentBlock,
      gallery: visualGallery,
      checks: checksSection,
      example: scenario,
      diagram,
      ruleLink,
    }),
    model: Object.freeze({ canonical, entitiesOf, openapiView, operationRuleIds }),
    state: Object.freeze({
      get project() {
        return project;
      },
      get baseline() {
        return baseline;
      },
      get baselineProject() {
        return baselineProject;
      },
      get comparing() {
        return comparisonEnabled;
      },
    }),
  }));
const ui = Object.freeze({
  escape,
  raw: markup,
  // Tagged template: interpolations are escaped unless wrapped with ui.raw or produced by ui.html.
  html: (strings, ...values) =>
    markup(
      strings.reduce(
        (out, part, i) =>
          out +
          part +
          (i < values.length
            ? [values[i]]
                .flat()
                .map((v) => (v?.[trusted] ? v.value : v === false || v == null ? '' : escape(v)))
                .join('')
            : ''),
        '',
      ),
    ),
  json: (value) => markup(raw(value)),
  disclosure: (title, body, open) =>
    markup(disclosure(title, body?.[trusted] ? body.value : escape(body), open)),
});
function pluginMarkup(kind, hook, entity, fallback) {
  const render = viewerRenderers()[kind]?.[hook];
  if (!render) return fallback();
  try {
    const result = render(entity, pluginUi());
    return result?.[trusted] ? result.value : escape(result ?? '');
  } catch (error) {
    return `<p class="error">This ${escape(kindInfo(kind).label.toLowerCase())} could not be shown by its plugin: ${escape(error.message)}</p>${fallback()}`;
  }
}
const clean = (value) => String(value ?? '').replace(/`|\*\*/g, '');
const checkTitle = (check) => (check.title ?? check.id).replace(/^(?:[A-Z][A-Z0-9.-]+\s+)+/, '');
const target = (cap, kind, id, extra = {}) => ({
  capability: cap.id,
  kind,
  ...(id ? { id } : {}),
  ...extra,
});
const sameTarget = (a, b) =>
  ['capability', 'kind', 'id', 'scope', 'status', 'path'].every(
    (k) => String(a?.[k] ?? '') === String(b?.[k] ?? ''),
  );
// Attachment placement is owned by text/header components, never by schema rendering.
const attachmentPolicy = Object.freeze({
  feature: 'text',
  operation: 'text',
  rule: 'text',
  example: 'text',
  check: 'text',
  request: 'header',
  response: 'header',
});
let attachmentOwners = new Set();
let baseline = $('#mhproto-baseline') ? JSON.parse($('#mhproto-baseline').textContent) : null;
let baselineProject,
  indexedBaseline,
  comparisonChanges = [],
  comparisonMap = new Map(),
  comparisonEnabled = false,
  comparisonError = '',
  localBaseline = false,
  baselineReadOnly = false,
  comparisonFilter = 'all';
const changeKey = (change) => JSON.stringify([change.capability, change.kind, change.id]);
const changeUrl = (change) => '#/changes/' + encodeURIComponent(changeKey(change));
const changeFor = (cap, kind, id) => comparisonMap.get(JSON.stringify([cap?.id ?? null, kind, id]));
const changeBadge = (change) =>
  comparisonEnabled && change
    ? `<a class="change-badge ${escape(change.status)}" href="${escape(changeUrl(change))}">${escape(pascal(change.status))}</a>`
    : '';
const baselineLabel = () => baseline?.label ?? 'Saved baseline';
function updateComparison() {
  if (indexedBaseline !== baseline) {
    baselineProject = baseline ? snapshotProject(baseline) : null;
    indexedBaseline = baseline;
  }
  comparisonChanges = baseline ? compareModels(baseline, project) : [];
  comparisonMap = new Map(comparisonChanges.map((c) => [changeKey(c), c]));
}
const pascal = (value) =>
  (String(value).match(/[A-Za-z0-9]+/g) ?? ['Type'])
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join('');
function visualsForSurface(t) {
  const extra = new Set(viewerPlugins().flatMap((p) => call(p, 'targetVisuals', t) ?? []));
  return (project.visuals ?? []).filter((v) => sameTarget(v.target, t) || extra.has(v));
}
function visualGallery(t) {
  const visuals = visualsForSurface(t);
  return visuals.length
    ? `<div class="visual-gallery">${visuals
        .map((v) => {
          let source =
            v.url || (embedded ? media[v.id] : '/api/visuals/' + encodeURIComponent(v.id));
          if (v.url) {
            try {
              const parsed = new URL(v.url);
              if (parsed.protocol !== 'https:' || parsed.username || parsed.password) source = null;
            } catch {
              source = null;
            }
          }
          const mime =
            v.mime ??
            {
              png: 'image/png',
              jpg: 'image/jpeg',
              jpeg: 'image/jpeg',
              webp: 'image/webp',
              gif: 'image/gif',
              pdf: 'application/pdf',
            }[v.file?.split('.').pop().toLowerCase()];
          const image = v.file && mime?.startsWith('image/') && source;
          const context =
            v.target.kind === 'field'
              ? v.target.path
              : v.target.kind === 'schema'
                ? v.target.id
                : null;
          return `<figure class="visual">${context ? `<span class="visual-context">${escape(context)}</span>` : ''}<a href="${escape(source ?? '#')}" target="_blank" rel="noopener noreferrer"${embedded && mime === 'application/pdf' ? ` download="${escape(v.file.split('/').pop())}"` : ''}>${image ? `<img src="${escape(source)}" alt="${escape(v.title)}" loading="lazy">` : ''}<span>${escape(v.title)}${v.url ? ' ↗' : ''}</span></a>${v.caption ? `<figcaption>${escape(v.caption)}</figcaption>` : ''}</figure>`;
        })
        .join('')}</div>`
    : '';
}
function attachmentBlock(
  t,
  content,
  { tag = 'p', className = '', label = t.id ?? 'feature' } = {},
) {
  const placement = attachmentPolicy[t.kind];
  if (!placement) throw new Error('No attachment control is permitted for ' + t.kind);
  if ((placement === 'header') !== (tag === 'h3'))
    throw new Error('Attachment control has an invalid placement');
  const key = JSON.stringify([
    t.capability,
    t.kind,
    t.id ?? '',
    t.scope ?? '',
    t.status ?? '',
    t.path ?? '',
  ]);
  // Repeated read-only text may link the same target; only its first surface owns editing.
  if (attachmentOwners.has(key)) return `<${tag} class="${escape(className)}">${content}</${tag}>`;
  attachmentOwners.add(key);
  return `<div class="attachment-block" data-visual-target="${escape(JSON.stringify(t))}"><${tag} class="attachment-zone ${escape(className)}" data-attachment-zone>${content}<button class="text-button add-visual" data-add-visual aria-label="Attach visual to ${escape(label)}" title="Attach visual">+</button></${tag}>${visualGallery(t)}<div class="visual-editor" hidden></div></div>`;
}

function route() {
  const [pathname, params] = location.hash.slice(1).split('?');
  const parts = pathname
    .replace(/^\//, '')
    .split('/')
    .map((x) => {
      try {
        return decodeURIComponent(x);
      } catch {
        return x;
      }
    });
  // Older exported links still lead to the feature overview.
  const id = parts[0] === 'features' ? parts[1] : parts[0];
  const cap = project.capabilities.find((c) => c.id === id) ?? project.capabilities[0];
  const entities = parts[0] === 'features' && parts[2] === 'entities';
  return {
    cap,
    kind: parts[0] === 'changes' ? 'changes' : parts[0] === 'features' ? parts[2] : null,
    id: parts[0] === 'changes' ? parts[1] : entities ? parts[4] : parts[3],
    entityKind: entities ? parts[3] : null,
    rule: new URLSearchParams(params).get('rule'),
    compare: new URLSearchParams(params).get('compare') === '1',
  };
}
// Where a rule is shown: a plugin page that binds it, or a plugin entity citing it.
function ruleTarget(cap, id) {
  const found = ask('ruleTarget', cap, id);
  if (found) return found;
  const entity = pluginEntities(cap).find((e) => e.rules.includes(id));
  return entity && { url: entityUrl(cap, entity, id), note: entity.title ?? entity.id };
}
function ruleLink(cap, id, label) {
  const found = ruleTarget(cap, id);
  return found ? `<a href="${escape(found.url)}">${escape(label ?? id)}</a>` : escape(label ?? id);
}

function diagram(title, source) {
  return `<figure class="diagram"><figcaption>${escape(title)}</figcaption><div class="diagram-canvas" data-mermaid="${escape(source)}" aria-label="${escape(title)}"><span class="section-note">Rendering diagram…</span></div><details class="diagram-source"><summary>Diagram source</summary><pre>${escape(source)}</pre></details></figure>`;
}
function markdownDiagrams(markdown, title) {
  return [...String(markdown ?? '').matchAll(/```mermaid\s*\n([\s\S]*?)```/g)]
    .map((match) => diagram(title, match[1].trim()))
    .join('');
}
const diagrams = globalThis.mermaid;
if (diagrams)
  diagrams.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: 'base',
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
    htmlLabels: false,
    flowchart: { htmlLabels: false, useMaxWidth: true },
    sequence: { useMaxWidth: true },
    secure: ['secure', 'securityLevel', 'startOnLoad', 'htmlLabels', 'theme', 'themeVariables'],
    themeVariables: {
      primaryColor: '#ffffff',
      primaryTextColor: '#141414',
      primaryBorderColor: '#aaa',
      lineColor: '#666',
      secondaryColor: '#ffffff',
      tertiaryColor: '#ffffff',
      background: '#ffffff',
      mainBkg: '#ffffff',
      nodeBorder: '#aaa',
      clusterBkg: '#ffffff',
      clusterBorder: '#ddd',
      actorBkg: '#ffffff',
      actorBorder: '#aaa',
      actorTextColor: '#141414',
      signalColor: '#666',
      signalTextColor: '#141414',
      labelBoxBkgColor: '#fff',
      labelBoxBorderColor: '#aaa',
      labelTextColor: '#141414',
      loopTextColor: '#141414',
      noteBkgColor: '#fff',
      noteBorderColor: '#aaa',
      noteTextColor: '#141414',
      textColor: '#141414',
      fontSize: '12px',
    },
  });
async function renderDiagrams(version) {
  for (const element of document.querySelectorAll('[data-mermaid]')) {
    if (version !== generation || !element.isConnected) return;
    if (element.dataset.rendered === 'true' || element.closest('details:not([open])')) continue;
    try {
      if (!diagrams) throw new Error('The Mermaid runtime is unavailable.');
      const id = 'mhproto-diagram-' + ++diagramSerial;
      const { svg } = await diagrams.render(id, element.dataset.mermaid);
      if (version !== generation || !element.isConnected) return;
      element.innerHTML = svg;
      element.dataset.rendered = 'true';
    } catch (error) {
      if (element.isConnected)
        element.innerHTML = `<p class="diagram-error">Could not render this diagram. ${escape(error.message.split('\n')[0])} Its source is available below.</p>`;
    }
  }
}

function evidenceResult(cap, check) {
  if (!cap.evidence) return { status: 'unchecked' };
  if (cap.evidence.stale || cap.evidence.changedDuringRun) return { status: 'stale' };
  return cap.evidence.results.find((r) => r.id === check.id) ?? { status: 'unchecked' };
}
const statusLabel = (status) =>
  ({ passing: 'Passed', failing: 'Failed', stale: 'Needs a new run', unchecked: 'Not run' })[
    status
  ] ?? status;
function checksList(cap, checks) {
  return `<ul class="check-list">${checks
    .map((c) => {
      const r = evidenceResult(cap, c);
      return `<li><a href="${escape(checkUrl(cap, c))}">${escape(checkTitle(c))}</a><span class="check-status ${r.status === 'failing' ? 'failing' : ''}">${escape(statusLabel(r.status))}</span></li>`;
    })
    .join('')}</ul>`;
}
function checksSection(cap, checks = cap.checks, rules = cap.rules) {
  const passing = checks.filter((c) => evidenceResult(cap, c).status === 'passing');
  const attention = checks.filter((c) => evidenceResult(cap, c).status !== 'passing');
  const gaps = rules.filter((r) => !cap.checks.some((c) => c.rules?.includes(r.id)));
  const summary = cap.evidence
    ? `${passing.length} of ${checks.length} linked checks have current passing evidence.`
    : 'No verification run recorded.';
  return `<section class="checks-section"><h2>Checks</h2><p class="section-note">${escape(summary)}${gaps.length ? ` ${gaps.length} ${gaps.length === 1 ? 'rule still needs' : 'rules still need'} a linked check.` : ''}</p>${attention.length ? disclosure('Needs attention · ' + attention.length, checksList(cap, attention), true) : ''}${passing.length ? disclosure('Passing checks · ' + passing.length, checksList(cap, passing)) : ''}${gaps.length ? disclosure('Rules without checks · ' + gaps.length, `<ul class="check-list">${gaps.map((r) => `<li>${ruleLink(cap, r.id, cap.presentation?.ruleTitles?.[r.id] ?? clean(r.text.split('\n')[0]))}</li>`).join('')}</ul>`) : ''}${disclosure('Scope of this evidence', '<p class="section-note">A passing run establishes what the linked tests observed. It does not cover every case or live model behaviour. Tracked source changes make the evidence stale.</p>' + (cap.gaps ?? []).map((g) => `<p class="section-note">${escape(g)}</p>`).join(''))}</section>`;
}
function entitySections(cap) {
  const entities = pluginEntities(cap);
  return [...new Set(entities.map((e) => e.kind))]
    .map(
      (kind) =>
        `<section id="kind-${escape(kind)}"><h2>${escape(kindInfo(kind).plural)}</h2><ul class="entity-list">${entities
          .filter((e) => e.kind === kind)
          .map(
            (e) =>
              `<li data-entity="${escape(JSON.stringify([e.kind, e.id]))}"><a href="${escape(entityUrl(cap, e))}">${escape(e.title ?? e.id)}</a>${pluginMarkup(kind, 'summary', e, () => (e.summary ? `<span class="section-note">${escape(e.summary)}</span>` : ''))}</li>`,
          )
          .join('')}</ul></section>`,
    )
    .join('');
}
const hookMarkup = (value) => (value?.[trusted] ? value.value : escape(value ?? ''));
function overview(cap) {
  return `<header><h1>${escape(cap.title ?? cap.id)}</h1>${attachmentBlock(target(cap, 'feature'), escape(cap.description ?? 'Describe what this page loads, shows and lets the user do.'), { className: 'description', label: cap.title ?? cap.id })}${cap.url ? `<p class="feature-url"><span>URL</span><code>${escape(cap.url)}</code></p>` : ''}</header>${viewerPlugins()
    .map((p) => hookMarkup(call(p, 'overview', cap, pluginUi())))
    .join(
      '',
    )}${entitySections(cap)}${markdownDiagrams(cap.prose, 'Play states')}${checksSection(cap)}`;
}
function scenario(cap, e) {
  return `<article class="scenario"><h3>${escape(e.title ?? e.id)}</h3>${attachmentBlock(target(cap, 'example', e.id), ['given', 'when', 'then'].map((k) => `<div class="scenario-line"><b>${k.charAt(0).toUpperCase() + k.slice(1)}</b><span>${prose(e[k])}</span></div>`).join(''), { tag: 'div', className: 'scenario-text', label: e.title ?? e.id })}${e.request ? disclosure('Payload example', raw({ request: e.request, response: e.response })) : ''}</article>`;
}
function checkPage(cap, check) {
  const r = evidenceResult(cap, check),
    expected = new Set(check.testNames ?? []);
  const observed = (r.tests ?? []).filter((t) => expected.has(t.name) || t.type === 'test:fail');
  return `<a class="back" href="${escape(featureUrl(cap))}">← ${escape(cap.title ?? cap.id)}</a><h1>${escape(checkTitle(check))}</h1>${attachmentBlock(target(cap, 'check', check.id), escape(statusLabel(r.status)), { className: 'section-note ' + (r.status === 'failing' ? 'failing' : ''), label: checkTitle(check) })}${r.status === 'stale' ? '<p class="description">The tracked sources changed. Run this check again to refresh its evidence.</p>' : ''}${r.error ? `<p class="error">${escape(r.error)}</p>` : ''}${r.missing?.length ? `<p class="error">Expected tests did not run: ${escape(r.missing.join(', '))}</p>` : ''}${r.stderr ? disclosure('Error output', `<pre>${escape(r.stderr)}</pre>`, r.status === 'failing') : ''}${observed.length ? disclosure('Observed tests', observed.map((t) => `<p class="section-note">${t.skip ? 'Skipped' : t.todo ? 'TODO' : t.type === 'test:fail' ? 'Failed' : 'Passed'} · ${escape(t.name)}</p>`).join(''), r.status === 'failing') : ''}<h2>Behaviour checked</h2><ul class="check-list">${(check.rules ?? []).map((id) => `<li>${ruleLink(cap, id, clean(cap.rules.find((x) => x.id === id)?.text.split('\n')[0] ?? id))}</li>`).join('')}</ul>${disclosure('Run details', raw({ command: check.command, durationMs: r.durationMs, exitCode: r.exitCode }))}`;
}
function pluginEntityPage(cap, entity) {
  const info = kindInfo(entity.kind);
  const rules = cap.rules.filter((r) => entity.rules.includes(r.id));
  const examples = cap.examples.filter((e) => e.rules?.some((id) => entity.rules.includes(id)));
  const checks = cap.checks.filter(
    (c) =>
      c.rules?.some((id) => entity.rules.includes(id)) ||
      c.examples?.some((id) => examples.some((e) => e.id === id)),
  );
  // Any entity as a link to its page, including entities with plugin pages.
  const entityRef = (feature, e) => {
    const url = ask('targetUrl', feature, { kind: e.kind, id: e.id }) ?? entityUrl(feature, e);
    const link = `<a href="${escape(url)}">${escape(e.title ?? e.id)}</a>`;
    return `${link}<span class="section-note">${escape(kindInfo(e.kind).label)}${feature.id !== cap.id ? ' · ' + escape(feature.title ?? feature.id) : ''}</span>`;
  };
  const links = entity.links.map((link) => {
    const feature = project.capabilities.find((c) => c.id === (link.capability ?? cap.id));
    const found =
      feature && entitiesOf(feature).find((e) => e.kind === link.kind && e.id === link.id);
    return `<li>${found ? entityRef(feature, found) : `${escape(link.kind)}:${escape(link.id)}`}${link.relation ? `<span class="section-note">${escape(link.relation)}</span>` : ''}</li>`;
  });
  const usedBy = project.capabilities.flatMap((feature) =>
    entitiesOf(feature)
      .filter((e) =>
        e.links.some(
          (l) =>
            (l.capability ?? feature.id) === cap.id && l.kind === entity.kind && l.id === entity.id,
        ),
      )
      .map((e) => `<li>${entityRef(feature, e)}</li>`),
  );
  return `<a class="back" href="${escape(featureUrl(cap))}">← ${escape(cap.title ?? cap.id)}</a><header><h1>${escape(entity.title ?? entity.id)}</h1><p class="section-note">${escape(info.label)} · ${escape(entity.id)}</p>${entity.summary ? `<p class="description">${escape(entity.summary)}</p>` : ''}</header><div class="page-actions"><button class="text-button" data-copy-url>Copy page link</button></div>${pluginMarkup(entity.kind, 'section', entity, () => (entity.data === undefined ? '' : disclosure('Definition', raw(entity.data), true)))}${visualGallery(target(cap, entity.kind, entity.id))}<section><h2>Behaviour</h2>${rules.length ? `<ul class="rule-list">${rules.map((r) => `<li id="${escape(r.id)}">${attachmentBlock(target(cap, 'rule', r.id), prose(r.text), { tag: 'div', className: 'rule-text', label: r.id })}<a class="rule-id" href="${escape(entityUrl(cap, entity, r.id))}">${escape(r.id)}</a></li>`).join('')}</ul>` : '<p class="section-note">No behaviour rules linked yet.</p>'}</section>${links.length ? `<section><h2>Depends on</h2><ul class="type-parent-list">${links.join('')}</ul></section>` : ''}${usedBy.length ? `<section><h2>Used by</h2><ul class="type-parent-list">${usedBy.join('')}</ul></section>` : ''}${examples.length ? `<section><h2>Examples</h2>${examples.map((e) => scenario(cap, e)).join('')}</section>` : ''}${checksSection(cap, checks, rules)}<p class="type-source section-note">Defined in ${escape(entity.file)}</p>`;
}
function sourcesPage(cap) {
  return `<a class="back" href="${escape(featureUrl(cap))}">← ${escape(cap.title ?? cap.id)}</a><h1>Sources</h1><p class="description">The feature reads these existing contract files. Edit them in your editor or through your agent.</p><table class="table"><tbody>${Object.entries(
    cap.files,
  )
    .map(
      ([kind, file]) =>
        `<tr><td>${escape(kind)}</td><td class="source-path">${escape(file)}</td></tr>`,
    )
    .join(
      '',
    )}</tbody></table>${disclosure('Tracked implementation', raw(cap.sources))}${disclosure('Complete behaviour document', `<div class="rule-text">${prose(cap.prose)}</div>` + markdownDiagrams(cap.prose, 'State diagram'))}${disclosure('System map', `<div class="rule-text">${prose(project.system)}</div>` + markdownDiagrams(project.system, 'System diagram'))}${disclosure('Local commands', '<pre>mhproto check\nmhproto verify --capability ' + escape(cap.id) + '\nmhproto snapshot\nmhproto diff</pre>')}`;
}
const kindLabel = (kind) =>
  ({
    feature: 'Feature',
    operation: 'API',
    schema: 'Type',
    rule: 'Behaviour',
    example: 'Example',
    check: 'Check',
    visual: 'Visual',
    system: 'System',
  })[kind] ?? kindInfo(kind).label;
function changeTitle(c) {
  const value = c.after ?? c.before;
  return (
    ask('changeTitle', c) ??
    (c.kind === 'rule'
      ? value.title === c.id
        ? clean(value.text.split('\n')[0])
        : value.title
      : (value.title ?? (c.kind === 'system' ? 'System and project' : c.id)))
  );
}
function currentChangeUrl(c) {
  if (c.status === 'removed') return null;
  const cap = project.capabilities.find((x) => x.id === c.capability);
  if (!cap) return featureUrl(project.capabilities[0]) + '/sources';
  if (viewerPlugins().some((p) => p.ownsKinds?.includes(c.kind)))
    return ask('targetUrl', cap, { kind: c.kind, id: c.id });
  if (c.kind === 'check') return checkUrl(cap, { id: c.id });
  const entity = pluginEntities(cap).find((e) => e.kind === c.kind && e.id === c.id);
  if (entity) return entityUrl(cap, entity);
  if (c.kind === 'rule') return ruleTarget(cap, c.id)?.url ?? featureUrl(cap) + '/sources';
  if (c.kind === 'example')
    return ask('exampleTarget', cap, c.after)?.url ?? featureUrl(cap) + '/sources';
  if (c.kind === 'visual') {
    const t = c.after.target;
    const url = ask('targetUrl', cap, t);
    if (url) return url;
    if (t.kind === 'check') return checkUrl(cap, { id: t.id });
    const targetEntity = pluginEntities(cap).find((e) => e.kind === t.kind && e.id === t.id);
    if (targetEntity) return entityUrl(cap, targetEntity);
  }
  return featureUrl(cap);
}
const fieldPath = (path) =>
  path.length
    ? path
        .map((k) => (k === 'schema' ? 'Definition' : k === 'presentation' ? 'Page behaviour' : k))
        .join(' → ')
    : 'Definition';
function comparisonSetup() {
  return `<details class="disclosure baseline-picker"${!baseline ? ' open' : ''}><summary>${baseline ? 'Change baseline' : 'Choose where this iteration starts'}</summary><div><label class="baseline-file">Compare with an earlier snapshot or preview<input id="baseline-file" type="file" accept=".json,.html,application/json,text/html"></label><p class="section-note">The selected file stays in this viewer. It is never executed.</p><button class="text-button" data-start-iteration${baselineReadOnly ? ' disabled' : ''}>Use current spec as baseline</button><p class="section-note">${baselineReadOnly ? 'Viewing a saved iteration. Start the viewer without --against to save a new baseline.' : embedded ? 'Save preview to keep this baseline with the exported file.' : 'Saves .mhproto/baseline.json for the local workspace.'}</p></div></details><p class="comparison-error error" role="status">${escape(comparisonError)}</p>`;
}
function changesPage(id) {
  const changed = id ? comparisonMap.get(id) : null;
  if (id && !changed)
    return '<a class="back" href="#/changes">← Changes</a><h1>Change not found</h1><p class="description">This item is unchanged against the selected baseline. Open Changes to see the current comparison.</p>';
  if (changed) {
    const url = currentChangeUrl(changed),
      format = (value, present) =>
        !present ? '—' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    const rows = changed.fields
      .map(
        (f) =>
          `<tr><th scope="row">${escape(fieldPath(f.path))}<span class="field-change">${escape(pascal(f.status))}</span></th><td><pre>${escape(format(f.before, f.beforePresent))}</pre></td><td><pre>${escape(format(f.after, f.afterPresent))}</pre></td></tr>`,
      )
      .join('');
    return `<a class="back" href="#/changes">← Changes</a><h1>${escape(changeTitle(changed))}</h1><p class="section-note">${escape(pascal(changed.status))} · ${escape(kindLabel(changed.kind))} · ${escape(baselineLabel())} → Current spec</p><div class="page-actions"><button class="text-button" data-copy-url>Copy page link</button>${url ? `<a href="${escape(url)}">Open current ${escape(kindLabel(changed.kind).toLowerCase())}</a>` : '<span class="section-note">Removed from the current spec.</span>'}</div><div class="diff-table-wrap"><table class="table diff-table"><thead><tr><th>Field</th><th>Before</th><th>Now</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  const counts = ['added', 'changed', 'removed']
    .map((s) => comparisonChanges.filter((c) => c.status === s).length + ' ' + s)
    .join(' · ');
  const filtered = comparisonChanges.filter(
    (c) => comparisonFilter === 'all' || c.kind === comparisonFilter,
  );
  const groups = [...new Set(filtered.map((c) => c.capability))]
    .map((id) => {
      const cap =
        project.capabilities.find((c) => c.id === id) ??
        baselineProject?.capabilities.find((c) => c.id === id);
      return `<section class="changes-group"><h2>${escape(cap?.title ?? cap?.id ?? 'Project')}</h2><ul class="changes-list">${filtered
        .filter((c) => c.capability === id)
        .map(
          (c) =>
            `<li><span class="change-status ${escape(c.status)}">${escape(pascal(c.status))}</span><div><a href="${escape(changeUrl(c))}">${escape(changeTitle(c))}</a><span class="change-kind">${escape(kindLabel(c.kind))}</span><p class="section-note">${escape(
              c.status === 'changed'
                ? c.fields
                    .slice(0, 2)
                    .map((f) => fieldPath(f.path))
                    .join(' · ') +
                    (c.fields.length > 2 ? ' · ' + (c.fields.length - 2) + ' more' : '')
                : c.status === 'added'
                  ? 'New in this iteration.'
                  : 'Present in the baseline.',
            )}</p></div></li>`,
        )
        .join('')}</ul></section>`;
    })
    .join('');
  return `<h1>Changes</h1><p class="description">${baseline ? escape(baselineLabel()) + ' → Current spec' : 'Save the current spec before editing, or choose an earlier snapshot to compare.'}</p>${baseline?.createdAt ? `<p class="section-note">Baseline saved ${escape(new Date(baseline.createdAt).toLocaleString())}</p>` : ''}${baseline ? `<p class="change-counts">${counts}</p><div class="page-actions"><button class="text-button" data-copy-url>Copy page link</button><button class="text-button" data-download-snapshot>Download current snapshot</button></div>` : ''}${comparisonSetup()}${baseline && comparisonChanges.length ? `<label class="changes-filter">Show <select id="changes-filter">${['all', 'operation', 'schema', ...new Set([...project.capabilities, ...(baselineProject?.capabilities ?? [])].flatMap((c) => pluginEntities(c).map((e) => e.kind))), 'rule', 'feature', 'example', 'check', 'visual', 'system'].map((k) => `<option value="${escape(k)}"${comparisonFilter === k ? ' selected' : ''}>${k === 'all' ? 'All changes' : escape(kindLabel(k))}</option>`).join('')}</select></label>${groups || '<p class="empty">No changes in this category.</p>'}` : baseline ? '<p class="empty">No spec changes since this baseline.</p>' : ''}`;
}
function comparisonBar() {
  return comparisonEnabled && baseline
    ? `<div class="comparison-bar"><span>Comparing with ${escape(baselineLabel())}</span><a href="#/changes">${comparisonChanges.length} changes</a><button class="text-button" data-exit-comparison>Hide highlights</button></div>`
    : '';
}
function decorateComparison(state) {
  if (!comparisonEnabled || !baseline || state.kind === 'changes' || query) return;
  const cap = state.cap,
    pageChange = state.page?.change
      ? changeFor(cap, ...state.page.change)
      : state.kind === 'checks'
        ? changeFor(cap, 'check', state.id)
        : state.kind === 'entities'
          ? changeFor(cap, state.entityKind, state.id)
          : !state.kind
            ? changeFor(cap, 'feature', cap.id)
            : null;
  if (pageChange) $('#content h1')?.insertAdjacentHTML('beforeend', changeBadge(pageChange));
  for (const plugin of viewerPlugins())
    call(plugin, 'decorate', cap, { changeFor, badge: changeBadge });
  for (const item of document.querySelectorAll('.entity-list>li[data-entity]')) {
    const [kind, id] = JSON.parse(item.dataset.entity);
    item.querySelector('a')?.insertAdjacentHTML('afterend', changeBadge(changeFor(cap, kind, id)));
  }
  for (const rule of cap.rules)
    document
      .getElementById(rule.id)
      ?.querySelector('.rule-id')
      ?.insertAdjacentHTML('afterend', changeBadge(changeFor(cap, 'rule', rule.id)));
  for (const link of document.querySelectorAll('.check-list>li>a')) {
    const id = decodeURIComponent(link.hash.split('/checks/')[1] ?? '');
    if (id) link.insertAdjacentHTML('afterend', changeBadge(changeFor(cap, 'check', id)));
  }
}
function searchResults() {
  const found = [],
    matches = (value) => JSON.stringify(value).toLowerCase().includes(query.toLowerCase());
  for (const cap of project.capabilities) {
    if (matches([cap.title, cap.description, cap.url]))
      found.push({ url: featureUrl(cap), title: cap.title, note: cap.description });
    const pages = viewerPlugins().map((p) => call(p, 'search', cap, matches) ?? {});
    for (const page of pages) found.push(...(page.lead ?? []));
    for (const rule of cap.rules)
      if (matches([rule, cap.presentation?.ruleTitles?.[rule.id]])) {
        const shown = ruleTarget(cap, rule.id);
        if (shown)
          found.push({
            url: shown.url,
            title: cap.presentation?.ruleTitles?.[rule.id] ?? clean(rule.text.split('\n')[0]),
            note: shown.note,
          });
      }
    for (const check of cap.checks)
      if (matches(check))
        found.push({
          url: checkUrl(cap, check),
          title: checkTitle(check),
          note: cap.title + ' · check',
        });
    for (const example of cap.examples)
      if (matches(example)) {
        const shown = ask('exampleTarget', cap, example);
        if (shown)
          found.push({
            url: shown.url,
            title: example.title ?? example.id,
            note: shown.note + ' · example',
          });
      }
    for (const entity of pluginEntities(cap))
      if (matches([entity.id, entity.title, entity.summary, entity.data]))
        found.push({
          url: entityUrl(cap, entity),
          title: entity.title ?? entity.id,
          note: kindInfo(entity.kind).label + ' · ' + (cap.title ?? cap.id),
        });
    for (const page of pages) found.push(...(page.trail ?? []));
  }
  return `<h1>Search</h1>${found.length ? found.map((f) => `<article class="search-result"><a href="${escape(f.url)}">${escape(f.title)}</a><p>${escape(f.note)}</p></article>`).join('') : '<p class="empty">No matches.</p>'}`;
}
function render() {
  attachmentOwners = new Set();
  const version = ++generation,
    state = route(),
    cap = state.cap;
  comparisonEnabled = state.compare || state.kind === 'changes';
  updateComparison();
  for (const plugin of viewerPlugins()) call(plugin, 'setup', pluginUi());
  // Pages a plugin provides, such as OpenAPI's #/features/:feature/api/:operation.
  const owner =
    state.kind && !shellPages.has(state.kind) && viewerPlugins().find((p) => p.pages?.[state.kind]);
  if (owner) {
    try {
      state.page = owner.pages[state.kind](cap, state.id, pluginUi());
    } catch (error) {
      state.page = {
        html: markup(
          `<p class="error">This page could not be shown by the ${escape(owner.name ?? '')} plugin: ${escape(error.message)}</p>`,
        ),
        title: 'Error',
      };
    }
  }
  $('#project-name').textContent = project.name;
  $('#search').value = query;
  $('#home').href = 'https://mhproto.dev/';
  $('#features').innerHTML = project.capabilities
    .map(
      (c) =>
        `<a href="${escape(featureUrl(c))}" class="${c.id === cap.id ? 'active' : ''}"${c.id === cap.id ? ' aria-current="page"' : ''}>${escape(c.title ?? c.id)}</a>`,
    )
    .join('');
  $('#sources-link').href = featureUrl(cap) + '/sources';
  $('#changes-link').textContent = 'Changes' + (baseline ? ' · ' + comparisonChanges.length : '');
  let body;
  if (query) body = searchResults();
  else if (state.kind === 'changes') body = changesPage(state.id);
  else if (state.page) body = hookMarkup(state.page.html);
  else if (state.kind === 'checks') {
    const check = cap.checks.find((c) => c.id === state.id);
    body = check ? checkPage(cap, check) : '<h1>Check not found</h1>';
  } else if (state.kind === 'entities') {
    const entity = pluginEntities(cap).find(
      (e) => e.kind === state.entityKind && e.id === state.id,
    );
    body = entity
      ? pluginEntityPage(cap, entity)
      : `<a class="back" href="${escape(featureUrl(cap))}">← ${escape(cap.title ?? cap.id)}</a><h1>${escape(kindInfo(state.entityKind).label)} not found</h1>`;
  } else if (state.kind === 'sources') body = sourcesPage(cap);
  else body = overview(cap);
  $('#content').innerHTML = (state.kind === 'changes' ? '' : comparisonBar()) + body;
  decorateComparison(state);
  if (comparisonEnabled && baseline)
    for (const a of document.querySelectorAll('a[href^="#/features/"]')) {
      const [pathname, params] = a.getAttribute('href').split('?'),
        search = new URLSearchParams(params);
      search.set('compare', '1');
      a.setAttribute('href', pathname + '?' + search);
    }
  const stale = cap.evidence?.stale || cap.evidence?.changedDuringRun;
  $('#freshness').textContent = stale
    ? 'Evidence needs a new run'
    : cap.evidence
      ? 'Latest run · ' +
        new Date(cap.evidence.finishedAt).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'No verification run recorded';
  $('#view-mode').textContent = embedded ? 'Exported snapshot' : 'Local workspace';
  $('#read-mode').textContent = previewChanged
    ? 'Added to this preview · save to keep'
    : embedded
      ? 'Snapshot · visuals can be attached'
      : 'Visuals save to the workspace';
  $('#save-preview').hidden = !previewChanged;
  document.title =
    (state.kind === 'changes'
      ? 'Changes'
      : state.page
        ? state.page.title
        : state.kind === 'entities'
          ? (pluginEntities(cap).find((e) => e.kind === state.entityKind && e.id === state.id)
              ?.title ?? state.id)
          : (cap.title ?? cap.id)) + ' · MHProto';
  if (state.rule && !query) {
    const target = document.getElementById(state.rule);
    for (let parent = target?.parentElement; parent; parent = parent.parentElement)
      if (parent.tagName === 'DETAILS') parent.open = true;
    target?.scrollIntoView?.({ block: 'start' });
  }
  diagramQueue = diagramQueue.catch(() => {}).then(() => renderDiagrams(version));
  globalThis.mhprotoReady = diagramQueue;
  return diagramQueue;
}
window.addEventListener('hashchange', () => {
  query = '';
  $('#search').value = '';
  window.scrollTo?.({ top: 0 });
  render();
});
document.addEventListener(
  'toggle',
  (event) => {
    if (event.target.open && event.target.querySelector('[data-mermaid]:not([data-rendered])')) {
      diagramQueue = diagramQueue.catch(() => {}).then(() => renderDiagrams(generation));
      globalThis.mhprotoReady = diagramQueue;
    }
  },
  true,
);
$('#search').addEventListener('input', (event) => {
  query = event.target.value;
  render();
});
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    $('#search').focus();
  }
});
document.addEventListener('click', async (event) => {
  if (event.target.closest('[data-exit-comparison]')) {
    const [pathname, params] = location.hash.split('?'),
      search = new URLSearchParams(params);
    search.delete('compare');
    location.hash = pathname + (search.size ? '?' + search : '');
    return;
  }
  if (event.target.closest('[data-download-snapshot]')) {
    downloadFile(
      'mhproto-snapshot.json',
      JSON.stringify(contractSnapshot(project, { label: project.name + ' snapshot' }), null, 2),
      'application/json',
    );
    return;
  }
  const start = event.target.closest('[data-start-iteration]');
  if (start) {
    const task = async () => {
      start.disabled = true;
      comparisonError = '';
      try {
        if (embedded) {
          baseline = contractSnapshot(project);
          previewChanged = true;
        } else {
          const response = await fetch('/api/baseline', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          });
          const value = await response.json();
          if (!response.ok) throw new Error(value.error ?? 'Could not save the baseline');
          baseline = value;
        }
        localBaseline = false;
        await render();
      } catch (error) {
        comparisonError = error.message;
        await render();
      }
    };
    globalThis.mhprotoComparisonReady = task();
    return;
  }
  const add = event.target.closest('[data-add-visual]');
  if (add) {
    const slot = add.closest('[data-visual-target]'),
      editor = slot.querySelector(':scope > .visual-editor');
    editor.hidden = false;
    add.hidden = true;
    editor.innerHTML = `<form class="visual-form"><label>Title<input name="title" required maxlength="200" placeholder="What this visual explains"></label><label>Screenshot or design file<input name="file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"></label><p class="section-note">PNG, JPEG, WebP, GIF or PDF · up to 8 MB</p><label>Or design link<input name="url" type="url" placeholder="https://…"></label><label>Note <span class="section-note">optional</span><input name="caption" maxlength="1000" placeholder="State, version or source"></label><div class="visual-actions"><button class="text-button" type="submit">Attach</button><button class="text-button" type="button" data-cancel-visual>Cancel</button></div><p class="visual-message section-note" role="status"></p></form>`;
    editor.querySelector('[name=title]').focus();
    return;
  }
  const cancel = event.target.closest('[data-cancel-visual]');
  if (cancel) {
    const slot = cancel.closest('[data-visual-target]'),
      add = slot.querySelector(':scope > [data-attachment-zone] > [data-add-visual]');
    slot.querySelector(':scope > .visual-editor').hidden = true;
    add.hidden = false;
    add.focus();
    return;
  }
  const button = event.target.closest('[data-copy-url]');
  if (!button) return;
  try {
    await navigator.clipboard.writeText(location.href);
    button.textContent = 'Link copied';
  } catch {
    button.textContent = 'Copy the address from your browser';
  }
});
function downloadFile(name, content, type) {
  const link = document.createElement('a'),
    url = URL.createObjectURL(new Blob([content], { type }));
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.addEventListener('change', (event) => {
  if (event.target.id === 'changes-filter') {
    comparisonFilter = event.target.value;
    render();
    return;
  }
  if (event.target.id !== 'baseline-file') return;
  const file = event.target.files[0];
  if (!file) return;
  const task = async () => {
    try {
      if (file.size > 16 * 1024 * 1024)
        throw new Error('Choose a snapshot or preview up to 16 MB.');
      const text = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read the baseline'));
        reader.readAsText(file);
      });
      // Read only the marked JSON script. Never construct an HTML document from
      // imported previews: even inert HTML parsers may load remote resources.
      const match =
        /<script\b(?=[^>]*\s+id=["'](?:mhproto-model|bive-model)["'])[^>]*>([\s\S]*?)<\/script\s*>/i.exec(
          text,
        );
      const parsed = JSON.parse(text.trimStart().startsWith('<') ? (match?.[1] ?? 'null') : text);
      const next = contractSnapshot(parsed, {
        label: parsed?.label ?? file.name,
        createdAt: parsed?.createdAt ?? null,
      });
      for (const plugin of viewerPlugins()) plugin.index?.(snapshotProject(next));
      baseline = next;
      localBaseline = true;
      comparisonError = '';
      if (embedded) previewChanged = true;
      await render();
    } catch (error) {
      comparisonError =
        error instanceof SyntaxError
          ? 'Could not read a MHProto baseline from this file.'
          : error.message;
      await render();
    }
  };
  globalThis.mhprotoComparisonReady = task();
});
const readData = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read this file'));
    reader.readAsDataURL(file);
  });
function mediaValid(data) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(data ?? '');
  if (!match) return false;
  const s = atob(match[2]);
  return (
    {
      'image/png': () => s.startsWith('\x89PNG\r\n\x1a\n'),
      'image/jpeg': () => s.startsWith('\xff\xd8\xff'),
      'image/webp': () => s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP',
      'image/gif': () => /^GIF8[79]a/.test(s),
      'application/pdf': () => s.startsWith('%PDF-'),
    }[match[1]]?.() ?? false
  );
}
document.addEventListener('submit', (event) => {
  if (!event.target.matches('.visual-form')) return;
  event.preventDefault();
  const form = event.target,
    slot = form.closest('[data-visual-target]');
  const task = async () => {
    const message = form.querySelector('.visual-message'),
      button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      const file = form.elements.file.files[0],
        url = form.elements.url.value.trim();
      if (Boolean(file) === Boolean(url)) throw new Error('Choose one file or one design link.');
      if (url) {
        let parsed;
        try {
          parsed = new URL(url);
        } catch {}
        if (parsed?.protocol !== 'https:' || parsed.username || parsed.password)
          throw new Error('Use an HTTPS design link.');
      }
      if (file && (file.size === 0 || file.size > 8 * 1024 * 1024))
        throw new Error('Choose a file up to 8 MB.');
      const data = file ? await readData(file) : undefined;
      if (file && !mediaValid(data)) throw new Error('Use a valid PNG, JPEG, WebP, GIF or PDF.');
      const input = {
        target: JSON.parse(slot.dataset.visualTarget),
        title: form.elements.title.value.trim(),
        caption: form.elements.caption.value.trim(),
        ...(url ? { url } : { data }),
      };
      if (!input.title || input.title.length > 200) throw new Error('Give the visual a title.');
      if (embedded) {
        const id =
          globalThis.crypto?.randomUUID?.() ??
          'visual-' + Date.now() + '-' + Math.random().toString(36).slice(2);
        const mime = file?.type,
          ext = {
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/webp': 'webp',
            'image/gif': 'gif',
            'application/pdf': 'pdf',
          }[mime];
        const visual = {
          id,
          title: input.title,
          caption: input.caption,
          target: input.target,
          kind: url || mime === 'application/pdf' ? 'design' : 'screenshot',
          ...(url ? { url } : { file: 'preview/assets/' + id + '.' + ext, mime }),
        };
        (project.visuals ??= []).push(visual);
        if (data) media[id] = data;
        previewChanged = true;
        await render();
      } else {
        const response = await fetch('/api/visuals', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Could not attach the visual');
        await refresh(true);
      }
    } catch (error) {
      message.textContent = error.message;
      message.classList.add('error');
      button.disabled = false;
    }
  };
  globalThis.mhprotoAttachmentReady = task();
});
$('#save-preview').addEventListener('click', () => {
  const copy = document.documentElement.cloneNode(true),
    safe = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');
  copy.querySelector('#mhproto-model').textContent = safe(project);
  let registry = copy.querySelector('#mhproto-media');
  if (!registry) {
    registry = document.createElement('script');
    registry.id = 'mhproto-media';
    registry.type = 'application/json';
    copy.querySelector('#mhproto-model').after(registry);
  }
  registry.textContent = safe(media);
  copy.querySelector('#content').textContent = 'Loading…';
  copy.querySelector('#features').textContent = '';
  copy.querySelector('#save-preview').hidden = true;
  let baselineNode = copy.querySelector('#mhproto-baseline');
  if (!baselineNode) {
    baselineNode = document.createElement('script');
    baselineNode.id = 'mhproto-baseline';
    baselineNode.type = 'application/json';
    copy.querySelector('#mhproto-model').after(baselineNode);
  }
  baselineNode.textContent = safe(baseline);
  const link = document.createElement('a'),
    url = URL.createObjectURL(
      new Blob(['<!doctype html>\n' + copy.outerHTML], { type: 'text/html' }),
    );
  link.href = url;
  link.download = 'mhproto-preview.html';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
const loadedScripts = new Set();
async function loadPluginScripts(model) {
  // Exported previews inline these scripts ahead of the viewer.
  for (const plugin of model.plugins ?? []) {
    if (!plugin.viewer || loadedScripts.has(plugin.viewer)) continue;
    loadedScripts.add(plugin.viewer);
    await new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = plugin.viewer;
      script.onload = resolve;
      // Try again on the next refresh.
      script.onerror = () => {
        loadedScripts.delete(plugin.viewer);
        script.remove();
        resolve();
      };
      document.head.append(script);
    });
  }
}
async function refresh(initial = false) {
  try {
    if (embedded) {
      project = embedded;
      await render();
      return;
    }
    let response = await fetch('/api/model');
    if (!response.ok) response = await fetch('./model.json');
    if (!response.ok) throw new Error('Could not load the project');
    const next = await response.json();
    if (next.error) throw new Error(next.error);
    let nextBaseline = baseline;
    if (!localBaseline) {
      const r = await fetch('/api/baseline');
      if (r.ok) {
        nextBaseline = await r.json();
        baselineReadOnly = r.headers.get('x-mhproto-baseline-readonly') === 'true';
      } else if (r.status === 404) {
        const fallback = await fetch('./baseline.json');
        if (fallback.ok) nextBaseline = await fallback.json();
        else if (initial) nextBaseline = null;
      } else throw new Error('Could not read the comparison baseline');
    }
    if (nextBaseline) snapshotProject(nextBaseline);
    await loadPluginScripts(next);
    const nextSignature = JSON.stringify([next, nextBaseline]);
    if (initial || nextSignature !== signature) {
      project = next;
      baseline = nextBaseline;
      signature = nextSignature;
      await render();
    }
  } catch (error) {
    if (initial) $('#content').innerHTML = `<p class="error">${escape(error.message)}</p>`;
    else $('#freshness').textContent = 'Source read failed';
  }
}
await refresh(true);
if (!embedded) setInterval(() => refresh(), 4000);
