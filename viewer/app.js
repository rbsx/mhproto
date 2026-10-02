const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const text = value => escape(value).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
const raw = value => `<pre>${escape(JSON.stringify(value, null, 2))}</pre>`;
const embedded = $('#bive-model') ? JSON.parse($('#bive-model').textContent) : null;
const tabs = ['Behaviour', 'API', 'Checks', 'Changes'];
let project, capability, tab = 'Behaviour', query = '', signature, diff;
let checksFilter = 'attention', trail = [], restoreFocus;
const selected = () => project.capabilities.find(c => c.id === capability) ?? project.capabilities[0];
const matches = value => !query || JSON.stringify(value).toLowerCase().includes(query.toLowerCase());
const clean = value => String(value ?? '').replace(/`/g, '').replace(/\*\*/g, '');
const firstLine = value => clean(String(value ?? '').split('\n')[0]);
const short = (value, length = 150) => value.length > length ? value.slice(0, length - 1).trim() + '…' : value;
const ruleTitle = (cap, rule) => cap.presentation?.ruleTitles?.[rule.id] ?? short(firstLine(rule.text));
const checkTitle = check => (check.title ?? check.id).replace(/^(?:[A-Z][A-Z0-9.-]+\s+)+/, '');
const link = (kind, id, label = id) => `<a href="#${escape(selected().id)}/${tab.toLowerCase()}/${escape(kind)}/${encodeURIComponent(id)}" data-kind="${escape(kind)}" data-id="${escape(id)}">${escape(label)}</a>`;
const disclosure = (title, body, open = false) => `<details class="related"${open ? ' open' : ''}><summary>${escape(title)}</summary><div class="related-body">${body}</div></details>`;

function result(cap, check) {
  if (!cap.evidence) return { status: 'unchecked' };
  if (cap.evidence.stale || cap.evidence.changedDuringRun) return { status: 'stale' };
  return cap.evidence.results.find(r => r.id === check.id) ?? { status: 'unchecked' };
}
function statusLabel(status) { return ({ passing:'Passed', failing:'Failed', stale:'Needs a new run', unchecked:'Not run' })[status] ?? status; }
function row(kind, id, title, meta = '', status = '') {
  return `<button class="item-row" data-kind="${escape(kind)}" data-id="${escape(id)}"><span class="item-main"><span class="item-title">${escape(title)}</span>${meta ? `<span class="item-meta">${escape(meta)}</span>` : ''}</span>${status ? `<span class="row-status ${escape(status)}">${statusLabel(status)}</span>` : ''}<span class="row-arrow" aria-hidden="true">↗</span></button>`;
}

function ruleGroups(cap) {
  const sections = new Map();
  let heading = 'Rules';
  for (const line of cap.prose.split('\n')) {
    if (/^##\s/.test(line)) heading = line.replace(/^##\s+/, '').replace(/^[A-Z][A-Z0-9-]*\s*[—–-]\s*/, '');
    const id = /^\s*-\s+\*\*([A-Z][A-Z0-9-]*-\d+)\*\*/.exec(line)?.[1];
    if (id) sections.set(id, heading);
  }
  const labels = cap.presentation?.sectionTitles ?? {};
  const groups = new Map();
  for (const rule of cap.rules) {
    const section = sections.get(rule.id) ?? 'Rules';
    const label = labels[section] ?? section.charAt(0).toUpperCase() + section.slice(1);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(rule);
  }
  const entry = cap.presentation?.entrySection;
  return [...groups].sort(([a],[b]) => a === entry ? -1 : b === entry ? 1 : 0);
}

function behaviour(cap) {
  const phases = [...new Set(cap.transitions.flatMap(t => [t.from, t.to]).filter(Boolean))];
  const flow = phases.length ? `<p class="section-caption">How it works</p><ol class="phases">${phases.map((phase,i)=>`<li><span class="phase-number">${i+1}</span>${escape(phase.charAt(0).toUpperCase()+phase.slice(1))}</li>`).join('')}</ol>` : '';
  return flow + ruleGroups(cap).map(([name,rules],index) => `<details class="rule-group"${index===0?' open':''}><summary>${escape(name)}<span class="count">${rules.length}</span></summary><div>${rules.map(r => row('rule',r.id,ruleTitle(cap,r))).join('')}</div></details>`).join('');
}

function api(cap) {
  return `<p class="intro">Choose an endpoint to inspect its inputs, outputs and linked behaviour.</p><div class="stack-list">${cap.operations.map(op=>`<button class="item-row" data-kind="operation" data-id="${escape(op.operationId)}"><span class="item-main"><span class="endpoint"><span class="method">${escape(op.method)}</span><span class="endpoint-path">${escape(op.path)}</span></span><span class="op-summary">${escape(op.summary??op.operationId)}</span></span><span class="row-arrow" aria-hidden="true">↗</span></button>`).join('')}</div><details class="secondary-disclosure"><summary>Browse shared types</summary><div class="types-list">${Object.keys(cap.openapi.components?.schemas??{}).map(name=>link('schema',name)).join('')}</div></details>`;
}

function checks(cap) {
  const passing = cap.checks.filter(c=>result(cap,c).status==='passing').length;
  const gaps = cap.rules.filter(r=>!cap.checks.some(c=>c.rules?.includes(r.id)));
  const attention = cap.checks.filter(c=>result(cap,c).status!=='passing');
  const report = cap.evidence ? `${passing} of ${cap.checks.length} checks have current passing evidence.` : 'No verification run recorded.';
  const filters = `<div class="section-toggle"><button data-filter="attention" aria-pressed="${checksFilter==='attention'}">Needs attention${attention.length+gaps.length?' · '+(attention.length+gaps.length):''}</button><button data-filter="all" aria-pressed="${checksFilter==='all'}">All checks</button></div>`;
  const rows = (checksFilter==='all'?cap.checks:attention).map(c=>row('check',c.id,checkTitle(c),'',result(cap,c).status)).join('');
  const missing = checksFilter==='attention' && gaps.length ? `<h2 class="quiet-heading">Rules without a check</h2><div class="stack-list">${gaps.map(r=>row('rule',r.id,ruleTitle(cap,r))).join('')}</div>` : '';
  const empty = !rows&&!missing ? '<div class="empty"><strong>No checks need attention.</strong>Passing checks are available in All checks.</div>' : '';
  return `<p class="intro">${escape(report)}${gaps.length?` <strong>${gaps.length} rules have no linked check.</strong>`:''}</p>${filters}${rows?`<div class="stack-list">${rows}</div>`:''}${missing}${empty}<details class="secondary-disclosure"><summary>What these checks establish</summary><p>Each result describes an observed run against the tracked sources. It does not prove every case of a rule. Changes to those sources make the evidence stale.</p>${(cap.gaps??[]).map(g=>`<p>${escape(g)}</p>`).join('')}</details>`;
}

function changes(cap) {
  if (!diff?.available) return '<div class="empty"><strong>No comparison available.</strong>A saved baseline is needed to review changes.</div>';
  const items = diff.changes.filter(c=>c.capability===cap.id);
  if (!items.length) return '<div class="empty"><strong>No contract changes.</strong>This capability matches the saved baseline.</div>';
  return `<p class="intro">${items.length} ${items.length===1?'item differs':'items differ'} from the baseline. Open one to review what changed.</p><div class="stack-list">${items.map((c,i)=>row('change',String(i),c.kind==='rule'?short(firstLine(c.after?.text??c.before?.text??c.id)):c.kind==='check'?checkTitle(c.after??c.before):c.id,`${c.kind} · ${c.status}`)).join('')}</div>`;
}

function search(cap) {
  const groups = [
    ['Rules',cap.rules.filter(r=>matches(r)||matches(ruleTitle(cap,r))).map(r=>row('rule',r.id,ruleTitle(cap,r),r.id))],
    ['API',cap.operations.filter(matches).map(o=>row('operation',o.operationId,o.method+' '+o.path,o.summary))],
    ['Examples',cap.examples.filter(matches).map(e=>row('example',e.id,e.title??e.id))],
    ['Checks',cap.checks.filter(matches).map(c=>row('check',c.id,checkTitle(c),'',result(cap,c).status))],
  ];
  return groups.filter(([,rows])=>rows.length).map(([title,rows])=>`<h2 class="quiet-heading">${title}</h2><div class="stack-list">${rows.join('')}</div>`).join('') || '<div class="empty">No matches.</div>';
}

function scenario(cap, example) {
  return `<section class="scenario"><h3>${escape(example.title??example.id)}</h3>${['given','when','then'].map(k=>`<div class="scenario-line"><b>${k.charAt(0).toUpperCase()+k.slice(1)}</b><span>${text(example[k])}</span></div>`).join('')}${example.request?`<details class="secondary-disclosure"><summary>Payload example</summary>${raw({request:example.request,response:example.response})}</details>`:''}</section>`;
}

function ruleDetail(cap,rule) {
  const examples = cap.examples.filter(e=>e.rules?.includes(rule.id));
  const ops = cap.operations.filter(o=>o.rules.includes(rule.id));
  const checks = cap.checks.filter(c=>c.rules?.includes(rule.id));
  return `<p class="detail-id">${escape(rule.id)}</p><h2 id="detail-title">${escape(ruleTitle(cap,rule))}</h2><div class="detail-prose">${text(rule.text)}</div>${examples.length?disclosure(`Examples · ${examples.length}`,examples.map(e=>scenario(cap,e)).join(''),true):'<p class="note">No examples linked yet.</p>'}${ops.length?disclosure(`API · ${ops.length}`,`<div class="related-links">${ops.map(o=>link('operation',o.operationId,o.method+' '+o.path)).join('')}</div>`):''}${checks.length?disclosure(`Checks · ${checks.length}`,checks.map(c=>row('check',c.id,checkTitle(c),'',result(cap,c).status)).join('')):'<p class="note">This rule has no linked executable check.</p>'}`;
}

function schemaName(s) {
  if (!s) return '—';
  if (s.$ref) return s.$ref.split('/').at(-1);
  if (s.enum) return s.enum.map(v=>JSON.stringify(v)).join(' | ');
  if (s.const!==undefined) return JSON.stringify(s.const);
  if (s.type==='array') return schemaName(s.items)+'[]';
  if (s.oneOf||s.anyOf) return (s.oneOf??s.anyOf).map(schemaName).join(' | ');
  return Array.isArray(s.type)?s.type.join(' | '):(s.type??'value');
}
function typeLink(s) {
  const label = schemaName(s);
  if (s?.$ref) return link('schema',label);
  if (s?.type==='array'&&s.items?.$ref) return link('schema',schemaName(s.items),label);
  return escape(label);
}
function fields(cap,s) {
  if (!s) return '<p class="muted">No body.</p>';
  const schema = s.$ref ? cap.openapi.components?.schemas?.[schemaName(s)] : s;
  if (!schema?.properties) return `<p class="muted">${typeLink(s)}</p>`;
  return `<table class="table"><thead><tr><th>Field</th><th>Type</th><th></th></tr></thead><tbody>${Object.entries(schema.properties).map(([name,p])=>`<tr><td><code>${escape(name)}</code>${p.description?`<div class="field-note">${escape(p.description)}</div>`:''}</td><td class="type-link">${typeLink(p)}${p.minimum!==undefined?`<div class="field-note">min ${escape(p.minimum)}</div>`:''}${p.maximum!==undefined?`<div class="field-note">max ${escape(p.maximum)}</div>`:''}</td><td class="field-flags">${(schema.required??[]).includes(name)?'Required':'Optional'}</td></tr>`).join('')}</tbody></table>`;
}
function operationDetail(cap,op) {
  const request = op.requestBody?.content?.['application/json'];
  const responses = Object.entries(op.responses??{});
  const parameters = op.parameters.length ? `<h3 class="quiet-heading">Parameters</h3><table class="table"><thead><tr><th>Name</th><th>Location</th><th>Type</th></tr></thead><tbody>${op.parameters.map(p=>`<tr><td><code>${escape(p.name)}</code>${p.description?`<div class="field-note">${escape(p.description)}</div>`:''}</td><td>${escape(p.in)}</td><td>${escape(schemaName(p.schema))}</td></tr>`).join('')}</tbody></table>` : '';
  return `<p class="detail-id">${escape(op.operationId)}</p><h2 id="detail-title"><span class="method">${escape(op.method)}</span> ${escape(op.path)}</h2><p class="intro">${escape(op.summary??'')}</p>${parameters}<h3 class="quiet-heading">Request body</h3>${fields(cap,request?.schema)}${request?.example?disclosure('Request example',raw(request.example)):''}<h3 class="quiet-heading">Responses</h3>${responses.map(([status,res],i)=>disclosure(`${status} · ${short(clean(res.description??''),95)}`,fields(cap,res.content?.['application/json']?.schema)+(res['x-error-codes']?`<div class="stack-list">${res['x-error-codes'].map(e=>`<p class="muted"><code>${escape(e.code)}</code> ${escape(e.when??'')}${e.clause?' · '+link('rule',e.clause,'Behaviour'):''}</p>`).join('')}</div>`:'')+(res.content?.['application/json']?.example?`<details class="secondary-disclosure"><summary>Response example</summary>${raw(res.content['application/json'].example)}</details>`:''),i===0&&/^2/.test(status))).join('')}${op.rules.length?disclosure('Related behaviour',`<div class="related-links">${op.rules.map(id=>link('rule',id,short(firstLine(cap.rules.find(r=>r.id===id)?.text??id),90))).join('')}</div>`):''}${op['x-preconditions']?.length?disclosure('Preconditions',op['x-preconditions'].map(p=>`<p class="muted">${escape(p.needs)}${p.fails?.code?' → '+escape(p.fails.code):''}</p>`).join('')):''}${disclosure('Raw OpenAPI',raw(op))}`;
}

function checkDetail(cap,check) {
  const r = result(cap,check);
  const expected = new Set(check.testNames??[]);
  const tests = (r.tests??[]).filter(t=>expected.has(t.name)||t.type==='test:fail');
  return `<p class="detail-id">${escape(check.id)}</p><h2 id="detail-title">${escape(checkTitle(check))}</h2><div class="status-line"><span class="status-dot ${r.status}"></span><span class="${r.status==='failing'?'result-failing':''}">${statusLabel(r.status)}</span></div><p class="intro">${escape(check.description??'')}</p>${r.status==='stale'?'<p class="note">The tracked spec or implementation changed after this run. Run the check again to refresh its evidence.</p>':''}${tests.length?disclosure('Observed tests',tests.map(t=>`<p class="muted">${t.skip?'Skipped':t.type==='test:fail'?'Failed':'Passed'} · ${escape(t.name)}${t.message?'<br>'+escape(t.message):''}</p>`).join(''),r.status==='failing'):''}${r.missing?.length?`<p class="error">Expected tests did not run: ${escape(r.missing.join(', '))}</p>`:''}${check.rules?.length?disclosure('Related behaviour',`<div class="related-links">${check.rules.map(id=>link('rule',id,short(firstLine(cap.rules.find(r=>r.id===id)?.text??id),90))).join('')}</div>`):''}${check.examples?.length?disclosure('Examples',check.examples.map(id=>scenario(cap,cap.examples.find(e=>e.id===id))).join('')):''}${disclosure('Run details',raw({command:check.command,startedAt:r.startedAt,durationMs:r.durationMs,exitCode:r.exitCode}))}${r.stderr?disclosure('Error output',`<pre>${escape(r.stderr)}</pre>`,r.status==='failing'):''}<p class="note">A passing check is evidence for the linked behaviour, with the scope of the observed tests.</p>`;
}

function changeDetail(change) {
  const summary = value => change.kind==='rule' ? `<div class="comparison-text">${text(value?.text??'No rule')}</div>` : change.kind==='example' ? (value?scenario(selected(),value):'<p class="muted">No example</p>') : `<div class="comparison-text">${escape(value ? (value.summary??value.title??value.name??change.id) : 'Not present')}</div>`;
  return `<p class="detail-id">${escape(change.kind)} · ${escape(change.status)}</p><h2 id="detail-title">${escape(change.id)}</h2><section class="comparison"><p class="comparison-label">Before</p>${summary(change.before)}</section><section class="comparison"><p class="comparison-label">After</p>${summary(change.after)}</section>${change.kind!=='rule'&&change.kind!=='example'?disclosure('Full change',raw({before:change.before,after:change.after})):''}`;
}

function sourcesDetail(cap) {
  return `<h2 id="detail-title">Sources</h2><p class="intro">This view reads the capability’s existing files. Edit them in your editor or through your agent.</p><table class="table"><tbody>${Object.entries({Behaviour:cap.files.spec,Interface:cap.files.interface,Examples:cap.files.examples,Checks:cap.files.checks}).map(([label,file])=>`<tr><td>${label}</td><td><code>${escape(file)}</code></td></tr>`).join('')}</tbody></table>${disclosure('Tracked implementation',raw(cap.sources))}${disclosure('Verification metadata',raw({fingerprint:cap.digest,latestRun:cap.evidence?.finishedAt??null}))}${disclosure('Complete behaviour document',`<div class="detail-prose">${text(cap.prose)}</div>`)}${disclosure('Local commands','<pre>bive check\nbive verify --capability '+escape(cap.id)+'\nbive snapshot\nbive view</pre>')}`;
}

function renderDetail() {
  const cap = selected(), item = trail.at(-1);
  if (!item) return;
  const {kind,id}=item;
  let body;
  if(kind==='rule'){const r=cap.rules.find(r=>r.id===id);if(r)body=ruleDetail(cap,r);}
  if(kind==='operation'){const op=cap.operations.find(o=>o.operationId===id);if(op)body=operationDetail(cap,op);}
  if(kind==='example'){const e=cap.examples.find(e=>e.id===id);if(e)body=`<p class="detail-id">${escape(e.id)}</p><h2 id="detail-title">${escape(e.title??e.id)}</h2>${scenario(cap,e)}${disclosure('Related behaviour',`<div class="related-links">${(e.rules??[]).map(id=>link('rule',id)).join('')}</div>`)}`;}
  if(kind==='check'){const c=cap.checks.find(c=>c.id===id);if(c)body=checkDetail(cap,c);}
  if(kind==='schema'){const s=cap.openapi.components?.schemas?.[id];if(s)body=`<p class="detail-id">Shared type</p><h2 id="detail-title">${escape(id)}</h2>${fields(cap,s)}${disclosure('JSON Schema',raw(s))}`;}
  if(kind==='change'){const c=diff?.changes.filter(c=>c.capability===cap.id)[Number(id)];if(c)body=changeDetail(c);}
  if(kind==='sources')body=sourcesDetail(cap);
  if(kind==='system')body=`<h2 id="detail-title">System map</h2><div class="detail-prose">${text(project.system)}</div>`;
  $('#detail-content').innerHTML=body??'<h2 id="detail-title">Item not found</h2><p class="muted">It may have changed in the source files.</p>';
  $('#detail-label').textContent=({rule:'Behaviour',operation:'API',example:'Example',check:'Check',schema:'Type',change:'Change',sources:'Workspace',system:'Workspace'})[kind]??'';
  $('#detail-back').hidden=trail.length<2;
  $('#detail').scrollTop=0;
}
function openDetail(kind,id) {
  if(!$('#detail').open)restoreFocus=document.activeElement;
  trail.push({kind,id});renderDetail();
  if(!$('#detail').open)$('#detail').showModal();
}
function closeDetail() { $('#detail').close();trail=[];restoreFocus?.focus(); }

function render() {
  const cap=selected();capability=cap.id;
  $('#project-name').textContent=project.name;
  $('#capabilities').innerHTML=project.capabilities.map(c=>`<button data-capability="${escape(c.id)}" class="${c.id===cap.id?'active':''}">${escape(c.title??c.id)}</button>`).join('');
  $('#breadcrumb').textContent='Capability';
  $('#title').textContent=cap.title??cap.id;
  $('#subtitle').textContent=cap.description??'The agreed behaviour and interfaces for this capability.';
  $('#tabs').innerHTML=tabs.map(t=>`<button data-tab="${t}" class="${t===tab?'active':''}" aria-current="${t===tab?'page':'false'}">${t}</button>`).join('');
  $('#content').innerHTML=query?search(cap):({Behaviour:behaviour,API:api,Checks:checks,Changes:changes}[tab])(cap);
  $('#freshness').textContent=cap.evidence?.stale?'Evidence needs a new run':cap.evidence?'Latest run · '+new Date(cap.evidence.finishedAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'No verification run recorded';
  $('#view-mode').textContent=embedded?'Exported snapshot':'Local workspace';
  $('#read-mode').textContent=embedded?'Snapshot · read-only':'Read-only';
  const url=new URL(location);url.hash=cap.id+'/'+tab.toLowerCase();history.replaceState(null,'',url);
  if($('#detail').open)renderDetail();
}

document.addEventListener('click',event=>{
  const control=event.target.closest('[data-kind],[data-tab],[data-capability],[data-filter],.close,#detail-back');if(!control)return;
  if(control.tagName==='A')event.preventDefault();
  if(control.dataset.kind){openDetail(control.dataset.kind,control.dataset.id);return;}
  if(control.classList.contains('close')){closeDetail();return;}
  if(control.id==='detail-back'){trail.pop();renderDetail();return;}
  if(control.dataset.capability){capability=control.dataset.capability;query='';$('#search').value='';tab='Behaviour';trail=[];render();return;}
  if(control.dataset.tab){tab=control.dataset.tab;query='';$('#search').value='';render();return;}
  if(control.dataset.filter){checksFilter=control.dataset.filter;render();}
});
$('#detail').addEventListener('cancel',()=>{trail=[];});
$('#search').addEventListener('input',event=>{query=event.target.value;render();});
document.addEventListener('keydown',event=>{if(event.key==='/'&&!$('#detail').open&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){event.preventDefault();$('#search').focus();}});
function initialRoute() { const [id,view]=location.hash.slice(1).split('/');capability=id;tab=tabs.find(t=>t.toLowerCase()===view)??'Behaviour'; }
async function refresh(initial=false) {
  try {
    if(embedded){project=embedded;diff=JSON.parse($('#bive-diff').textContent);initialRoute();render();return;}
    let response=await fetch('/api/model');
    if(!response.ok)response=await fetch('./model.json');
    if(!response.ok)throw new Error('Could not load the capability');
    const next=await response.json();if(next.error)throw new Error(next.error);
    const nextSignature=JSON.stringify(next);
    if(initial||nextSignature!==signature){project=next;signature=nextSignature;if(initial)initialRoute();try{diff=await(await fetch('/api/diff')).json();}catch{diff=null;}render();}
  } catch(error) { if(initial)$('#content').innerHTML=`<p class="error">${escape(error.message)}</p>`;else $('#freshness').textContent='Source read failed'; }
}
await refresh(true);
if(!embedded)setInterval(()=>refresh(),4000);
