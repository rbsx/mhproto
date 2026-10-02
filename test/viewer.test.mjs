import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { JSDOM } from 'jsdom';
import { packageRoot } from '../src/core.mjs';
import { model } from '../src/server.mjs';

async function fixture(change = () => {}, changes = { available: false, changes: [] }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bive-flow-'));
  execFileSync(process.execPath, [path.join(packageRoot,'bin/bive.mjs'),'init','--root',root,'--no-skills']);
  const project = await model(root), cap = project.capabilities[0];
  cap.rules.push({ id:'EXAMPLE-B-2', text:'Only authorised users can update a service.' });
  cap.prose += '\n## Permissions\n- **EXAMPLE-B-2** Only authorised users can update a service.\n';
  cap.presentation = { ruleTitles:{'EXAMPLE-B-1':'Read the current service status.'} };
  cap.openapi.components = { schemas:{
    Status:{ type:'object', required:['status'], properties:{status:{type:'string'}, owner:{$ref:'#/components/schemas/User'}} },
    User:{ type:'object', properties:{id:{type:'string'}} },
  }};
  cap.operations[0].responses['200'].content['application/json'].schema = {$ref:'#/components/schemas/Status'};
  cap.checks = [{ id:'EXAMPLE-V-1',title:'EXAMPLE-B-1 status has the expected shape',command:['node','check.mjs'],rules:['EXAMPLE-B-1'],examples:['EXAMPLE-E-1'],testNames:['status check'] }];
  cap.evidence = { finishedAt:'2026-10-02T09:00:00Z', stale:false, results:[{id:'EXAMPLE-V-1',status:'passing',tests:[{name:'status check',type:'test:pass'}]}] };
  change(project);
  const html = await readFile(path.join(packageRoot,'viewer/index.html'),'utf8');
  const dom = new JSDOM(html,{runScripts:'outside-only',url:'https://bive.test/'});
  const {window} = dom, doc = window.document;
  for (const [id,data] of [['bive-model',project],['bive-diff',changes]]) {
    const element=doc.createElement('script');element.id=id;element.type='application/json';element.textContent=JSON.stringify(data);doc.body.append(element);
  }
  // JSDOM simulates DOM flow; native layout and modal focus-trapping are not assessed.
  window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  const script=await readFile(path.join(packageRoot,'viewer/app.js'),'utf8');
  await window.eval(`(async()=>{${script}\n})()`);
  const click=selector=>{const element=doc.querySelector(selector);assert.ok(element,selector);element.click();return element;};
  return {dom,window,doc,click};
}

test('understand a capability without opening schemas, logs or source metadata',async()=>{
  const {dom,doc}=await fixture();
  assert.equal(doc.querySelector('h1').textContent,'Example capability');
  assert.equal(doc.querySelectorAll('#tabs button').length,4);
  assert.equal(doc.querySelectorAll('.rule-group[open]').length,1);
  assert.ok(doc.querySelector('.rule-group[open]').textContent.includes('Read the current service status'));
  assert.equal(doc.querySelectorAll('#content pre,#content .table,#stats').length,0);
  assert.ok(!doc.querySelector('#detail').open);
  dom.window.close();
});

test('follow a rule to its example, API and nested type, then return in context',async()=>{
  const {dom,doc,click}=await fixture();
  const trigger=doc.querySelector('[data-kind="rule"]');trigger.focus();trigger.click();
  assert.ok(doc.querySelector('#detail').open);
  assert.ok(doc.querySelector('#detail-content .related[open]').textContent.includes('The service is ready'));
  const api=doc.querySelector('#detail-content [data-kind="operation"]');api.closest('details').open=true;api.click();
  assert.ok(doc.querySelector('#detail-title').textContent.includes('/status'));
  assert.ok(doc.querySelector('#detail-content').textContent.includes('Required'));
  const rawOpenApi = [...doc.querySelectorAll('#detail-content summary')].find(item=>item.textContent==='Raw OpenAPI');
  assert.ok(rawOpenApi);
  assert.ok(!rawOpenApi.closest('details').open);
  click('#detail-content [data-kind="schema"]');
  assert.equal(doc.querySelector('#detail-title').textContent,'User');
  click('#detail-back');assert.ok(doc.querySelector('#detail-title').textContent.includes('/status'));
  click('#detail-back');assert.ok(doc.querySelector('#detail-title').textContent.includes('Read the current'));
  click('.close');assert.ok(!doc.querySelector('#detail').open);assert.equal(doc.activeElement,trigger);
  dom.window.close();
});

test('checks prioritise missing and failing evidence while passing checks stay available',async()=>{
  const {dom,doc,click}=await fixture(project=>{
    const cap=project.capabilities[0];
    cap.checks.push({id:'EXAMPLE-V-2',title:'Update permission check',rules:[],command:['node','other.mjs']});
    cap.evidence.results.push({id:'EXAMPLE-V-2',status:'failing',stderr:'Denied incorrectly',tests:[]});
  });
  click('[data-tab="Checks"]');
  assert.ok(doc.querySelector('#content [data-id="EXAMPLE-V-2"]'));
  assert.equal(doc.querySelector('#content [data-id="EXAMPLE-V-1"]'),null);
  assert.ok(doc.querySelector('#content [data-id="EXAMPLE-B-2"]'));
  click('#content [data-id="EXAMPLE-V-2"]');
  assert.ok(doc.querySelector('#detail-content').textContent.includes('Failed'));
  assert.ok(doc.querySelector('#detail-content details[open]').textContent.includes('Denied incorrectly'));
  click('.close');click('[data-filter="all"]');
  assert.ok(doc.querySelector('#content [data-id="EXAMPLE-V-1"]'));
  dom.window.close();
});

test('stale evidence is actionable rather than shown as passing',async()=>{
  const {dom,doc,click}=await fixture(p=>p.capabilities[0].evidence.stale=true);
  click('[data-tab="Checks"]');
  assert.ok(doc.querySelector('#content [data-id="EXAMPLE-V-1"]').textContent.includes('Needs a new run'));
  click('#content [data-id="EXAMPLE-V-1"]');
  assert.ok(doc.querySelector('#detail-content').textContent.includes('Run the check again'));
  dom.window.close();
});

test('review one change without displaying full before/after JSON on the landing view',async()=>{
  const change={capability:'example',kind:'rule',id:'EXAMPLE-B-1',status:'changed',before:{text:'Return the old status.'},after:{text:'Return the current status.'}};
  const {dom,doc,click}=await fixture(()=>{},{available:true,changes:[change]});
  click('[data-tab="Changes"]');
  assert.equal(doc.querySelectorAll('#content pre').length,0);
  click('#content [data-kind="change"]');
  assert.ok(doc.querySelector('#detail-content').textContent.includes('Return the old status'));
  assert.ok(doc.querySelector('#detail-content').textContent.includes('Return the current status'));
  dom.window.close();
});

test('search crosses views and sources remain a secondary action',async()=>{
  const {dom,window,doc,click}=await fixture();
  const input=doc.querySelector('#search');input.value='Read the current';input.dispatchEvent(new window.Event('input'));
  assert.ok(doc.querySelector('#content [data-id="EXAMPLE-B-1"]'));
  input.value='No match at all';input.dispatchEvent(new window.Event('input'));
  assert.ok(doc.querySelector('#content').textContent.includes('No matches'));
  click('[data-kind="sources"]');
  assert.ok(doc.querySelector('#detail-content').textContent.includes('bive/interfaces/openapi.yaml'));
  assert.ok(doc.querySelector('#detail-content').textContent.includes('bive/capabilities/example/examples.yaml'));
  assert.ok(doc.querySelector('#detail-content').textContent.includes('bive/capabilities/example/checks.yaml'));
  assert.ok(!doc.querySelector('#detail-content').textContent.includes('[object Object]'));
  assert.equal(doc.querySelectorAll('#detail-content details[open]').length,0);
  dom.window.close();
});
