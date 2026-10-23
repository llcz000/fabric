/** Single project entry for source location, owned-cache cleanup and local commits. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const canonical=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const inside=(root,file)=>file.startsWith(root+path.sep);
function locations(root){
 const controller=fs.realpathSync(root);
 const pointer=JSON.parse(fs.readFileSync(path.join(controller,'docs/project/fabric-v2-active-workspace.json'),'utf8'));
 if(typeof pointer.workspace!=='string'||path.isAbsolute(pointer.workspace)||pointer.workspace.split(/[\\/]/).includes('..'))throw Error('Unsafe active workspace path');
 const active=fs.realpathSync(path.resolve(controller,pointer.workspace));
 if(!inside(controller,active))throw Error('Active source must stay inside the controller');
 return {controller,active,pointer};
}
function git(root,args){
 const result=spawnSync('git',['--no-optional-locks',...args],{cwd:root,encoding:'utf8'});
 if(result.error||result.status!==0)throw Error(result.error?.message||result.stderr||'Git command failed');
 return result.stdout.trimEnd();
}
function counts(dir){
 let files=0,bytes=0;
 if(!fs.existsSync(dir)||fs.lstatSync(dir).isSymbolicLink())return {files,bytes};
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  if(entry.isSymbolicLink())continue;
  const file=path.join(dir,entry.name);
  if(entry.isDirectory()){const child=counts(file);files+=child.files;bytes+=child.bytes;}
  else if(entry.isFile()){files++;bytes+=fs.statSync(file).size;}
 }
 return {files,bytes};
}
export function inspectWorkspace(root=canonical){
 const state=locations(root),status=git(state.active,['status','--porcelain=v1','-uall']);
 return {...state,application:{branch:git(state.active,['branch','--show-current']),head:git(state.active,['rev-parse','HEAD']),clean:!status,statusEntries:status?status.split('\n').length:0},artifacts:[state.controller,state.active].map(workspace=>({workspace,tmp:counts(path.join(workspace,'tmp')),artifacts:counts(path.join(workspace,'artifacts'))})),cleanup:planCleanup(root)};
}
function alive(pid){
 try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}
}
function cacheCandidate(dir){
 if(fs.lstatSync(dir).isSymbolicLink())return {path:dir,action:'retain',reason:'linked-path'};
 const marker=path.join(dir,'.fabric-test-output.json');
 if(!fs.existsSync(marker)||fs.lstatSync(marker).isSymbolicLink())return {path:dir,action:'retain',reason:'no-owned-marker'};
 let owner;try{owner=JSON.parse(fs.readFileSync(marker,'utf8'));}catch{return {path:dir,action:'retain',reason:'invalid-marker'};}
 if(owner.format!=='fabric-test-output-v1'||!Number.isInteger(owner.pid)||owner.pid<1)return {path:dir,action:'retain',reason:'invalid-marker'};
 if(alive(owner.pid))return {path:dir,action:'retain',reason:'running-owner'};
 function generated(folder){
  for(const item of fs.readdirSync(folder,{withFileTypes:true})){
   const target=path.join(folder,item.name);
   if(item.isSymbolicLink())return false;
   if(item.isDirectory()){if(!generated(target))return false;}
   else if(!item.isFile()||(target!==marker&&!/\.(?:cjs|css)$/.test(item.name)))return false;
  }
  return true;
 }
 const safe=generated(dir);
 return {path:dir,action:safe?'remove':'retain',reason:safe?'dead-owned-generated-output':'contains-protected-content'};
}
export function planCleanup(root=canonical){
 const {controller,active}=locations(root),items=[];
 for(const workspace of [controller,active]){
  const tmp=path.join(workspace,'tmp');
  if(!fs.existsSync(tmp))continue;
  if(fs.lstatSync(tmp).isSymbolicLink()){items.push({path:tmp,action:'retain',reason:'linked-temp-root'});continue;}
  for(const item of fs.readdirSync(tmp,{withFileTypes:true})){
   if(/^tests-[A-Za-z0-9]{6}$/.test(item.name)&&(item.isDirectory()||item.isSymbolicLink()))items.push(cacheCandidate(path.join(tmp,item.name)));
  }
 }
 return items;
}
export function cleanWorkspace(root=canonical,{apply=false}={}){
 const {controller,active}=locations(root),items=planCleanup(root),removed=[];
 if(apply)for(const item of items){
  if(item.action!=='remove')continue;
  const target=path.resolve(item.path);
  if(![controller,active].some(base=>inside(path.join(base,'tmp'),target)))throw Error('Cleanup target outside declared tmp');
  const parent=path.dirname(target);
  if(fs.lstatSync(parent).isSymbolicLink()||fs.realpathSync(parent)!==parent||fs.realpathSync(target)!==target){
   item.action='retain';item.reason='ancestor-or-target-changed';continue;
  }
  // Recheck ownership and contents immediately before deleting this exact output.
  if(cacheCandidate(target).action!=='remove')continue;
  fs.rmSync(target,{recursive:true,force:true,maxRetries:3,retryDelay:100});removed.push(target);
 }
 return {mode:apply?'apply':'preview',items,removed};
}
function gate(active){
 const check=spawnSync(process.execPath,['scripts/check-fabric-v2-development-source.mjs'],{cwd:active,encoding:'utf8'});
 if(check.error||check.status!==0)throw Error(check.error?.message||check.stderr||check.stdout||'Source gate failed');
}
export function commitWorkspace(root=canonical,{message}={}){
 if(typeof message!=='string'||!message.trim())throw Error('A commit message is required');
 const {active,pointer}=locations(root),status=git(active,['status','--porcelain=v1','-uall']);
 if(!status||status.split('\n').some(line=>line.startsWith('??')||line[1]!==' '))throw Error('Stage all intended changes first; unstaged/untracked files remain or nothing is staged');
 const file=fs.realpathSync(path.resolve(active,pointer.sourceManifest));
 if(!inside(active,file))throw Error('Unsafe local manifest path');
 const original=fs.readFileSync(file),manifest=JSON.parse(original);
 if(manifest.workspacePreservation?.kind!=='local-git-preservation')throw Error('A local development manifest is required; frozen release manifests are never rewritten');
 gate(active);
 const expectedTree=git(active,['write-tree']);
 const result=spawnSync('git',['commit','--message',message],{cwd:active,encoding:'utf8'});
 if(result.error||result.status!==0)throw Error('Git commit failed: '+(result.error?.message||result.stderr));
 const head=git(active,['rev-parse','HEAD']);
 if(git(active,['rev-parse','HEAD^{tree}'])!==expectedTree)throw Error('Commit tree changed in a hook; commit exists but local validation was not refreshed');
 if(git(active,['status','--porcelain=v1','-uall']))throw Error('Files changed during commit; commit exists but local validation was not refreshed');
 const unchanged=()=>{
  if(!fs.readFileSync(file).equals(original))return false;
  for(const entry of [manifest.requirements,...manifest.files]){
   const target=path.resolve(active,entry.path);
   if(!inside(active,target)||!fs.existsSync(target)||hash(target)!==entry.sha256)return false;
  }
  const expected=new Set(manifest.files.map(entry=>entry.path));
  function known(folder){
   for(const item of fs.readdirSync(path.join(active,folder),{withFileTypes:true})){
    const relative=folder+'/'+item.name;
    if(item.isSymbolicLink()||(item.isDirectory()?!known(relative):!expected.has(relative)))return false;
   }
   return true;
  }
  return ['src','server','scripts'].every(known);
 };
 if(!unchanged())throw Error('Source changed during commit; commit exists but local validation was not refreshed');
 const next={...manifest,baseHead:head,workspacePreservation:{...manifest.workspacePreservation,previousBaseHead:manifest.baseHead,commit:head}};
 const temp=file+'.next';
 fs.writeFileSync(temp,JSON.stringify(next,null,2)+'\n',{flag:'wx'});
 fs.renameSync(temp,file);
 gate(active);
 return {workspace:active,commit:head,sourceVerified:true,pushed:false,deployed:false};
}
function main(args){
 const [command,...rest]=args;
 if(command==='status'&&!rest.length)return inspectWorkspace();
 if(command==='clean'&&(rest.length===0||(rest.length===1&&rest[0]==='--apply')))return cleanWorkspace(canonical,{apply:rest.includes('--apply')});
 if(command==='commit'&&rest.length===2&&rest[0]==='--message')return commitWorkspace(canonical,{message:rest[1]});
 throw Error('Usage: status | clean [--apply] | commit --message "reviewed change"');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(main(process.argv.slice(2)),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
