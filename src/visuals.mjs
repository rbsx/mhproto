import { readFile, writeFile, mkdir, realpath, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { parse, stringify } from 'yaml';

export const visualsFile = 'bive/visuals.yaml';
const queues = new Map();
export const mediaTypes = { 'image/png':'png', 'image/jpeg':'jpg', 'image/webp':'webp', 'image/gif':'gif', 'application/pdf':'pdf' };
export const maxMediaBytes = 8 * 1024 * 1024;
export function mediaMime(file) { return Object.entries(mediaTypes).find(([,ext])=>path.extname(file).slice(1).toLowerCase()===ext || (ext==='jpg'&&path.extname(file).toLowerCase()==='.jpeg'))?.[0]; }
export function safeDesignUrl(value) { try { const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password; } catch { return false; } }
function resolve(cap,schema) {
  let current=schema, seen=new Set();
  while(current?.$ref){if(seen.has(current.$ref))return {};seen.add(current.$ref);let value=cap.openapi;for(const part of current.$ref.slice(2).split('/'))value=value?.[part.replaceAll('~1','/').replaceAll('~0','~')];current=value;}
  return current??{};
}
function propertyAt(cap,schema,parts) {
  const s=resolve(cap,schema);if(!parts.length)return s;
  if(s.anyOf||s.oneOf||s.allOf)return (s.anyOf??s.oneOf??s.allOf).map(item=>propertyAt(cap,item,parts)).find(Boolean);
  const [part,...rest]=parts;
  const child=part==='*'?s.items:s.properties?.[part];
  return child?propertyAt(cap,child,rest):null;
}
export function targetError(project,target) {
  if(!target||typeof target!=='object')return 'Visual requires a target';
  const cap=project.capabilities.find(c=>c.id===target.capability);
  if(!cap)return 'Visual references an unknown feature';
  const op=cap.operations.find(o=>o.operationId===target.id);
  if(target.kind==='feature')return null;
  if(['operation','request','response','field'].includes(target.kind)){
    if(!op)return 'Visual references an unknown operation';
    if(target.kind==='response'&&target.status&&!op.responses?.[target.status])return 'Visual references an unknown response';
    if(target.kind==='field'){
      if(!['request','response'].includes(target.scope)||typeof target.path!=='string'||!target.path.startsWith('/'))return 'Field visual requires request/response scope and a JSON pointer';
      let schema;
      if(target.scope==='response')schema=op.responses?.[target.status??Object.keys(op.responses).find(s=>/^2/.test(s))]?.content?.['application/json']?.schema;
      else schema={type:'object',properties:{body:op.requestBody?.content?.['application/json']?.schema,...Object.fromEntries(['path','query','header','cookie'].map(location=>[location,{type:'object',properties:Object.fromEntries((op.parameters??[]).filter(p=>p.in===location).map(p=>[p.name,p.schema]))}]))}};
      if(!propertyAt(cap,schema,target.path.slice(1).split('/').map(p=>p.replaceAll('~1','/').replaceAll('~0','~'))))return 'Visual references an unknown field';
    }
    return null;
  }
  const items={schema:Object.keys(cap.openapi.components?.schemas??{}),example:cap.examples.map(e=>e.id),rule:cap.rules.map(r=>r.id),check:cap.checks.map(c=>c.id)};
  if(!items[target.kind])return 'Unsupported visual target';
  return items[target.kind].includes(target.id)?null:'Visual references an unknown '+target.kind;
}
async function destination(root,relative) {
  const base=await realpath(root),candidate=path.resolve(base,relative);
  if(!candidate.startsWith(base+path.sep))throw new Error('Visual path escapes project');
  const parent=path.dirname(candidate);
  let ancestor=parent;
  while(true){try{const actual=await realpath(ancestor);if(actual!==base&&!actual.startsWith(base+path.sep))throw new Error('Visual path escapes project through symlink');break;}catch(error){if(error.code!=='ENOENT')throw error;ancestor=path.dirname(ancestor);}}
  await mkdir(parent,{recursive:true});
  try{const actual=await realpath(candidate);if(!actual.startsWith(base+path.sep))throw new Error('Visual file escapes project');}catch(error){if(error.code!=='ENOENT')throw error;}
  return candidate;
}
export function validMedia(bytes,mime) {
  if(mime==='image/png')return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(mime==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(mime==='image/webp')return bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  if(mime==='image/gif')return /^GIF8[79]a$/.test(bytes.toString('ascii',0,6));
  return mime==='application/pdf'&&bytes.toString('ascii',0,5)==='%PDF-';
}
export async function addVisual(root,project,input) {
  const operation=async()=>{
    const error=targetError(project,input.target);if(error)throw new Error(error);
    if(typeof input.title!=='string'||!input.title.trim()||input.title.length>200)throw new Error('Visual requires a title (up to 200 characters)');
    const visual={id:randomUUID(),title:input.title.trim(),kind:input.url?'design':'screenshot',target:input.target};
    if(input.caption){if(typeof input.caption!=='string'||input.caption.length>1000)throw new Error('Caption is too long');visual.caption=input.caption;}
    let bytes;
    if(input.url){if(!safeDesignUrl(input.url))throw new Error('Design links must use HTTPS');visual.url=input.url;}
    else {
      const match=/^data:([^;]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(input.data??'');
      if(!match||!mediaTypes[match[1]])throw new Error('Use a PNG, JPEG, WebP, GIF or PDF');
      bytes=Buffer.from(match[2],'base64');if(!bytes.length||bytes.length>maxMediaBytes)throw new Error('Visual files must be between 1 byte and 8 MB');
      if(!validMedia(bytes,match[1]))throw new Error('Visual content does not match its media type');
      visual.mime=match[1];if(visual.mime==='application/pdf')visual.kind='design';
      visual.file=`bive/assets/${visual.id}.${mediaTypes[visual.mime]}`;
      visual.sha256=createHash('sha256').update(bytes).digest('hex');
    }
    const metadata=await destination(root,visualsFile);
    let entries=[];try{entries=parse(await readFile(metadata,'utf8'))?.visuals;if(!Array.isArray(entries))throw new Error('visuals.yaml requires a visuals array');}catch(error){if(error.code!=='ENOENT')throw error;}
    if(bytes)await writeFile(await destination(root,visual.file),bytes,{flag:'wx'});
    const temporary=await destination(root,visualsFile+'.'+randomUUID()+'.tmp');
    await writeFile(temporary,stringify({visuals:[...entries,visual]}),{flag:'wx'});await rename(temporary,metadata);
    return visual;
  };
  const previous=queues.get(root)??Promise.resolve();
  const task=previous.catch(()=>{}).then(operation);queues.set(root,task);
  try{return await task;}finally{if(queues.get(root)===task)queues.delete(root);}
}
