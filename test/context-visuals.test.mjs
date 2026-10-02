import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { parse, stringify } from 'yaml';
import { packageRoot, loadProject, validateProject } from '../src/core.mjs';
import { contextPacket, encodeContext } from '../src/context.mjs';
import { addVisual, targetError } from '../src/visuals.mjs';
import { createHandler, exportViewer } from '../src/server.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4l8AAAAASUVORK5CYII=','base64');
const data='data:image/png;base64,'+png.toString('base64');
const target={capability:'example',kind:'response',id:'getStatus',status:'200'};
async function fixture(){const root=await mkdtemp(path.join(os.tmpdir(),'bive-visual-'));execFileSync(process.execPath,[path.join(packageRoot,'bin/bive.mjs'),'init','--root',root,'--no-skills']);return {root,project:await loadProject(root)};}
async function request(root,{method='GET',url='/api/model',origin,host='127.0.0.1:4317',body}={}){
  const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{method,url,headers:{host,origin,'content-type':'application/json'}});
  const result={status:200,headers:{}};
  const res={setHeader(k,v){result.headers[k]=v;},writeHead(s,h={}){result.status=s;Object.assign(result.headers,h);return this;},end(value){result.body=value;return this;}};
  await createHandler(root)(req,res);return result;
}
test('visual uploads and links persist by target without embedding bytes in the project model',async()=>{
  const {root,project}=await fixture();
  const [image,design]=await Promise.all([addVisual(root,project,{target,title:'Ready state',data}),addVisual(root,project,{target:{capability:'example',kind:'feature'},title:'Design',url:'https://www.figma.com/design/example'})]);
  const next=await loadProject(root);assert.equal(next.visuals.length,2);assert.equal(next.visuals[0].id,image.id);assert.equal(next.visuals[1].id,design.id);
  assert.deepEqual(await readFile(path.join(root,image.file)),png);
  assert.ok(!JSON.stringify(next).includes('base64'));
  assert.equal((await validateProject(next)).filter(i=>i.level==='error').length,0);
  const response=await request(root,{url:'/api/visuals/'+image.id});assert.equal(response.status,200);assert.equal(response.headers['content-type'],'image/png');assert.deepEqual(response.body,png);
  const out=path.join(root,'export');await exportViewer(root,out);
  assert.ok((await readFile(path.join(out,'viewer.html'),'utf8')).includes(data));
  assert.ok(!(await readFile(path.join(out,'model.json'),'utf8')).includes('base64'));
});
test('attachments reject invalid targets, disguised content, unsafe links and escaping asset paths',async()=>{
  const {root,project}=await fixture();
  assert.equal(targetError(project,{...target,kind:'field',scope:'response',path:'/status'}),null);
  assert.match(targetError(project,{...target,kind:'field',scope:'response',path:'/missing'}),/unknown field/);
  assert.match(targetError(project,{...target,status:'404'}),/unknown response/);
  await assert.rejects(addVisual(root,project,{target,title:'Fake',data:'data:image/png;base64,'+Buffer.from('<html>').toString('base64')}),/does not match/);
  await assert.rejects(addVisual(root,project,{target,title:'Link',url:'javascript:alert(1)'}),/HTTPS/);
  await assert.rejects(addVisual(root,project,{target:{...target,id:'missing'},title:'Link',url:'https://example.com'}),/unknown operation/);
  const outside=await mkdtemp(path.join(os.tmpdir(),'bive-outside-'));await symlink(outside,path.join(root,'bive/assets'));
  await assert.rejects(addVisual(root,project,{target,title:'Escape',data}),/escapes project/);
});
test('write endpoint requires same-origin JSON and persists a validated attachment',async()=>{
  const {root}=await fixture(),body={target,title:'Response',data};
  assert.equal((await request(root,{method:'POST',url:'/api/visuals',origin:'https://other.test',body})).status,403);
  assert.equal((await request(root,{method:'POST',url:'/api/visuals',body})).status,403);
  assert.equal((await request(root,{method:'POST',url:'/api/visuals',host:'other.test',origin:'http://other.test',body})).status,403);
  const valid=await request(root,{method:'POST',url:'/api/visuals',origin:'http://127.0.0.1:4317',body});assert.equal(valid.status,201);
  assert.equal((await loadProject(root)).visuals.length,1);
});
test('scoped context preserves exact behaviour, constraints and failures while deferring images, logs and nested types',async()=>{
  const {project}=await fixture(),cap=project.capabilities[0],op=cap.operations[0];
  cap.rules.push({id:'EXAMPLE-B-2',text:'Never reveal a private owner.'});
  cap.presentation={operations:{getStatus:{ruleGroups:[{title:'Privacy',rules:['EXAMPLE-B-2']}]}}};
  op['x-preconditions']=[{needs:'Service exists',check:'lookup()',fails:{status:404,code:'not_found',clause:'EXAMPLE-B-1'}}];
  op.responses['404']={description:'Not found','x-error-codes':[{code:'not_found',when:'Service missing',clause:'EXAMPLE-B-1'}]};
  op.responses['200'].content['application/json'].schema={type:'object',properties:{owner:{$ref:'#/components/schemas/Owner'}}};
  cap.openapi.components={schemas:{Owner:{type:'object',properties:{name:{type:'string',maxLength:100}}}}};
  cap.checks=[{id:'EXAMPLE-V-1',rules:['EXAMPLE-B-1'],command:['node','test']}];
  cap.evidence={stale:true,results:[{id:'EXAMPLE-V-1',status:'passing',stdout:'HUGE LOG'}]};
  project.visuals=[{id:'v1',title:'State',target,file:'bive/assets/state.png',mime:'image/png'}];
  const packet=contextPacket(project,{capability:cap.id,operation:op.operationId}),encoded=encodeContext(packet);
  assert.deepEqual(packet.behaviour.rules,[cap.rules[0]]);assert.equal(packet.behaviour.preconditions[0].needs,'Service exists');
  assert.deepEqual(packet.behaviour.deferredGroups[0].rules,['EXAMPLE-B-2']);assert.deepEqual(packet.referencedSchemas,['Owner']);
  assert.equal(packet.errors.cases[0].code,'not_found');assert.equal(packet.checks[0].status,'stale');
  assert.ok(!encoded.includes('HUGE LOG'));assert.ok(!encoded.includes('base64'));assert.ok(!encoded.includes('lookup()'));
  assert.deepEqual(contextPacket(project,{capability:cap.id,rule:'EXAMPLE-B-2'}).rule,cap.rules[1]);
  assert.equal(contextPacket(project,{schema:'Owner'}).schema.properties.name.maxLength,100);
  assert.throws(()=>encodeContext(packet,100),/No content was truncated/);
  assert.throws(()=>contextPacket(project,{operation:'missing'}),/Unknown operation/);
});
test('context CLI emits compact index and reports exact sizes separately',async()=>{
  const {root}=await fixture();
  const output=execFileSync(process.execPath,[path.join(packageRoot,'bin/bive.mjs'),'context','--root',root],{encoding:'utf8'});
  const packet=JSON.parse(output);assert.equal(packet.features.length,1);assert.ok(!output.includes('openapi'));
});
