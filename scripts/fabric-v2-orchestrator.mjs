/**
 * Fabric Multi-Agent Orchestrator V2 / phase 1: local deterministic queue.
 * READ-ONLY by default. Explicit --reserve only records a reservation:
 * it NEVER calls ACP, modifies business sources, merges files, runs MySQL,
 * creates Git worktrees or authorizes deployment.
 *
 * Latest source of business requirements: docs/project/项目需求总览.md
 * ACP launch needs a separately checked provider/quota, baseline, project,
 * scoped prompt and run_id; this queue is NOT a dispatch or sandbox engine.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const QUEUE='docs/project/fabric-v2-agent-queue.json';
const STATE='tmp/fabric-v2-agent-queue.state.json';
const QUEUE_FORMAT='fabric-v2-multi-agent-queue-v1';
const STATE_FORMAT='fabric-v2-multi-agent-state-v1';
const priorities=['P0','P1','P2'];
const owners=['backend','frontend','qa','integration'];
const activeStates=new Set(['reserved_not_dispatched','agent_running','submitted_for_review']);
const validStates=new Set([...activeStates,'blocked','reviewed']);
const protectedFiles=new Set(['server.ts','src/App.tsx','AGENTS.md','server/product-master/v2CatalogAssembly.ts',
 'docs/project/项目需求总览.md','docs/project/项目现状.md']);
const hash=data=>createHash('sha256').update(data).digest('hex');
const reject=message=>{throw Error('Orchestrator refused: '+message)};
const safeId=id=>typeof id==='string'&&/^[a-z][a-z0-9-]{2,60}$/.test(id);
function safePath(rel,{edit=false}={}){
 // Canonical Chinese-titled requirements file is a fixed read-only exception.
 if(!edit&&rel==='docs/project/项目需求总览.md')return true;
 if(typeof rel!=='string'||!rel||rel.length>240||rel.includes('\\')||
   rel.includes(':')||path.isAbsolute(rel)||
   !/^[A-Za-z0-9_./-]+$/.test(rel)||path.posix.normalize(rel)!==rel||
   rel.split('/').some(x=>!x||x==='.'||x==='..'))return false;
 if(!['server/','src/','scripts/','docs/'].some(p=>rel.startsWith(p)))return false;
 if(/(?:^|\/)(?:tmp|\.git|\.env|node_modules|dist|\.agent-workspaces)(?:\/|$)/i.test(rel)||
   /(?:\.pem|\.key|secrets?\.json)$/i.test(rel))return false;
 if(edit&&(protectedFiles.has(rel)||!['server/','src/','scripts/'].some(p=>rel.startsWith(p))))return false;
 return true;
}
function strictFile(root,relative,{canMissing=false}={}){
 if(!safePath(relative))reject('unsafe file path');
 const whole=path.resolve(root,relative),base=path.resolve(root),rel=path.relative(base,whole);
 if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))reject('outside project');
 let current=base;
 for(const part of rel.split(path.sep)){
  current=path.join(current,part);
  if(!fs.existsSync(current)){
   if(canMissing)return whole;
   reject('missing project file');
  }
  if(fs.lstatSync(current).isSymbolicLink())reject('symlink in project file');
 }
 if(!fs.statSync(whole).isFile())reject('not a regular file');
 if(fs.statSync(whole).size>400_000)reject('oversized project file');
 return whole;
}
function loadJson(file){
 if(!fs.existsSync(file))reject('file not found');
 const st=fs.lstatSync(file);
 if(st.isSymbolicLink()||!st.isFile()||st.size>400_000)reject('unsafe JSON file');
 const obj=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!obj||typeof obj!=='object'||Array.isArray(obj))reject('invalid JSON object');
 return obj;
}
const unique=a=>new Set(a).size===a.length;
function orderedIds(ids){return [...ids].sort()}
export function loadQueue(root,backlogFile=QUEUE){
 const real=path.resolve(root);
 const obj=loadJson(strictFile(real,backlogFile));
 if(obj.format!==QUEUE_FORMAT||obj.source!=='docs/project/项目需求总览.md'||
  !Array.isArray(obj.tasks)||obj.tasks.length<1||obj.tasks.length>60)reject('queue schema');
 const content=fs.readFileSync(strictFile(real,obj.source),'utf8');
 const tasks=[],known=new Set();
 for(const raw of obj.tasks){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
   Object.keys(raw).some(k=>!['id','owner','priority','requirements','title','dependsOn','read','edit','remainingGate'].includes(k)))
   reject('unknown task fields');
  const {id,owner,priority,requirements,dependsOn,read,edit,title,remainingGate}=raw;
  if(!safeId(id)||known.has(id))reject('duplicate or unsafe task ID');
  known.add(id);
  if(!owners.includes(owner)||!priorities.includes(priority)||
   typeof title!=='string'||title.trim().length<12||title.length>150||
   typeof remainingGate!=='string'||remainingGate.trim().length<12||remainingGate.length>240)
   reject('task owner, priority or description');
  if(!Array.isArray(requirements)||requirements.length<1||requirements.length>4||
   !unique(requirements)||requirements.some(code=>typeof code!=='string'||
    !/^[A-Z][A-Z0-9]*-[0-9]{2}$/.test(code)||
    !(new RegExp('(?:^|[^A-Z0-9-])'+code+'(?:$|[^A-Z0-9-])')).test(content)))
   reject('requirement not in latest business overview');
  if(!Array.isArray(dependsOn)||dependsOn.length>8||!unique(dependsOn)||
   dependsOn.some(d=>!safeId(d)||d===id))reject('invalid dependency');
  if(!Array.isArray(read)||read.length<1||read.length>3||!unique(read)||
   !Array.isArray(edit)||edit.length<1||edit.length>2||!unique(edit)||
   edit.some(f=>!safePath(f,{edit:true}))||
   read.some(f=>!safePath(f)))reject('unsafe or excessive task file scope');
  for(const rel of read)strictFile(real,rel);
  for(const rel of edit){
   const full=path.resolve(real,rel);
   if(fs.existsSync(full))strictFile(real,rel);
   else{
    const parent=path.dirname(full),parentRel=path.relative(real,parent).split(path.sep).join('/');
    if(!safePath(parentRel+'/dummy.ts')||!fs.existsSync(parent)||
     fs.lstatSync(parent).isSymbolicLink()||!fs.statSync(parent).isDirectory())
     reject('missing or unsafe edit parent');
    // Resolve every ancestor, not just the immediate parent, before allowing
    // a NEW source path. Symlink parents must not redirect edits elsewhere.
    let part=real;
    for(const segment of path.relative(real,parent).split(path.sep)){
     part=path.join(part,segment);
     if(fs.lstatSync(part).isSymbolicLink())reject('symlink edit parent');
    }
   }
  }
  tasks.push({...raw,read:[...read],edit:[...edit],dependsOn:[...dependsOn],requirements:[...requirements]});
 }
 const byId=new Map(tasks.map(t=>[t.id,t]));
 const seen=new Set(),visiting=new Set();
 function visit(id){
  if(visiting.has(id))reject('dependency cycle');
  if(seen.has(id))return;
  const t=byId.get(id);
  if(!t)reject('unknown dependency');
  visiting.add(id);
  for(const d of t.dependsOn)visit(d);
  visiting.delete(id);seen.add(id);
 }
 for(const t of tasks)visit(t.id);
 return {format:QUEUE_FORMAT,source:obj.source,sourceSha256:hash(content),
  backlogSha256:hash(fs.readFileSync(strictFile(real,backlogFile))),
  tasks:tasks.sort((a,b)=>priorities.indexOf(a.priority)-priorities.indexOf(b.priority)||
   a.id.localeCompare(b.id))};
}
const emptyState=()=>({format:STATE_FORMAT,entries:{}});
function assertState(state){
 if(!state||state.format!==STATE_FORMAT||!state.entries||
  typeof state.entries!=='object'||Array.isArray(state.entries))reject('invalid state schema');
 for(const [id,entry] of Object.entries(state.entries)){
  if(!safeId(id)||!entry||typeof entry!=='object'||!validStates.has(entry.status)||
   typeof entry.sourceSha256!=='string'||!/^[0-9a-f]{64}$/.test(entry.sourceSha256)||
   typeof entry.backlogSha256!=='string'||!/^[0-9a-f]{64}$/.test(entry.backlogSha256)||
   !Array.isArray(entry.edit)||entry.edit.length<1||entry.edit.length>2||
   entry.edit.some(f=>!safePath(f,{edit:true})))reject('invalid state entry');
 }
 return state;
}
function readState(file){
 if(!fs.existsSync(file))return emptyState();
 return assertState(loadJson(file));
}
function conflict(a,b){return a.some(f=>b.includes(f))}
function checkSlots(slots){
 if(!Number.isSafeInteger(slots)||slots<0||slots>4)reject('capacity slots must be explicitly checked 0..4');
}
export function planTasks(queue,state,{slots=0}={}){
 checkSlots(slots);assertState(state);
 const tasks=queue.tasks,ids=new Set(tasks.map(t=>t.id));
 if(Object.keys(state.entries).some(id=>!ids.has(id)))reject('orphan reservation; backlog changed');
 const occupied=[],busyCount=Object.values(state.entries).filter(e=>activeStates.has(e.status)).length;
 for(const [id,e] of Object.entries(state.entries)){
  const t=tasks.find(t=>t.id===id);
  if(e.sourceSha256!==queue.sourceSha256||e.backlogSha256!==queue.backlogSha256)
   reject('active queue source changed; coordinator must reconcile');
  if(activeStates.has(e.status))occupied.push(...e.edit);
  if(!t||JSON.stringify(t.edit)!==JSON.stringify(e.edit))reject('reserved edit scope changed');
 }
 let free=Math.max(0,slots-busyCount);
 const dispatchable=[],waiting=[];
 for(const task of tasks){
  const status=state.entries[task.id]?.status;
  if(status){waiting.push({id:task.id,reason:status});continue;}
  if(task.dependsOn.some(id=>state.entries[id]?.status!=='reviewed')){
   waiting.push({id:task.id,reason:'dependency'});continue;
  }
  if(conflict(task.edit,occupied)){
   waiting.push({id:task.id,reason:'file_conflict'});continue;
  }
  if(free===0){waiting.push({id:task.id,reason:'capacity'});continue;}
  dispatchable.push({id:task.id,owner:task.owner,priority:task.priority,requirements:task.requirements,
   edit:task.edit,remainingGate:task.remainingGate,dispatchStatus:'eligible_not_started'});
  free--;occupied.push(...task.edit);
 }
 return {capacity:slots===0?'not_confirmed':'operator_declared_not_provider_verified',slots,
  busyReservations:busyCount,dispatchable,waiting,
  noAutomaticDispatch:true,releaseAuthorized:false};
}
const positiveId=id=>{if(!safeId(id))reject('invalid task ID')};
function withLock(statePath,fn){
 // Deliberately no stale-lock eviction. Parallel coordinators fail closed.
 fs.mkdirSync(path.dirname(statePath),{recursive:true});
 const lock=statePath+'.lock';
 let fd;
 try{fd=fs.openSync(lock,'wx',0o600)}
 catch{reject('queue lock busy; investigate ownership; do not auto-delete');}
 try{
  if(fs.existsSync(statePath)&&fs.lstatSync(statePath).isSymbolicLink())reject('unsafe queue state');
  const result=fn(readState(statePath));
  if(result?.changed){
   const target=statePath+'.new-'+process.pid+'-'+Date.now();
   try{
    fs.writeFileSync(target,JSON.stringify(result.state,null,2)+'\n',{flag:'wx',mode:0o600});
    fs.renameSync(target,statePath);
   }finally{if(fs.existsSync(target))fs.unlinkSync(target)}
  }
  return result.value;
 }finally{
  fs.closeSync(fd);
  fs.unlinkSync(lock);
 }
}
export function reserveTask(root,backlogFile,statePath,id,{slots=0,expectedSourceSha256}={}){
 positiveId(id);checkSlots(slots);
 if(slots===0)reject('ACP capacity not confirmed; reservation prohibited');
 const queue=loadQueue(root,backlogFile);
 if(expectedSourceSha256!==undefined&&expectedSourceSha256!==queue.sourceSha256)
  reject('stale business source fingerprint');
 return withLock(statePath,state=>{
  // Explicit operator reservation may choose ANY safe eligible task, not
  // merely the first task shown in the read-only priority recommendation.
  planTasks(queue,state,{slots}); // also rejects stale/orphan queue state
  const task=queue.tasks.find(t=>t.id===id);
  const active=Object.values(state.entries).filter(e=>activeStates.has(e.status));
  if(!task||state.entries[id]||active.length>=slots||
   task.dependsOn.some(dep=>state.entries[dep]?.status!=='reviewed')||
   active.some(entry=>conflict(task.edit,entry.edit)))
   reject('task not ready: dependency, reserved, file conflict or capacity');
  const entry={status:'reserved_not_dispatched',sourceSha256:queue.sourceSha256,
   backlogSha256:queue.backlogSha256,edit:[...task.edit],observedAt:new Date().toISOString()};
  state.entries[id]=entry;
  return {changed:true,state,value:{task:id,status:entry.status,sourceSha256:queue.sourceSha256,
   note:'Reserved only. Must separately check ACP Provider/quota and run SHA256 workspace + actual coding_agent_start.'}};
 });
}
/** Phase 2: record an actual Runner-returned Run ID after explicit
 * coding_agent_start. This local entry is NOT cryptographic proof of launch:
 * coordinator must verify the id was returned by WebCodex for this task.
 */
export function recordAgentStarted(statePath,id,runId,idempotencyKey){
 positiveId(id);
 if(typeof runId!=='string'||!/^wc_agent_run_[A-Za-z0-9_.-]{12,200}$/.test(runId)||
  typeof idempotencyKey!=='string'||!/^fabric-v2-acp-[a-f0-9]{42}$/.test(idempotencyKey))
  reject('invalid ACP start receipt');
 return withLock(statePath,state=>{
  const entry=state.entries[id];
  if(entry?.status!=='reserved_not_dispatched')reject('agent start needs active reservation');
  if(Object.values(state.entries).some(v=>v.runId===runId))reject('duplicate ACP run id');
  entry.status='agent_running';entry.runId=runId;entry.idempotencyKey=idempotencyKey;
  entry.startedAt=new Date().toISOString();
  return {changed:true,state,value:{task:id,status:entry.status,runId,verified:false,
   warning:'Local record of coordinator observed Runner response, not server attestation'}};
 });
}
/** Phase 2: only terminal Runner observations can unblock review or mark
 * blocked. Missing/unknown observations MUST leave the job running.
 */
export function recordAgentObserved(statePath,id,runId,observedState){
 positiveId(id);
 if(typeof runId!=='string'||!/^wc_agent_run_[A-Za-z0-9_.-]{12,200}$/.test(runId)||
  !['running','completed','cancelled','failed','quota'].includes(observedState))
  reject('invalid ACP observation');
 return withLock(statePath,state=>{
  const entry=state.entries[id];
  if(!entry||entry.runId!==runId)reject('ACP run observation mismatch');
  if(entry.status!=='agent_running')reject('ACP run not in running state');
  if(observedState==='running')return {changed:false,value:{task:id,status:'agent_running',verified:false}};
  if(observedState==='completed'){
   entry.status='submitted_for_review';
   entry.handedOffAt=new Date().toISOString();
  }else{
   entry.status='blocked';
   entry.reason={cancelled:'cancelled',failed:'test-failed',quota:'provider-quota'}[observedState];
   entry.blockedAt=new Date().toISOString();
  }
  return {changed:true,state,value:{task:id,status:entry.status,reason:entry.reason??null,verified:false}};
 });
}
export function markHandoff(statePath,id,runId){
 positiveId(id);
 if(typeof runId!=='string'||!/^wc_agent_run_[A-Za-z0-9_.-]{12,200}$/.test(runId))
  reject('real ACP Run ID required');
 return withLock(statePath,state=>{
  const entry=state.entries[id];
  if(entry?.status!=='reserved_not_dispatched')reject('handoff needs active reservation');
  entry.status='submitted_for_review';entry.runId=runId;entry.handedOffAt=new Date().toISOString();
  return {changed:true,state,value:{task:id,status:entry.status,verified:false}};
 });
}
export function markBlocked(statePath,id,reason){
 positiveId(id);
 if(!['provider-quota','provider-capacity','cancelled','test-failed','merge-conflict','manual-stop'].includes(reason))
  reject('unsupported blocking reason');
 return withLock(statePath,state=>{
  const entry=state.entries[id];
  if(!entry||!activeStates.has(entry.status))reject('blocking needs active reservation');
  entry.status='blocked';entry.reason=reason;entry.blockedAt=new Date().toISOString();
  return {changed:true,state,value:{task:id,status:'blocked',reason}};
 });
}
/** Explicit post-dispatch business-spec change control. The coordinator must
 * independently re-review the CURRENT requirement and provide a signed-off
 * local attestation; never silently replace a changed source fingerprint.
 * Original dispatch fingerprint is permanently retained.
 */
export function reconcileTaskSource(root,backlogFile,statePath,id,evidenceRel){
 positiveId(id);
 if(typeof evidenceRel!=='string'||!/^docs\/(?:project|operations)\/[A-Za-z0-9_./-]+\.json$/.test(evidenceRel))
  reject('invalid source reconciliation reference');
 const queue=loadQueue(root,backlogFile);
 const task=queue.tasks.find(t=>t.id===id);
 if(!task)reject('unknown task');
 const bytes=fs.readFileSync(strictFile(root,evidenceRel));
 const proof=JSON.parse(bytes.toString('utf8'));
 const sameIds=Array.isArray(proof?.requirements)&&
  JSON.stringify([...proof.requirements].sort())===JSON.stringify([...task.requirements].sort());
 if(proof?.format!=='fabric-v2-task-source-reconciliation-v1'||proof.task!==id||
  proof.decision!=='reviewed-current-requirements'||sameIds!==true||
  proof.currentSourceSha256!==queue.sourceSha256||
  proof.backlogSha256!==queue.backlogSha256||
  typeof proof.previousSourceSha256!=='string'||!/^[0-9a-f]{64}$/.test(proof.previousSourceSha256)||
  proof.testVerified!==true||proof.codeScopeVerified!==true||
  typeof proof.reviewer!=='string'||!/^[A-Za-z0-9_-]{12,80}$/.test(proof.reviewer)||
  typeof proof.rationale!=='string'||proof.rationale.trim().length<35||proof.rationale.length>1200)
  reject('source reconciliation evidence incomplete or invalid');
 return withLock(statePath,state=>{
  const entry=state.entries[id];
  if(entry?.status!=='submitted_for_review'||!entry.runId||
   entry.sourceSha256!==proof.previousSourceSha256||
   entry.backlogSha256!==queue.backlogSha256||
   entry.sourceSha256===queue.sourceSha256||entry.dispatchedSourceSha256)
   reject('source reconciliation state or prior fingerprint invalid');
  entry.dispatchedSourceSha256=entry.sourceSha256;
  entry.sourceSha256=queue.sourceSha256;
  entry.reconciliationEvidence=evidenceRel;
  entry.reconciliationSha256=hash(bytes);
  entry.reconciledAt=new Date().toISOString();
  return {changed:true,state,value:{task:id,status:'reconciled_pending_review',
   originalSourceSha256:entry.dispatchedSourceSha256,
   reviewedCurrentSourceSha256:entry.sourceSha256,releaseAuthorized:false}};
 });
}
export function markReviewed(root,backlogFile,statePath,id,evidenceRel){
 positiveId(id);
 if(typeof evidenceRel!=='string'||!/^docs\/(?:project|operations)\/[A-Za-z0-9_./-]+\.json$/.test(evidenceRel))
  reject('invalid evidence reference');
 const queue=loadQueue(root,backlogFile);
 const evidenceFile=strictFile(root,evidenceRel);
 const bytes=fs.readFileSync(evidenceFile);
 const attestation=JSON.parse(bytes.toString('utf8'));
 if(attestation?.format!=='fabric-v2-task-review-v1'||attestation.task!==id||
  attestation.result!=='accepted'||attestation.testVerified!==true||
  attestation.lintVerified!==true||attestation.buildVerified!==true||
  attestation.mergeGateVerified!==true||typeof attestation.reviewer!=='string'||
  !/^[A-Za-z0-9_-]{12,80}$/.test(attestation.reviewer))
  reject('evidence incomplete; no automatic acceptance');
 return withLock(statePath,state=>{
  const entry=state.entries[id];
  if(entry?.status!=='submitted_for_review'||entry.sourceSha256!==queue.sourceSha256||
    entry.backlogSha256!==queue.backlogSha256)reject('handoff or source fingerprint invalid');
  entry.status='reviewed';entry.evidenceFile=evidenceRel;
  entry.evidenceSha256=hash(bytes);entry.reviewedAt=new Date().toISOString();
  return {changed:true,state,value:{task:id,status:'reviewed',evidenceSha256:entry.evidenceSha256,
   releaseAuthorized:false,notice:'Coordinator attestation, NOT independent verification of evidence truth or production release'}};
 });
}
export function queueReport(root,backlogFile,statePath,{slots=0}={}){
 const q=loadQueue(root,backlogFile),state=readState(statePath);
 const plan=planTasks(q,state,{slots});
 const values=Object.values(state.entries);
 return {...plan,source:q.source,sourceSha256:q.sourceSha256,backlogSha256:q.backlogSha256,
  totalTasks:q.tasks.length,counts:{
   queued:q.tasks.length-values.length,reserved:values.filter(e=>e.status==='reserved_not_dispatched').length,
   running:values.filter(e=>e.status==='agent_running').length,
   submitted:values.filter(e=>e.status==='submitted_for_review').length,
   blocked:values.filter(e=>e.status==='blocked').length,reviewed:values.filter(e=>e.status==='reviewed').length,
   observedAgentRuns:null // requires Runner coding_agent_observe; never infer from queue state
  }};
}
const main=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(main){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const statePath=path.join(root,STATE);
 try{
  const [action,a,b,c]=process.argv.slice(2);
  let result;
  if(action==='--plan'&&process.argv.length<=4)result=queueReport(root,QUEUE,statePath,{slots:a===undefined?0:Number(a)});
  else if(action==='--reserve'&&a&&b&&c)result=reserveTask(root,QUEUE,statePath,a,{slots:Number(b),expectedSourceSha256:c});
  else if(action==='--started'&&a&&b&&c)result=recordAgentStarted(statePath,a,b,c);
  else if(action==='--observed'&&a&&b&&c)result=recordAgentObserved(statePath,a,b,c);
  else if(action==='--handoff'&&a&&b)result=markHandoff(statePath,a,b);
  else if(action==='--block'&&a&&b)result=markBlocked(statePath,a,b);
  else if(action==='--reconcile'&&a&&b)result=reconcileTaskSource(root,QUEUE,statePath,a,b);
  else if(action==='--review'&&a&&b)result=markReviewed(root,QUEUE,statePath,a,b);
  else reject('usage: --plan [capacity] | --reserve ID capacity sourceSha256 | --started ID runId replayKey | --observed ID runId running|completed|failed|cancelled|quota | --block ID reason | --reconcile ID evidence.json | --review ID evidence.json');
  console.log(JSON.stringify(result,null,2));
 }catch(e){console.error(String(e.message));process.exitCode=2}
}
