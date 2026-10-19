/** Pure WebCodex ACP dispatch adapter — NEVER invokes a coding Agent, shell, DB or Git.
 * Only the coordinator may call coding_agent_start/observe with the emitted envelope.
 * No ACP quota/parallel slots API has been verified; one explicit probing attempt
 * at a time is allowed only after operator approval and safe queue reservation.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadQueue} from './fabric-v2-orchestrator.mjs';

const sha=data=>createHash('sha256').update(data).digest('hex');
const fail=(msg)=>{throw Error('ACP runner bridge refused: '+msg);};
const validRun=v=>typeof v==='string'&&/^wc_agent_run_[A-Za-z0-9_.-]{12,200}$/.test(v);
const roleFor={backend:'A',frontend:'C',qa:'C',integration:'D'};
function safeRead(file,limit=1048576){
 if(!fs.existsSync(file))fail('missing snapshot or workspace evidence');
 const stat=fs.lstatSync(file);
 if(stat.isSymbolicLink()||!stat.isFile()||stat.size>limit)fail('unsafe snapshot or workspace evidence');
 return fs.readFileSync(file);
}
function childOf(parent,child){
 const rel=path.relative(parent,child);
 return rel!==''&&rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);
}
export function readRunnerCapability(status,providerId='codex'){
 const f=status?.focus;
 const providers=Array.isArray(f?.coding_agent_providers)?f.coding_agent_providers:[];
 const providerConnected=f?.connected===true&&f?.status==='online'&&
  providers.some(item=>item?.provider_id===providerId);
 // A generic Runner Job slot isn't an ACP capacity/quota promise.
 return Object.freeze({providerId,providerConnected,
  confirmedAcpSlots:null,quotaRemaining:null,canAutoFanOut:false,
  singleProbeAllowed:providerConnected});
}
function assertNoSymlinkComponents(base,relative){
 let cursor=base;
 for(const component of relative.split('/')){
  cursor=path.join(cursor,component);
  if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink())
   fail('symlink path component in workspace or baseline');
 }
}
function verifyWorkspace(root,workspace,role){
 const main=path.resolve(root),work=path.resolve(workspace);
 const expected=path.join(main,'.agent-workspaces');
 if(!childOf(expected,work)||path.dirname(work)!==expected||
  !/^acp-[a-e]-[a-z0-9-]{3,65}$/.test(path.basename(work)))
  fail('isolated workspace location not allowed');
 if(!fs.existsSync(expected)||fs.lstatSync(expected).isSymbolicLink()||
    !fs.statSync(expected).isDirectory()||!fs.existsSync(work)||
    fs.lstatSync(work).isSymbolicLink()||!fs.statSync(work).isDirectory())
  fail('unsafe isolated workspace');
 const record=JSON.parse(safeRead(path.join(work,'.fabric-acp-workspace.json'),8192));
 if(record.format!=='fabric-v2-acp-workspace-v1'||record.role!==role||
  typeof record.snapshot!=='string'||typeof record.baselineManifestSha256!=='string')
  fail('workspace role or baseline metadata invalid');
 const snapshot=path.resolve(record.snapshot);
 const store=path.resolve(main,'..','fabric-agent-baselines');
 if(path.dirname(snapshot)!==store||!path.basename(snapshot).startsWith('v2-'))
  fail('baseline must be in sibling snapshot store');
 const manifestBytes=safeRead(path.join(snapshot,'manifest.json'),524288);
 if(sha(manifestBytes)!==record.baselineManifestSha256)fail('snapshot manifest hash mismatch');
 const manifest=JSON.parse(manifestBytes);
 if(manifest.format!=='fabric-v2-safe-source-v1'||!Array.isArray(manifest.entries)||
  manifest.entries.length!==manifest.count||manifest.count<1||
  manifest.count>3000||record.count!==manifest.count)fail('snapshot metadata inconsistent');
 const seen=new Set();let bytes=0;
 for(const item of manifest.entries){
  const rel=item?.file;
  if(typeof rel!=='string'||rel.includes('\\')||rel.includes(':')||
   path.isAbsolute(rel)||path.posix.normalize(rel)!==rel||
   rel.split('/').some(t=>!t||t==='.'||t==='..')||seen.has(rel)||
   !Number.isSafeInteger(item.bytes)||item.bytes<0||item.bytes>2097152||
   typeof item.sha256!=='string'||!/^[0-9a-f]{64}$/.test(item.sha256))
   fail('unsafe snapshot manifest entry');
  seen.add(rel);
  assertNoSymlinkComponents(snapshot,rel);
  assertNoSymlinkComponents(work,rel);
  const src=path.join(snapshot,rel),dst=path.join(work,rel);
  const a=safeRead(src,2097152),b=safeRead(dst,2097152);
  if(a.length!==item.bytes||b.length!==item.bytes||sha(a)!==item.sha256||sha(b)!==item.sha256)
   fail('snapshot/workspace byte hash differs');
  bytes+=a.length;
 }
 if(bytes!==manifest.totalBytes)fail('snapshot total bytes mismatch');
 return {work,snapshot,manifestSha256:sha(manifestBytes),fileCount:manifest.count};
}
export function buildAcpLaunchEnvelope({
 root,queueFile='docs/project/fabric-v2-agent-queue.json',taskId,
 workspace,registeredProject,runnerStatus,providerId='codex',
 allowSingleProbe=false,expectedSourceSha256
}={}){
 if(!allowSingleProbe)fail('one ACP probing attempt must be explicitly approved');
 if(typeof root!=='string'||!path.isAbsolute(root))fail('absolute project root required');
 const cap=readRunnerCapability(runnerStatus,providerId);
 if(!cap.singleProbeAllowed)fail('Codex ACP provider not connected/online');
 if(typeof registeredProject!=='string'||
  !/^agent:[A-Za-z0-9_-]{5,128}:fabricv2-[A-Za-z0-9_-]{5,90}$/.test(registeredProject)||
  registeredProject===('agent:'+runnerStatus.focus.client_id+':fabric'))
  fail('registered isolated Project required, never main project');
 if(registeredProject.split(':')[1]!==runnerStatus.focus.client_id)
  fail('wrong Runner for isolated Project');
 const queue=loadQueue(root,queueFile);
 if(expectedSourceSha256&&queue.sourceSha256!==expectedSourceSha256)
  fail('stale requirements source SHA');
 const task=queue.tasks.find(t=>t.id===taskId);
 if(!task)fail('unknown or retired task');
 const role=roleFor[task.owner];
 if(!role)fail('unsupported agent role');
 const verified=verifyWorkspace(root,workspace,role);
 // Snapshot is immutable, and all task sources MUST exist in the snapshot.
 const manifest=JSON.parse(safeRead(path.join(verified.snapshot,'manifest.json'),524288));
 const entryNames=new Set(manifest.entries.map(e=>e.file));
 for(const f of task.read)if(!entryNames.has(f))fail('task read file absent from immutable source snapshot');
 for(const f of task.edit){
  assertNoSymlinkComponents(verified.work,f);
  if(!entryNames.has(f)&&!fs.existsSync(path.dirname(path.join(verified.work,f))))
   fail('new edit target lacks isolated workspace parent');
 }
 const replay=sha([queue.sourceSha256,queue.backlogSha256,task.id,
  verified.manifestSha256,verified.work,registeredProject,providerId].join('\0'));
 const instruction=[
  'Fabric isolated ACP code task ('+task.id+'). Work ONLY in this registered isolated Project.',
  'Business source: docs/project/项目需求总览.md (task IDs: '+task.requirements.join(', ')+').',
  'Goal: '+task.title+'.',
  'READ at most: '+task.read.join(', ')+'.',
  'EDIT EXACTLY (no other files): '+task.edit.join(', ')+'.',
  'Important open acceptance Gate: '+task.remainingGate+'.',
  'Use narrow TDD RED->GREEN, targeted tests, report actual counts and touched files.',
  'NEVER edit main D:\\fabric; no SQL/SSH/COS, production environment, Git commit, cleanup or deploy.',
  'Do not delegate to subagents, crawl entire repo or run full build/lint; coordinator reviews and merges.',
  'Return DONE or DONE_WITH_CONCERNS with unresolved gates. Code completion is NOT release authorization.'
 ].join('\n');
 return Object.freeze({
  tool:'coding_agent_start',probeOnly:true,confirmedParallelAcpSlots:null,quotaRemaining:null,
  releaseAuthorized:false,task:task.id,role,sourceSha256:queue.sourceSha256,
  backlogSha256:queue.backlogSha256,workspace:verified.work,
  verifiedSourceCount:verified.fileCount,manifestSha256:verified.manifestSha256,
  note:'Tool action requires explicit operator decision; no ACP launch performed by this module.',
  arguments:Object.freeze({project:registeredProject,provider_id:providerId,
   idempotency_key:'fabric-v2-acp-'+replay.slice(0,42),instruction,timeout_secs:220})
 });
}
export function interpretAcpStart(result,envelope){
 if(!envelope||envelope.tool!=='coding_agent_start'||typeof envelope.task!=='string')
  fail('unexpected ACP envelope');
 const run=result?.run_id;
 if(!validRun(run)||result?.terminal===true||result?.verified===true)
  fail('unexpected coding_agent_start acknowledgement');
 return {task:envelope.task,runId:run,terminal:false,verified:false};
}
export function interpretAcpObservation(observation,expectedRunId){
 if(!validRun(expectedRunId))fail('invalid expected run id');
 if(observation?.run_id&&observation.run_id!==expectedRunId)fail('observation run mismatch');
 if(observation?.state==='completed'&&observation.terminal===true)
  return {runId:expectedRunId,status:'submitted_for_review',verified:false};
 if(observation?.state==='failed'&&observation.terminal===true)
  return {runId:expectedRunId,status:'blocked',
   reason:observation.reason==='usageLimitExceeded'?'provider-quota':'test-failed',verified:false};
 if(observation?.state==='cancelled'&&observation.terminal===true)
  return {runId:expectedRunId,status:'blocked',reason:'cancelled',verified:false};
 return {runId:expectedRunId,status:'agent_running',verified:false};
}
