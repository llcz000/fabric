import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {audit,start,gate,integrate,finish,retire} from './fabric-parallel-git.mjs';

const liveRoot=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const appLive=path.join(liveRoot,'.agent-workspaces/v2-quality-20261020');
function git(cwd,...args){
 const r=spawnSync('git',args,{cwd,encoding:'utf8',windowsHide:true});
 if(r.status!==0)throw Error('git '+args.join(' ')+': '+r.stderr);
 return r.stdout.trim();
}
function put(root,name,contents){
 const file=path.join(root,name);
 fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file,contents,'utf8');
}
function makeFixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-parallel-git-'));
 git(root,'init','--quiet');
 git(root,'config','user.name','Fabric Test');
 git(root,'config','user.email','fabric-test@local.invalid');
 git(root,'config','core.autocrlf','false');
 put(root,'.gitignore','.local/\n.agent-workspaces/\nartifacts/\n');
 put(root,'docs/project/项目需求总览.md','Approved task requirements\n');
 put(root,'docs/project/fabric-v2-active-workspace.json',JSON.stringify({role:'controller',workspace:'.agent-workspaces/v2-quality-20261020',sourceManifest:'artifacts/local/source-manifest.json'}));
 put(root,'src/a.ts','export const a=1;\n');
 put(root,'src/b.ts','export const b=1;\n');
 put(root,'server/core.ts','export const core=true;\n');
 put(root,'package.json','{"type":"module"}\n');
 put(root,'AGENTS.md','# Development\n');
 fs.mkdirSync(path.join(root,'scripts'),{recursive:true});
 for(const name of ['init-fabric-workspace.mjs','check-fabric-v2-development-source.mjs'])
  fs.copyFileSync(path.join(appLive,'scripts',name),path.join(root,'scripts',name));
 git(root,'add','--all');git(root,'commit','--quiet','-m','base');
 const active=path.join(root,'.agent-workspaces','v2-quality-20261020');
 fs.mkdirSync(path.dirname(active),{recursive:true});
 git(root,'worktree','add','-q','-b','fabric-dev',active,'HEAD');
 put(active,'docs/project/fabric-v2-active-workspace.json',JSON.stringify({role:'application',workspace:'.agent-workspaces/v2-quality-20261020',sourceManifest:'artifacts/local/source-manifest.json'}));
 git(active,'add','docs/project/fabric-v2-active-workspace.json');
 git(active,'commit','--quiet','-m','app pointer');
 const init=spawnSync(process.execPath,['scripts/init-fabric-workspace.mjs'],{cwd:active,encoding:'utf8'});
 assert.equal(init.status,0,init.stderr+init.stdout);
 return {root,active,close:()=>{
  const lines=git(root,'worktree','list','--porcelain').split(/\r?\n/).filter(l=>l.startsWith('worktree ')).map(l=>l.substring(9));
  for(const dir of lines)if(path.normalize(dir).toLowerCase()!==path.normalize(root).toLowerCase())
   git(root,'worktree','remove','--force',dir);
  fs.rmSync(root,{recursive:true,force:true});
 }};
}
function checkEvidence(f,id,label='unit'){
 const logPath='.local/parallel-tasks/logs/'+id+'-'+label+'.log';
 const log='Test '+label+' passed for '+id+'\n';
 put(f.root,logPath,log);
 return {command:'node --test '+label,passed:true,logPath,sha256:createHash('sha256').update(log).digest('hex')};
}
function review(f,id,task,mainHead){
 const relative='.local/parallel-tasks/'+id+'-review.json';
 put(f.root,relative,JSON.stringify({format:'fabric-parallel-review-v1',taskId:id,baseHead:task.baseHead,taskHead:git(task.workspace,'rev-parse','HEAD'),mainHead,reviewer:'Independent QA',specReviewed:true,qualityReviewed:true,checks:[checkEvidence(f,id)]}));
 return relative;
}
function commitFile(task,rel,content){
 put(task.workspace,rel,content);git(task.workspace,'add','--',rel);git(task.workspace,'commit','--quiet','-m','task change');
}
test('new tasks use separate branches and reject overlapping file ownership and protected paths',()=>{
 const f=makeFixture();try{
  let result=start(f.root,'alpha-task',['src/a.ts'],'Agent A');
  assert.equal(result.task.status,'active');
  assert.equal(audit(f.root).projectClean,true);
  assert.throws(()=>start(f.root,'beta-task',['src/a.ts'],'Agent B'),/collision/);  assert.equal(audit(f.root).legacyWorktrees.length,0);
  assert.equal(audit(f.root).allRegisteredClean,true);

  assert.throws(()=>start(f.root,'beta-task',['src\/App.tsx'],'Agent B'),/Supervisor/);
  assert.throws(()=>start(f.root,'beta-task',['..\/outside.ts'],'Agent B'),/Unsafe/);
  result=start(f.root,'beta-task',['src/b.ts'],'Agent B');
  assert.equal(result.task.status,'active');
  assert.equal(audit(f.root).taskList.length,2);
 }finally{f.close();}
});
test('check rejects uncommitted changes, unauthorized committed paths and stale evidence',()=>{
 const f=makeFixture();try{
  const {task}=start(f.root,'owner-check',['src/a.ts'],'Agent A');
  put(task.workspace,'src/a.ts','export const a=7;\n');
  assert.throws(()=>gate(f.root,'owner-check','.local/parallel-tasks/x.json'),/uncommitted/);
  git(task.workspace,'add','src/a.ts');git(task.workspace,'commit','--quiet','-m','authorized');
  commitFile(task,'src/b.ts','export const b=9;\n');
  assert.throws(()=>gate(f.root,'owner-check','.local/parallel-tasks/x.json'),/outside exact ownership/);
 }finally{f.close();}
});
test('main changes in owned files block integration; disjoint updates remain mergeable',()=>{
 const f=makeFixture();try{
  const {task}=start(f.root,'base-drift',['src/a.ts'],'Agent A');
  commitFile(task,'src/a.ts','export const a=5;\n');
  const mainHead=git(f.active,'rev-parse','HEAD');
  const evidence=review(f,'base-drift',task,mainHead);
  assert.equal(gate(f.root,'base-drift',evidence).ready,true);
  const proof=JSON.parse(fs.readFileSync(path.join(f.root,evidence),'utf8')).checks[0];
  fs.appendFileSync(path.join(f.root,proof.logPath),'tampered');
  assert.throws(()=>gate(f.root,'base-drift',evidence),/tampered/);
  review(f,'base-drift',task,mainHead);
  assert.equal(gate(f.root,'base-drift',evidence).ready,true);
  commitFile({...task,workspace:f.active},'src/b.ts','export const b=2;\n');
  assert.throws(()=>gate(f.root,'base-drift',evidence),/stale task review/);
  const updated=review(f,'base-drift',task,git(f.active,'rev-parse','HEAD'));
  assert.equal(gate(f.root,'base-drift',updated).ready,true);
  commitFile({...task,workspace:f.active},'src/a.ts','export const a=8;\n');
  assert.throws(()=>gate(f.root,'base-drift',updated),/Main changed owned files/);
 }finally{f.close();}
});
test('reviewed task merges, requires post-check and retires without discarding files',()=>{
 const f=makeFixture();try{
  const {task}=start(f.root,'fast-merge',['src/a.ts'],'Agent A');
  commitFile(task,'src/a.ts','export const a=23;\n');
  const evidence=review(f,'fast-merge',task,git(f.active,'rev-parse','HEAD'));
  const result=integrate(f.root,'fast-merge',evidence);
  assert.equal(result.status,'awaiting-postcheck');
  assert.equal(audit(f.root).projectClean,true);
  assert.throws(()=>retire(f.root,'fast-merge'),/Only accepted/);
  const post='.local/parallel-tasks/fast-merge-postcheck.json';
  put(f.root,post,JSON.stringify({format:'fabric-parallel-postcheck-v1',taskId:'fast-merge',mergedHead:result.mergedHead,accepted:true,reviewer:'Independent QA',checks:[checkEvidence(f,'fast-merge','lint')]}));
  assert.equal(finish(f.root,'fast-merge',post).status,'accepted');
  assert.equal(retire(f.root,'fast-merge').status,'retired');
  assert.equal(fs.existsSync(task.workspace),false);
  assert.equal(audit(f.root).projectClean,true);
 }finally{f.close();}
});
test('retirement refuses untracked ignored customer/local data',()=>{
 const f=makeFixture();try{
  const {task}=start(f.root,'keep-data',['src/a.ts'],'Agent A');
  commitFile(task,'src/a.ts','export const a=24;\n');
  const e=review(f,'keep-data',task,git(f.active,'rev-parse','HEAD'));
  const merged=integrate(f.root,'keep-data',e);
  const post='.local/parallel-tasks/keep-data-postcheck.json';
  put(f.root,post,JSON.stringify({format:'fabric-parallel-postcheck-v1',taskId:'keep-data',mergedHead:merged.mergedHead,accepted:true,reviewer:'Independent QA',checks:[checkEvidence(f,'keep-data','lint')]}));
  finish(f.root,'keep-data',post);
  put(task.workspace,'.local/customer-original.xlsx','protected');
  assert.throws(()=>retire(f.root,'keep-data'),/Ignored\/untracked/);
  assert.equal(fs.existsSync(path.join(task.workspace,'.local/customer-original.xlsx')),true);
 }finally{f.close();}
});
