import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { JSDOM } from 'jsdom';
import { packageRoot } from '../src/core.mjs';
import { model } from '../src/server.mjs';
import { contractSnapshot } from '../viewer/diff.js';
async function viewerCode() {
  const [app,diff]=await Promise.all(['app.js','diff.js'].map(name=>readFile(path.join(packageRoot,'viewer',name),'utf8')));
  return app.replace("import { compareModels, contractSnapshot, snapshotProject, canonical } from './diff.js';",()=>diff.replace(/^export /gm,''));
}

async function fixture({change=()=>{},hash='',realMermaid=false,baseline=false}={}) {
  const root=await mkdtemp(path.join(os.tmpdir(),'mhproto-flow-'));
  execFileSync(process.execPath,[path.join(packageRoot,'bin/mhproto.mjs'),'init','--root',root,'--no-skills']);
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
  const before=JSON.parse(JSON.stringify(project));change(project);
  const dom=new JSDOM(await readFile(path.join(packageRoot,'viewer/index.html'),'utf8'),{runScripts:'outside-only',url:'https://mhproto.test/'+hash});
  const {window}=dom,doc=window.document;window.scrollTo=()=>{};
  const style=doc.createElement('style');style.textContent=await readFile(path.join(packageRoot,'viewer/style.css'),'utf8');doc.head.append(style);
  const element=doc.createElement('script');element.id='mhproto-model';element.type='application/json';element.textContent=JSON.stringify(project);doc.body.append(element);
  if(baseline){const node=doc.createElement('script');node.id='mhproto-baseline';node.type='application/json';node.textContent=JSON.stringify(contractSnapshot(before,{label:'Before this iteration',createdAt:'2026-10-01T10:00:00Z'}));doc.body.append(node);}
  if(realMermaid){
    window.structuredClone=structuredClone;
    // SVG text measurement is approximate in JSDOM: tests assess parsing/rendering, not pixel layout.
    window.SVGElement.prototype.getBBox=function(){return {x:0,y:0,width:Math.max(30,(this.textContent??'').length*6),height:18};};
    window.SVGElement.prototype.getComputedTextLength=function(){return Math.max(30,(this.textContent??'').length*6);};
    await window.eval(await readFile(path.join(packageRoot,'viewer/vendor/mermaid.min.js'),'utf8'));
  } else window.mermaid={initialize:config=>window.mermaidConfig=config,render:async(id)=>({svg:`<svg id="${id}" xmlns="http://www.w3.org/2000/svg"></svg>`})};
  await window.eval(`(async()=>{${await viewerCode()}\n})()`);
  const click=async selector=>{
    const item=doc.querySelector(selector);assert.ok(item,selector);
    if(item.tagName==='A'&&item.hash&&item.hash!==window.location.hash){
      const navigation=new Promise(resolve=>window.addEventListener('hashchange',resolve,{once:true}));item.click();await navigation;await window.mhprotoReady;
    }else {item.click();await Promise.resolve();}
    return item;
  };
  return {dom,window,doc,click,project};
}

test('feature overview starts with API signatures and ends with checks, without tabs or modals',async()=>{
  const {dom,doc}=await fixture();
  assert.equal(doc.querySelector('#project-name').textContent,'Example app');
  assert.equal(doc.querySelector('#features a').textContent,'Example capability');
  assert.equal(doc.querySelector('.brand-mark').textContent,'[mh]');
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

test('Changes lists semantic edits, opens a stable before/now page and links to the affected type',async()=>{
  const options={baseline:true,change:p=>{p.capabilities[0].openapi.components.schemas.User.properties.avatar={type:'string'};}};
  const {dom,doc,window,click}=await fixture(options);
  assert.equal(doc.querySelectorAll('[data-change]').length,0,'Reading mode stays uncluttered');
  await click('#changes-link');assert.equal(doc.querySelector('h1').textContent,'Changes');
  assert.equal(doc.querySelectorAll('.changes-list>li').length,1);
  assert.ok(doc.querySelector('.changes-list').textContent.includes('User'));
  assert.equal(doc.querySelectorAll('[data-add-visual]').length,0);
  const directHash=doc.querySelector('.changes-list a').hash;await click('.changes-list a');
  assert.ok(doc.querySelector('.diff-table').textContent.includes('avatar'));
  assert.ok(doc.querySelector('.diff-table thead').textContent.includes('Before'));
  const direct=await fixture({...options,hash:directHash});assert.equal(direct.doc.querySelector('h1').textContent,'User');
  await click('.page-actions a');assert.equal(window.location.hash,'#/features/example/types/User?compare=1');
  assert.ok(doc.querySelector('[data-change=added]').textContent.includes('avatar'));
  assert.ok(doc.querySelector('.comparison-bar'));assert.ok(doc.querySelector('.change-badge'));
  dom.window.close();direct.dom.window.close();
});

test('comparison highlights added, changed and removed fields without adding object attachment controls',async()=>{
  const {dom,doc,window,click}=await fixture({baseline:true,hash:'#/features/example/api/setStatus?compare=1&rule=EXAMPLE-B-2',change:p=>{
    const user=p.capabilities[0].openapi.components.schemas.User;user.required=[];delete user.properties.name;user.properties.avatar={type:'string'};
    p.capabilities[0].operations[1].requestBody.content['application/json'].schema.properties.load.minimum=0.2;
  }});
  assert.ok(doc.querySelector('.io-grid [data-change=added]').textContent.includes('avatar'));
  assert.ok(doc.querySelector('.io-grid [data-change=removed]').textContent.includes('name'));
  assert.ok([...doc.querySelectorAll('.io-grid [data-change=changed]')].some(n=>n.textContent.includes('id?')));
  assert.equal(doc.querySelectorAll('.signature [data-add-visual]').length,0);
  assert.equal(doc.querySelectorAll('.io-grid>.section').length,0);
  assert.equal(doc.querySelectorAll('.io-heading>[data-add-visual]').length,2);
  await click('[data-exit-comparison]');await new Promise(resolve=>window.setTimeout(resolve,0));await window.mhprotoReady;
  assert.ok(window.location.hash.includes('rule=EXAMPLE-B-2'));assert.ok(!window.location.hash.includes('compare='));
  assert.equal(doc.querySelectorAll('[data-change],.change-badge,.comparison-bar').length,0);
  dom.window.close();
});

test('removed endpoints remain reviewable, and category filtering does not hide their change details',async()=>{
  const {dom,doc,window,click}=await fixture({baseline:true,hash:'#/changes',change:p=>{
    p.capabilities[0].operations.pop();p.capabilities[0].openapi.components.schemas.User.properties.avatar={type:'string'};
  }});
  const select=doc.querySelector('#changes-filter');select.value='operation';select.dispatchEvent(new window.Event('change',{bubbles:true}));
  assert.equal(doc.querySelectorAll('.changes-list>li').length,1);assert.ok(doc.querySelector('.changes-list').textContent.includes('Removed'));
  await click('.changes-list a');assert.ok(doc.querySelector('.diff-table').textContent.includes('/status/{id}'));
  assert.equal(doc.querySelectorAll('.page-actions a').length,0);assert.ok(doc.querySelector('.page-actions').textContent.includes('Removed'));
  dom.window.close();
});

test('baseline picker reads earlier HTML without executing it and preserves the comparison on invalid input',async()=>{
  const {dom,doc,window}=await fixture({hash:'#/changes'});
  const old=JSON.parse(JSON.stringify(JSON.parse(doc.querySelector('#mhproto-model').textContent)));old.capabilities[0].openapi.components.schemas.User.properties.previous={type:'string'};
  const choose=async(content,name)=>{
    const input=doc.querySelector('#baseline-file');Object.defineProperty(input,'files',{value:[new window.File([content],name)],configurable:true});
    input.dispatchEvent(new window.Event('change',{bubbles:true}));await window.mhprotoComparisonReady;
  };
  await choose('<script>window.wasExecuted=true</script><script id="mhproto-model" type="application/json">'+JSON.stringify(old)+'</script>','previous.html');
  assert.equal(window.wasExecuted,undefined);assert.equal(doc.querySelectorAll('.changes-list>li').length,1);
  assert.ok(doc.querySelector('#content').textContent.includes('previous.html'));
  await choose('{"name":"not a contract"}','invalid.json');
  assert.equal(doc.querySelectorAll('.changes-list>li').length,1);assert.ok(doc.querySelector('.comparison-error').textContent.includes('MHProto'));
  dom.window.close();
});

test('starting an iteration and saving the exported preview retains the baseline and clean comparison',async()=>{
  const {dom,doc,window,click}=await fixture({hash:'#/changes'});
  await click('[data-start-iteration]');await window.mhprotoComparisonReady;
  assert.ok(doc.querySelector('.empty').textContent.includes('No spec changes'));
  assert.equal(doc.querySelector('#save-preview').hidden,false);
  let saved;window.URL.createObjectURL=blob=>{saved=blob;return 'blob:preview';};window.URL.revokeObjectURL=()=>{};window.HTMLAnchorElement.prototype.click=function(){};
  await click('#save-preview');
  const html=await new Promise(resolve=>{const reader=new window.FileReader();reader.onload=()=>resolve(reader.result);reader.readAsText(saved);});
  const reload=new JSDOM(html,{runScripts:'outside-only',url:'https://mhproto.test/#/changes'});
  const baseline=JSON.parse(reload.window.document.querySelector('#mhproto-baseline').textContent);assert.equal(baseline.format,'mhproto-snapshot');assert.equal(baseline.project.capabilities[0].evidence,undefined);
  reload.window.mermaid={initialize(){},render:async()=>({svg:'<svg></svg>'})};reload.window.scrollTo=()=>{};
  await reload.window.eval(`(async()=>{${await viewerCode()}\n})()`);
  assert.ok(reload.window.document.querySelector('.empty').textContent.includes('No spec changes'));dom.window.close();reload.window.close();
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
  assert.equal(owner.querySelector('.object-pill').textContent,'{...}');
  assert.ok(!owner.querySelector('summary').textContent.includes('name'));
  owner.open=true;
  assert.ok(owner.textContent.includes('id: string'));
  assert.ok(owner.textContent.includes('name?: string'));
  assert.ok(io.querySelector('a.type-link[href$="/types/Status"]'));
  assert.ok(owner.querySelector('a.type-link[href$="/types/User"]'));
  dom.window.close();
});

test('named types link from inline signatures to a shareable definition and every endpoint using them',async()=>{
  const {dom,doc,window,click}=await fixture({hash:'#/features/example/api/setStatus'});
  const owner=[...doc.querySelectorAll('.inline-object')].find(d=>d.querySelector('summary').textContent.startsWith('owner:'));
  assert.equal(owner.querySelector('a.type-link').textContent,'User');assert.ok(!owner.open);
  await click('.inline-object > summary a[href$="/types/User"]');
  assert.ok(!owner.open,'Following a type link does not expand the object');
  assert.equal(window.location.hash,'#/features/example/types/User');assert.equal(doc.querySelector('h1').textContent,'User');
  assert.ok(doc.querySelector('.signature').textContent.includes('name?: string'));
  assert.equal(doc.querySelectorAll('.type-usage-list a').length,2);
  assert.ok(doc.querySelector('.type-usage-list a[href$="/api/getStatus"]'));
  assert.ok(doc.querySelector('.type-usage-list a[href$="/api/setStatus"]'));
  assert.ok(doc.querySelector('.type-parent-list a[href$="/types/Status"]'));
  assert.equal(doc.querySelectorAll('[data-add-visual],dialog').length,0);
  const direct=await fixture({hash:window.location.hash});assert.equal(direct.doc.querySelector('h1').textContent,'User');
  await click('.type-parent-list a[href$="/types/Status"]');assert.equal(doc.querySelector('h1').textContent,'Status');
  await click('.type-usage-list a[href$="/api/setStatus"]');assert.ok(doc.querySelector('h1').textContent.includes('/status/{id}'));
  dom.window.close();direct.dom.window.close();
});

test('unnamed query and body structures receive linked labels without conflating them with declared types',async()=>{
  const change=p=>{
    const cap=p.capabilities[0];
    cap.operations[0].parameters=[{in:'query',name:'date',required:true,schema:{type:'string'}},{in:'query',name:'deviceId',required:false,schema:{type:'string'}}];
    cap.openapi.components.schemas.GetStatusQuery={type:'object',properties:{unrelated:{type:'boolean'}}};
  };
  const {dom,doc,window,click}=await fixture({change});
  const query=doc.querySelector('.endpoint[data-operation="getStatus"] .io-grid a.type-link');
  assert.equal(query.textContent,'GetStatusQueryInline');assert.ok(query.hash.includes('%40operation%2FgetStatus%2Fquery'));
  const directHash=query.hash;await click('.endpoint[data-operation="getStatus"] .io-grid a.type-link');
  assert.equal(doc.querySelector('h1').textContent,'GetStatusQueryInline');assert.ok(doc.querySelector('.signature').textContent.includes('deviceId?: string'));
  assert.ok(doc.querySelector('.type-source').textContent.includes('Name derived'));
  const direct=await fixture({hash:directHash,change});assert.equal(direct.doc.querySelector('h1').textContent,'GetStatusQueryInline');
  await click('.type-usage-list a');assert.equal(window.location.hash,'#/features/example/api/getStatus');
  dom.window.close();direct.dom.window.close();
});

test('array item entities and enum types have definitions and nested usage backlinks',async()=>{
  const {dom,doc,click}=await fixture({hash:'#/features/example/api/setStatus',change:p=>{
    const cap=p.capabilities[0];
    cap.openapi.components.schemas.Phase={type:'string',enum:['ready','busy']};
    cap.openapi.components.schemas.Status.properties.phase={$ref:'#/components/schemas/Phase'};
    cap.openapi.components.schemas.Status.properties.history={type:'array',items:{type:'object',required:['at'],properties:{at:{type:'string',format:'date-time'}}}};
  }});
  const history=[...doc.querySelectorAll('.inline-object')].find(d=>d.querySelector('summary').textContent.startsWith('history'));
  assert.ok(history.querySelector('summary').textContent.includes('Array<StatusHistoryItem {...}>'));
  await click('.inline-object>summary a[href*="%40Status%2Fproperties%2Fhistory%2Fitems"]');
  assert.equal(doc.querySelector('h1').textContent,'StatusHistoryItem');assert.ok(doc.querySelector('.signature').textContent.includes('date-time'));
  assert.equal(doc.querySelectorAll('.type-usage-list a').length,2);
  assert.ok(doc.querySelector('.type-parent-list').textContent.includes('history[]'));
  await click('.type-parent-list a[href$="/types/Status"]');await click('.signature a[href$="/types/Phase"]');
  assert.equal(doc.querySelector('h1').textContent,'Phase');assert.ok(doc.querySelector('.signature').textContent.includes('"ready" | "busy"'));
  assert.equal(doc.querySelectorAll('.type-usage-list a').length,2);dom.window.close();
});

test('recursive type references terminate while keeping definitions and endpoint backlinks reachable',async()=>{
  const {dom,doc,click}=await fixture({hash:'#/features/example/api/setStatus',change:p=>{
    const cap=p.capabilities[0];cap.openapi.components.schemas.Node={type:'object',properties:{value:{type:'string'},next:{anyOf:[{$ref:'#/components/schemas/Node'},{type:'null'}]},children:{type:'array',items:{$ref:'#/components/schemas/Node'}}}};
    cap.operations[1].responses['201'].content['application/json'].schema={$ref:'#/components/schemas/Node'};
  }});
  assert.ok(doc.querySelector('.io-grid').textContent.includes('recursive'));
  await click('.io-grid a[href$="/types/Node"]');assert.equal(doc.querySelector('h1').textContent,'Node');
  assert.ok(doc.querySelector('.signature').textContent.includes('value?: string'));
  assert.equal(doc.querySelectorAll('.type-usage-list a').length,1);assert.ok(doc.querySelector('.type-usage-list a[href$="/api/setStatus"]'));
  assert.ok(doc.querySelectorAll('.signature .inline-object').length<5);dom.window.close();
});

test('shared interface types link across features while equally named types in another interface stay separate',async()=>{
  const {dom,doc}=await fixture({hash:'#/features/example/types/User',change:p=>{
    const same=structuredClone(p.capabilities[0]);same.id='second';same.title='Second screen';
    const other=structuredClone(p.capabilities[0]);other.id='unrelated';other.title='Another API';other.files.interface='another.openapi.json';
    p.capabilities.push(same,other);
  }});
  assert.equal(doc.querySelectorAll('.type-usage-group').length,2);
  assert.equal(doc.querySelectorAll('.type-usage-list a').length,4);
  assert.ok(doc.querySelector('.type-usage-group a[href="#/features/second"]'));
  assert.ok(!doc.querySelector('.type-usage-group a[href*="unrelated"]'));
  assert.ok(doc.querySelector('.type-parent-list a[href="#/features/second/types/Status"]'));
  dom.window.close();
});

test('type search opens a definition and a missing type keeps a way back to the feature',async()=>{
  const {dom,doc,window,click}=await fixture();
  const search=doc.querySelector('#search');search.value='User';search.dispatchEvent(new window.Event('input'));
  await click('.search-result a[href$="/types/User"]');assert.equal(doc.querySelector('h1').textContent,'User');
  const missing=await fixture({hash:'#/features/example/types/missing'});assert.equal(missing.doc.querySelector('h1').textContent,'Type not found');assert.equal(missing.doc.querySelector('.back').hash,'#/features/example');
  dom.window.close();missing.dom.window.close();
});

test('visuals stay beside their target, and static attachments survive Save preview with bytes outside the model',async()=>{
  const {dom,doc,window,click}=await fixture({hash:'#/features/example/api/setStatus',change:p=>{
    p.visuals=[{id:'design',title:'Update flow',url:'https://www.figma.com/design/example',kind:'design',target:{capability:'example',kind:'operation',id:'setStatus'}}];
  }});
  assert.ok(doc.querySelector('.visual-gallery a[href="https://www.figma.com/design/example"]'));
  const slot=[...doc.querySelectorAll('[data-visual-target]')].find(e=>JSON.parse(e.dataset.visualTarget).kind==='response');
  slot.querySelector('[data-add-visual]').click();const form=slot.querySelector('form');
  form.elements.title.value='Updated state';
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4l8AAAAASUVORK5CYII=','base64');
  Object.defineProperty(form.elements.file,'files',{value:[new window.File([png],'state.png',{type:'image/png'})]});
  form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await window.mhprotoAttachmentReady;
  assert.ok(doc.querySelector('.visual img[alt="Updated state"]'));
  assert.ok(!doc.querySelector('#save-preview').hidden);
  assert.ok(doc.querySelector('#read-mode').textContent.includes('save to keep'));
  let saved;window.URL.createObjectURL=blob=>{saved=blob;return 'blob:preview';};window.URL.revokeObjectURL=()=>{};
  window.HTMLAnchorElement.prototype.click=function(){};
  await click('#save-preview');
  const html=await new Promise(resolve=>{const reader=new window.FileReader();reader.onload=()=>resolve(reader.result);reader.readAsText(saved);});
  const reload=new JSDOM(html,{runScripts:'outside-only',url:'https://mhproto.test/#/features/example/api/setStatus'});
  const model=JSON.parse(reload.window.document.querySelector('#mhproto-model').textContent);
  assert.equal(model.visuals.length,2);assert.ok(!JSON.stringify(model).includes('base64'));
  assert.ok(reload.window.document.querySelector('#mhproto-media').textContent.includes(png.toString('base64')));
  reload.window.scrollTo=()=>{};reload.window.mermaid={initialize(){},render:async()=>({svg:'<svg></svg>'})};
  await reload.window.eval(`(async()=>{${await viewerCode()}\n})()`);
  assert.ok(reload.window.document.querySelector('.visual img[alt="Updated state"]'));
  dom.window.close();reload.window.close();
});

test('visual editor validates file/link choice without losing the endpoint',async()=>{
  const {dom,doc,window}=await fixture({hash:'#/features/example/api/setStatus'});
  doc.querySelector('[data-add-visual]').click();const form=doc.querySelector('.visual-form');form.elements.title.value='Design';
  form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await window.mhprotoAttachmentReady;
  assert.ok(form.querySelector('[role=status]').textContent.includes('Choose one'));
  assert.ok(doc.querySelector('.io-grid'));dom.window.close();
});

test('shared and expanded request/response objects have no attachment actions; each header owns one',async()=>{
  const {dom,doc}=await fixture({hash:'#/features/example/api/setStatus',change:p=>{
    // Reproduce the screenshot: root refs, path parameters, a JSON body and nested refs.
    p.capabilities[0].operations[1].requestBody.content['application/json'].schema={$ref:'#/components/schemas/Status'};
  }});
  for(const detail of doc.querySelectorAll('.inline-object'))detail.open=true;
  for(const section of doc.querySelectorAll('.io-grid>section')){
    assert.equal(section.querySelectorAll('[data-add-visual]').length,1);
    const header=section.querySelector('.io-heading');assert.equal(header.querySelectorAll(':scope > [data-add-visual]').length,1);
    assert.equal(header.lastElementChild.textContent,'+');
  }
  assert.equal(doc.querySelectorAll('.signature [data-add-visual],.inline-object [data-add-visual]').length,0);
  assert.equal(doc.querySelectorAll('[data-attachment-zone] [data-attachment-zone]').length,0);
  const owners=[...doc.querySelectorAll('[data-visual-target]')];
  assert.ok(owners.every(e=>!['field','schema'].includes(JSON.parse(e.dataset.visualTarget).kind)));
  assert.equal(new Set(owners.map(e=>e.dataset.visualTarget)).size,owners.length);
  dom.window.close();
});

test('hovering a header or text block targets one plus; hovering an object field targets none',async()=>{
  const {dom,doc,window}=await fixture({hash:'#/features/example/api/setStatus'});
  // JSDOM tracks :hover for selector matching, but does not recalculate painted CSS.
  // Match the stylesheet's real hover rules rather than claiming pixel-level browser QA.
  const selectors=[...doc.styleSheets].flatMap(s=>[...s.cssRules]).filter(r=>r.selectorText?.includes(':hover')&&r.style?.opacity==='1').map(r=>r.selectorText);
  const hoveredButtons=()=>new Set(selectors.flatMap(selector=>[...doc.querySelectorAll(selector)]).filter(e=>e.matches('[data-add-visual]:not([hidden])')));
  const hover=e=>e.dispatchEvent(new window.MouseEvent('mouseover',{bubbles:true}));
  for(const header of doc.querySelectorAll('.io-heading')){hover(header);assert.equal(hoveredButtons().size,1);assert.equal([...hoveredButtons()][0].parentElement,header);}
  const text=doc.querySelector('header .description');hover(text);assert.equal(hoveredButtons().size,1);
  for(const field of doc.querySelectorAll('.signature .field')){hover(field);assert.equal(hoveredButtons().size,0);}
  for(const section of doc.querySelectorAll('.io-grid>section')){hover(section);assert.equal(hoveredButtons().size,0);}
  dom.window.close();
});

test('existing field and schema visuals appear under their response header without restoring object controls',async()=>{
  const {dom,doc}=await fixture({hash:'#/features/example/api/setStatus',change:p=>{
    p.visuals=[
      {id:'field',title:'Owner selection',url:'https://example.com/owner',target:{capability:'example',kind:'field',id:'setStatus',scope:'response',status:'201',path:'/owner'}},
      {id:'schema',title:'User card',url:'https://example.com/user',target:{capability:'example',kind:'schema',id:'User'}},
    ];
  }});
  const section=doc.querySelectorAll('.io-grid>section')[1],surface=section.querySelector('.attachment-block');
  assert.equal(surface.querySelectorAll('.visual-gallery .visual').length,2);
  assert.ok(surface.textContent.includes('/owner'));assert.ok(surface.textContent.includes('User'));
  assert.equal(section.querySelectorAll('[data-add-visual]').length,1);
  assert.equal(section.querySelectorAll('.signature .visual-gallery,.inline-object [data-add-visual]').length,0);
  dom.window.close();
});

test('a repeated rule target has one attachment owner and closing its editor restores keyboard focus',async()=>{
  const {dom,doc,click}=await fixture({hash:'#/features/example/api/setStatus',change:p=>{
    p.capabilities[0].presentation.operations.setStatus.ruleGroups=[{title:'Permissions',rules:['EXAMPLE-B-2']},{title:'Update prerequisites',rules:['EXAMPLE-B-2']}];
  }});
  const owners=[...doc.querySelectorAll('[data-visual-target]')].filter(e=>JSON.parse(e.dataset.visualTarget).kind==='rule');
  assert.equal(owners.length,1);
  const header=doc.querySelector('.io-heading'),button=header.querySelector('[data-add-visual]');
  button.click();assert.ok(button.hidden);
  await click('.io-grid [data-cancel-visual]');
  assert.ok(!button.hidden);assert.equal(doc.activeElement,button);assert.ok(header.parentElement.querySelector('.visual-editor').hidden);
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
  assert.ok(doc.querySelector('.table').textContent.includes('mhproto/capabilities/example/examples.yaml'));
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
