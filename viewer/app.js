const $ = selector => document.querySelector(selector);
const embedded = $('#bive-model') ? JSON.parse($('#bive-model').textContent) : null;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json = value => `<pre>${escape(JSON.stringify(value, null, 2))}</pre>`;
let project, capability, tab = 'Overview', query = '', signature, diff;
const tabs = ['Overview', 'Behaviour', 'Interface', 'Examples', 'Verification', 'Changes', 'Sources'];
const selected = () => project.capabilities.find(c => c.id === capability) ?? project.capabilities[0];
const tag = (text, cls = '') => `<span class="tag ${cls}">${escape(text)}</span>`;
const link = (kind, id, label = id) => `<button data-kind="${escape(kind)}" data-id="${escape(id)}">${escape(label)}</button>`;
const match = value => !query || JSON.stringify(value).toLowerCase().includes(query.toLowerCase());
function result(cap, check) {
  const evidence = cap.evidence;
  if (!evidence) return { status: 'unchecked' };
  if (evidence.stale || evidence.changedDuringRun) return { status: 'stale' };
  return evidence.results.find(r => r.id === check.id) ?? { status: 'unchecked' };
}
function ruleLinks(cap, id) {
  return `<div class="links">${cap.operations.filter(o=>o.rules.includes(id)).map(o=>link('operation',o.operationId,o.method+' '+o.path)).join('')}${cap.examples.filter(e=>e.rules?.includes(id)).map(e=>link('example',e.id)).join('')}${cap.checks.filter(c=>c.rules?.includes(id)).map(c=>link('check',c.id,`${c.id} · ${result(cap,c).status}`)).join('')}</div>`;
}
function ruleCard(cap, r) {
  return `<article class="card"><div class="card-heading"><span class="rule-id">${escape(r.id)}</span>${tag(cap.checks.some(c=>c.rules?.includes(r.id)) ? 'Check linked' : 'No check linked')}</div><div class="rule-text">${escape(r.text)}</div>${ruleLinks(cap,r.id)}</article>`;
}
function exampleCard(cap,e) {
  return `<article class="card"><span class="rule-id">${escape(e.id)}</span><h2>${escape(e.title ?? e.id)}</h2>${['given','when','then'].map(k=>`<div class="scenario"><b>${k.toUpperCase()}</b><span>${escape(e[k])}</span></div>`).join('')}<div class="links">${(e.rules??[]).map(id=>link('rule',id)).join('')}${(e.operations??[]).map(id=>link('operation',id)).join('')}${cap.checks.filter(c=>c.examples?.includes(e.id)).map(c=>link('check',c.id,c.id+' · '+result(cap,c).status)).join('')}</div>${e.request?`<details><summary>Request / response example</summary>${json({request:e.request,response:e.response})}</details>`:''}</article>`;
}
function schema(cap, object, depth = 0, visited = []) {
  if (!object) return '<span class="muted">No body</span>';
  if (object.$ref) {
    const name = object.$ref.split('/').at(-1);
    if (visited.includes(name) || depth > 5) return link('schema',name);
    return `<div>${link('schema',name)}${schema(cap,cap.openapi.components?.schemas?.[name],depth+1,[...visited,name])}</div>`;
  }
  if (object.anyOf || object.oneOf) return `<div>${(object.anyOf??object.oneOf).map(s=>schema(cap,s,depth+1,visited)).join('<div class="muted">or</div>')}</div>`;
  if (object.type === 'array') return `<div>${tag('array')}${schema(cap,object.items,depth+1,visited)}</div>`;
  if (object.properties) return `<div class="schema-properties">${Object.entries(object.properties).map(([name,s])=>`<div class="schema-field"><code>${escape(name)}</code> ${tag((object.required??[]).includes(name)?'required':'optional')}${schema(cap,s,depth+1,visited)}${s.description?`<p>${escape(s.description)}</p>`:''}</div>`).join('')}</div>`;
  return `<span class="mono">${escape(object.type??(object.const!==undefined?'const':'value'))}</span> ${object.enum?tag(object.enum.join(' | ')):''}${object.const!==undefined?tag(JSON.stringify(object.const)):''}${object.format?tag(object.format):''}${object.minimum!==undefined?tag('min '+object.minimum):''}${object.maximum!==undefined?tag('max '+object.maximum):''}${object.maxLength!==undefined?tag('max length '+object.maxLength):''}`;
}
function opDetail(cap,op) {
  const media = op.requestBody?.content?.['application/json'];
  return `<div class="operation-title"><span class="method ${op.method.toLowerCase()}">${escape(op.method)}</span>${escape(op.path)}</div><p class="muted">${escape(op.summary)}</p><div class="links">${op.rules.map(id=>link('rule',id)).join('')}</div>${op.parameters.length?`<h3 class="section-title">Parameters</h3>${json(op.parameters)}`:''}<h3 class="section-title">Request</h3>${schema(cap,media?.schema)}${media?.example?`<details><summary>Example payload</summary>${json(media.example)}</details>`:''}<h3 class="section-title">Responses</h3>${Object.entries(op.responses).map(([status,res])=>`<div class="card"><h2>${escape(status)} · ${escape(res.description)}</h2>${schema(cap,res.content?.['application/json']?.schema)}${res.content?.['application/json']?.example?`<details><summary>Example payload</summary>${json(res.content['application/json'].example)}</details>`:''}${res['x-error-codes']?json(res['x-error-codes']):''}</div>`).join('')}${op['x-preconditions']?.length?`<h3 class="section-title">Preconditions</h3>${json(op['x-preconditions'])}`:''}`;
}
function checkDetail(cap,check) {
  const r = result(cap,check);
  return `<span class="rule-id">${escape(check.id)}</span><h2>${escape(check.title??check.id)}</h2>${tag(r.status,r.status)}<p class="muted">${escape(check.description??'')}</p><div class="links">${(check.rules??[]).map(id=>link('rule',id)).join('')}${(check.examples??[]).map(id=>link('example',id)).join('')}</div><h3 class="section-title">Command</h3>${json(check.command)}${check.testNames?`<h3 class="section-title">Required tests</h3>${json(check.testNames)}`:''}${r.tests?`<h3 class="section-title">Observed test results</h3>${json(r.tests)}`:''}${r.stderr?`<h3 class="section-title">Error output</h3>${json(r.stderr)}`:''}${r.missing?.length?json({missing:r.missing}):''}<p class="muted">A passing check is evidence for the linked rules, rather than proof of every possible behaviour.</p>`;
}
function overview(cap) {
  const linked = cap.rules.filter(r=>cap.checks.some(c=>c.rules?.includes(r.id))).length;
  return `<div class="grid"><div><article class="card"><h2>The capability</h2><p>${escape(cap.description??cap.prose.split('\n\n').find(p=>!p.startsWith('#')&&!p.startsWith('Status:'))??'')}</p>${tag('Behaviour')}${tag('Interface')}${tag('Verification')}${tag('Examples')}<p>${escape(cap.owner?'Owner · '+cap.owner:'Owner not recorded')}</p></article><article class="card"><h2>States & transitions</h2>${cap.transitions.length?cap.transitions.map(t=>`<div class="transition">${tag(t.from??t.phase??'?')}<span>→</span>${tag(t.to??'?')}<small>${escape(t.on??t.when??t.trigger??t.operation??'')}</small><div class="links">${link('rule',t.clause)}</div></div>`).join(''):'<p>No structured transitions supplied.</p>'}<p>Full state and recovery semantics live in Behaviour.</p></article><article class="card"><h2>System map</h2><div class="rule-text">${escape(project.system)}</div></article></div><div><article class="card"><h2>Evidence, with its limits</h2><p>${linked} of ${cap.rules.length} rules have linked checks. ${cap.rules.length-linked} have no executable check.</p><table class="table"><thead><tr><th>Check</th><th>Latest evidence</th></tr></thead><tbody>${cap.checks.map(c=>`<tr><td><button class="link" data-kind="check" data-id="${escape(c.id)}">${escape(c.title??c.id)}</button></td><td>${tag(result(cap,c).status,result(cap,c).status)}</td></tr>`).join('')}</tbody></table><p>Evidence is tied to a digest of the spec, tests and tracked implementation. Changes make it stale.</p></article><article class="card"><h2>Open gaps</h2>${(cap.gaps??[]).map(g=>`<p>• ${escape(g)}</p>`).join('')}${project.issues.filter(i=>i.capability===cap.id).slice(0,7).map(i=>`<p>${tag(i.level)} ${escape(i.message)}</p>`).join('')}</article></div></div>`;
}
function render() {
  const cap = selected();
  $('#project-name').textContent = project.name;
  $('#capabilities').innerHTML = project.capabilities.map(c=>`<button data-capability="${escape(c.id)}" class="${c.id===cap.id?'active':''}">${escape(c.title??c.id)}</button>`).join('');
  $('#title').textContent = cap.title??cap.id;
  $('#breadcrumb').textContent = 'WORKSPACE / '+cap.id.toUpperCase();
  $('#subtitle').textContent = cap.description??'Behaviour, interfaces and evidence in one place.';
  const statuses = cap.checks.map(c=>result(cap,c).status);
  const status = statuses.includes('stale')?'stale':statuses.includes('failing')?'failing':statuses.length&&statuses.every(s=>s==='passing')?'passing':'unchecked';
  $('#freshness').className = 'pill '+status;
  $('#freshness').textContent = status === 'passing'?'Linked checks passing':status==='stale'?'Evidence stale':status==='failing'?'A check is failing':'Evidence unchecked';
  $('#stats').innerHTML = [[cap.rules.length,'Behaviour rules'],[cap.operations.length,'Interface operations'],[cap.examples.length,'Concrete scenarios'],[statuses.filter(s=>s==='passing').length+' / '+cap.checks.length,'Checks with current passing evidence']].map(([n,label])=>`<div class="stat"><strong>${n}</strong><span>${label}</span></div>`).join('');
  $('#tabs').innerHTML = tabs.map(t=>`<button data-tab="${t}" class="${t===tab?'active':''}">${t}</button>`).join('');
  let content = '';
  if(tab==='Overview') content=overview(cap);
  if(tab==='Behaviour') content=cap.rules.filter(match).map(r=>ruleCard(cap,r)).join('');
  if(tab==='Interface') content=`<div class="grid"><div>${cap.operations.filter(match).map(o=>`<article class="card"><div class="operation-title"><span class="method ${o.method.toLowerCase()}">${escape(o.method)}</span>${escape(o.path)}</div><p class="op-summary">${escape(o.summary)}</p><div class="links">${link('operation',o.operationId,'Inspect types & errors')}${o.rules.map(id=>link('rule',id)).join('')}</div></article>`).join('')}</div><article class="card"><h2>Shared schemas</h2>${Object.entries(cap.openapi.components?.schemas??{}).filter(match).map(([name,s])=>`<p><button class="link" data-kind="schema" data-id="${escape(name)}">${escape(name)}</button> ${tag(s.type??'union')}</p>`).join('')}<p>OpenAPI ${escape(cap.openapi.openapi)} · read from ${escape(cap.interface)}</p></article></div>`;
  if(tab==='Examples') content=cap.examples.filter(match).map(e=>exampleCard(cap,e)).join('');
  if(tab==='Verification') content=`<div class="note">Passing checks describe the observed run. Unlinked rules remain unchecked; stale evidence needs a new run. Prompt-text checks cannot establish live model behaviour.</div>${cap.checks.filter(match).map(c=>`<article class="card"><div class="card-heading"><h2>${escape(c.title??c.id)}</h2>${tag(result(cap,c).status,result(cap,c).status)}</div><p>${escape(c.description??'')}</p><div class="links">${link('check',c.id,'Inspect evidence')}${(c.rules??[]).map(id=>link('rule',id)).join('')}${(c.examples??[]).map(id=>link('example',id)).join('')}</div></article>`).join('')}<article class="card"><h2>Rules without executable checks</h2><div class="links">${cap.rules.filter(r=>!cap.checks.some(c=>c.rules?.includes(r.id))).map(r=>link('rule',r.id)).join('')}</div></article>`;
  if(tab==='Changes') content=diff?.available?`<p class="muted">Compared with the saved baseline. Review intended changes before implementation.</p>${diff.changes.filter(c=>c.capability===cap.id).map(c=>`<article class="card"><h2>${escape(c.id)} ${tag(c.status)}</h2><div class="grid"><div><span class="rule-id">BEFORE</span>${json(c.before)}</div><div><span class="rule-id">AFTER</span>${json(c.after)}</div></div></article>`).join('')||'<article class="card"><h2>No contract changes</h2><p>Current rules, schemas, examples and checks match the baseline.</p></article>'}`:'<article class="card"><h2>No baseline saved</h2><p>Run <code>bive snapshot</code> before proposing a contract change.</p></article>';
  if(tab==='Sources') content=`<article class="card"><h2>Contract sources</h2>${json({behaviour:cap.spec,interface:cap.interface,examples:cap.examples,verification:cap.checks,trackedImplementation:cap.sources})}<p>Fingerprint <code>${escape(cap.digest.slice(0,16))}</code></p><p>Latest run ${escape(cap.evidence?.finishedAt??'not recorded')}</p></article><article class="card"><h2>Complete behaviour document</h2><div class="rule-text">${escape(cap.prose)}</div></article>`;
  $('#content').innerHTML=content||'<div class="empty">No matches.</div>';
  const url = new URL(location);url.hash=cap.id+'/'+tab.toLowerCase();history.replaceState(null,'',url);
}
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.capability){capability=button.dataset.capability;render();return;}
  if(button.dataset.tab){tab=button.dataset.tab;render();return;}
  if(button.classList.contains('close')){$('#detail').close();return;}
  const kind=button.dataset.kind,id=button.dataset.id,cap=selected();if(!kind)return;
  let html;
  if(kind==='rule'){const r=cap.rules.find(r=>r.id===id);html=r?ruleCard(cap,r):'<p>Rule not found</p>';}
  if(kind==='operation'){const o=cap.operations.find(o=>o.operationId===id);html=o?opDetail(cap,o):'<p>Operation not found</p>';}
  if(kind==='example'){const e=cap.examples.find(e=>e.id===id);html=e?exampleCard(cap,e):'<p>Example not found</p>';}
  if(kind==='check'){const c=cap.checks.find(c=>c.id===id);html=c?checkDetail(cap,c):'<p>Check not found</p>';}
  if(kind==='schema')html=`<h2>${escape(id)}</h2>${schema(cap,cap.openapi.components?.schemas?.[id],0,[id])}<details><summary>JSON Schema</summary>${json(cap.openapi.components?.schemas?.[id])}</details>`;
  $('#detail-content').innerHTML=html;if(!$('#detail').open)$('#detail').showModal();
});
$('#search').addEventListener('input',event=>{query=event.target.value;if(query&&tab==='Overview')tab='Behaviour';render();});
async function refresh(initial=false){
  try{
    if(embedded){project=embedded;diff=JSON.parse($('#bive-diff').textContent);const [id,section]=location.hash.slice(1).split('/');capability=id;tab=tabs.find(t=>t.toLowerCase()===section)??'Overview';render();return;}
    let response=await fetch('/api/model');
    if(!response.ok)response=await fetch('./model.json');
    if(!response.ok)throw new Error('Could not load contract');
    const next=await response.json();if(next.error)throw new Error(next.error);
    const nextSignature=JSON.stringify(next);
    if(initial||nextSignature!==signature){
      project=next;signature=nextSignature;
      if(initial){const [id,section]=location.hash.slice(1).split('/');capability=id;tab=tabs.find(t=>t.toLowerCase()===section)??'Overview';}
      try{diff=await(await fetch('/api/diff')).json();}catch{diff=null;}
      render();
    }
  }catch(e){if(initial)$('#content').innerHTML=`<div class="error">${escape(e.message)}</div>`;else{$('#freshness').textContent='Source read failed';$('#freshness').className='pill failing';}}
}
await refresh(true);if(!embedded)setInterval(()=>refresh(),4000);
