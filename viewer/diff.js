// Pure contract comparison, shared by the CLI, server and browser.
const unordered = new Set(['required','enum','type','rules','operations','examples','sources','testNames','x-mhproto-rules','x-clauses']);
export function canonical(value, key='') {
  if(Array.isArray(value)){
    const items=value.map(v=>canonical(v));
    return unordered.has(key)?items.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):items;
  }
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k],k)]));
  return value;
}
export function snapshotProject(value) {
  const wrapped=['mhproto-snapshot','bive-snapshot'].includes(value?.format);
  if(wrapped&&value.version!==1)throw new Error('Unsupported MHProto snapshot version.');
  const project=wrapped?value.project:value;
  if(!project||!Array.isArray(project.capabilities)||!project.capabilities.length||typeof project.name!=='string')throw new Error('Choose a MHProto snapshot JSON or exported preview HTML.');
  const ids=new Set();
  for(const cap of project.capabilities){
    if(!cap||typeof cap.id!=='string'||ids.has(cap.id)||!Array.isArray(cap.operations)||!Array.isArray(cap.rules)||!Array.isArray(cap.examples)||!Array.isArray(cap.checks)||!cap.openapi)throw new Error('The baseline does not contain a valid MHProto contract.');
    ids.add(cap.id);
  }
  return project;
}
export function contractSnapshot(value, {label='Iteration baseline',createdAt=new Date().toISOString()}={}) {
  const project=snapshotProject(value);
  // Detach nested schemas and visuals: later viewer edits must not move the baseline.
  return JSON.parse(JSON.stringify({format:'mhproto-snapshot',version:1,label,createdAt,project:{name:project.name,system:project.system??'',visuals:project.visuals??[],capabilities:project.capabilities.map(({evidence,digest,...cap})=>cap)}}));
}
const status = (a,b) => a===undefined?'added':b===undefined?'removed':'changed';
export function fieldChanges(before,after,path=[]) {
  if(JSON.stringify(canonical(before,path.at(-1)))===JSON.stringify(canonical(after,path.at(-1))))return [];
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
  if(object(before)&&object(after))return [...new Set([...Object.keys(before),...Object.keys(after)])].sort().flatMap(key=>fieldChanges(before[key],after[key],[...path,key]));
  return [{path,status:status(before,after),beforePresent:before!==undefined,afterPresent:after!==undefined,before:before??null,after:after??null}];
}
function behaviourText(text='') {
  let rule=false;
  return text.replaceAll('\r\n','\n').split('\n').filter(line=>{
    if(/^\s*-\s+\*\*[A-Z][A-Z0-9-]*-\d+\*\*/.test(line)){rule=true;return false;}
    if(rule&&/^\s{2,}\S/.test(line))return false;
    rule=false;return true;
  }).map(line=>line.trimEnd()).join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
export function compareModels(beforeValue,afterValue) {
  const before=snapshotProject(beforeValue),after=snapshotProject(afterValue),changes=[];
  const add=(capability,kind,id,a,b)=>{
    const fields=fieldChanges(a,b);
    if(fields.length)changes.push({capability,kind,id,status:status(a,b),before:a??null,after:b??null,fields});
  };
  const compare=(capability,kind,oldItems,newItems,key)=>{
    const oldMap=new Map(oldItems.map(x=>[x[key],x])),newMap=new Map(newItems.map(x=>[x[key],x]));
    for(const id of new Set([...oldMap.keys(),...newMap.keys()]))add(capability,kind,id,oldMap.get(id),newMap.get(id));
  };
  add(null,'system','system',{name:before.name,system:before.system??''},{name:after.name,system:after.system??''});
  const oldCaps=new Map(before.capabilities.map(c=>[c.id,c])),newCaps=new Map(after.capabilities.map(c=>[c.id,c]));
  const feature=cap=>{
    if(!cap)return undefined;
    const {operations,ruleTitles,...presentation}=cap.presentation??{};
    const {paths,components,...api}=cap.openapi,{schemas,...shared}=components??{};
    return {title:cap.title??cap.id,description:cap.description??'',url:cap.url??'',behaviour:behaviourText(cap.prose),api:{...api,components:shared},transitions:cap.transitions??[],nonTransitions:cap.nonTransitions??[],presentation,files:cap.files??{},sources:cap.sources??[],gaps:cap.gaps??[]};
  };
  const rules=cap=>(cap?.rules??[]).map(r=>({...r,title:cap.presentation?.ruleTitles?.[r.id]??r.id}));
  const operations=cap=>(cap?.operations??[]).map(op=>({...op,presentation:cap.presentation?.operations?.[op.operationId]??{}}));
  for(const id of new Set([...oldCaps.keys(),...newCaps.keys()])){
    const a=oldCaps.get(id),b=newCaps.get(id);
    add(id,'feature',id,feature(a),feature(b));
    compare(id,'rule',rules(a),rules(b),'id');
    compare(id,'operation',operations(a),operations(b),'operationId');
    compare(id,'example',a?.examples??[],b?.examples??[],'id');
    compare(id,'check',a?.checks??[],b?.checks??[],'id');
    compare(id,'schema',Object.entries(a?.openapi.components?.schemas??{}).map(([name,schema])=>({name,schema})),Object.entries(b?.openapi.components?.schemas??{}).map(([name,schema])=>({name,schema})),'name');
    compare(id,'visual',(before.visuals??[]).filter(v=>v.target?.capability===id),(after.visuals??[]).filter(v=>v.target?.capability===id),'id');
  }
  return changes;
}
