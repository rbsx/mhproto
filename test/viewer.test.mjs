import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { JSDOM } from 'jsdom';
import { packageRoot } from '../src/core.mjs';
import { model } from '../src/server.mjs';

async function fixture({change=()=>{},hash='',realMermaid=false}={}) {
  const root=await mkdtemp(path.join(os.tmpdir(),'bive-flow-'));
  execFileSync(process.execPath,[path.join(packageRoot,'bin/bive.mjs'),'init','--root',root,'--no-skills']);
  const project=await model(root),cap=project.capabilities[0];
  project.name='Example app';cap.url='/status';cap.description='Loads and displays the service status. Users may update it if authorised.';
  cap.rules.push({id:'EXAMPLE-B-2',text:'Only authorised users can update a service.'});
  cap.openapi.components={schemas:{
    Status:{type:'object',required:['status','owner'],properties:{status:{type:'string',enum:['ready','busy']},owner:{anyOf:[{$ref:'#/components/schemas/User'},{type:'null'}]}}},
    User:{type:'object',required:['id'],properties:{id:{type:'string',format:'uuid'},name:{type:'string'}}}
  }};
  cap.operations[0].responses['200'].content['application/json'].schema={$ref:'#/components/schemas/Status'};
  cap.operations.push({operationId:'setStatus',method:'POST',path:'/status/{id}',summary:'Update service status',rules:['EXAMPLE-B-2'],parameters:[{in:'path',name:'id',required:true,schema:{type:'string',format:'uuid'}}],requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['status','load'],properties:{status:{type:'string',enum:['ready','busy']},load:{type:'number',minimum:0,maximum:1}}}}}},responses:{'201':{description:'Updated',content:{'application/json':{schema:{$ref:'#/components/schemas/Status'}}}},'403':{description:'Permission denied','x-error-codes':[{code:'forbidden',when:'User cannot update this service',clause:'EXAMPLE-B-2'}]}}});
  cap.presentation={operations:{getStatus:{behaviour:'Returns the current service status.'},setStatus:{behaviour:'Requires permission to update.',diagrams:[{title:'Permission flow',source:'flowchart TD\n A["Request"] --> B{"Permission?"}\n B -->|Yes|C["Update"]\n B -->|No|D["403 forbidden"]'}]}}};
  cap.checks=[{id:'EXAMPLE-V-1',title:'Read status',command:['node','check.mjs'],rules:['EXAMPLE-B-1'],testNames:['status check']}];
  cap.evidence={finishedAt:'2026-10-02T09:00:00Z',stale:false,results:[{id:'EXAMPLE-V-1',status:'passing',tests:[{name:'status check',type:'test:pass'}]}]};
  change(project);
  const dom=new JSDOM(await readFile(path.join(packageRoot,'viewer/index.html'),'utf8'),{runScripts:'outside-only',url:'https://bive.test/'+hash});
  const {window}=dom,doc=window.document;window.scrollTo=()=>{};
  const element=doc.createElement('script');element.id='bive-model';element.type='application/json';element.textContent=JSON.stringify(project);doc.body.append(element);
  if(realMermaid){
    window.structuredClone=structuredClone;
    // SVG text measurement is approximate in JSDOM: tests assess parsing/rendering, not pixel layout.
    window.SVGElement.prototype.getBBox=function(){return {x:0,y:0,width:Math.max(30,(this.textContent??'').length*6),height:18};};
    window.SVGElement.prototype.getComputedTextLength=function(){return Math.max(30,(this.textContent??'').length*6);};
    await window.eval(await readFile(path.join(packageRoot,'viewer/vendor/mermaid.min.js'),'utf8'));
  } else window.mermaid={initialize:config=>window.mermaidConfig=config,render:async(id)=>({svg:`<svg id="${id}" xmlns="http://www.w3.org/2000/svg"></svg>`})};
  await window.eval(`(async()=>{${await readFile(path.join(packageRoot,'viewer/app.js'),'utf8')}\n})()`);
  const click=async selector=>{
    const item=doc.querySelector(selector);assert.ok(item,selector);
    if(item.tagName==='A'&&item.hash&&item.hash!==window.location.hash){
      const navigation=new Promise(resolve=>window.addEventListener('hashchange',resolve,{once:true}));item.click();await navigation;await window.biveReady;
    }else {item.click();await Promise.resolve();}
    return item;
  };
  return {dom,window,doc,click,project};
}

test('feature overview starts with API signatures and ends with checks, without tabs or modals',async()=>{
  const {dom,doc}=await fixture();
  assert.equal(doc.querySelector('#project-name').textContent,'Example app');
  assert.equal(doc.querySelector('#features a').textContent,'Example capability');
  assert.equal(doc.querySelector('.brand-mark').textContent,'[b]');
  assert.equal(doc.querySelector('main').firstElementChild.className,'search-row');
  assert.equal(doc.querySelector('h1').textContent,'Example capability');
  assert.equal(doc.querySelector('.feature-url code').textContent,'/status');
  assert.equal(doc.querySelectorAll('.endpoint').length,2);
  assert.equal(doc.querySelectorAll('.endpoint .io-grid').length,2);
  assert.equal(doc.querySelectorAll('#tabs,dialog,#breadcrumb').length,0);
  assert.ok(doc.querySelector('#api').compareDocumentPosition(doc.querySelector('.checks-section'))&dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(!doc.querySelector('#content').textContent.includes('Browse shared types'));
  dom.window.close();
});

test('endpoint opens a shareable page, direct navigation preserves it, and Back returns to the feature',async()=>{
  const {dom,doc,window,click}=await fixture();
  await click('.endpoint[data-operation="setStatus"] .endpoint-heading a');
  assert.equal(window.location.hash,'#/features/example/api/setStatus');
  assert.ok(doc.querySelector('h1').textContent.includes('/status/{id}'));
  assert.equal(doc.querySelectorAll('dialog').length,0);
  assert.ok(doc.querySelector('#EXAMPLE-B-2').textContent.includes('Only authorised users'));
  const direct=await fixture({hash:window.location.hash});
  assert.ok(direct.doc.querySelector('h1').textContent.includes('/status/{id}'));
  const copied=[];Object.defineProperty(window.navigator,'clipboard',{value:{writeText:async value=>copied.push(value)}});
  await click('[data-copy-url]');assert.equal(copied[0],window.location.href);
  await click('.back');assert.equal(window.location.hash,'#/features/example');
  assert.equal(doc.querySelectorAll('.endpoint').length,2);
  dom.window.close();direct.dom.window.close();
});

test('request constraints and nullable nested response objects stay inline in the endpoint',async()=>{
  const {dom,doc}=await fixture({hash:'#/features/example/api/setStatus'});
  const io=doc.querySelector('.io-grid');
  assert.ok(io.textContent.includes('Path'));
  assert.ok(io.textContent.includes('uuid'));
  assert.ok(io.textContent.includes('0–1'));
  assert.ok(io.textContent.includes('Response 201'));
  assert.ok(io.textContent.includes('"ready" | "busy"'));
  const owner=[...io.querySelectorAll('.inline-object')].find(d=>d.querySelector('summary').textContent.startsWith('owner:'));
  assert.ok(owner.querySelector('summary').textContent.includes('| null'));
  owner.open=true;
  assert.ok(owner.textContent.includes('id: string'));
  assert.ok(owner.textContent.includes('name?: string'));
  assert.equal(io.querySelectorAll('a').length,0);
  dom.window.close();
});

test('checks below API surface failures and gaps while the passing inventory stays closed',async()=>{
  const {dom,doc,click}=await fixture({change:project=>{
    const cap=project.capabilities[0];
    cap.checks.push({id:'EXAMPLE-V-2',title:'Update permission',rules:[],command:['node','other.mjs']});
    cap.evidence.results.push({id:'EXAMPLE-V-2',status:'failing',stderr:'Denied incorrectly',tests:[]});
  }});
  const section=doc.querySelector('.checks-section');
  assert.ok(section.textContent.includes('1 rule still needs'));
  assert.ok(section.querySelector('details[open]').textContent.includes('Update permission'));
  const passed=[...section.querySelectorAll('details')].find(d=>d.querySelector('summary').textContent==='Passing checks · 1');
  assert.ok(!passed.open);
  await click('.checks-section a[href$="EXAMPLE-V-2"]');
  assert.ok(doc.querySelector('details[open]').textContent.includes('Denied incorrectly'));
  dom.window.close();
});

test('stale checks require a new run and grouped rule deep links open their containing group',async()=>{
  const {dom,doc,click}=await fixture({hash:'#/features/example/api/setStatus?rule=EXAMPLE-B-2',change:p=>{
    p.capabilities[0].evidence.stale=true;
    p.capabilities[0].presentation.operations.setStatus.ruleGroups=[{title:'Permissions',rules:['EXAMPLE-B-2']}];
  }});
  assert.ok(doc.querySelector('#EXAMPLE-B-2').closest('details').open);
  await click('.back');
  assert.ok(doc.querySelector('.checks-section').textContent.includes('Needs a new run'));
  await click('.checks-section a[href$="EXAMPLE-V-1"]');
  assert.ok(doc.querySelector('#content').textContent.includes('Run this check again'));
  dom.window.close();
});

test('search leads to endpoint context, and Sources is a secondary page with real file paths',async()=>{
  const {dom,doc,window,click}=await fixture();
  const input=doc.querySelector('#search');input.value='authorised';input.dispatchEvent(new window.Event('input'));
  const result=doc.querySelector('.search-result a[href$="setStatus?rule=EXAMPLE-B-2"]');assert.ok(result);
  await click('.search-result a[href$="setStatus?rule=EXAMPLE-B-2"]');assert.ok(doc.querySelector('#EXAMPLE-B-2'));
  await click('#sources-link');
  assert.equal(doc.querySelector('h1').textContent,'Sources');
  assert.ok(doc.querySelector('.table').textContent.includes('bive/capabilities/example/examples.yaml'));
  assert.ok(!doc.querySelector('.table').textContent.includes('[object Object]'));
  assert.equal(doc.querySelectorAll('#content details[open]').length,0);
  dom.window.close();
});

test('Mermaid flow, state and sequence sources render to SVG using the actual bundled runtime',async()=>{
  const {dom,doc}=await fixture({realMermaid:true,hash:'#/features/example/api/setStatus',change:p=>{
    p.capabilities[0].presentation.operations.setStatus.diagrams.push(
      {title:'State flow',source:'stateDiagram-v2\n [*] --> ready\n ready --> ready: read\n ready --> busy: update\n busy --> ready: finish'},
      {title:'Request race',source:'sequenceDiagram\n participant Client\n participant API\n participant Store\n Client->>API: Update\n API->>Store: Save\n Store-->>API: State\n API-->>Client: Result'}
    );
  }});
  assert.equal(doc.querySelectorAll('.diagram-canvas[data-rendered="true"] svg').length,3);
  assert.ok(doc.querySelectorAll('.diagram-canvas')[0].textContent.includes('Permission?'));
  assert.ok(doc.querySelectorAll('.diagram-canvas')[1].textContent.includes('ready'));
  assert.ok(doc.querySelectorAll('.diagram-canvas')[2].textContent.includes('Store'));
  assert.equal(doc.querySelectorAll('.diagram-error').length,0);
  dom.window.close();
});

test('a bad diagram does not prevent reading the endpoint or its signatures',async()=>{
  const {dom,doc}=await fixture({realMermaid:true,hash:'#/features/example/api/setStatus',change:p=>p.capabilities[0].presentation.operations.setStatus.diagrams=[{title:'Broken',source:'not a valid diagram'}]});
  assert.ok(doc.querySelector('.diagram-error').textContent.includes('Could not render'));
  assert.ok(doc.querySelector('.diagram-source').textContent.includes('not a valid diagram'));
  assert.ok(doc.querySelector('.io-grid').textContent.includes('Response 201'));
  dom.window.close();
});
