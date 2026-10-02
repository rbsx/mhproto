import { compareModels, contractSnapshot, snapshotProject, canonical } from './diff.js';
const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const prose = value => escape(value).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
const raw = value => `<pre>${escape(JSON.stringify(value, null, 2))}</pre>`;
const embedded = $('#bive-model') ? JSON.parse($('#bive-model').textContent) : null;
const media = $('#bive-media') ? JSON.parse($('#bive-media').textContent) : {};
let previewChanged = false;
const disclosure = (title, body, open = false) => `<details class="disclosure"${open?' open':''}><summary>${escape(title)}</summary><div>${body}</div></details>`;
let project, signature, query = '', generation = 0, diagramSerial = 0, diagramQueue = Promise.resolve();
const featureUrl = cap => '#/features/'+encodeURIComponent(cap.id);
const endpointUrl = (cap, op, rule) => featureUrl(cap)+'/api/'+encodeURIComponent(op.operationId)+(rule?'?rule='+encodeURIComponent(rule):'');
const checkUrl = (cap, check) => featureUrl(cap)+'/checks/'+encodeURIComponent(check.id);
const typeUrl = (cap, entity) => featureUrl(cap)+'/types/'+encodeURIComponent(entity.id);
const typeLink = (cap, entity) => {const status=entityChange(cap,entity);return `<a class="type-link${status?' change-link '+status:''}" href="${escape(typeUrl(cap,entity))}"${status?` title="${escape(pascal(status))} type"`:''}>${escape(entity.name)}</a>`;};
const method = op => `<span class="method ${escape(op.method.toLowerCase())}">${escape(op.method)}</span>`;
const clean = value => String(value ?? '').replace(/`|\*\*/g,'');
const checkTitle = check => (check.title??check.id).replace(/^(?:[A-Z][A-Z0-9.-]+\s+)+/,'');
const target = (cap,kind,id,extra={}) => ({capability:cap.id,kind,...(id?{id}:{}),...extra});
const sameTarget = (a,b) => ['capability','kind','id','scope','status','path'].every(k=>String(a?.[k]??'')===String(b?.[k]??''));
// Attachment placement is owned by text/header components, never by schema rendering.
const attachmentPolicy = Object.freeze({
  feature:'text',operation:'text',rule:'text',example:'text',check:'text',
  request:'header',response:'header',
});
let attachmentOwners = new Set();
let entityIndex, entityProject;
let baseline=$('#bive-baseline')?JSON.parse($('#bive-baseline').textContent):null;
let baselineProject,baselineEntities,indexedBaseline,comparisonChanges=[],comparisonMap=new Map(),comparisonEnabled=false,comparisonError='',localBaseline=false,baselineReadOnly=false,comparisonFilter='all';
const changeKey = change => JSON.stringify([change.capability,change.kind,change.id]);
const changeUrl = change => '#/changes/'+encodeURIComponent(changeKey(change));
const changeFor = (cap,kind,id) => comparisonMap.get(JSON.stringify([cap?.id??null,kind,id]));
const changeBadge = change => comparisonEnabled&&change?`<a class="change-badge ${escape(change.status)}" href="${escape(changeUrl(change))}">${escape(pascal(change.status))}</a>`:'';
const baselineLabel = () => baseline?.label??'Saved baseline';
function updateComparison() {
  if(indexedBaseline!==baseline){baselineProject=baseline?snapshotProject(baseline):null;baselineEntities=baselineProject?buildEntityIndex(baselineProject):null;indexedBaseline=baseline;}
  comparisonChanges=baseline?compareModels(baseline,project):[];
  comparisonMap=new Map(comparisonChanges.map(c=>[changeKey(c),c]));
}
function entityChange(cap,entity) {
  if(!comparisonEnabled||!baselineEntities)return null;
  const old=baselineEntities.caps.get(cap.id)?.get(entity.id);
  return !old?'added':JSON.stringify(canonical(old.schema))!==JSON.stringify(canonical(entity.schema))?'changed':null;
}
const schemaName = schema => schema?.$ref?.match(/^#\/components\/schemas\/([^/]+)$/)?.[1]?.replaceAll('~1','/').replaceAll('~0','~');
const pascal = value => (String(value).match(/[A-Za-z0-9]+/g)??['Type']).map(s=>s[0].toUpperCase()+s.slice(1)).join('');
const pointer = value => String(value).replaceAll('~','~0').replaceAll('/','~1');
const rootKey = (cap,op,part,status='') => JSON.stringify([cap.id,op.operationId,part,status]);
function schemaChildren(s) {
  const children=Object.entries(s?.properties??{}).map(([name,schema])=>({schema,path:'/properties/'+pointer(name),name:pascal(name),field:name}));
  if(s?.items&&typeof s.items==='object')children.push({schema:s.items,path:'/items',name:'Item',field:'[]'});
  if(s?.additionalProperties&&typeof s.additionalProperties==='object')children.push({schema:s.additionalProperties,path:'/additionalProperties',name:'Value',field:'[key]'});
  for(const kind of ['anyOf','oneOf','allOf','prefixItems'])for(const [i,schema] of (s?.[kind]??[]).entries())children.push({schema,path:`/${kind}/${i}`,name:'Variant'+(i+1),field:''});
  return children;
}
// This index is derived from the current model in memory. No schema copies enter agent packets.
function buildEntityIndex(model) {
  const index={caps:new Map(),nodes:new Map(),roots:new Map(),usage:new Map(),entities:[]};
  const register=(cap,id,name,schema,source,derived=false)=>{
    const types=index.caps.get(cap.id),nodes=index.nodes.get(cap.id);
    if(types.has(id))return types.get(id);
    if(derived){const taken=new Set([...types.values()].map(e=>e.name));let n=1,base=name;while(taken.has(name))name=base+'Inline'+(n++===1?'':n-1);}
    const identity=(cap.files?.interface??cap.interface??cap.id)+'#'+id;
    if(!index.usage.has(identity))index.usage.set(identity,new Map());
    const entity={id,name,schema,source,derived,identity,capability:cap.id,references:new Map(),usages:index.usage.get(identity)};
    types.set(id,entity);if(schema&&typeof schema==='object')nodes.set(schema,entity);index.entities.push(entity);return entity;
  };
  const entityAt=(cap,schema)=>{const name=schemaName(schema);return name?index.caps.get(cap.id).get(name):index.nodes.get(cap.id).get(schema);};
  const discover=(cap,node,owner,path='',suffix='')=>{
    if(!node||typeof node!=='object'||node.$ref)return;
    let current=owner;
    if(path&&(node.properties||node.type==='object'||node.type?.includes?.('object')))current=register(cap,'@'+owner.id+path,owner.name+suffix,node,{kind:'inline',parent:owner.name,path},true);
    for(const child of schemaChildren(node))discover(cap,child.schema,current,current===owner?path+child.path:child.path,current===owner?suffix+child.name:child.name);
  };
  for(const cap of model.capabilities){
    index.caps.set(cap.id,new Map());index.nodes.set(cap.id,new WeakMap());
    for(const [name,schema] of Object.entries(cap.openapi.components?.schemas??{}))register(cap,name,name,schema,{kind:'schema',file:cap.files?.interface});
  }
  for(const cap of model.capabilities){
    for(const entity of [...index.caps.get(cap.id).values()])discover(cap,entity.schema,entity);
    for(const op of orderedOperations(cap)){
      const addRoot=(part,schema,label,source,status='')=>{
        if(!schema)return;
        const entity=entityAt(cap,schema)??register(cap,'@operation/'+op.operationId+'/'+part+(status?'/'+status:''),pascal(op.operationId)+label,schema,{...source,operationId:op.operationId},true);
        index.roots.set(rootKey(cap,op,part,status),{entity,cap,op,part,status});discover(cap,entity.schema,entity);
      };
      for(const location of ['path','query','header','cookie']){const params=(op.parameters??[]).filter(p=>p.in===location);if(params.length)addRoot(location,parameterSchema(params),pascal(location),{kind:'parameters',location});}
      addRoot('body',op.requestBody?.content?.['application/json']?.schema,'Body',{kind:'body'});
      for(const [status,r] of Object.entries(op.responses??{}))addRoot('response',r.content?.['application/json']?.schema,'Response'+pascal(status),{kind:'response',status},status);
    }
  }
  for(const entity of index.entities){
    const cap=model.capabilities.find(c=>c.id===entity.capability);
    const visit=(schema,path='')=>{
      const other=entityAt(cap,schema);
      if(other&&other!==entity){
        const ref=entity.references.get(other.identity)??{entity:other,fields:new Set()};ref.fields.add(path||'definition');entity.references.set(other.identity,ref);return;
      }
      if(schema?.$ref){const name=schemaName(schema);const ref=index.caps.get(cap.id).get(name);if(ref&&ref!==entity){entity.references.set(ref.identity,{entity:ref,fields:new Set([path||'definition'])});}return;}
      for(const child of schemaChildren(schema))visit(child.schema,path+(child.field==='[]'||child.field==='[key]'?child.field:child.field?(path?'.':'')+child.field:''));
    };
    visit(entity.schema);
  }
  for(const root of index.roots.values()){
    const role=root.part==='response'?'Response '+root.status:root.part==='body'?'JSON body':pascal(root.part),seen=new Set();
    const visit=entity=>{
      if(seen.has(entity.identity))return;seen.add(entity.identity);
      const key=JSON.stringify([root.cap.id,root.op.operationId]);
      const use=entity.usages.get(key)??{capability:root.cap.id,operationId:root.op.operationId,roles:new Set()};use.roles.add(role);entity.usages.set(key,use);
      for(const ref of entity.references.values())visit(ref.entity);
    };visit(root.entity);
  }
  return index;
}
function entityFor(cap,schema) { const name=schemaName(schema);return name?entityIndex.caps.get(cap.id)?.get(name):entityIndex.nodes.get(cap.id)?.get(schema); }
function rootEntity(cap,op,part,status='') { return entityIndex.roots.get(rootKey(cap,op,part,status))?.entity; }
function referencedSchemas(cap,schemas) {
  const names=new Set();
  const visit=node=>{
    if(!node||typeof node!=='object')return;
    const ref=node.$ref?.match(/^#\/components\/schemas\/(.+)$/)?.[1];
    if(ref){const name=ref.replaceAll('~1','/').replaceAll('~0','~');if(!names.has(name)){names.add(name);visit(cap.openapi.components?.schemas?.[name]);}}
    for(const [key,value] of Object.entries(node))if(key!=='$ref')visit(value);
  };
  visit(schemas);return names;
}
function visualsForSurface(t) {
  const cap=project.capabilities.find(c=>c.id===t.capability),op=cap.operations.find(o=>o.operationId===t.id);
  const schemas=t.kind==='request'?[op?.requestBody,...(op?.parameters??[])]:t.kind==='response'?op?.responses?.[t.status]:null;
  const names=referencedSchemas(cap,schemas);
  return (project.visuals??[]).filter(v=>sameTarget(v.target,t)||(
    ['request','response'].includes(t.kind)&&v.target.capability===t.capability&&(
      (v.target.kind==='field'&&v.target.id===t.id&&v.target.scope===t.kind&&(!v.target.status||String(v.target.status)===String(t.status)))||
      (v.target.kind==='schema'&&names.has(v.target.id))
    )
  ));
}
function visualGallery(t) {
  const visuals=visualsForSurface(t);
  return visuals.length?`<div class="visual-gallery">${visuals.map(v=>{
    const source=v.url||(embedded?media[v.id]:'/api/visuals/'+encodeURIComponent(v.id));
    const mime=v.mime??({'png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','webp':'image/webp','gif':'image/gif','pdf':'application/pdf'})[v.file?.split('.').pop().toLowerCase()];
    const image=v.file&&mime?.startsWith('image/')&&source;
    const context=v.target.kind==='field'?v.target.path:v.target.kind==='schema'?v.target.id:null;
    return `<figure class="visual">${context?`<span class="visual-context">${escape(context)}</span>`:''}<a href="${escape(source??'#')}" target="_blank" rel="noopener noreferrer"${embedded&&mime==='application/pdf'?` download="${escape(v.file.split('/').pop())}"`:''}>${image?`<img src="${escape(source)}" alt="${escape(v.title)}" loading="lazy">`:''}<span>${escape(v.title)}${v.url?' ↗':''}</span></a>${v.caption?`<figcaption>${escape(v.caption)}</figcaption>`:''}</figure>`;
  }).join('')}</div>`:'';
}
function attachmentBlock(t,content,{tag='p',className='',label=t.id??'feature'}={}) {
  const placement=attachmentPolicy[t.kind];
  if(!placement)throw new Error('No attachment control is permitted for '+t.kind);
  if((placement==='header')!==(tag==='h3'))throw new Error('Attachment control has an invalid placement');
  const key=JSON.stringify([t.capability,t.kind,t.id??'',t.scope??'',t.status??'',t.path??'']);
  // Repeated read-only text may link the same target; only its first surface owns editing.
  if(attachmentOwners.has(key))return `<${tag} class="${escape(className)}">${content}</${tag}>`;
  attachmentOwners.add(key);
  return `<div class="attachment-block" data-visual-target="${escape(JSON.stringify(t))}"><${tag} class="attachment-zone ${escape(className)}" data-attachment-zone>${content}<button class="text-button add-visual" data-add-visual aria-label="Attach visual to ${escape(label)}" title="Attach visual">+</button></${tag}>${visualGallery(t)}<div class="visual-editor" hidden></div></div>`;
}

function route() {
  const [pathname,params] = location.hash.slice(1).split('?');
  const parts = pathname.replace(/^\//,'').split('/').map(x=>{try{return decodeURIComponent(x);}catch{return x;}});
  // Older exported links still lead to the feature overview.
  const id = parts[0]==='features'?parts[1]:parts[0];
  const cap = project.capabilities.find(c=>c.id===id) ?? project.capabilities[0];
  return { cap, kind:parts[0]==='changes'?'changes':parts[0]==='features'?parts[2]:null, id:parts[0]==='changes'?parts[1]:parts[3], rule:new URLSearchParams(params).get('rule'), compare:new URLSearchParams(params).get('compare')==='1' };
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
  if(input?.$ref&&seen.has(input.$ref))return '{...}';
  const next=new Set(seen);if(input?.$ref)next.add(input.$ref);
  const s=resolveSchema(cap,input);
  if(s.const!==undefined)return JSON.stringify(s.const);
  if(s.enum)return s.enum.map(v=>JSON.stringify(v)).join(' | ');
  if(s.anyOf||s.oneOf)return (s.anyOf??s.oneOf).map(x=>typeLabel(cap,x,depth,next)).join(' | ');
  if(s.allOf)return s.allOf.map(x=>typeLabel(cap,x,depth,next)).join(' & ');
  if(s.type==='array')return `Array<${typeLabel(cap,s.items,depth+1,next)}>`;
  if(s.properties)return '{...}';
  const types=Array.isArray(s.type)?s.type:[s.type??'unknown'];
  return types.map(t=>t==='integer'?'number':t).join(' | ');
}
function typeMarkup(cap,input,seen=new Set(),includeEntity=true) {
  const entity=includeEntity?entityFor(cap,input):null,s=resolveSchema(cap,input),next=new Set(seen);
  if(input?.$ref)next.add(input.$ref);
  if(entity){
    const link=typeLink(cap,entity);
    if(input?.$ref&&seen.has(input.$ref))return link+' <span class="field-constraint">recursive</span>';
    if(s.properties||s.type==='object')return link+' <span class="object-pill">{...}</span>';
    if(s.type==='array')return link+` Array&lt;${typeMarkup(cap,s.items,next)}&gt;`;
    const objects=nestedObjects(cap,input,seen);
    return link+(objects.length?' <span class="object-pill">{...}</span>':'')+((s.anyOf??s.oneOf??[]).some(x=>x.type==='null')?' | null':'');
  }
  if(s.anyOf||s.oneOf)return (s.anyOf??s.oneOf).map(x=>typeMarkup(cap,x,next)).join(' | ');
  if(s.allOf)return s.allOf.map(x=>typeMarkup(cap,x,next)).join(' & ');
  if(s.type==='array')return `Array&lt;${typeMarkup(cap,s.items,next)}&gt;`;
  if(s.properties||s.type==='object')return '<span class="object-pill">{...}</span>';
  return escape(typeLabel(cap,s));
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
  if(input?.$ref&&seen.has(input.$ref))return [];
  const next=new Set(seen);if(input?.$ref)next.add(input.$ref);
  const s=resolveSchema(cap,input);
  if(s.properties)return [{schema:input,suffix:''}];
  if(s.type==='array')return nestedObjects(cap,s.items,next).map(item=>({...item,suffix:item.suffix+'[]'}));
  return (s.anyOf??s.oneOf??s.allOf??[]).flatMap(item=>nestedObjects(cap,item,next));
}
function objectSignature(cap,input,depth=0,seen=new Set(),root=null) {
  if(input?.$ref&&seen.has(input.$ref))return `<span class="field-type">${typeMarkup(cap,input,seen)}</span>`;
  const next=new Set(seen);if(input?.$ref)next.add(input.$ref);
  const s=resolveSchema(cap,input);
  const entity=root??entityFor(cap,input),name=depth===0&&entity?typeLink(cap,entity)+' ':'';
  if(!s.properties)return `<div class="signature">${name}${typeMarkup(cap,s,next,false)}</div>`;
  const oldCap=baselineProject?.capabilities.find(c=>c.id===cap.id),oldEntity=entity&&baselineEntities?.caps.get(cap.id)?.get(entity.id);
  const old=oldCap&&oldEntity?resolveSchema(oldCap,oldEntity.schema):null;
  const fields=Object.entries(s.properties).map(([name,p])=>{
    const resolved=resolveSchema(cap,p), optional=(s.required??[]).includes(name)?'':'?';
    const label=`<span class="field-name">${escape(name+optional)}:</span> <span class="field-type">${typeMarkup(cap,p,next)}</span>${constraint(resolved)}`;
    const status=comparisonEnabled&&old?(old.properties?.[name]===undefined?'added':JSON.stringify(canonical({schema:old.properties[name],required:(old.required??[]).includes(name)}))!==JSON.stringify(canonical({schema:p,required:(s.required??[]).includes(name)}))?'changed':null):comparisonEnabled&&baseline&&entity&&!oldEntity?'added':null;
    const attrs=status?` data-change="${status}" title="${pascal(status)} field"`:'';
    const marker=status?`<span class="field-change">${pascal(status)}</span>`:'';
    const objects=nestedObjects(cap,p,next);
    if(objects.length&&depth<7&&!(p.$ref&&next.has(p.$ref)))return `<details class="inline-object"${attrs}><summary>${label}${marker}</summary><div>${objects.map(obj=>objectSignature(cap,obj.schema,depth+1,next)).join('')}${resolved.description?`<p class="field-note">${escape(resolved.description)}</p>`:''}</div></details>`;
    return `<div class="field"${attrs}>${label};${marker}</div>`;
  }).join('');
  const removed=comparisonEnabled&&old?Object.entries(old.properties??{}).filter(([name])=>!Object.hasOwn(s.properties,name)).map(([name,p])=>`<div class="field" data-change="removed"><span class="field-name">${escape(name+((old.required??[]).includes(name)?'':'?'))}:</span> <span class="field-type">${escape(typeLabel(oldCap,p))}</span>;<span class="field-change">Removed</span></div>`).join(''):'';
  return `<div class="signature">${name}{<div class="signature-body">${fields}${removed}</div>}</div>`;
}
function parameterSchema(parameters) {
  return {type:'object',properties:Object.fromEntries(parameters.map(p=>[p.name,p.schema??{}])),required:parameters.filter(p=>p.required).map(p=>p.name)};
}
function requestSignature(cap,op) {
  const parts=[];
  for(const location of ['path','query','header','cookie']){
    const params=(op.parameters??[]).filter(p=>p.in===location);
    if(params.length){const entity=rootEntity(cap,op,location);parts.push(`<p class="request-part">${escape(location.charAt(0).toUpperCase()+location.slice(1))}</p>${objectSignature(cap,entity.schema,0,new Set(),entity)}`);}
  }
  const body=op.requestBody?.content?.['application/json']?.schema;
  if(body)parts.push(`<p class="request-part">JSON body${op.requestBody.required?'':' · optional'}</p>${objectSignature(cap,body,0,new Set(),rootEntity(cap,op,'body'))}`);
  return parts.join('')||'<div class="signature">No parameters or body.</div>';
}
function successResponse(op) { return Object.entries(op.responses??{}).find(([status])=>/^2\d\d$/.test(status))??Object.entries(op.responses??{})[0]??['—',{}]; }
function io(cap,op) {
  const [status,res]=successResponse(op);
  return `<div class="io-grid"><section>${attachmentBlock(target(cap,'request',op.operationId),'Request',{tag:'h3',className:'io-heading',label:'Request'})}${requestSignature(cap,op)}</section><section>${attachmentBlock(target(cap,'response',op.operationId,{status}),`Response <strong>${escape(status)}</strong>`,{tag:'h3',className:'io-heading',label:'Response '+status})}${res.content?.['application/json']?.schema?objectSignature(cap,res.content['application/json'].schema,0,new Set(),rootEntity(cap,op,'response',status)):'<div class="signature">No response body.</div>'}</section></div>`;
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
  return `<header><h1>${escape(cap.title??cap.id)}</h1>${attachmentBlock(target(cap,'feature'),escape(cap.description??'Describe what this page loads, shows and lets the user do.'),{className:'description',label:cap.title??cap.id})}${cap.url?`<p class="feature-url"><span>URL</span><code>${escape(cap.url)}</code></p>`:''}</header><section id="api"><h2>API</h2>${orderedOperations(cap).map(op=>{
    const info=operationPresentation(cap,op);
    return `<article class="endpoint" data-operation="${escape(op.operationId)}"><h3 class="endpoint-heading">${method(op)}<a href="${escape(endpointUrl(cap,op))}">${escape(op.path)}</a></h3>${attachmentBlock(target(cap,'operation',op.operationId),escape(op.summary??op.operationId),{className:'endpoint-summary',label:op.path})}${io(cap,op)}<p class="behaviour-preview"><b>Behaviour.</b> ${escape(info.behaviour??clean(rulesFor(cap,op)[0]?.text??'No behaviour rules linked yet.'))}</p></article>`;
  }).join('')}</section>${markdownDiagrams(cap.prose,'Play states')}${checksSection(cap)}`;
}
function errorSection(cap,op) {
  const errors=Object.entries(op.responses??{}).filter(([status])=>!/^2/.test(status));
  if(!errors.length)return '';
  const schema=errors.map(([,r])=>r.content?.['application/json']?.schema).find(Boolean);
  return `<section><h2>Errors</h2>${schema?objectSignature(cap,schema):''}<table class="table"><thead><tr><th>Status</th><th>Code</th><th>When</th></tr></thead><tbody>${errors.flatMap(([status,r])=>(r['x-error-codes']??[{code:'—',when:clean(r.description)}]).map(e=>`<tr><td>${escape(status)}</td><td><code>${escape(e.code)}</code></td><td>${escape(e.when)}${e.clause?' · '+ruleLink(cap,e.clause,'Rule',op):''}</td></tr>`)).join('')}</tbody></table></section>`;
}
function scenario(cap,e) {
  return `<article class="scenario"><h3>${escape(e.title??e.id)}</h3>${attachmentBlock(target(cap,'example',e.id),['given','when','then'].map(k=>`<div class="scenario-line"><b>${k.charAt(0).toUpperCase()+k.slice(1)}</b><span>${prose(e[k])}</span></div>`).join(''),{tag:'div',className:'scenario-text',label:e.title??e.id})}${e.request?disclosure('Payload example',raw({request:e.request,response:e.response})):''}</article>`;
}
function endpointPage(cap,op) {
  const info=operationPresentation(cap,op), rules=rulesFor(cap,op);
  const examples=cap.examples.filter(e=>(e.operations??[]).includes(op.operationId));
  const checks=cap.checks.filter(c=>(c.rules??[]).some(id=>rules.some(r=>r.id===id))||(c.examples??[]).some(id=>examples.some(e=>e.id===id)));
  const groups=info.ruleGroups??[], grouped=new Set(groups.flatMap(g=>g.rules));
  const ruleList=items=>`<ul class="rule-list">${items.map(r=>`<li id="${escape(r.id)}">${attachmentBlock(target(cap,'rule',r.id),prose(r.text),{tag:'div',className:'rule-text',label:r.id})}<a class="rule-id" href="${escape(endpointUrl(cap,op,r.id))}">${escape(r.id)}</a></li>`).join('')}</ul>`;
  return `<a class="back" href="${escape(featureUrl(cap))}">← ${escape(cap.title??cap.id)}</a><header><h1 class="endpoint-title">${method(op)} ${escape(op.path)}</h1>${attachmentBlock(target(cap,'operation',op.operationId),escape(info.description??op.summary??op.operationId),{className:'description',label:op.path})}</header><div class="page-actions"><button class="text-button" data-copy-url>Copy page link</button></div>${io(cap,op)}<section><h2>Behaviour</h2>${info.behaviour?`<p class="description">${escape(info.behaviour)}</p>`:''}${ruleList(rules.filter(r=>!grouped.has(r.id)))}${groups.map(group=>disclosure(group.title,ruleList(rules.filter(r=>group.rules.includes(r.id))))).join('')}</section>${operationDiagrams(cap,op)}${errorSection(cap,op)}${examples.length?`<section><h2>Examples</h2>${examples.map(e=>scenario(cap,e)).join('')}</section>`:''}${checksSection(cap,checks,rules)}${disclosure('Payload examples',raw({request:op.requestBody?.content?.['application/json']?.example,responses:Object.fromEntries(Object.entries(op.responses??{}).filter(([,r])=>r.content?.['application/json']?.example).map(([status,r])=>[status,r.content['application/json'].example]))}))}`;
}
function checkPage(cap,check) {
  const r=evidenceResult(cap,check), expected=new Set(check.testNames??[]);
  const observed=(r.tests??[]).filter(t=>expected.has(t.name)||t.type==='test:fail');
  return `<a class="back" href="${escape(featureUrl(cap))}">← ${escape(cap.title??cap.id)}</a><h1>${escape(checkTitle(check))}</h1>${attachmentBlock(target(cap,'check',check.id),escape(statusLabel(r.status)),{className:'section-note '+(r.status==='failing'?'failing':''),label:checkTitle(check)})}${r.status==='stale'?'<p class="description">The tracked sources changed. Run this check again to refresh its evidence.</p>':''}${r.error?`<p class="error">${escape(r.error)}</p>`:''}${r.missing?.length?`<p class="error">Expected tests did not run: ${escape(r.missing.join(', '))}</p>`:''}${r.stderr?disclosure('Error output',`<pre>${escape(r.stderr)}</pre>`,r.status==='failing'):''}${observed.length?disclosure('Observed tests',observed.map(t=>`<p class="section-note">${t.skip?'Skipped':t.type==='test:fail'?'Failed':'Passed'} · ${escape(t.name)}</p>`).join(''),r.status==='failing'):''}<h2>Behaviour checked</h2><ul class="check-list">${(check.rules??[]).map(id=>`<li>${ruleLink(cap,id,clean(cap.rules.find(x=>x.id===id)?.text.split('\n')[0]??id))}</li>`).join('')}</ul>${disclosure('Run details',raw({command:check.command,durationMs:r.durationMs,exitCode:r.exitCode}))}`;
}
function entityPage(cap,entity) {
  const source=entity.source,op=cap.operations.find(o=>o.operationId===source.operationId);
  const context=entity.derived?source.kind==='parameters'?`${pascal(source.location)} parameters for ${op.method} ${op.path}.`:source.kind==='body'?`JSON request body for ${op.method} ${op.path}.`:source.kind==='response'?`Response ${source.status} for ${op.method} ${op.path}.`:`Object inside ${source.parent}.`:entity.schema.description;
  const groups=project.capabilities.flatMap(feature=>{
    const uses=[...entity.usages.values()].filter(u=>u.capability===feature.id);
    if(!uses.length)return [];
    return `<section class="type-usage-group"><h3><a href="${escape(featureUrl(feature))}">${escape(feature.title??feature.id)} overview</a></h3><ul class="type-usage-list">${orderedOperations(feature).filter(o=>uses.some(u=>u.operationId===o.operationId)).map(o=>{const use=uses.find(u=>u.operationId===o.operationId);return `<li>${method(o)}<a href="${escape(endpointUrl(feature,o))}">${escape(o.path)}</a><span class="section-note">${escape([...use.roles].join(' · '))}</span></li>`;}).join('')}</ul></section>`;
  }).join('');
  const parents=entityIndex.entities.filter(e=>e.identity!==entity.identity&&e.references.has(entity.identity));
  return `<a class="back" href="${escape(featureUrl(cap))}">← ${escape(cap.title??cap.id)}</a><header><h1>${escape(entity.name)}</h1>${context?`<p class="description">${escape(context)}</p>`:''}</header><div class="page-actions"><button class="text-button" data-copy-url>Copy page link</button></div>${objectSignature(cap,entity.schema,0,new Set(),entity)}${entity.derived?'':visualGallery(target(cap,'schema',entity.id))}<section><h2>Used in</h2>${groups||'<p class="section-note">No API endpoint currently uses this type.</p>'}</section>${parents.length?`<section><h2>Referenced by types</h2><ul class="type-parent-list">${parents.map(parent=>{const feature=project.capabilities.find(c=>c.id===parent.capability),fields=[...parent.references.get(entity.identity).fields];return `<li>${typeLink(feature,parent)}<span class="section-note">${escape(fields.join(', '))}${feature.id!==cap.id?' · '+escape(feature.title??feature.id):''}</span></li>`;}).join('')}</ul></section>`:''}<p class="type-source section-note">${entity.derived?'Name derived for this view from its existing structure.':'Defined in '+escape(cap.files.interface)+' · '+escape(entity.id)}</p>`;
}
function sourcesPage(cap) {
  return `<a class="back" href="${escape(featureUrl(cap))}">← ${escape(cap.title??cap.id)}</a><h1>Sources</h1><p class="description">The feature reads these existing contract files. Edit them in your editor or through your agent.</p><table class="table"><tbody>${Object.entries(cap.files).map(([kind,file])=>`<tr><td>${escape(kind)}</td><td class="source-path">${escape(file)}</td></tr>`).join('')}</tbody></table>${disclosure('Tracked implementation',raw(cap.sources))}${disclosure('Complete behaviour document',`<div class="rule-text">${prose(cap.prose)}</div>`+markdownDiagrams(cap.prose,'State diagram'))}${disclosure('System map',`<div class="rule-text">${prose(project.system)}</div>`+markdownDiagrams(project.system,'System diagram'))}${disclosure('Local commands','<pre>bive check\nbive verify --capability '+escape(cap.id)+'\nbive snapshot\nbive diff</pre>')}`;
}
const kindLabel = kind => ({feature:'Feature',operation:'API',schema:'Type',rule:'Behaviour',example:'Example',check:'Check',visual:'Visual',system:'System'})[kind]??kind;
function changeTitle(c) {
  const value=c.after??c.before;
  return c.kind==='operation'?value.method+' '+value.path:c.kind==='rule'?value.title===c.id?clean(value.text.split('\n')[0]):value.title:c.kind==='schema'?c.id:value.title??(c.kind==='system'?'System and project':c.id);
}
function currentChangeUrl(c) {
  if(c.status==='removed')return null;
  const cap=project.capabilities.find(x=>x.id===c.capability);if(!cap)return featureUrl(project.capabilities[0])+'/sources';
  if(c.kind==='operation'){const op=cap.operations.find(o=>o.operationId===c.id);return op&&endpointUrl(cap,op);}
  if(c.kind==='schema'){const entity=entityIndex.caps.get(cap.id).get(c.id);return entity&&typeUrl(cap,entity);}
  if(c.kind==='check')return checkUrl(cap,{id:c.id});
  if(c.kind==='rule'||c.kind==='example'){
    const ids=c.kind==='example'?c.after.operations:undefined,op=orderedOperations(cap).find(o=>ids?ids.includes(o.operationId):operationRuleIds(cap,o).includes(c.id));
    return op?endpointUrl(cap,op,c.kind==='rule'?c.id:undefined):featureUrl(cap)+'/sources';
  }
  if(c.kind==='visual'){
    const t=c.after.target;if(['operation','request','response','field'].includes(t.kind)){const op=cap.operations.find(o=>o.operationId===t.id);if(op)return endpointUrl(cap,op);}
    if(t.kind==='schema'){const entity=entityIndex.caps.get(cap.id).get(t.id);if(entity)return typeUrl(cap,entity);}
    if(t.kind==='check')return checkUrl(cap,{id:t.id});
  }
  return featureUrl(cap);
}
const fieldPath = path => path.length?path.map(k=>k==='schema'?'Definition':k==='presentation'?'Page behaviour':k).join(' → '):'Definition';
function comparisonSetup() {
  return `<details class="disclosure baseline-picker"${!baseline?' open':''}><summary>${baseline?'Change baseline':'Choose where this iteration starts'}</summary><div><label class="baseline-file">Compare with an earlier snapshot or preview<input id="baseline-file" type="file" accept=".json,.html,application/json,text/html"></label><p class="section-note">The selected file stays in this viewer. It is never executed.</p><button class="text-button" data-start-iteration${baselineReadOnly?' disabled':''}>Use current spec as baseline</button><p class="section-note">${baselineReadOnly?'Viewing a saved iteration. Start the viewer without --against to save a new baseline.':embedded?'Save preview to keep this baseline with the exported file.':'Saves .bive/baseline.json for the local workspace.'}</p></div></details><p class="comparison-error error" role="status">${escape(comparisonError)}</p>`;
}
function changesPage(id) {
  const changed=id?comparisonMap.get(id):null;
  if(id&&!changed)return '<a class="back" href="#/changes">← Changes</a><h1>Change not found</h1><p class="description">This item is unchanged against the selected baseline. Open Changes to see the current comparison.</p>';
  if(changed){
    const url=currentChangeUrl(changed),format=(value,present)=>!present?'—':typeof value==='string'?value:JSON.stringify(value,null,2);
    const rows=changed.fields.map(f=>`<tr><th scope="row">${escape(fieldPath(f.path))}<span class="field-change">${escape(pascal(f.status))}</span></th><td><pre>${escape(format(f.before,f.beforePresent))}</pre></td><td><pre>${escape(format(f.after,f.afterPresent))}</pre></td></tr>`).join('');
    return `<a class="back" href="#/changes">← Changes</a><h1>${escape(changeTitle(changed))}</h1><p class="section-note">${escape(pascal(changed.status))} · ${escape(kindLabel(changed.kind))} · ${escape(baselineLabel())} → Current spec</p><div class="page-actions"><button class="text-button" data-copy-url>Copy page link</button>${url?`<a href="${escape(url)}">Open current ${escape(kindLabel(changed.kind).toLowerCase())}</a>`:'<span class="section-note">Removed from the current spec.</span>'}</div><div class="diff-table-wrap"><table class="table diff-table"><thead><tr><th>Field</th><th>Before</th><th>Now</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  const counts=['added','changed','removed'].map(s=>comparisonChanges.filter(c=>c.status===s).length+' '+s).join(' · ');
  const filtered=comparisonChanges.filter(c=>comparisonFilter==='all'||c.kind===comparisonFilter);
  const groups=[...new Set(filtered.map(c=>c.capability))].map(id=>{
    const cap=project.capabilities.find(c=>c.id===id)??baselineProject?.capabilities.find(c=>c.id===id);
    return `<section class="changes-group"><h2>${escape(cap?.title??cap?.id??'Project')}</h2><ul class="changes-list">${filtered.filter(c=>c.capability===id).map(c=>`<li><span class="change-status ${escape(c.status)}">${escape(pascal(c.status))}</span><div><a href="${escape(changeUrl(c))}">${escape(changeTitle(c))}</a><span class="change-kind">${escape(kindLabel(c.kind))}</span><p class="section-note">${escape(c.status==='changed'?c.fields.slice(0,2).map(f=>fieldPath(f.path)).join(' · ')+(c.fields.length>2?' · '+(c.fields.length-2)+' more':''):c.status==='added'?'New in this iteration.':'Present in the baseline.')}</p></div></li>`).join('')}</ul></section>`;
  }).join('');
  return `<h1>Changes</h1><p class="description">${baseline?escape(baselineLabel())+' → Current spec':'Save the current spec before editing, or choose an earlier snapshot to compare.'}</p>${baseline?.createdAt?`<p class="section-note">Baseline saved ${escape(new Date(baseline.createdAt).toLocaleString())}</p>`:''}${baseline?`<p class="change-counts">${counts}</p><div class="page-actions"><button class="text-button" data-copy-url>Copy page link</button><button class="text-button" data-download-snapshot>Download current snapshot</button></div>`:''}${comparisonSetup()}${baseline&&comparisonChanges.length?`<label class="changes-filter">Show <select id="changes-filter">${['all','operation','schema','rule','feature','example','check','visual','system'].map(k=>`<option value="${k}"${comparisonFilter===k?' selected':''}>${k==='all'?'All changes':escape(kindLabel(k))}</option>`).join('')}</select></label>${groups||'<p class="empty">No changes in this category.</p>'}`:baseline?'<p class="empty">No spec changes since this baseline.</p>':''}`;
}
function comparisonBar() {
  return comparisonEnabled&&baseline?`<div class="comparison-bar"><span>Comparing with ${escape(baselineLabel())}</span><a href="#/changes">${comparisonChanges.length} changes</a><button class="text-button" data-exit-comparison>Hide highlights</button></div>`:'';
}
function decorateComparison(state) {
  if(!comparisonEnabled||!baseline||state.kind==='changes'||query)return;
  const cap=state.cap,pageChange=state.kind==='api'?changeFor(cap,'operation',state.id):state.kind==='types'?changeFor(cap,'schema',state.id):state.kind==='checks'?changeFor(cap,'check',state.id):!state.kind?changeFor(cap,'feature',cap.id):null;
  if(pageChange)$('#content h1')?.insertAdjacentHTML('beforeend',changeBadge(pageChange));
  for(const article of document.querySelectorAll('.endpoint[data-operation]'))article.querySelector('.endpoint-heading')?.insertAdjacentHTML('beforeend',changeBadge(changeFor(cap,'operation',article.dataset.operation)));
  for(const rule of cap.rules)document.getElementById(rule.id)?.querySelector('.rule-id')?.insertAdjacentHTML('afterend',changeBadge(changeFor(cap,'rule',rule.id)));
  for(const link of document.querySelectorAll('.check-list>li>a')){const id=decodeURIComponent(link.hash.split('/checks/')[1]??'');if(id)link.insertAdjacentHTML('afterend',changeBadge(changeFor(cap,'check',id)));}
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
    for(const entity of entityIndex.caps.get(cap.id).values())if(matches([entity.name,entity.schema.description]))found.push({url:typeUrl(cap,entity),title:entity.name,note:'Type · '+(cap.title??cap.id)});
  }
  return `<h1>Search</h1>${found.length?found.map(f=>`<article class="search-result"><a href="${escape(f.url)}">${escape(f.title)}</a><p>${escape(f.note)}</p></article>`).join(''):'<p class="empty">No matches.</p>'}`;
}
function render() {
  attachmentOwners=new Set();
  if(entityProject!==project){entityIndex=buildEntityIndex(project);entityProject=project;}
  const version=++generation, state=route(),cap=state.cap;
  comparisonEnabled=state.compare||state.kind==='changes';updateComparison();
  $('#project-name').textContent=project.name;
  $('#home').href=featureUrl(project.capabilities[0]);
  $('#features').innerHTML=project.capabilities.map(c=>`<a href="${escape(featureUrl(c))}" class="${c.id===cap.id?'active':''}"${c.id===cap.id?' aria-current="page"':''}>${escape(c.title??c.id)}</a>`).join('');
  $('#sources-link').href=featureUrl(cap)+'/sources';
  $('#changes-link').textContent='Changes'+(baseline?' · '+comparisonChanges.length:'');
  let body;
  if(query)body=searchResults();
  else if(state.kind==='changes')body=changesPage(state.id);
  else if(state.kind==='api'){const op=cap.operations.find(o=>o.operationId===state.id);body=op?endpointPage(cap,op):`<a class="back" href="${escape(featureUrl(cap))}">← ${escape(cap.title)}</a><h1>Endpoint not found</h1>`;}
  else if(state.kind==='checks'){const check=cap.checks.find(c=>c.id===state.id);body=check?checkPage(cap,check):'<h1>Check not found</h1>';}
  else if(state.kind==='types'){const entity=entityIndex.caps.get(cap.id).get(state.id);body=entity?entityPage(cap,entity):`<a class="back" href="${escape(featureUrl(cap))}">← ${escape(cap.title??cap.id)}</a><h1>Type not found</h1>`;}
  else if(state.kind==='sources')body=sourcesPage(cap);
  else body=overview(cap);
  $('#content').innerHTML=(state.kind==='changes'?'':comparisonBar())+body;decorateComparison(state);
  if(comparisonEnabled&&baseline)for(const a of document.querySelectorAll('a[href^="#/features/"]')){
    const [pathname,params]=a.getAttribute('href').split('?'),search=new URLSearchParams(params);search.set('compare','1');a.setAttribute('href',pathname+'?'+search);
  }
  const stale=cap.evidence?.stale||cap.evidence?.changedDuringRun;
  $('#freshness').textContent=stale?'Evidence needs a new run':cap.evidence?'Latest run · '+new Date(cap.evidence.finishedAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'No verification run recorded';
  $('#view-mode').textContent=embedded?'Exported snapshot':'Local workspace';
  $('#read-mode').textContent=previewChanged?'Added to this preview · save to keep':embedded?'Snapshot · visuals can be attached':'Visuals save to the workspace';
  $('#save-preview').hidden=!previewChanged;
  document.title=(state.kind==='changes'?'Changes':state.kind==='api'?cap.operations.find(o=>o.operationId===state.id)?.path:state.kind==='types'?entityIndex.caps.get(cap.id).get(state.id)?.name??'Type not found':cap.title??cap.id)+' · BIVE';
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
  if(event.target.closest('[data-exit-comparison]')){
    const [pathname,params]=location.hash.split('?'),search=new URLSearchParams(params);search.delete('compare');location.hash=pathname+(search.size?'?'+search:'');return;
  }
  if(event.target.closest('[data-download-snapshot]')){downloadFile('bive-snapshot.json',JSON.stringify(contractSnapshot(project,{label:project.name+' snapshot'}),null,2),'application/json');return;}
  const start=event.target.closest('[data-start-iteration]');
  if(start){
    const task=async()=>{
      start.disabled=true;comparisonError='';
      try{
        if(embedded){baseline=contractSnapshot(project);previewChanged=true;}
        else {const response=await fetch('/api/baseline',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});const value=await response.json();if(!response.ok)throw new Error(value.error??'Could not save the baseline');baseline=value;}
        localBaseline=false;await render();
      }catch(error){comparisonError=error.message;await render();}
    };globalThis.biveComparisonReady=task();return;
  }
  const add=event.target.closest('[data-add-visual]');
  if(add){
    const slot=add.closest('[data-visual-target]'),editor=slot.querySelector(':scope > .visual-editor');
    editor.hidden=false;add.hidden=true;
    editor.innerHTML=`<form class="visual-form"><label>Title<input name="title" required maxlength="200" placeholder="What this visual explains"></label><label>Screenshot or design file<input name="file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"></label><p class="section-note">PNG, JPEG, WebP, GIF or PDF · up to 8 MB</p><label>Or design link<input name="url" type="url" placeholder="https://…"></label><label>Note <span class="section-note">optional</span><input name="caption" maxlength="1000" placeholder="State, version or source"></label><div class="visual-actions"><button class="text-button" type="submit">Attach</button><button class="text-button" type="button" data-cancel-visual>Cancel</button></div><p class="visual-message section-note" role="status"></p></form>`;
    editor.querySelector('[name=title]').focus();return;
  }
  const cancel=event.target.closest('[data-cancel-visual]');
  if(cancel){const slot=cancel.closest('[data-visual-target]'),add=slot.querySelector(':scope > [data-attachment-zone] > [data-add-visual]');slot.querySelector(':scope > .visual-editor').hidden=true;add.hidden=false;add.focus();return;}
  const button=event.target.closest('[data-copy-url]');if(!button)return;
  try{await navigator.clipboard.writeText(location.href);button.textContent='Link copied';}
  catch{button.textContent='Copy the address from your browser';}
});
function downloadFile(name,content,type) {
  const link=document.createElement('a'),url=URL.createObjectURL(new Blob([content],{type}));link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
document.addEventListener('change',event=>{
  if(event.target.id==='changes-filter'){comparisonFilter=event.target.value;render();return;}
  if(event.target.id!=='baseline-file')return;
  const file=event.target.files[0];if(!file)return;
  const task=async()=>{
    try{
      if(file.size>16*1024*1024)throw new Error('Choose a snapshot or preview up to 16 MB.');
      const text=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read the baseline'));reader.readAsText(file);});
      const parsed=text.trimStart().startsWith('<')?JSON.parse(new DOMParser().parseFromString(text,'text/html').querySelector('#bive-model')?.textContent??'null'):JSON.parse(text);
      const next=contractSnapshot(parsed,{label:parsed?.label??file.name,createdAt:parsed?.createdAt??null});
      buildEntityIndex(snapshotProject(next));baseline=next;localBaseline=true;comparisonError='';if(embedded)previewChanged=true;await render();
    }catch(error){comparisonError=error instanceof SyntaxError?'Could not read a BIVE baseline from this file.':error.message;await render();}
  };globalThis.biveComparisonReady=task();
});
const readData = file => new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read this file'));reader.readAsDataURL(file);});
function mediaValid(data) {
  const match=/^data:([^;]+);base64,(.+)$/.exec(data??'');if(!match)return false;
  const s=atob(match[2]);
  return ({'image/png':()=>s.startsWith('\x89PNG\r\n\x1a\n'),'image/jpeg':()=>s.startsWith('\xff\xd8\xff'),'image/webp':()=>s.startsWith('RIFF')&&s.slice(8,12)==='WEBP','image/gif':()=>/^GIF8[79]a/.test(s),'application/pdf':()=>s.startsWith('%PDF-')}[match[1]])?.()??false;
}
document.addEventListener('submit',event=>{
  if(!event.target.matches('.visual-form'))return;
  event.preventDefault();const form=event.target,slot=form.closest('[data-visual-target]');
  const task=async()=>{
    const message=form.querySelector('.visual-message'),button=form.querySelector('[type=submit]');button.disabled=true;
    try{
      const file=form.elements.file.files[0],url=form.elements.url.value.trim();
      if(Boolean(file)===Boolean(url))throw new Error('Choose one file or one design link.');
      if(url){let parsed;try{parsed=new URL(url);}catch{}if(parsed?.protocol!=='https:'||parsed.username||parsed.password)throw new Error('Use an HTTPS design link.');}
      if(file&&(file.size===0||file.size>8*1024*1024))throw new Error('Choose a file up to 8 MB.');
      const data=file?await readData(file):undefined;
      if(file&&!mediaValid(data))throw new Error('Use a valid PNG, JPEG, WebP, GIF or PDF.');
      const input={target:JSON.parse(slot.dataset.visualTarget),title:form.elements.title.value.trim(),caption:form.elements.caption.value.trim(),...(url?{url}:{data})};
      if(!input.title||input.title.length>200)throw new Error('Give the visual a title.');
      if(embedded){
        const id=globalThis.crypto?.randomUUID?.()??'visual-'+Date.now()+'-'+Math.random().toString(36).slice(2);
        const mime=file?.type,ext=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','application/pdf':'pdf'})[mime];
        const visual={id,title:input.title,caption:input.caption,target:input.target,kind:url||mime==='application/pdf'?'design':'screenshot',...(url?{url}:{file:'preview/assets/'+id+'.'+ext,mime})};
        (project.visuals??=[]).push(visual);if(data)media[id]=data;previewChanged=true;await render();
      }else{
        const response=await fetch('/api/visuals',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
        const result=await response.json();if(!response.ok)throw new Error(result.error??'Could not attach the visual');
        await refresh(true);
      }
    }catch(error){message.textContent=error.message;message.classList.add('error');button.disabled=false;}
  };
  globalThis.biveAttachmentReady=task();
});
$('#save-preview').addEventListener('click',()=>{
  const copy=document.documentElement.cloneNode(true),safe=value=>JSON.stringify(value).replaceAll('<','\\u003c');
  copy.querySelector('#bive-model').textContent=safe(project);
  let registry=copy.querySelector('#bive-media');if(!registry){registry=document.createElement('script');registry.id='bive-media';registry.type='application/json';copy.querySelector('#bive-model').after(registry);}
  registry.textContent=safe(media);copy.querySelector('#content').textContent='Loading…';copy.querySelector('#features').textContent='';copy.querySelector('#save-preview').hidden=true;
  let baselineNode=copy.querySelector('#bive-baseline');if(!baselineNode){baselineNode=document.createElement('script');baselineNode.id='bive-baseline';baselineNode.type='application/json';copy.querySelector('#bive-model').after(baselineNode);}baselineNode.textContent=safe(baseline);
  const link=document.createElement('a'),url=URL.createObjectURL(new Blob(['<!doctype html>\n'+copy.outerHTML],{type:'text/html'}));
  link.href=url;link.download='bive-preview.html';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
async function refresh(initial=false) {
  try{
    if(embedded){project=embedded;await render();return;}
    let response=await fetch('/api/model');if(!response.ok)response=await fetch('./model.json');
    if(!response.ok)throw new Error('Could not load the project');
    const next=await response.json();if(next.error)throw new Error(next.error);
    let nextBaseline=baseline;
    if(!localBaseline){const r=await fetch('/api/baseline');if(r.ok){nextBaseline=await r.json();baselineReadOnly=r.headers.get('x-bive-baseline-readonly')==='true';}else if(r.status===404){const fallback=await fetch('./baseline.json');if(fallback.ok)nextBaseline=await fallback.json();else if(initial)nextBaseline=null;}else throw new Error('Could not read the comparison baseline');}
    if(nextBaseline)snapshotProject(nextBaseline);
    const nextSignature=JSON.stringify([next,nextBaseline]);
    if(initial||nextSignature!==signature){project=next;baseline=nextBaseline;signature=nextSignature;await render();}
  }catch(error){if(initial)$('#content').innerHTML=`<p class="error">${escape(error.message)}</p>`;else $('#freshness').textContent='Source read failed';}
}
await refresh(true);
if(!embedded)setInterval(()=>refresh(),4000);
