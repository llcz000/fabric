import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const cli=fileURLToPath(new URL('./fabric-v2-acp-merge-gate.mjs',import.meta.url));
const sha=v=>createHash('sha256').update(v).digest('hex');
function scenario(){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-acp-gate-'));
 const base=path.join(temp,'snapshot'),main=path.join(temp,'main'),agent=path.join(temp,'agent');
 for(const dir of [base,main,agent])fs.mkdirSync(dir);
 const files={'server/customer-share/publicPatternProjection.ts':'export const sample=1;\n',
  'server/customer-share/publicPatternProjection.test.ts':'export const test=1;\n',
  'server/product-master/v2CatalogAssembly.ts':'export const shared=1;\n',
  'src/components/product-master-v2/SampleSelectionPanel.tsx':'export const ui=1;\n'};
 const put=(root,rel,data)=>{const full=path.join(root,rel);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,data)};
 for(const [name,contents] of Object.entries(files))for(const root of [base,main,agent])put(root,name,contents);
 const entries=Object.entries(files).map(([file,value])=>({file,bytes:Buffer.byteLength(value),sha256:sha(value)}));
 fs.writeFileSync(path.join(base,'manifest.json'),JSON.stringify({format:'fabric-v2-safe-source-v1',count:entries.length,totalBytes:entries.reduce((n,x)=>n+x.bytes,0),entries}));
 const run=(owner='E')=>spawnSync(process.execPath,[cli,base,agent,main,owner],{encoding:'utf8'});
 return {temp,base,main,agent,put,run};
}
test('read-only merge review accepts only changed owned files with untouched main and verified base',()=>{
 const s=scenario();
 try{
  s.put(s.agent,'server/customer-share/publicPatternProjection.ts','export const sample=2;\n');
  const r=s.run();
  assert.equal(r.status,0,r.stdout+r.stderr);
  const result=JSON.parse(r.stdout);
  assert.equal(result.ready,true);
  assert.deepEqual(result.changed,['server/customer-share/publicPatternProjection.ts']);
  assert.deepEqual(result.added,[]);
  assert.equal(result.owner,'E');
 }finally{fs.rmSync(s.temp,{recursive:true,force:true})}
});
test('cross-owner writes and unapproved shared assembly are refused, even if main unchanged',()=>{
 const s=scenario();
 try{
  s.put(s.agent,'server/product-master/v2CatalogAssembly.ts','tampered');
  let r=s.run();assert.equal(r.status,2,r.stderr);assert.equal(JSON.parse(r.stdout).ready,false);
  s.put(s.agent,'server/product-master/v2CatalogAssembly.ts','export const shared=1;\n');
  s.put(s.agent,'src/components/product-master-v2/SampleSelectionPanel.tsx','modified');
  r=s.run('C');assert.equal(r.status,2,'C cannot change E sample-selection UI');
  r=s.run('E');assert.equal(r.status,0,'E owns selection UI');
 }finally{fs.rmSync(s.temp,{recursive:true,force:true})}
});
test('same-path main edit, conflicting new addition, deletions, and missing baseline block merge',()=>{
 const s=scenario();
 try{
  const target='server/customer-share/publicPatternProjection.ts';
  s.put(s.agent,target,'agent version');
  s.put(s.main,target,'other agent version');
  assert.equal(s.run().status,2);
  s.put(s.main,target,'export const sample=1;\n');
  s.put(s.agent,'server/customer-share/newProjection.test.ts','new');
  s.put(s.main,'server/customer-share/newProjection.test.ts','other agent');
  assert.equal(s.run().status,2,'must not overwrite another agent’s new file');
  fs.unlinkSync(path.join(s.main,'server/customer-share/newProjection.test.ts'));
  let r=s.run();assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(JSON.parse(r.stdout).added.length,1);
  fs.unlinkSync(path.join(s.agent,target));
  assert.equal(s.run().status,2,'agent cannot delete baseline source');
  s.put(s.agent,target,'agent version');
  fs.writeFileSync(path.join(s.base,target),'base tampered');
  assert.equal(s.run().status,2,'tampered baseline cannot pass');
 }finally{fs.rmSync(s.temp,{recursive:true,force:true})}
});
test('agent-added files outside source roots are denied, including root secrets and unowned docs',()=>{
 const s=scenario();
 try{
  s.put(s.agent,'.env','UNTRUSTED=1');
  assert.equal(s.run('E').status,2,'root config must not escape review');
  fs.unlinkSync(path.join(s.agent,'.env'));
  s.put(s.agent,'docs/maintenance/other-agent.md','unowned');
  assert.equal(s.run('E').status,2,'out-of-scope docs must be detected');
 }finally{fs.rmSync(s.temp,{recursive:true,force:true})}
});

test('phase2 exact task Gate accepts only queued files with pinned requirements and observed run',()=>{
 const s=scenario();
 try{
  s.put(s.main,'docs/project/项目需求总览.md','SCAN-01\\n');
  const tasks=[{id:'scan-test',owner:'backend',priority:'P0',requirements:['SCAN-01'],
   title:'Allow admin scans with proper identity',dependsOn:[],
   read:['server/customer-share/publicPatternProjection.test.ts'],
   edit:['server/customer-share/publicPatternProjection.ts'],
   remainingGate:'Real QR test and user acceptance pending'}];
  const backlog='docs/project/fabric-v2-agent-queue.json';
  s.put(s.main,backlog,JSON.stringify({format:'fabric-v2-multi-agent-queue-v1',source:'docs/project/项目需求总览.md',tasks}));
  const sourceSha=sha(fs.readFileSync(path.join(s.main,'docs/project/项目需求总览.md')));
  const backlogSha=sha(fs.readFileSync(path.join(s.main,backlog)));
  const state={format:'fabric-v2-multi-agent-state-v1',entries:{'scan-test':{
   status:'submitted_for_review',runId:'wc_agent_run_abcdefghijklmnop',
   edit:tasks[0].edit,sourceSha256:sourceSha,backlogSha256:backlogSha
  }}};
  s.put(s.main,'tmp/fabric-v2-agent-queue.state.json',JSON.stringify(state));
  s.put(s.agent,'.fabric-acp-workspace.json',JSON.stringify({
   format:'fabric-v2-acp-workspace-v1',role:'A',snapshot:s.base
  }));
  const run=()=>spawnSync(process.execPath,[cli,s.base,s.agent,s.main,'A','--task','scan-test'],{encoding:'utf8'});
  s.put(s.agent,'server/customer-share/publicPatternProjection.ts','export const sample=2;\\n');
  let r=run();assert.equal(r.status,0,r.stdout+r.stderr);
  let report=JSON.parse(r.stdout);assert.equal(report.taskScoped,true);
  assert.deepEqual(report.changed,['server/customer-share/publicPatternProjection.ts']);
  s.put(s.agent,'src/components/product-master-v2/SampleSelectionPanel.tsx','unauthorized');
  r=run();assert.equal(r.status,2,'second file not in exact queued edit list');
  s.put(s.agent,'src/components/product-master-v2/SampleSelectionPanel.tsx','export const ui=1;\\n');
  s.put(s.main,'docs/project/项目需求总览.md','SCAN-01\\nSTATS-01\\n');
  r=run();assert.equal(r.status,2,'changed requirements must invalidate observed reservation');
 }finally{fs.rmSync(s.temp,{recursive:true,force:true})}
});
test('extra files outside ownership or symlinks fail closed',()=>{
 const s=scenario();
 try{
  s.put(s.agent,'src/components/product-master-v2/NewFabricEditor.tsx','out of scope');
  assert.equal(s.run('E').status,2);
  fs.unlinkSync(path.join(s.agent,'src/components/product-master-v2/NewFabricEditor.tsx'));
  s.put(s.agent,'server/customer-share/unapproved.env','secret');
  assert.equal(s.run('E').status,2,'new unsafe files must not be silently copied');
 }finally{fs.rmSync(s.temp,{recursive:true,force:true})}
});
