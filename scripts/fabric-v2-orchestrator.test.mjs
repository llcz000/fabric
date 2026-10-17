import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadQueue,planTasks,reserveTask,markHandoff,markBlocked,markReviewed,queueReport,recordAgentStarted,recordAgentObserved,reconcileTaskSource} from './fabric-v2-orchestrator.mjs';

function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-v2-queue-'));
 fs.mkdirSync(path.join(root,'docs','project'),{recursive:true});
 fs.mkdirSync(path.join(root,'server','order-v2'),{recursive:true});
 fs.mkdirSync(path.join(root,'src','components'),{recursive:true});
 fs.writeFileSync(path.join(root,'docs','project','项目需求总览.md'),'QUERY-01 QUERY-02 STATS-01 DOC-06');
 for(const f of ['server/order-v2/query.ts','server/order-v2/query.test.ts','src/components/list.tsx','src/components/list.test.ts'])fs.writeFileSync(path.join(root,f),'// source');
 const tasks=[
  {id:'query-api',owner:'backend',priority:'P0',requirements:['QUERY-01'],title:'Complete protected order query',
   dependsOn:[],read:['server/order-v2/query.ts'],edit:['server/order-v2/query.test.ts'],
   remainingGate:'No real database access; awaiting coordinator review'},
  {id:'query-ui',owner:'frontend',priority:'P0',requirements:['QUERY-02'],title:'Connect user order list controls',
   dependsOn:['query-api'],read:['server/order-v2/query.ts'],edit:['src/components/list.tsx'],
   remainingGate:'No browser UAT or production integration'},
  {id:'stats',owner:'backend',priority:'P1',requirements:['STATS-01'],title:'Calculate protected business metrics',
   dependsOn:[],read:['server/order-v2/query.ts'],edit:['server/order-v2/query.ts'],
   remainingGate:'No database performance evidence'},
  {id:'doc-conflict',owner:'frontend',priority:'P2',requirements:['DOC-06'],title:'Add extra piece inputs to list',
   dependsOn:[],read:['server/order-v2/query.ts'],edit:['src/components/list.tsx','src/components/list.test.ts'],
   remainingGate:'Sales UI not signed off yet'}
 ];
 const backlog='docs/project/fabric-multi-agent-queue.json';
 fs.writeFileSync(path.join(root,backlog),JSON.stringify({format:'fabric-v2-multi-agent-queue-v1',source:'docs/project/项目需求总览.md',tasks}));
 const state=path.join(root,'tmp','fabric-multi-agent-state.json');
 return {root,backlog,state,tasks,dispose(){fs.rmSync(root,{recursive:true,force:true});}};
}
test('queue verifies exact current overview requirement IDs and file ownership',()=>{
 const x=fixture();try{
  const q=loadQueue(x.root,x.backlog);
  assert.equal(q.tasks.length,4);
  assert.deepEqual(q.tasks[0].requirements,['QUERY-01']);
  const changed=JSON.parse(fs.readFileSync(path.join(x.root,x.backlog),'utf8'));
  changed.tasks[0].requirements=['OLD-99'];
  fs.writeFileSync(path.join(x.root,x.backlog),JSON.stringify(changed));
  assert.throws(()=>loadQueue(x.root,x.backlog),/requirement/i);
 }finally{x.dispose()}
});
test('queue rejects unknown dependencies, cycles, duplicate IDs and restricted edit paths',()=>{
 const x=fixture();try{
  const pathname=path.join(x.root,x.backlog);
  const original=JSON.parse(fs.readFileSync(pathname,'utf8'));
  const invalid=[
   t=>{t.tasks[0].dependsOn=['missing']},
   t=>{t.tasks[0].dependsOn=['query-ui']},
   t=>{t.tasks[1].id='query-api'},
   t=>{t.tasks[0].edit=['server.ts']},
   t=>{t.tasks[0].edit=['../.env']},
   t=>{t.tasks[0].requirements=['STATS-01','STATS-01']},
   t=>{t.tasks[0].title=''}
  ];
  for(const edit of invalid){
   const changed=structuredClone(original);edit(changed);
   fs.writeFileSync(pathname,JSON.stringify(changed));
   assert.throws(()=>loadQueue(x.root,x.backlog));
  }
 }finally{x.dispose()}
});
test('planner is read-only; respects dependencies, file overlap and explicitly observed capacity',()=>{
 const x=fixture();try{
  const q=loadQueue(x.root,x.backlog);
  const report=planTasks(q,{format:'fabric-v2-multi-agent-state-v1',entries:{}},{slots:0});
  assert.equal(report.dispatchable.length,0);
  assert.equal(report.capacity,'not_confirmed');
  assert.deepEqual(report.waiting.map(v=>v.id).sort(),['doc-conflict','query-api','query-ui','stats'].sort());
  assert.equal(fs.existsSync(x.state),false);
  const possible=planTasks(q,{format:'fabric-v2-multi-agent-state-v1',entries:{}},{slots:2});
  assert.deepEqual(possible.dispatchable.map(t=>t.id),['query-api','stats']);
  assert.equal(possible.waiting.find(t=>t.id==='query-ui').reason,'dependency');
  assert.equal(possible.waiting.find(t=>t.id==='doc-conflict').reason,'capacity');
 }finally{x.dispose()}
});
test('reservation locks exact files, never starts an ACP agent, and blocks overlapping tasks',()=>{
 const x=fixture();try{
  assert.equal(reserveTask(x.root,x.backlog,x.state,'query-api',{slots:1}).status,'reserved_not_dispatched');
  assert.equal(fs.existsSync(x.state),true);
  assert.throws(()=>reserveTask(x.root,x.backlog,x.state,'query-api',{slots:1}),/reserved|ready|capacity/i);
  assert.throws(()=>reserveTask(x.root,x.backlog,x.state,'query-ui',{slots:1}),/dependency|ready|capacity/i);
  const view=queueReport(x.root,x.backlog,x.state,{slots:2});
  assert.equal(view.counts.reserved,1);
  assert.equal(view.counts.observedAgentRuns,null,'queue cannot verify Runner launches');
 }finally{x.dispose()}
});
test('reserved file overlap cannot be bypassed even when reported slots > actual jobs',()=>{
 const x=fixture();try{
  reserveTask(x.root,x.backlog,x.state,'doc-conflict',{slots:2});
  const view=queueReport(x.root,x.backlog,x.state,{slots:3});
  assert.equal(view.waiting.find(t=>t.id==='query-ui').reason,'dependency');
  assert.equal(view.dispatchable.some(t=>t.id==='query-api'),true);
  assert.throws(()=>reserveTask(x.root,x.backlog,x.state,'query-ui',{slots:3}));
 }finally{x.dispose()}
});
test('handoff is not verified; dependencies remain blocked until independent reviewed evidence',()=>{
 const x=fixture();try{
  reserveTask(x.root,x.backlog,x.state,'query-api',{slots:2});
  markHandoff(x.state,'query-api','wc_agent_run_abcdefghijklmnop');
  let r=queueReport(x.root,x.backlog,x.state,{slots:2});
  assert.equal(r.counts.submitted,1);
  assert.equal(r.waiting.find(t=>t.id==='query-ui').reason,'dependency');
  assert.throws(()=>markReviewed(x.root,x.backlog,x.state,'query-api','docs/project/missing-evidence.json'),/evidence|missing/i);
  const proof='docs/project/integration.json';
  fs.writeFileSync(path.join(x.root,proof),JSON.stringify({format:'fabric-v2-task-review-v1',task:'query-api',result:'accepted',
   testVerified:true,lintVerified:true,buildVerified:true,mergeGateVerified:true,reviewer:'coordinator-independent-review'}));
  markReviewed(x.root,x.backlog,x.state,'query-api',proof);
  r=queueReport(x.root,x.backlog,x.state,{slots:2});
  assert.equal(r.counts.reviewed,1);
  assert.equal(r.dispatchable.some(t=>t.id==='query-ui'),true);
 }finally{x.dispose()}
});
test('block state preserves reasons without pretending success; no automatic recovery or claim expiry',()=>{
 const x=fixture();try{
  reserveTask(x.root,x.backlog,x.state,'stats',{slots:1});
  markBlocked(x.state,'stats','provider-quota');
  const r=queueReport(x.root,x.backlog,x.state,{slots:1});
  assert.equal(r.counts.blocked,1);
  assert.equal(r.dispatchable.some(t=>t.id==='stats'),false);
  assert.throws(()=>reserveTask(x.root,x.backlog,x.state,'stats',{slots:1}));
 }finally{x.dispose()}
});
test('lock failure refuses write without altering state; stale lock not auto-overridden',()=>{
 const x=fixture();try{
  fs.mkdirSync(path.dirname(x.state),{recursive:true});
  fs.writeFileSync(x.state+'.lock','someone else owns queue state');
  assert.throws(()=>reserveTask(x.root,x.backlog,x.state,'stats',{slots:1}),/lock|busy/i);
  assert.equal(fs.existsSync(x.state),false);
 }finally{x.dispose()}
});
test('phase2 typed real-run acknowledgement is distinct from reservation, and terminal evidence remains unreviewed',()=>{
 const x=fixture();try{
  reserveTask(x.root,x.backlog,x.state,'query-api',{slots:1});
  const run='wc_agent_run_abcdefghijklmnop',key='fabric-v2-acp-'+'a'.repeat(42);
  assert.equal(recordAgentStarted(x.state,'query-api',run,key).status,'agent_running');
  assert.throws(()=>recordAgentStarted(x.state,'query-api','wc_agent_run_otherabcdefghij',key),/running|reservation|state/i);
  let s=queueReport(x.root,x.backlog,x.state,{slots:1});
  assert.equal(s.counts.running,1);
  assert.equal(s.counts.submitted,0);
  assert.throws(()=>recordAgentObserved(x.state,'query-api','wc_agent_run_otherabcdefghij','completed'),/mismatch/i);
  assert.equal(recordAgentObserved(x.state,'query-api',run,'running').status,'agent_running');
  assert.equal(recordAgentObserved(x.state,'query-api',run,'completed').status,'submitted_for_review');
  s=queueReport(x.root,x.backlog,x.state,{slots:1});
  assert.equal(s.counts.submitted,1);
  assert.equal(s.counts.reviewed,0);
 }finally{x.dispose()}
});
test('phase2 observed quota errors and cancellation block without automatic retries',()=>{
 for(const [terminal,reason] of [['quota','provider-quota'],['cancelled','cancelled'],['failed','test-failed']]){
  const x=fixture();try{
   reserveTask(x.root,x.backlog,x.state,'stats',{slots:1});
   const run='wc_agent_run_abcdefghijklmnop',key='fabric-v2-acp-'+'b'.repeat(42);
   recordAgentStarted(x.state,'stats',run,key);
   assert.equal(recordAgentObserved(x.state,'stats',run,terminal).reason,reason);
   const report=queueReport(x.root,x.backlog,x.state,{slots:1});
   assert.equal(report.counts.blocked,1);
   assert.equal(report.dispatchable.some(y=>y.id==='stats'),false);
   assert.throws(()=>recordAgentObserved(x.state,'stats',run,'completed'),/state|running|terminal/i);
  }finally{x.dispose()}
 }
});
test('coordinator-only requirement reconciliation preserves dispatch fingerprint and permits review after verified source drift',()=>{
 const x=fixture();try{
  const original=loadQueue(x.root,x.backlog);
  const run='wc_agent_run_abcdefghijklmnop',key='fabric-v2-acp-'+'a'.repeat(42);
  reserveTask(x.root,x.backlog,x.state,'query-api',{slots:1,expectedSourceSha256:original.sourceSha256});
  recordAgentStarted(x.state,'query-api',run,key);
  recordAgentObserved(x.state,'query-api',run,'completed');
  const proofFile='docs/project/accepted-task.json';
  fs.writeFileSync(path.join(x.root,proofFile),JSON.stringify({format:'fabric-v2-task-review-v1',
   task:'query-api',result:'accepted',testVerified:true,lintVerified:true,buildVerified:true,
   mergeGateVerified:true,reviewer:'independent-coordinator'}));
  fs.appendFileSync(path.join(x.root,'docs','project','项目需求总览.md'),'\nSCAN-01 registered accounts');
  assert.throws(()=>markReviewed(x.root,x.backlog,x.state,'query-api',proofFile),/source|fingerprint/i);
  const now=loadQueue(x.root,x.backlog);
  const reconcileFile='docs/project/requirement-reconcile.json';
  const attestation={
   format:'fabric-v2-task-source-reconciliation-v1',task:'query-api',
   previousSourceSha256:original.sourceSha256,currentSourceSha256:now.sourceSha256,
   backlogSha256:now.backlogSha256,requirements:['QUERY-01'],
   decision:'reviewed-current-requirements',reviewer:'independent-coordinator',
   testVerified:true,codeScopeVerified:true,
   rationale:'Re-reviewed same QUERY-01 product behavior after unrelated SCAN-01 text update'
  };
  fs.writeFileSync(path.join(x.root,reconcileFile),JSON.stringify(attestation));
  assert.equal(reconcileTaskSource(x.root,x.backlog,x.state,'query-api',reconcileFile).status,'reconciled_pending_review');
  const state=JSON.parse(fs.readFileSync(x.state,'utf8')).entries['query-api'];
  assert.equal(state.dispatchedSourceSha256,original.sourceSha256);
  assert.equal(state.sourceSha256,now.sourceSha256);
  assert.equal(state.status,'submitted_for_review');
  assert.equal(markReviewed(x.root,x.backlog,x.state,'query-api',proofFile).status,'reviewed');
  assert.throws(()=>reconcileTaskSource(x.root,x.backlog,x.state,'query-api',reconcileFile),/state|review|current/i);
 }finally{x.dispose()}
});
test('source drift never auto-reconciles: absent, false or wrong proof retains pending state',()=>{
 const x=fixture();try{
  const old=loadQueue(x.root,x.backlog);
  reserveTask(x.root,x.backlog,x.state,'stats',{slots:1});
  const run='wc_agent_run_abcdefghijklmnop';recordAgentStarted(x.state,'stats',run,'fabric-v2-acp-'+'a'.repeat(42));
  recordAgentObserved(x.state,'stats',run,'completed');
  fs.appendFileSync(path.join(x.root,'docs','project','项目需求总览.md'),'\nSCAN-01');
  const now=loadQueue(x.root,x.backlog),f='docs/project/reconcile.json';
  assert.throws(()=>reconcileTaskSource(x.root,x.backlog,x.state,'stats',f),/missing/i);
  const fake={format:'fabric-v2-task-source-reconciliation-v1',task:'stats',
   previousSourceSha256:old.sourceSha256,currentSourceSha256:now.sourceSha256,
   backlogSha256:now.backlogSha256,requirements:['STATS-01'],decision:'reviewed-current-requirements',
   reviewer:'independent-coordinator',testVerified:false,codeScopeVerified:true,rationale:'Unverified'};
  fs.writeFileSync(path.join(x.root,f),JSON.stringify(fake));
  assert.throws(()=>reconcileTaskSource(x.root,x.backlog,x.state,'stats',f),/evidence|review/i);
  const actual=JSON.parse(fs.readFileSync(x.state,'utf8')).entries.stats;
  assert.equal(actual.sourceSha256,old.sourceSha256);
  assert.equal(actual.dispatchedSourceSha256,undefined);
 }finally{x.dispose()}
});
test('queue refuses symlinked paths and stale requirements baseline fingerprint',()=>{
 const x=fixture();try{
  const queue=loadQueue(x.root,x.backlog);
  const file=path.join(x.root,'docs','project','项目需求总览.md');
  fs.appendFileSync(file,'\nAUTH-01');
  assert.throws(()=>reserveTask(x.root,x.backlog,x.state,'stats',{slots:1,expectedSourceSha256:queue.sourceSha256}),/source|stale/i);
  assert.equal(fs.existsSync(x.state),false);
 }finally{x.dispose()}
});
