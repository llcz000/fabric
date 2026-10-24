import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const project=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-workspace-'));
 const active=path.join(root,'.agent-workspaces/current');
 const write=(relative,value)=>{const file=path.join(active,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
 const git=(...args)=>execFileSync('git',args,{cwd:active,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 fs.mkdirSync(active,{recursive:true});
 git('init','--quiet');git('config','user.name','Workspace test');git('config','user.email','test@local');git('config','core.autocrlf','false');
 fs.mkdirSync(path.join(active,'server'));
 write('.gitignore','artifacts/\ntmp/\n');
 write('package.json','{"type":"module"}\n');
 write('src/value.ts','export const value=1;\n');
 write('docs/requirements.md','fixed requirements\n');
 const checker=fs.readFileSync(path.join(project,'.agent-workspaces/v2-quality-20261020/scripts/check-fabric-v2-development-source.mjs'));
 write('scripts/check-fabric-v2-development-source.mjs',checker);
 const pointer={workspace:'.agent-workspaces/current',sourceManifest:'artifacts/local/source-manifest.json'};
 write('docs/project/fabric-v2-active-workspace.json',JSON.stringify(pointer));
 fs.mkdirSync(path.join(root,'docs/project'),{recursive:true});
 fs.writeFileSync(path.join(root,'docs/project/fabric-v2-active-workspace.json'),JSON.stringify(pointer));
 git('add','--all');git('commit','--quiet','-m','fixture');
 const manifest={workspace:active,baseHead:git('rev-parse','HEAD'),requirements:{path:'docs/requirements.md',sha256:hash('fixed requirements\n')},files:['src/value.ts','scripts/check-fabric-v2-development-source.mjs'].map(p=>({path:p,sha256:hash(fs.readFileSync(path.join(active,p)))})),workspacePreservation:{kind:'local-git-preservation'},releaseAuthorized:false};
 const manifestFile=path.join(active,pointer.sourceManifest);
 const save=()=>write(pointer.sourceManifest,JSON.stringify(manifest));save();
 return {root,active,write,git,manifest,manifestFile,save,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
async function tools(){return import('./fabric-workspace.mjs');}
function cache(f,name,pid,extra={}){
 const dir=path.join(f.active,'tmp',name);fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'fixture.test.cjs'),'// generated output\n');
 fs.writeFileSync(path.join(dir,'.fabric-test-output.json'),JSON.stringify({format:'fabric-test-output-v1',pid,...extra}));return dir;
}
const deadPid=()=>Number(execFileSync(process.execPath,['-e','process.stdout.write(String(process.pid))'],{encoding:'utf8'}));

test('status identifies the declared active source without writing files',async()=>{
 const f=fixture();try{const {inspectWorkspace}=await tools();const before=fs.readdirSync(f.root);const state=inspectWorkspace(f.root);assert.equal(state.active,f.active);assert.equal(state.controller,f.root);assert.equal(state.application.clean,true);assert.deepEqual(fs.readdirSync(f.root),before);}finally{f.close();}
});

test('standalone application can inspect and clean itself without a controller checkout',async()=>{
 const f=fixture();try{
  f.write('docs/project/fabric-v2-active-workspace.json',JSON.stringify({role:'application',sourceManifest:'artifacts/local/source-manifest.json'}));
  const {inspectWorkspace,cleanWorkspace}=await tools();
  const state=inspectWorkspace(f.active);
  assert.equal(state.active,f.active);assert.equal(state.controller,f.active);assert.equal(state.artifacts.length,1);
  assert.deepEqual(cleanWorkspace(f.active).removed,[]);
 }finally{f.close();}
});
test('cleanup defaults to preview and only removes marked dead generated output',async()=>{
 const f=fixture();try{const {cleanWorkspace}=await tools();const stale=cache(f,'tests-abcdef',deadPid()),live=cache(f,'tests-ghijkl',process.pid);f.write('tmp/customer-baseline/source.ts','unique source');f.write('tmp/tests-mnopqr/fixture.test.cjs','unmarked output');const preview=cleanWorkspace(f.root);assert.equal(fs.existsSync(stale),true);assert.equal(preview.removed.length,0);const done=cleanWorkspace(f.root,{apply:true});assert.deepEqual(done.removed,[stale]);assert.equal(fs.existsSync(live),true);assert.equal(fs.existsSync(path.join(f.active,'tmp/customer-baseline/source.ts')),true);assert.equal(fs.existsSync(path.join(f.active,'tmp/tests-mnopqr')),true);}finally{f.close();}
});
test('cleanup retains links and marked directories containing actual source',async()=>{
 const f=fixture();try{const {cleanWorkspace}=await tools();const mixed=cache(f,'tests-abcdef',deadPid());fs.writeFileSync(path.join(mixed,'source.ts'),'preserve');const outside=path.join(f.root,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'sentinel'),'preserve');fs.symlinkSync(outside,path.join(f.active,'tmp/tests-ghijkl'),process.platform==='win32'?'junction':'dir');const result=cleanWorkspace(f.root,{apply:true});assert.equal(result.removed.length,0);assert.equal(fs.readFileSync(path.join(outside,'sentinel'),'utf8'),'preserve');assert.equal(fs.existsSync(mixed),true);}finally{f.close();}
});
test('cleanup retains an external cache when the tmp ancestor is replaced during planning',async()=>{
 const f=fixture();const read=fs.readdirSync;let swapped=false;
 try{
  const {cleanWorkspace}=await tools();cache(f,'tests-abcdef',deadPid());
  const external=path.join(f.root,'external-tmp'),tmp=path.join(f.active,'tmp');
  fs.mkdirSync(path.join(external,'tests-abcdef'),{recursive:true});
  fs.writeFileSync(path.join(external,'tests-abcdef/keep.cjs'),'external data');
  fs.writeFileSync(path.join(external,'tests-abcdef/.fabric-test-output.json'),JSON.stringify({format:'fabric-test-output-v1',pid:deadPid()}));
  fs.readdirSync=function(dir,...args){const result=read.call(fs,dir,...args);if(dir===tmp&&!swapped){swapped=true;fs.renameSync(tmp,tmp+'-original');fs.symlinkSync(external,tmp,process.platform==='win32'?'junction':'dir');}return result;};
  cleanWorkspace(f.root,{apply:true});
  assert.equal(fs.readFileSync(path.join(external,'tests-abcdef/keep.cjs'),'utf8'),'external data');
 }finally{fs.readdirSync=read;f.close();}
});
test('commit preserves strict validation and refreshes only the local development HEAD',async()=>{
 const f=fixture();try{const {commitWorkspace}=await tools();const previous=f.manifest.baseHead;f.write('src/value.ts','export const value=2;\n');f.manifest.files[0].sha256=hash('export const value=2;\n');f.save();f.git('add','src/value.ts');const result=commitWorkspace(f.root,{message:'preserve reviewed source'});assert.notEqual(result.commit,previous);assert.equal(f.git('status','--porcelain'),'');const after=JSON.parse(fs.readFileSync(f.manifestFile));assert.equal(after.baseHead,result.commit);assert.deepEqual(after.files,f.manifest.files);assert.equal(after.releaseAuthorized,false);}finally{f.close();}
});
test('commit rejects unstaged files and unreviewed source drift',async()=>{
 const f=fixture();try{const {commitWorkspace}=await tools();f.write('src/value.ts','unreviewed\n');assert.throws(()=>commitWorkspace(f.root,{message:'blocked'}),/stage|unstaged/i);f.git('add','src/value.ts');assert.throws(()=>commitWorkspace(f.root,{message:'blocked'}),/Source changed/);assert.equal(f.git('rev-parse','HEAD'),f.manifest.baseHead);}finally{f.close();}
});
test('commit never rewrites a frozen release manifest or bypasses a failing hook',async()=>{
 const f=fixture();try{const {commitWorkspace}=await tools();f.write('docs/note.md','note');f.git('add','docs/note.md');delete f.manifest.workspacePreservation;f.save();assert.throws(()=>commitWorkspace(f.root,{message:'blocked'}),/local development manifest/);f.manifest.workspacePreservation={kind:'local-git-preservation'};f.save();const before=fs.readFileSync(f.manifestFile,'utf8');fs.writeFileSync(path.join(f.active,'.git/hooks/pre-commit'),'#!/bin/sh\nexit 1\n',{mode:0o755});assert.throws(()=>commitWorkspace(f.root,{message:'blocked'}),/commit failed/i);assert.equal(fs.readFileSync(f.manifestFile,'utf8'),before);assert.equal(f.git('rev-parse','HEAD'),f.manifest.baseHead);}finally{f.close();}
});
test('post-commit source drift fails closed without blessing the changed files',async()=>{
 const f=fixture();try{const {commitWorkspace}=await tools();f.write('docs/note.md','note');f.git('add','docs/note.md');const before=fs.readFileSync(f.manifestFile,'utf8');fs.writeFileSync(path.join(f.active,'.git/hooks/post-commit'),'#!/bin/sh\necho drift >> src/value.ts\n',{mode:0o755});assert.throws(()=>commitWorkspace(f.root,{message:'hook drift'}),/changed during commit/i);assert.equal(fs.readFileSync(f.manifestFile,'utf8'),before);}finally{f.close();}
});
test('commit rejects a hook that replaces staged source without changing reviewed disk bytes',async()=>{
 const f=fixture();try{
  const {commitWorkspace}=await tools();f.write('src/value.ts','export const value=2;\n');f.manifest.files[0].sha256=hash('export const value=2;\n');f.save();f.git('add','src/value.ts');
  const before=fs.readFileSync(f.manifestFile,'utf8');
  fs.writeFileSync(path.join(f.active,'.git/hooks/pre-commit'),'#!/bin/sh\nblob=$(printf "export const value=999;\\n" | git hash-object -w --stdin)\ngit update-index --cacheinfo 100644 "$blob" src/value.ts\n',{mode:0o755});
  assert.throws(()=>commitWorkspace(f.root,{message:'hook index drift'}),/commit tree changed/i);
  assert.equal(fs.readFileSync(f.manifestFile,'utf8'),before);
 }finally{f.close();}
});
test('commit rejects untracked files created by post-commit hooks before refreshing validation',async()=>{
 const f=fixture();try{
  const {commitWorkspace}=await tools();f.write('docs/note.md','note');f.git('add','docs/note.md');const before=fs.readFileSync(f.manifestFile,'utf8');
  fs.writeFileSync(path.join(f.active,'.git/hooks/post-commit'),'#!/bin/sh\necho drift > docs/hook-note.md\n',{mode:0o755});
  assert.throws(()=>commitWorkspace(f.root,{message:'hook extra file'}),/changed during commit/i);
  assert.equal(fs.readFileSync(f.manifestFile,'utf8'),before);
 }finally{f.close();}
});

test('real test runner records its owning PID before running and removes its output',()=>{
 const folder=fs.mkdtempSync(path.join(project,'tmp/runner-owner-fixture-'));
 const resultFile=path.join(folder,'owner.json'),testFile=path.join(folder,'owner.test.ts');
 const source=[
  "import fs from 'node:fs';import path from 'node:path';import test from 'node:test';",
  "let output=__dirname;while(!/^tests-[A-Za-z0-9]{6}$/.test(path.basename(output)))output=path.dirname(output);",
  `const owner=JSON.parse(fs.readFileSync(path.join(output,'.fabric-test-output.json'),'utf8'));fs.writeFileSync(${JSON.stringify(resultFile)},JSON.stringify({owner,output}));`,
  "test('owner fixture',()=>{});",
 ].join('\n');
 fs.writeFileSync(testFile,source);
 try{
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const result=spawnSync(process.execPath,['scripts/run-ts-tests.mjs',testFile],{cwd:project,encoding:'utf8',env});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  const evidence=JSON.parse(fs.readFileSync(resultFile,'utf8'));
  assert.equal(evidence.owner.format,'fabric-test-output-v1');
  assert.equal(evidence.owner.pid,result.pid);
  assert.equal(fs.existsSync(evidence.output),false);
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
