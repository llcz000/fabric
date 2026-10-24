/** Fabric parallel Git tasks: isolated worktrees, exact ownership and serial integration. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const defaultRoot=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const sha=(data)=>createHash('sha256').update(data).digest('hex');
const fail=(message)=>{throw Error(message);};
function exec(cwd,program,args,{allowFailure=false}={}){
 const r=spawnSync(program,args,{cwd,encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true});
 if(r.error)fail(r.error.message);
 if(r.status!==0&&!allowFailure)fail(program+' '+args.slice(0,3).join(' ')+': '+(r.stderr||r.stdout).trim());
 return {ok:r.status===0,stdout:r.stdout||'',stderr:r.stderr||'',code:r.status};
}
const git=(cwd,...args)=>exec(cwd,'git',args).stdout.trim();
const status=(cwd)=>git(cwd,'status','--porcelain=v1','--untracked-files=all');
const relSafe=(v)=>{
 if(typeof v!=='string'||!v||v.includes('\\')||v.includes(':')||v.startsWith('/')||v.endsWith('/')||
    v.split('/').some(x=>!x||x==='.'||x==='..')||v.includes('\0'))fail('Unsafe task path: '+v);
 return v;
};
function allowed(file){
 relSafe(file);
 if(!/^(src|server|tests|scripts)\/[A-Za-z0-9_.\/-]+$/.test(file))fail('Task path outside application code/tests: '+file);
 if(/(^|\/)(?:\.env(?:\.|$)|node_modules|dist|artifacts|tmp|uploads|\.local|secrets?|credentials?|private|id_rsa|id_ed25519)(\/|\.|$)/i.test(file)||
    /(?:^|\/)(?:server\.ts|App\.tsx|v2CatalogAssembly\.ts)$/i.test(file)||
    /^scripts\/(?:release|fabric-parallel|init-fabric-workspace|check-fabric-v2-development-source|fabric-v2-(?:acp|orchestrator|safe-baseline|workspace))/.test(file)||
    /^server\/(?:db|migrations?|image-assets\/migrations?)\//.test(file))
  fail('Supervisor-owned or sensitive task path: '+file);
 return file;
}
function taskId(id){
 if(typeof id!=='string'||!/^[a-z][a-z0-9-]{2,47}$/.test(id))fail('Task ID must be lowercase slug (3-48 characters)');
 return id;
}
function within(base,target){
 const relative=path.relative(base,target);
 return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);
}
function rootContext(controller=defaultRoot){
 const root=fs.realpathSync(controller);
 const pointer=JSON.parse(fs.readFileSync(path.join(root,'docs/project/fabric-v2-active-workspace.json'),'utf8'));
 if(pointer.role==='application'){
  if(!fs.existsSync(path.join(root,'src'))||!fs.existsSync(path.join(root,'server')))fail('Application source missing from single checkout');
  return {root,active:root,store:path.join(root,'.local','parallel-tasks'),tasksParent:path.join(root,'.agent-workspaces','parallel-tasks'),pointer};
 }
 const relative=relSafe(pointer.workspace.replaceAll('\\','/'));
 const active=fs.realpathSync(path.resolve(root,relative));
 if(!within(root,active)||path.normalize(git(active,'rev-parse','--show-toplevel')).toLowerCase()!==path.normalize(active).toLowerCase())
  fail('Application worktree must be registered inside controller');
 const store=path.join(root,'.local','parallel-tasks');
 const tasksParent=path.join(root,'.agent-workspaces','parallel-tasks');
 return {root,active,store,tasksParent,pointer};
}
function ensureSafeDir(directory){
 let current=path.parse(directory).root;
 for(const part of path.relative(current,directory).split(path.sep)){
  current=path.join(current,part);
  if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())fail('Symlink in managed directory: '+current);
 }
}
function records(ctx){
 if(!fs.existsSync(ctx.store))return [];
 ensureSafeDir(ctx.store);
 return fs.readdirSync(ctx.store).filter(name=>/^[a-z][a-z0-9-]{2,47}\.json$/.test(name))
   .map(name=>JSON.parse(fs.readFileSync(path.join(ctx.store,name),'utf8')));
}
const metadata=(ctx,id)=>path.join(ctx.store,taskId(id)+'.json');
function readTask(ctx,id){
 const name=metadata(ctx,id);
 if(!fs.existsSync(name))fail('Unknown parallel task: '+id);
 const task=JSON.parse(fs.readFileSync(name,'utf8'));
 if(task.id!==id||task.format!=='fabric-parallel-git-v1')fail('Invalid task receipt');
 if(task.workspace!==path.join(ctx.tasksParent,id)||task.branch!=='fabric/parallel/'+id)fail('Task path/branch does not match fixed allocation');
 return task;
}
function save(ctx,task,{newOnly=false}={}){
 const target=metadata(ctx,task.id);
 fs.mkdirSync(ctx.store,{recursive:true});
 ensureSafeDir(ctx.store);
 const tmp=target+'.next';
 fs.writeFileSync(tmp,JSON.stringify(task,null,2)+'\n',{flag:'wx'});
 try{
  if(newOnly&&fs.existsSync(target))fail('Task already exists: '+task.id);
  fs.renameSync(tmp,target);
 }finally{if(fs.existsSync(tmp))fs.rmSync(tmp);}
}
function locked(ctx,fn){
 fs.mkdirSync(ctx.store,{recursive:true});ensureSafeDir(ctx.store);
 const name=path.join(ctx.store,'.lock'),fd=fs.openSync(name,'wx');
 try{return fn();}finally{fs.closeSync(fd);fs.unlinkSync(name);}
}
function cleanIntegration(ctx){
 if(status(ctx.root))fail('Controller has uncommitted changes; commit/review them first');
 if(status(ctx.active))fail('Main application has uncommitted changes; no merge into dirty main');
}
const requirementHash=ctx=>sha(fs.readFileSync(path.join(ctx.active,'docs/project/项目需求总览.md')));
function changedFiles(cwd,base,head){
 const r=git(cwd,'diff','--name-status','--no-renames',base,head);
 return r?r.split(/\r?\n/).map(line=>{
  const parts=line.split('\t');if(parts.length!==2||!/^[AMDT]$/.test(parts[0]))fail('Unsupported diff entry: '+line);
  return {type:parts[0],path:parts[1]};
 }):[];
}
function changedInHistory(cwd,base,head){
 const out=git(cwd,'log','--pretty=format:','--name-only','--no-renames',base+'..'+head);
 return out?out.split(/\r?\n/).filter(Boolean):[];
}
function commonGuard(ctx,task){
 cleanIntegration(ctx);
 if(task.status!=='active')fail('Task not active: '+task.status);
 if(!fs.existsSync(task.workspace))fail('Missing task worktree');
 if(path.normalize(git(task.workspace,'rev-parse','--show-toplevel')).toLowerCase()!==path.normalize(task.workspace).toLowerCase())fail('Task checkout identity changed');
 if(git(task.workspace,'branch','--show-current')!==task.branch)fail('Task branch changed');
 if(status(task.workspace))fail('Task worktree has uncommitted/untracked files; commit reviewed files first');
 if(!exec(task.workspace,'git',['merge-base','--is-ancestor',task.baseHead,'HEAD'],{allowFailure:true}).ok)fail('Task branch diverged from original base');
 if(requirementHash(ctx)!==task.requirementsSha256)fail('Requirements changed during task; reconcile and re-review before merging');
 const head=git(task.workspace,'rev-parse','HEAD'),main=git(ctx.active,'rev-parse','HEAD');
 if(head===task.baseHead)fail('Task has no committed changes');
 const diff=changedFiles(task.workspace,task.baseHead,head);
 const touched=[...new Set([...diff.map(e=>e.path),...changedInHistory(task.workspace,task.baseHead,head)])];
 if(touched.some(x=>!task.edit.includes(x)))fail('Task changed files outside exact ownership: '+touched.filter(x=>!task.edit.includes(x)).join(', '));
 if(diff.length===0)fail('Task changes are empty after review');
 const mainChanges=changedFiles(ctx.active,task.baseHead,main).map(x=>x.path);
 const conflicts=mainChanges.filter(x=>task.edit.includes(x));
 if(conflicts.length)fail('Main changed owned files since task start: '+conflicts.join(', '));
 for(const other of records(ctx)){
  if(other.id===task.id||!['integrating','awaiting-postcheck'].includes(other.status))continue;
  fail('Previous integration is unresolved: '+other.id+' ('+other.status+')');
 }
 const mergeTree=exec(ctx.active,'git',['merge-tree','--write-tree',main,head],{allowFailure:true});
 if(!mergeTree.ok)fail('Git three-way merge conflict; manual integration review needed');
 return {head,main,diff,touched,mergeTree:mergeTree.stdout.split(/\r?\n/)[0],ready:true};
}
function proof(ctx,check){
 if(typeof check?.command!=='string'||!check.command.trim()||check.passed!==true||
    typeof check.logPath!=='string'||!/^[a-f0-9]{64}$/.test(check.sha256||''))fail('A passing check requires a command, nonempty local log and SHA256');
 const file=path.resolve(ctx.root,relSafe(check.logPath));
 if(!within(ctx.store,file)||!fs.existsSync(file)||!within(ctx.store,fs.realpathSync(file))||
    fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile()||fs.statSync(file).size===0||
    sha(fs.readFileSync(file))!==check.sha256)fail('Check log missing, empty or tampered: '+check.logPath);
 return true;
}
function reviewFile(ctx,task,relative,guard){
 const file=path.resolve(ctx.root,relSafe(relative));
 if(!within(ctx.store,file)||!fs.existsSync(file)||!within(ctx.store,fs.realpathSync(file))||fs.lstatSync(file).isSymbolicLink())fail('Review receipt must be a file in .local/parallel-tasks');
 const record=JSON.parse(fs.readFileSync(file,'utf8'));
 if(record.format!=='fabric-parallel-review-v1'||record.taskId!==task.id||record.taskHead!==guard.head||
    record.baseHead!==task.baseHead||record.mainHead!==guard.main||
    record.specReviewed!==true||record.qualityReviewed!==true||
    typeof record.reviewer!=='string'||record.reviewer.trim().length<2||record.reviewer===task.owner||
    !Array.isArray(record.checks)||!record.checks.length||
    record.checks.some(x=>!proof(ctx,x)))
  fail('Missing or stale task review: require exact HEADs, reviewer, spec/quality reviews and passing tests');
 return {file,sha256:sha(fs.readFileSync(file)),reviewer:record.reviewer,checks:record.checks.length};
}
export function audit(controller=defaultRoot){
 const ctx=rootContext(controller);
 const taskList=records(ctx).map(t=>({id:t.id,status:t.status,branch:t.branch,baseHead:t.baseHead,workspace:t.workspace,clean:fs.existsSync(t.workspace)?!status(t.workspace):null}));
 const wts=git(ctx.active,'worktree','list','--porcelain').split(/\r?\n/).filter(x=>x.startsWith('worktree ')).map(x=>x.slice(9));
 const norm=x=>path.normalize(x).toLowerCase();
 const isTask=x=>norm(x).startsWith(norm(ctx.tasksParent+path.sep));
 const legacyWorktrees=wts.filter(x=>norm(x)!==norm(ctx.root)&&norm(x)!==norm(ctx.active)&&!isTask(x)).map(x=>{
  try{const dirty=status(x);return {path:x,clean:!dirty,uncommitted:dirty?dirty.split(/\r?\n/).length:0};}
  catch{return {path:x,clean:null,uncommitted:null};}
 });
 return {controller:ctx.root,active:ctx.active,projectClean:!status(ctx.root)&&!status(ctx.active),registeredWorktrees:wts.length,taskList,legacyWorktrees,allRegisteredClean:legacyWorktrees.every(x=>x.clean===true)&&taskList.every(x=>x.clean===true)&&!status(ctx.root)&&!status(ctx.active)};
}
export function start(controller,id,edit,owner='task-owner'){
 const ctx=rootContext(controller);
 taskId(id);
 const paths=[...new Set(edit.map(allowed))].sort();
 if(!paths.length||paths.length!==edit.length||paths.length>30)fail('Require 1-30 unique exact writable files');
 if(typeof owner!=='string'||owner.length<2||owner.length>80)fail('Invalid owner');
 return locked(ctx,()=>{
  cleanIntegration(ctx);
  const source=exec(ctx.active,process.execPath,['scripts/check-fabric-v2-development-source.mjs'],{allowFailure:true});
  if(!source.ok)fail('Active source manifest must be verified before task allocation');
  if(records(ctx).some(t=>t.id===id))fail('Task ID already used');
  for(const t of records(ctx)){
   if(['integrating','awaiting-postcheck'].includes(t.status))fail('Complete or recover the prior integration first: '+t.id);
   if(t.status!=='active')continue;
   const overlap=paths.filter(x=>t.edit.includes(x));
   if(overlap.length)fail('File ownership collision with '+t.id+': '+overlap.join(', '));
  }
  const workspace=path.join(ctx.tasksParent,id),branch='fabric/parallel/'+id;
  if(fs.existsSync(workspace))fail('Worktree target already exists');
  if(exec(ctx.active,'git',['show-ref','--verify','--quiet','refs/heads/'+branch],{allowFailure:true}).ok)fail('Task branch already exists');
  ensureSafeDir(ctx.tasksParent);
  fs.mkdirSync(ctx.tasksParent,{recursive:true});
  const baseHead=git(ctx.active,'rev-parse','HEAD'),requirementsSha256=requirementHash(ctx);
  exec(ctx.active,'git',['worktree','add','-b',branch,workspace,baseHead]);
  const task={format:'fabric-parallel-git-v1',id,owner,edit:paths,workspace,branch,baseHead,requirementsSha256,status:'active',createdAt:new Date().toISOString()};
  save(ctx,task,{newOnly:true});
  return {task,releaseAuthorized:false,note:'Worktree created; install dependencies and initialize local source separately. No ACP dispatch or merge is authorized.'};
 });
}
export function gate(controller,id,evidence){
 const ctx=rootContext(controller),task=readTask(ctx,id),result=commonGuard(ctx,task);
 return {format:'fabric-parallel-gate-v1',taskId:id,baseHead:task.baseHead,mainHead:result.main,taskHead:result.head,
  changed:result.diff,review:reviewFile(ctx,task,evidence,result),ready:true,releaseAuthorized:false};
}
function refreshSourceManifest(ctx,previousHead){
 const rel=relSafe(ctx.pointer.sourceManifest),full=path.resolve(ctx.active,rel);
 if(!within(ctx.active,full)||!fs.existsSync(full))fail('Missing verified local source manifest');
 const m=JSON.parse(fs.readFileSync(full,'utf8'));
 if(m.workspacePreservation?.kind!=='local-git-preservation'||m.releaseAuthorized===true||m.baseHead!==previousHead)fail('Local source manifest is stale or untrusted');
 const all=git(ctx.active,'ls-files','-z').split('\0').filter(Boolean);
 const tracked=all.filter(x=>/^(src|server|scripts|tests|tools)\//.test(x)||(!x.includes('/')&&(/\.(?:json|html|[cm]?js|tsx?)$/.test(x)||x==='AGENTS.md')));
 const files=tracked.map(file=>{
  const target=path.resolve(ctx.active,file);
  if(!within(ctx.active,target)||fs.lstatSync(target).isSymbolicLink())fail('Changed source is a link: '+file);
  return {path:file,sha256:sha(fs.readFileSync(target))};
 }).sort((a,b)=>a.path.localeCompare(b.path,'en'));
 const next={...m,files,baseHead:git(ctx.active,'rev-parse','HEAD'),
  requirements:{path:'docs/project/项目需求总览.md',sha256:requirementHash(ctx)},
  workspacePreservation:{...m.workspacePreservation,previousBaseHead:previousHead,commit:git(ctx.active,'rev-parse','HEAD')}};
 ensureSafeDir(path.dirname(full));
 const temp=full+'.parallel-next';fs.writeFileSync(temp,JSON.stringify(next,null,2)+'\n',{flag:'wx'});
 fs.renameSync(temp,full);
 const check=exec(ctx.active,process.execPath,['scripts/check-fabric-v2-development-source.mjs'],{allowFailure:true});
 if(!check.ok)fail('Merged commit exists; source manifest validation failed: '+check.stderr);
}
export function integrate(controller,id,evidence){
 const ctx=rootContext(controller);
 return locked(ctx,()=>{
  const task=readTask(ctx,id),result=commonGuard(ctx,task);
  const review=reviewFile(ctx,task,evidence,result);
  if(git(ctx.active,'rev-parse','HEAD')!==result.main||status(ctx.active)||git(task.workspace,'rev-parse','HEAD')!==result.head)fail('Heads/status changed during merge preflight');
  task.status='integrating';task.review=review;task.expectedMainHead=result.main;task.taskHead=result.head;
  save(ctx,task);
  // The task branch and worktree are preserved if a merge unexpectedly fails.
  try{
   exec(ctx.active,'git',['merge','--no-ff','--no-edit','-m','merge(parallel): '+id,task.branch]);
   if(status(ctx.active))fail('Merge left main worktree dirty; manual recovery required');
   task.mergedHead=git(ctx.active,'rev-parse','HEAD');
   task.status='awaiting-postcheck';save(ctx,task);
   refreshSourceManifest(ctx,result.main);
   return {taskId:id,mergedHead:task.mergedHead,status:task.status,releaseAuthorized:false};
  }catch(error){fail('Integration needs manual recovery; task kept as integrating: '+error.message);}
 });
}
export function finish(controller,id,receipt){
 const ctx=rootContext(controller);
 return locked(ctx,()=>{
  const task=readTask(ctx,id);
  if(task.status!=='awaiting-postcheck')fail('Task has not reached post-merge validation');
  cleanIntegration(ctx);
  const head=git(ctx.active,'rev-parse','HEAD');
  if(head!==task.mergedHead)fail('Main changed since merge; run independent regression again');
  const file=path.resolve(ctx.root,relSafe(receipt));
  if(!within(ctx.store,file)||!fs.existsSync(file)||!within(ctx.store,fs.realpathSync(file))||fs.lstatSync(file).isSymbolicLink())fail('Post-merge receipt must be under .local/parallel-tasks');
  const evidence=JSON.parse(fs.readFileSync(file,'utf8'));
  if(evidence.format!=='fabric-parallel-postcheck-v1'||evidence.taskId!==id||
   evidence.mergedHead!==head||evidence.accepted!==true||
   typeof evidence.reviewer!=='string'||evidence.reviewer.trim().length<2||
   !Array.isArray(evidence.checks)||!evidence.checks.length||
   evidence.checks.some(x=>!proof(ctx,x)))
    fail('Post-merge checks require the exact merge commit and explicit independent acceptance');
  const check=exec(ctx.active,process.execPath,['scripts/check-fabric-v2-development-source.mjs'],{allowFailure:true});
  if(!check.ok)fail('Current source manifest fails verification');
  if(!exec(ctx.active,'git',['merge-base','--is-ancestor',task.taskHead,'HEAD'],{allowFailure:true}).ok)fail('Task commit not integrated');
  task.status='accepted';task.acceptedHead=head;task.finishedAt=new Date().toISOString();task.postcheckSha256=sha(fs.readFileSync(file));
  save(ctx,task);
  return {taskId:id,status:'accepted',worktreeRetained:true,releaseAuthorized:false};
 });
}
export function retire(controller,id){
 const ctx=rootContext(controller);
 return locked(ctx,()=>{
  const task=readTask(ctx,id);
  if(task.status!=='accepted')fail('Only accepted task worktrees may retire');
  cleanIntegration(ctx);
  if(!fs.existsSync(task.workspace))fail('Task worktree missing');
  if(status(task.workspace))fail('Worktree has uncommitted changes');
  if(!exec(ctx.active,'git',['merge-base','--is-ancestor',task.taskHead,'HEAD'],{allowFailure:true}).ok)fail('Task commits not fully merged');
  const tracked=new Set(git(task.workspace,'ls-files','-z').split('\0').filter(Boolean));
  const leftover=[];
  function walk(folder,relative=''){
   for(const item of fs.readdirSync(folder,{withFileTypes:true})){
    const p=path.join(folder,item.name),rel=relative?relative+'/'+item.name:item.name;
    if(rel==='.git')continue;
    if(item.isSymbolicLink()){leftover.push(rel);continue;}
    if(item.isDirectory())walk(p,rel);
    else if(!tracked.has(rel))leftover.push(rel);
   }
  }
  walk(task.workspace);
  if(leftover.length)fail('Ignored/untracked files exist, preserve or archive before retirement: '+leftover.slice(0,8).join(', '));
  exec(ctx.active,'git',['worktree','remove',task.workspace]);
  exec(ctx.active,'git',['branch','-d',task.branch]);
  task.status='retired';task.retiredAt=new Date().toISOString();save(ctx,task);
  return {taskId:id,status:task.status};
 });
}
function cli(args){
 const [action,...rest]=args;
 if(action==='audit'&&rest.length===0)return audit();
 if(action==='start'&&rest.length>=3)return start(defaultRoot,rest[0],rest.slice(2),rest[1]);
 if(action==='gate'&&rest.length===2)return gate(defaultRoot,rest[0],rest[1]);
 if(action==='integrate'&&rest.length===2)return integrate(defaultRoot,rest[0],rest[1]);
 if(action==='finish'&&rest.length===2)return finish(defaultRoot,rest[0],rest[1]);
 if(action==='retire'&&rest.length===1)return retire(defaultRoot,rest[0]);
 fail('Usage: audit | start TASK_ID OWNER FILE... | gate TASK_ID .local/parallel-tasks/REVIEW.json | integrate TASK_ID REVIEW | finish TASK_ID POSTCHECK | retire TASK_ID');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(cli(process.argv.slice(2)),null,2));}
 catch(error){console.error('Fabric parallel gate: '+error.message);process.exitCode=2;}
}
