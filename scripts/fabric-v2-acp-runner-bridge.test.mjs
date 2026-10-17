import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readRunnerCapability,buildAcpLaunchEnvelope,interpretAcpStart,interpretAcpObservation} from './fabric-v2-acp-runner-bridge.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-agent-bridge-'));
 const baseline=path.join(path.dirname(root),'fabric-agent-baselines');
 const snap=path.join(baseline,'v2-fixture-'+path.basename(root));
 const work=path.join(root,'.agent-workspaces','acp-a-fixture-1');
 fs.mkdirSync(path.join(root,'docs','project'),{recursive:true});
 fs.mkdirSync(path.join(root,'server','x'),{recursive:true});
 fs.mkdirSync(path.join(snap,'server','x'),{recursive:true});
 fs.mkdirSync(path.join(work,'server','x'),{recursive:true});
 fs.writeFileSync(path.join(root,'docs','project','项目需求总览.md'),'QUERY-01 STATS-01');
 const code=Buffer.from('export const x=1;\n');
 for(const at of [path.join(root,'server','x','file.ts'),path.join(snap,'server','x','file.ts'),path.join(work,'server','x','file.ts')])fs.writeFileSync(at,code);
 const manifest={format:'fabric-v2-safe-source-v1',count:1,totalBytes:code.length,entries:[{file:'server/x/file.ts',bytes:code.length,sha256:sha(code)}]};
 fs.writeFileSync(path.join(snap,'manifest.json'),JSON.stringify(manifest));
 const roleFile={format:'fabric-v2-acp-workspace-v1',role:'A',snapshot:snap,baselineManifestSha256:sha(fs.readFileSync(path.join(snap,'manifest.json'))),count:1};
 fs.writeFileSync(path.join(work,'.fabric-acp-workspace.json'),JSON.stringify(roleFile));
 const queue='docs/project/fabric-v2-agent-queue.json';
 fs.writeFileSync(path.join(root,queue),JSON.stringify({format:'fabric-v2-multi-agent-queue-v1',source:'docs/project/项目需求总览.md',tasks:[{
  id:'query-gate',owner:'backend',priority:'P0',requirements:['QUERY-01'],title:'Add strict query gating tests',dependsOn:[],read:['server/x/file.ts'],edit:['server/x/file.ts'],remainingGate:'Actual MySQL UAT still needed'
 }]}));
 const runner={focus:{client_id:'test-runner',connected:true,status:'online',job_concurrency:{limit:4},coding_agent_providers:[{provider_id:'codex',name:'Codex ACP'}]}};
 const args={root,queueFile:queue,taskId:'query-gate',workspace:work,registeredProject:'agent:test-runner:fabricv2-bridge-test',runnerStatus:runner,providerId:'codex'};
 return {root,work,snap,baseline,runner,args,dispose(){fs.rmSync(root,{recursive:true,force:true});fs.rmSync(snap,{recursive:true,force:true});}};
}
test('runner provider advertises connectivity, but not ACP quota or real parallel slots',()=>{
 const x=fixture();try{
  const cap=readRunnerCapability(x.runner,'codex');
  assert.equal(cap.providerConnected,true);
  assert.equal(cap.confirmedAcpSlots,null);
  assert.equal(cap.canAutoFanOut,false);
  assert.equal(cap.singleProbeAllowed,true);
  assert.equal(readRunnerCapability({focus:{...x.runner.focus,connected:false}},'codex').singleProbeAllowed,false);
  assert.equal(readRunnerCapability(x.runner,'unknown').singleProbeAllowed,false);
 }finally{x.dispose()}
});
test('phase2 launch envelope pins requirements baseline, exact files, isolated workspace and replay key',()=>{
 const x=fixture();try{
  const v=buildAcpLaunchEnvelope({...x.args,allowSingleProbe:true});
  assert.equal(v.tool,'coding_agent_start');
  assert.equal(v.arguments.provider_id,'codex');
  assert.equal(v.arguments.project,x.args.registeredProject);
  assert.match(v.arguments.idempotency_key,/^fabric-v2-acp-/);
  assert.match(v.arguments.instruction,/server\/x\/file\.ts/);
  assert.match(v.arguments.instruction,/QUERY-01/);
  assert.match(v.arguments.instruction,/NEVER.*main/i);
  assert.equal(v.verifiedSourceCount,1);
  assert.equal(v.confirmedParallelAcpSlots,null);
  assert.equal(v.probeOnly,true);
  assert.equal(v.releaseAuthorized,false);
  assert.deepEqual(buildAcpLaunchEnvelope({...x.args,allowSingleProbe:true}).arguments,v.arguments);
 }finally{x.dispose()}
});
test('default fails closed before explicit single attempt and rejects wrong provider or main project',()=>{
 const x=fixture();try{
  assert.throws(()=>buildAcpLaunchEnvelope(x.args),/prob|permission|confirm|approv/i);
  assert.throws(()=>buildAcpLaunchEnvelope({...x.args,allowSingleProbe:true,providerId:'anything'}),/provider/i);
  assert.throws(()=>buildAcpLaunchEnvelope({...x.args,allowSingleProbe:true,registeredProject:'agent:test-runner:fabric'}),/isolat|main/i);
  assert.throws(()=>buildAcpLaunchEnvelope({...x.args,allowSingleProbe:true,workspace:x.root}),/workspace|isolat/i);
 }finally{x.dispose()}
});
test('snapshot byte tampering, manifest forgery or incompatible Agent role blocks dispatch',()=>{
 const x=fixture();try{
  const broken=path.join(x.work,'server','x','file.ts');fs.writeFileSync(broken,'mutated');
  assert.throws(()=>buildAcpLaunchEnvelope({...x.args,allowSingleProbe:true}),/hash|snapshot|workspace/i);
  fs.writeFileSync(broken,'export const x=1;\n');
  const record=path.join(x.work,'.fabric-acp-workspace.json');
  const data=JSON.parse(fs.readFileSync(record,'utf8'));data.role='D';fs.writeFileSync(record,JSON.stringify(data));
  assert.throws(()=>buildAcpLaunchEnvelope({...x.args,allowSingleProbe:true}),/role|owner/i);
 }finally{x.dispose()}
});
test('no launch after requirement source or backlog changes; no automatic retries',()=>{
 const x=fixture();try{
  const plan=buildAcpLaunchEnvelope({...x.args,allowSingleProbe:true});
  fs.appendFileSync(path.join(x.root,'docs','project','项目需求总览.md'),'\nSTATS-02');
  assert.throws(()=>buildAcpLaunchEnvelope({...x.args,allowSingleProbe:true,expectedSourceSha256:plan.sourceSha256}),/stale|source/i);
 }finally{x.dispose()}
});
test('start parser accepts ONLY exact WebCodex run id, no green/accepted assumptions',()=>{
 const x=fixture();try{
  const v=buildAcpLaunchEnvelope({...x.args,allowSingleProbe:true});
  const id='wc_agent_run_abcdefghijklmnop';
  assert.deepEqual(interpretAcpStart({run_id:id},v),{task:'query-gate',runId:id,terminal:false,verified:false});
  for(const bogus of [{},{run_id:'fake'},{run_id:id,terminal:true},{run_id:id,verified:true}])
   assert.throws(()=>interpretAcpStart(bogus,v),/run|start|unexpected/i);
 }finally{x.dispose()}
});
test('observation rejects mismatched run and distinguishes completed, cancelled and blocked',()=>{
 const id='wc_agent_run_abcdefghijklmnop';
 const completed=interpretAcpObservation({state:'completed',terminal:true},id);
 assert.deepEqual(completed,{runId:id,status:'submitted_for_review',verified:false});
 assert.equal(interpretAcpObservation({state:'cancelled',terminal:true},id).reason,'cancelled');
 assert.equal(interpretAcpObservation({state:'failed',terminal:true},id).reason,'test-failed');
 assert.equal(interpretAcpObservation({state:'running',terminal:false},id).status,'agent_running');
 assert.throws(()=>interpretAcpObservation({run_id:'wc_agent_run_different',state:'completed',terminal:true},id),/mismatch/i);
});
test('quota failure is blocked, not a pretend started Agent',()=>{
 const id='wc_agent_run_abcdefghijklmnop';
 assert.deepEqual(interpretAcpObservation({state:'failed',terminal:true,reason:'usageLimitExceeded'},id),{
  runId:id,status:'blocked',reason:'provider-quota',verified:false
 });
});
