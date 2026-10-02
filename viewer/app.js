const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const prose = value => escape(value).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
const raw = value => `<pre>${escape(JSON.stringify(value, null, 2))}</pre>`;
const embedded = $('#bive-model') ? JSON.parse($('#bive-model').textContent) : null;
const disclosure = (title, body, open = false) => `<details class="disclosure"${open?' open':''}><summary>${escape(title)}</summary><div>${body}</div></details>`;
let project, signature, query = '', generation = 0, diagramSerial = 0, diagramQueue = Promise.resolve();
const featureUrl = cap => '#/features/'+encodeURIComponent(cap.id);
const endpointUrl = (cap, op, rule) => featureUrl(cap)+'/api/'+encodeURIComponent(op.operationId)+(rule?'?rule='+encodeURIComponent(rule):'');
const checkUrl = (cap, check) => featureUrl(cap)+'/checks/'+encodeURIComponent(check.id);
const method = op => `<span class="method ${escape(op.method.toLowerCase())}">${escape(op.method)}</span>`;
const clean = value => String(value ?? '').replace(/`|\*\*/g,'');
const checkTitle = check => (check.title??check.id).replace(/^(?:[A-Z][A-Z0-9.-]+\s+)+/,'');

function route() {
  const [pathname,params] = location.hash.slice(1).split('?');
  const parts = pathname.replace(/^\//,'').split('/').map(x=>{try{return decodeURIComponent(x);}catch{return x;}});
  // Older exported links still lead to the feature overview.
  const id = parts[0]==='features'?parts[1]:parts[0];
  const cap = project.capabilities.find(c=>c.id===id) ?? project.capabilities[0];
  return { cap, kind:parts[0]==='features'?parts[2]:null, id:parts[3], rule:new URLSearchParams(params).get('rule') };
}
function orderedOperations(cap) {
  const order=cap.presentation?.operationOrder??[];
  return [...cap.operations].sort((a,b)=>(order.includes(a.operationId)?order.indexOf(a.operationId):999)-(order.includes(b.operationId)?order.indexOf(b.operationId):999));
}
const operationPresentation = (cap,op) => cap.presentation?.operations?.[op.operationId]??{};
function operationRuleIds(cap,op) {
  const presentation=operationPresentation(cap,op);
  return [...new Set([...(op.rules??[]),...(op['x-preconditions']??[]).map(p=>p.fails?.clause),...Object.values(op.responses??{}).flatMap(r=>(r['x-error-codes']??[]).map(e=>e.clause)),...(presentation.rules??[]),...(presentation.ruleGroups??[]).flatMap(g=>g.rules??[])].filter(Boolean))];
}
function rulesFor(cap,op) { const ids=operationRuleIds(cap,op);return cap.rules.filter(r=>ids.includes(r.id)); }
function ruleLink(cap,id,label,currentOperation) {
  const op=currentOperation??orderedOperations(cap).find(o=>operationRuleIds(cap,o).includes(id));
  return op?`<a href="${escape(endpointUrl(cap,op,id))}">${escape(label??id)}</a>`:escape(label??id);
}

function resolveSchema(cap,schema,seen=new Set()) {
  if(!schema?.$ref)return schema??{};
  if(seen.has(schema.$ref))return {type:'object',description:'Recursive object'};
  let node=cap.openapi;
  for(const part of schema.$ref.slice(2).split('/'))node=node?.[part.replaceAll('~1','/').replaceAll('~0','~')];
  const next=new Set(seen).add(schema.$ref);
  return {...resolveSchema(cap,node,next),...Object.fromEntries(Object.entries(schema).filter(([key])=>key!=='$ref'))};
}
function typeLabel(cap,input,depth=0,seen=new Set()) {
  if(input?.$ref&&seen.has(input.$ref))return '{ recursive object }';
  const next=new Set(seen);if(input?.$ref)next.add(input.$ref);
  const s=resolveSchema(cap,input);
  if(s.const!==undefined)return JSON.stringify(s.const);
  if(s.enum)return s.enum.map(v=>JSON.stringify(v)).join(' | ');
  if(s.anyOf||s.oneOf)return (s.anyOf??s.oneOf).map(x=>typeLabel(cap,x,depth,next)).join(' | ');
  if(s.allOf)return s.allOf.map(x=>typeLabel(cap,x,depth,next)).join(' & ');
  if(s.type==='array')return `Array<${typeLabel(cap,s.items,depth+1,next)}>`;
  if(s.properties){
    if(depth>1)return '{ … }';
    const items=Object.entries(s.properties), required=s.required??[];
    return '{ '+items.slice(0,2).map(([name,p])=>name+(required.includes(name)?'':'?')+': '+typeLabel(cap,p,depth+1,next)).join('; ')+(items.length>2?'; …':'')+' }';
  }
  const types=Array.isArray(s.type)?s.type:[s.type??'unknown'];
  return types.map(t=>t==='integer'?'number':t).join(' | ');
}
function constraint(input) {
  const parts=[];
  if(input.format)parts.push(input.format);
  if(input.type==='integer')parts.push('integer');
  if(input.minimum!==undefined&&input.maximum!==undefined)parts.push(`${input.minimum}–${input.maximum}`);
  else {if(input.minimum!==undefined)parts.push(`≥ ${input.minimum}`);if(input.maximum!==undefined)parts.push(`≤ ${input.maximum}`);}
  if(input.maxLength!==undefined)parts.push(`max ${input.maxLength} chars`);
  if(input.pattern)parts.push(input.pattern==='^\\d{4}-\\d{2}-\\d{2}$'?'YYYY-MM-DD':'pattern: '+input.pattern);
  return parts.length?`<span class="field-constraint">${escape(parts.join(' · '))}</span>`:'';
}
function nestedObjects(cap,input,seen) {
  const s=resolveSchema(cap,input);
  if(s.properties)return [{schema:s,suffix:''}];
  if(s.type==='array')return nestedObjects(cap,s.items,seen).map(item=>({...item,suffix:item.suffix+'[]'}));
  return (s.anyOf??s.oneOf??s.allOf??[]).flatMap(item=>nestedObjects(cap,item,seen));
}
function objectSignature(cap,input,depth=0,seen=new Set()) {
  if(input?.$ref&&seen.has(input.$ref))return '<span class="field-type">{ recursive object }</span>';
  const next=new Set(seen);if(input?.$ref)next.add(input.$ref);
  const s=resolveSchema(cap,input);
  if(!s.properties)return `<div class="signature">${escape(typeLabel(cap,input))}</div>`;
  const fields=Object.entries(s.properties).map(([name,p])=>{
    const resolved=resolveSchema(cap,p), optional=(s.required??[]).includes(name)?'':'?';
    const label=`<span class="field-name">${escape(name+optional)}:</span> <span class="field-type">${escape(typeLabel(cap,p))}</span>${constraint(resolved)}`;
    const objects=nestedObjects(cap,p,next);
    if(objects.length&&depth<7&&!(p.$ref&&next.has(p.$ref)))return `<details class="inline-object"><summary>${label}</summary><div>${objects.map(obj=>objectSignature(cap,obj.schema,depth+1,next)+(obj.suffix?`<span class="field-type">${escape(obj.suffix)}</span>`:'')).join('')}${resolved.description?`<p class="field-note">${escape(resolved.description)}</p>`:''}</div></details>`;
    return `<div class="field">${label};</div>`;
  }).join('');
  return `<div class="signature">{<div class="signature-body">${fields}</div>}</div>`;
}
function parameterSchema(parameters) {
  return {type:'object',properties:Object.fromEntries(parameters.map(p=>[p.name,p.schema??{}])),required:parameters.filter(p=>p.required).map(p=>p.name)};
}
function requestSignature(cap,op) {
  const parts=[];
  for(const location of ['path','query','header','cookie']){
    const params=(op.parameters??[]).filter(p=>p.in===location);
    if(params.length)parts.push(`<p class="request-part">${escape(location.charAt(0).toUpperCase()+location.slice(1))}</p>${objectSignature(cap,parameterSchema(params))}`);
  }
  const body=op.requestBody?.content?.['application/json']?.schema;
  if(body)parts.push(`<p class="request-part">JSON body${op.requestBody.required?'':' · optional'}</p>${objectSignature(cap,body)}`);
  return parts.join('')||'<div class="signature">No parameters or body.</div>';
}
function successResponse(op) { return Object.entries(op.responses??{}).find(([status])=>/^2\d\d$/.test(status))??Object.entries(op.responses??{})[0]??['—',{}]; }
function io(cap,op) {
  const [status,res]=successResponse(op);
  return `<div class="io-grid"><section><h3 class="io-heading">Request</h3>${requestSignature(cap,op)}</section><section><h3 class="io-heading">Response <strong>${escape(status)}</strong></h3>${res.content?.['application/json']?.schema?objectSignature(cap,res.content['application/json'].schema):'<div class="signature">No response body.</div>'}</section></div>`;
}

function diagram(title,source) {
  return `<figure class="diagram"><figcaption>${escape(title)}</figcaption><div class="diagram-canvas" data-mermaid="${escape(source)}" aria-label="${escape(title)}"><span class="section-note">Rendering diagram…</span></div><details class="diagram-source"><summary>Diagram source</summary><pre>${escape(source)}</pre></details></figure>`;
}
function markdownDiagrams(markdown,title) {
  return [...String(markdown??'').matchAll(/```mermaid\s*\n([\s\S]*?)```/g)].map(match=>diagram(title,match[1].trim())).join('');
}
function operationDiagrams(cap,op) { return (operationPresentation(cap,op).diagrams??[]).map(d=>diagram(d.title,d.source)).join(''); }
const diagrams = globalThis.mermaid;
if(diagrams)diagrams.initialize({startOnLoad:false,securityLevel:'strict',suppressErrorRendering:true,theme:'base',fontFamily:'-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',htmlLabels:false,flowchart:{htmlLabels:false,useMaxWidth:true},sequence:{useMaxWidth:true},secure:['secure','securityLevel','startOnLoad','htmlLabels','theme','themeVariables'],themeVariables:{primaryColor:'#ffffff',primaryTextColor:'#141414',primaryBorderColor:'#aaa',lineColor:'#666',secondaryColor:'#ffffff',tertiaryColor:'#ffffff',background:'#ffffff',mainBkg:'#ffffff',nodeBorder:'#aaa',clusterBkg:'#ffffff',clusterBorder:'#ddd',actorBkg:'#ffffff',actorBorder:'#aaa',actorTextColor:'#141414',signalColor:'#666',signalTextColor:'#141414',labelBoxBkgColor:'#fff',labelBoxBorderColor:'#aaa',labelTextColor:'#141414',loopTextColor:'#141414',noteBkgColor:'#fff',noteBorderColor:'#aaa',noteTextColor:'#141414',textColor:'#141414',fontSize:'12px'}});
async function renderDiagrams(version) {
  for(const element of document.querySelectorAll('[data-mermaid]')){
    if(version!==generation||!element.isConnected)return;
    if(element.dataset.rendered==='true'||element.closest('details:not([open])'))continue;
    try {
      if(!diagrams)throw new Error('The Mermaid runtime is unavailable.');
      const id='bive-diagram-'+(++diagramSerial);
      const {svg}=await diagrams.render(id,element.dataset.mermaid);
      if(version!==generation||!element.isConnected)return;
      element.innerHTML=svg;
      element.dataset.rendered='true';
    } catch(error) {
      if(element.isConnected)element.innerHTML=`<p class="diagram-error">Could not render this diagram. ${escape(error.message.split('\n')[0])} Its source is available below.</p>`;
    }
  }
}

function evidenceResult(cap,check) {
  if(!cap.evidence)return {status:'unchecked'};
  if(cap.evidence.stale||cap.evidence.changedDuringRun)return {status:'stale'};
  return cap.evidence.results.find(r=>r.id===check.id)??{status:'unchecked'};
}
const statusLabel = status => ({passing:'Passed',failing:'Failed',stale:'Needs a new run',unchecked:'Not run'})[status]??status;
function checksList(cap,checks) {
  return `<ul class="check-list">${checks.map(c=>{const r=evidenceResult(cap,c);return `<li><a href="${escape(checkUrl(cap,c))}">${escape(checkTitle(c))}</a><span class="check-status ${r.status==='failing'?'failing':''}">${escape(statusLabel(r.status))}</span></li>`;}).join('')}</ul>`;
}
function checksSection(cap,checks=cap.checks,rules=cap.rules) {
  const passing=checks.filter(c=>evidenceResult(cap,c).status==='passing');
  const attention=checks.filter(c=>evidenceResult(cap,c).status!=='passing');
  const gaps=rules.filter(r=>!cap.checks.some(c=>c.rules?.includes(r.id)));
  const summary=cap.evidence?`${passing.length} of ${checks.length} linked checks have current passing evidence.`:'No verification run recorded.';
  return `<section class="checks-section"><h2>Checks</h2><p class="section-note">${escape(summary)}${gaps.length?` ${gaps.length} ${gaps.length===1?'rule still needs':'rules still need'} a linked check.`:''}</p>${attention.length?disclosure('Needs attention · '+attention.length,checksList(cap,attention),true):''}${passing.length?disclosure('Passing checks · '+passing.length,checksList(cap,passing)):''}${gaps.length?disclosure('Rules without checks · '+gaps.length,`<ul class="check-list">${gaps.map(r=>`<li>${ruleLink(cap,r.id,cap.presentation?.ruleTitles?.[r.id]??clean(r.text.split('\n')[0]))}</li>`).join('')}</ul>`):''}${disclosure('Scope of this evidence','<p class="section-note">A passing run establishes what the linked tests observed. It does not cover every case or live model behaviour. Tracked source changes make the evidence stale.</p>'+(cap.gaps??[]).map(g=>`<p class="section-note">${escape(g)}</p>`).join(''))}</section>`;
}
function overview(cap) {
  return `<header><h1>${escape(cap.title??cap.id)}</h1><p class="description">${escape(cap.description??'Describe what this page loads, shows and lets the user do.')}</p>${cap.url?`<p class="feature-url"><span>URL</span><code>${escape(cap.url)}</code></p>`:''}</header><section id="api"><h2>API</h2>${orderedOperations(cap).map(op=>{
    const info=operationPresentation(cap,op);
    return `<article class="endpoint" data-operation="${escape(op.operationId)}"><h3 class="endpoint-heading">${method(op)}<a href="${escape(endpointUrl(cap,op))}">${escape(op.path)}</a></h3><p class="endpoint-summary">${escape(op.summary??op.operationId)}</p>${io(cap,op)}<p class="behaviour-preview"><b>Behaviour.</b> ${escape(info.behaviour??clean(rulesFor(cap,op)[0]?.text??'No behaviour rules linked yet.'))}</p></article>`;
  }).join('')}</section>${markdownDiagrams(cap.prose,'Play states')}${checksSection(cap)}`;
}
function errorSection(cap,op) {
  const errors=Object.entries(op.responses??{}).filter(([status])=>!/^2/.test(status));
  if(!errors.length)return '';
  const schema=errors.map(([,r])=>r.content?.['application/json']?.schema).find(Boolean);
  return `<section><h2>Errors</h2>${schema?objectSignature(cap,schema):''}<table class="table"><thead><tr><th>Status</th><th>Code</th><th>When</th></tr></thead><tbody>${errors.flatMap(([status,r])=>(r['x-error-codes']??[{code:'—',when:clean(r.description)}]).map(e=>`<tr><td>${escape(status)}</td><td><code>${escape(e.code)}</code></td><td>${escape(e.when)}${e.clause?' · '+ruleLink(cap,e.clause,'Rule',op):''}</td></tr>`)).join('')}</tbody></table></section>`;
}
function scenario(e) {
  return `<article class="scenario"><h3>${escape(e.title??e.id)}</h3>${['given','when','then'].map(k=>`<div class="scenario-line"><b>${k.charAt(0).toUpperCase()+k.slice(1)}</b><span>${prose(e[k])}</span></div>`).join('')}${e.request?disclosure('Payload example',raw({request:e.request,response:e.response})):''}</article>`;
}
function endpointPage(cap,op) {
  const info=operationPresentation(cap,op), rules=rulesFor(cap,op);
  const examples=cap.examples.filter(e=>(e.operations??[]).includes(op.operationId));
  const checks=cap.checks.filter(c=>(c.rules??[]).some(id=>rules.some(r=>r.id===id))||(c.examples??[]).some(id=>examples.some(e=>e.id===id)));
  const groups=info.ruleGroups??[], grouped=new Set(groups.flatMap(g=>g.rules));
  const ruleList=items=>`<ul class="rule-list">${items.map(r=>`<li id="${escape(r.id)}"><div class="rule-text">${prose(r.text)}</div><a class="rule-id" href="${escape(endpointUrl(cap,op,r.id))}">${escape(r.id)}</a></li>`).join('')}</ul>`;
  return `<a class="back" href="${escape(featureUrl(cap))}">← ${escape(cap.title??cap.id)}</a><header><h1 class="endpoint-title">${method(op)} ${escape(op.path)}</h1><p class="description">${escape(info.description??op.summary??op.operationId)}</p></header><div class="page-actions"><button class="text-button" data-copy-url>Copy page link</button></div>${io(cap,op)}<section><h2>Behaviour</h2>${info.behaviour?`<p class="description">${escape(info.behaviour)}</p>`:''}${ruleList(rules.filter(r=>!grouped.has(r.id)))}${groups.map(group=>disclosure(group.title,ruleList(rules.filter(r=>group.rules.includes(r.id))))).join('')}</section>${operationDiagrams(cap,op)}${errorSection(cap,op)}${examples.length?`<section><h2>Examples</h2>${examples.map(scenario).join('')}</section>`:''}${checksSection(cap,checks,rules)}${disclosure('Payload examples',raw({request:op.requestBody?.content?.['application/json']?.example,responses:Object.fromEntries(Object.entries(op.responses??{}).filter(([,r])=>r.content?.['application/json']?.example).map(([status,r])=>[status,r.content['application/json'].example]))}))}`;
}
function checkPage(cap,check) {
  const r=evidenceResult(cap,check), expected=new Set(check.testNames??[]);
  const observed=(r.tests??[]).filter(t=>expected.has(t.name)||t.type==='test:fail');
  return `<a class="back" href="${escape(featureUrl(cap))}">← ${escape(cap.title??cap.id)}</a><h1>${escape(checkTitle(check))}</h1><p class="section-note ${r.status==='failing'?'failing':''}">${escape(statusLabel(r.status))}</p>${r.status==='stale'?'<p class="description">The tracked sources changed. Run this check again to refresh its evidence.</p>':''}${r.error?`<p class="error">${escape(r.error)}</p>`:''}${r.missing?.length?`<p class="error">Expected tests did not run: ${escape(r.missing.join(', '))}</p>`:''}${r.stderr?disclosure('Error output',`<pre>${escape(r.stderr)}</pre>`,r.status==='failing'):''}${observed.length?disclosure('Observed tests',observed.map(t=>`<p class="section-note">${t.skip?'Skipped':t.type==='test:fail'?'Failed':'Passed'} · ${escape(t.name)}</p>`).join(''),r.status==='failing'):''}<h2>Behaviour checked</h2><ul class="check-list">${(check.rules??[]).map(id=>`<li>${ruleLink(cap,id,clean(cap.rules.find(x=>x.id===id)?.text.split('\n')[0]??id))}</li>`).join('')}</ul>${disclosure('Run details',raw({command:check.command,durationMs:r.durationMs,exitCode:r.exitCode}))}`;
}
function sourcesPage(cap) {
  return `<a class="back" href="${escape(featureUrl(cap))}">← ${escape(cap.title??cap.id)}</a><h1>Sources</h1><p class="description">The feature reads these existing contract files. Edit them in your editor or through your agent.</p><table class="table"><tbody>${Object.entries(cap.files).map(([kind,file])=>`<tr><td>${escape(kind)}</td><td class="source-path">${escape(file)}</td></tr>`).join('')}</tbody></table>${disclosure('Tracked implementation',raw(cap.sources))}${disclosure('Complete behaviour document',`<div class="rule-text">${prose(cap.prose)}</div>`+markdownDiagrams(cap.prose,'State diagram'))}${disclosure('System map',`<div class="rule-text">${prose(project.system)}</div>`+markdownDiagrams(project.system,'System diagram'))}${disclosure('Local commands','<pre>bive check\nbive verify --capability '+escape(cap.id)+'\nbive snapshot\nbive diff</pre>')}`;
}
function searchResults() {
  const found=[], matches=value=>JSON.stringify(value).toLowerCase().includes(query.toLowerCase());
  for(const cap of project.capabilities){
    if(matches([cap.title,cap.description,cap.url]))found.push({url:featureUrl(cap),title:cap.title,note:cap.description});
    for(const op of orderedOperations(cap))if(matches([op,operationPresentation(cap,op)]))found.push({url:endpointUrl(cap,op),title:op.method+' '+op.path,note:op.summary});
    for(const rule of cap.rules)if(matches([rule,cap.presentation?.ruleTitles?.[rule.id]])){
      const op=orderedOperations(cap).find(o=>operationRuleIds(cap,o).includes(rule.id));
      if(op)found.push({url:endpointUrl(cap,op,rule.id),title:cap.presentation?.ruleTitles?.[rule.id]??clean(rule.text.split('\n')[0]),note:op.method+' '+op.path});
    }
    for(const check of cap.checks)if(matches(check))found.push({url:checkUrl(cap,check),title:checkTitle(check),note:cap.title+' · check'});
    for(const example of cap.examples)if(matches(example)){
      const op=orderedOperations(cap).find(o=>(example.operations??[]).includes(o.operationId));
      if(op)found.push({url:endpointUrl(cap,op),title:example.title??example.id,note:op.method+' '+op.path+' · example'});
    }
  }
  return `<h1>Search</h1>${found.length?found.map(f=>`<article class="search-result"><a href="${escape(f.url)}">${escape(f.title)}</a><p>${escape(f.note)}</p></article>`).join(''):'<p class="empty">No matches.</p>'}`;
}
function render() {
  const version=++generation, state=route(),cap=state.cap;
  $('#project-name').textContent=project.name;
  $('#home').href=featureUrl(project.capabilities[0]);
  $('#features').innerHTML=project.capabilities.map(c=>`<a href="${escape(featureUrl(c))}" class="${c.id===cap.id?'active':''}"${c.id===cap.id?' aria-current="page"':''}>${escape(c.title??c.id)}</a>`).join('');
  $('#sources-link').href=featureUrl(cap)+'/sources';
  let body;
  if(query)body=searchResults();
  else if(state.kind==='api'){const op=cap.operations.find(o=>o.operationId===state.id);body=op?endpointPage(cap,op):`<a class="back" href="${escape(featureUrl(cap))}">← ${escape(cap.title)}</a><h1>Endpoint not found</h1>`;}
  else if(state.kind==='checks'){const check=cap.checks.find(c=>c.id===state.id);body=check?checkPage(cap,check):'<h1>Check not found</h1>';}
  else if(state.kind==='sources')body=sourcesPage(cap);
  else body=overview(cap);
  $('#content').innerHTML=body;
  const stale=cap.evidence?.stale||cap.evidence?.changedDuringRun;
  $('#freshness').textContent=stale?'Evidence needs a new run':cap.evidence?'Latest run · '+new Date(cap.evidence.finishedAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'No verification run recorded';
  $('#view-mode').textContent=embedded?'Exported snapshot':'Local workspace';
  $('#read-mode').textContent='Read-only';
  document.title=(state.kind==='api'?cap.operations.find(o=>o.operationId===state.id)?.path:cap.title??cap.id)+' · BIVE';
  if(state.rule&&!query){const target=document.getElementById(state.rule);for(let parent=target?.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;target?.scrollIntoView?.({block:'start'});}
  diagramQueue=diagramQueue.catch(()=>{}).then(()=>renderDiagrams(version));
  globalThis.biveReady=diagramQueue;
  return diagramQueue;
}
window.addEventListener('hashchange',()=>{query='';$('#search').value='';window.scrollTo?.({top:0});render();});
document.addEventListener('toggle',event=>{if(event.target.open&&event.target.querySelector('[data-mermaid]:not([data-rendered])')){diagramQueue=diagramQueue.catch(()=>{}).then(()=>renderDiagrams(generation));globalThis.biveReady=diagramQueue;}},true);
$('#search').addEventListener('input',event=>{query=event.target.value;render();});
document.addEventListener('keydown',event=>{if(event.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)){event.preventDefault();$('#search').focus();}});
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-copy-url]');if(!button)return;
  try{await navigator.clipboard.writeText(location.href);button.textContent='Link copied';}
  catch{button.textContent='Copy the address from your browser';}
});
async function refresh(initial=false) {
  try{
    if(embedded){project=embedded;await render();return;}
    let response=await fetch('/api/model');if(!response.ok)response=await fetch('./model.json');
    if(!response.ok)throw new Error('Could not load the project');
    const next=await response.json();if(next.error)throw new Error(next.error);
    const nextSignature=JSON.stringify(next);
    if(initial||nextSignature!==signature){project=next;signature=nextSignature;await render();}
  }catch(error){if(initial)$('#content').innerHTML=`<p class="error">${escape(error.message)}</p>`;else $('#freshness').textContent='Source read failed';}
}
await refresh(true);
if(!embedded)setInterval(()=>refresh(),4000);
