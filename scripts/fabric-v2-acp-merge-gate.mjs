/** Read-only ACP merge preflight. NEVER merges/deletes files.
 * Usage: node scripts/fabric-v2-acp-merge-gate.mjs SNAPSHOT AGENT_WORKSPACE MAIN_WORKSPACE A|B|C|D|E
 * Compare SHA256 three ways even when current V2 files are untracked in Git.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildBrief} from './fabric-v2-agent-brief.mjs';
import {loadQueue} from './fabric-v2-orchestrator.mjs';

const sourceRoots=['server','src','scripts','docs/product-master','docs/development','docs/ui-design',
 'docs/retrospectives/development','.agents/skills/fabric-product-master-v2',
 '.agents/skills/fabric-ui-design','.agents/skills/writing-plans',
 '.agents/skills/executing-plans','.agents/skills/test-driven-development',
 '.agents/skills/systematic-debugging','.agents/skills/requesting-code-review',
 '.agents/skills/verification-before-completion'];
const topFiles=['AGENTS.md','package.json','package-lock.json','tsconfig.json','tsconfig.node.json',
 'vite.config.ts','index.html','postcss.config.js','eslint.config.js'];
const skipDirs=new Set(['node_modules','.git','dist','build','coverage','tmp','artifacts','outputs',
 'uploads','.next','.cache','test-results','playwright-report','backups','fixtures-media']);
const supervisorOnly=['AGENTS.md','server.ts','src/App.tsx','server/product-master/v2CatalogAssembly.ts',
 'docs/product-master/product-master-v2-progress.md','scripts/fabric-v2-agent-brief.mjs'];
const sha=b=>createHash('sha256').update(b).digest('hex');
function fail(message){throw Error(message);}
function safeRel(rel){
 if(typeof rel!=='string'||!rel||path.isAbsolute(rel)||rel.includes('\\')||rel.includes(':')||
    /[\x00-\x1f]/.test(rel)||rel.split('/').some(part=>!part||part==='.'||part==='..')||
    path.posix.normalize(rel)!==rel)fail('Invalid source path');
 return rel;
}
function readFile(root,rel){
 const f=path.join(root,safeRel(rel));
 if(!fs.existsSync(f))return null;
 const meta=fs.lstatSync(f);
 if(!meta.isFile()||meta.isSymbolicLink())fail('Non-regular source path: '+rel);
 return fs.readFileSync(f);
}
function inventory(root){
 const found=new Set();
 function visit(relative){
  const full=path.join(root,relative);
  if(!fs.existsSync(full))return;
  const stat=fs.lstatSync(full);
  if(stat.isSymbolicLink())fail('Workspace symlink found: '+relative);
  if(stat.isDirectory()){
   for(const item of fs.readdirSync(full,{withFileTypes:true})){
    if(!relative&&item.name==='.fabric-acp-workspace.json'&&item.isFile())continue;
    if(skipDirs.has(item.name)&&item.isDirectory())fail('Unexpected generated workspace directory');
    if(item.name.startsWith('.')&&item.name!=='.agents'&&item.isDirectory())
     fail('Unexpected hidden workspace source directory');
    visit(path.posix.join(relative.replaceAll('\\','/'),item.name));
   }
  }else if(stat.isFile()){
   if(stat.size>2*1024*1024)fail('Unreviewed large source: '+relative);
   found.add(safeRel(relative.replaceAll('\\','/')));
  }else fail('Unsupported workspace source type: '+relative);
 }
 // Whole isolated workspace, not only baseline roots: root secrets and out-of-scope
 // docs/new files must never be invisible to ownership review.
 visit('');
 return found;
}
const inScope=(file,owned)=>owned.some(prefix=>prefix.endsWith('/')?
 file.startsWith(prefix):file===prefix);
/** Optional V2 task-bound ownership. No wildcards, no fallback to legacy role
 * when the requested task is missing/stale/unreviewed.
 */
function taskOwnedPaths(main,agent,snapshot,owner,taskId){
 const queue=loadQueue(main);
 const task=queue.tasks.find(t=>t.id===taskId);
 const roles={backend:'A',frontend:'C',qa:'C',integration:'D'};
 if(!task||roles[task.owner]!==owner)fail('Task owner differs from requested ACP role');
 const stateFile=path.join(main,'tmp','fabric-v2-agent-queue.state.json');
 if(!fs.existsSync(stateFile)||fs.lstatSync(stateFile).isSymbolicLink())fail('Task queue state unavailable');
 const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
 const record=state?.entries?.[taskId];
 if(state?.format!=='fabric-v2-multi-agent-state-v1'||
    record?.status!=='submitted_for_review'||
    record.sourceSha256!==queue.sourceSha256||record.backlogSha256!==queue.backlogSha256||
    JSON.stringify([...record.edit].sort())!==JSON.stringify([...task.edit].sort())||
    !/^wc_agent_run_[A-Za-z0-9_.-]{12,200}$/.test(String(record.runId??'')))
  fail('Task has no fresh observed ACP completion or ownership receipt');
 const meta=path.join(agent,'.fabric-acp-workspace.json');
 if(!fs.existsSync(meta)||fs.lstatSync(meta).isSymbolicLink())fail('Missing isolated workspace proof');
 const from=JSON.parse(fs.readFileSync(meta,'utf8'));
 if(from.format!=='fabric-v2-acp-workspace-v1'||from.role!==owner||
    path.resolve(from.snapshot)!==path.resolve(snapshot))fail('Workspace snapshot or role mismatch');
 return task.edit;
}
function gate(snapshot,agent,main,owner,taskId){
 const brief=taskId?{ownedPaths:taskOwnedPaths(main,agent,snapshot,owner,taskId)}:buildBrief(owner);
 for(const r of [snapshot,agent,main]){
  if(!fs.statSync(r).isDirectory())fail('Missing source workspace');
 }
 if(path.resolve(snapshot)===path.resolve(agent)||path.resolve(snapshot)===path.resolve(main)||
    path.resolve(agent)===path.resolve(main))fail('Workspaces must be physically separate');
 const manifest=JSON.parse(fs.readFileSync(path.join(snapshot,'manifest.json'),'utf8'));
 if(manifest.format!=='fabric-v2-safe-source-v1'||!Array.isArray(manifest.entries)||
    manifest.count!==manifest.entries.length||manifest.count===0)fail('Invalid source manifest');
 const baseline=new Map();let total=0;
 for(const entry of manifest.entries){
  const rel=safeRel(entry.file);
  if(baseline.has(rel)||!/^[0-9a-f]{64}$/.test(entry.sha256)||
    !Number.isSafeInteger(entry.bytes)||entry.bytes<0)fail('Invalid or duplicated baseline entry');
  const original=readFile(snapshot,rel);
  if(!original||original.length!==entry.bytes||sha(original)!==entry.sha256)
   fail('Baseline integrity mismatch: '+rel);
  total+=entry.bytes;
  baseline.set(rel,entry);
 }
 if(total!==manifest.totalBytes)fail('Baseline byte count mismatch');
 const changes=[],added=[],blocked=[];
 for(const [rel,e] of baseline){
  const candidate=readFile(agent,rel);
  if(!candidate){blocked.push(rel+':agent-deleted');continue;}
  const modified=candidate.length!==e.bytes||sha(candidate)!==e.sha256;
  if(!modified)continue;
  if(supervisorOnly.includes(rel)||!inScope(rel,brief.ownedPaths)){
   blocked.push(rel+':outside-owner');continue;
  }
  const now=readFile(main,rel);
  if(!now||now.length!==e.bytes||sha(now)!==e.sha256){
   blocked.push(rel+':main-changed-after-snapshot');continue;
  }
  changes.push(rel);
 }
 // No guessing from Git status: new, untracked V2 files count as first-class edits.
 const agentFiles=inventory(agent);
 for(const rel of agentFiles){
  if(baseline.has(rel))continue;
  const filename=path.posix.basename(rel).toLowerCase();
  if(filename.startsWith('.')||filename.endsWith('.env')||filename.includes('.env.')||
     /secret|credential|private|keypair|id_rsa|id_ed25519/.test(filename)||
     /\.(?:pem|key)$/.test(filename)){
   blocked.push(rel+':sensitive-extra');continue;
  }
  if(supervisorOnly.includes(rel)||!inScope(rel,brief.ownedPaths)){
   blocked.push(rel+':new-outside-owner');continue;
  }
  if(readFile(main,rel)!==null){
   blocked.push(rel+':new-file-already-exists-in-main');continue;
  }
  added.push(rel);
 }
 // Every manifest item must also be physically present in the agent tree.
 changes.sort();added.sort();blocked.sort();
 return {format:'fabric-v2-acp-merge-gate-v1',owner,taskId:taskId??null,
  taskScoped:Boolean(taskId),ready:blocked.length===0,
  snapshotFiles:baseline.size,changed:changes,added,blocked,
  note:'Read-only change eligibility only; not authorization to merge. Main owner must review exact diffs, repeat immediately before merge, recheck hashes, and test.'};
}
try{
 const [, ,snapshot,agent,main,owner,mode,taskId]=process.argv;
 if(!snapshot||!agent||!main||!owner||
   !([6,8].includes(process.argv.length))||
   (process.argv.length===8&&(!taskId||mode!=='--task')))
  fail('Usage: node scripts/fabric-v2-acp-merge-gate.mjs SNAPSHOT AGENT MAIN A|B|C|D|E [--task QUEUE_TASK_ID]');
 const report=gate(path.resolve(snapshot),path.resolve(agent),path.resolve(main),owner,taskId);
 console.log(JSON.stringify(report));
 if(!report.ready)process.exitCode=2;
}catch(e){console.error('ACP merge gate refused: '+String(e.message));process.exitCode=2;}
