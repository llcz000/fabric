import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {commitWorkspace,verifyPublishedWorkspace,finalizeWorkspace} from './fabric-workspace.mjs';

function fixture(run){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-local-helper-'));
 try{
  const put=(name,text)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','--quiet');git('config','user.name','Workspace test');git('config','user.email','workspace@test.local');git('config','core.autocrlf','false');git('config','core.hooksPath','.git/hooks');
  put('.gitignore','artifacts/\nscripts/*.py\n');
  put('src/value.ts','export const value=1;\n');put('server/value.ts','export const server=1;\n');put('docs/rules.md','fixed rules');
  put('scripts/check-fabric-v2-development-source.mjs',fs.readFileSync(new URL('./check-fabric-v2-development-source.mjs',import.meta.url)));
  const manifestPath='artifacts/local/source.json';
  put('docs/project/fabric-v2-active-workspace.json',JSON.stringify({role:'application',workspace:'.',sourceManifest:manifestPath}));
  git('add','.');git('commit','--quiet','--message','initial');
  const hash=text=>createHash('sha256').update(text).digest('hex');
  const manifest={workspace:root,baseHead:git('rev-parse','HEAD'),workspacePreservation:{kind:'local-git-preservation'},requirements:{path:'docs/rules.md',sha256:hash('fixed rules')},files:['src/value.ts','server/value.ts','scripts/check-fabric-v2-development-source.mjs'].map(name=>({path:name,sha256:hash(fs.readFileSync(path.join(root,name)))}))};
  put(manifestPath,JSON.stringify(manifest));put('scripts/generate_mockup.py','private helper, preserve exactly');
  put('docs/change.md','reviewed note');git('add','docs/change.md');
  run({root,put,git,manifestPath,helper:fs.readFileSync(path.join(root,'scripts/generate_mockup.py'))});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}

test('local commit preserves the documented private helper and refreshes its verified HEAD',()=>fixture(({root,git,manifestPath,helper})=>{
 const result=commitWorkspace(root,{message:'reviewed docs'});
 assert.equal(result.sourceVerified,true);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,manifestPath))).baseHead,git('rev-parse','HEAD'));
 assert.deepEqual(fs.readFileSync(path.join(root,'scripts/generate_mockup.py')),helper);
 assert.equal(git('status','--porcelain=v1','-uall'),'');
}));

test('local commit still rejects other ignored source additions before creating a commit',()=>fixture(({root,put,git})=>{
 const before=git('rev-parse','HEAD');put('scripts/other_local.py','unreviewed');
 assert.throws(()=>commitWorkspace(root,{message:'must refuse'}),/Unvalidated new source/);
 assert.equal(git('rev-parse','HEAD'),before);
}));

test('closeout rejects uncommitted files and unpublished HEAD, and verifies the actual remote branch',()=>fixture(({root,put,git})=>{
 commitWorkspace(root,{message:'reviewed docs'});
 assert.throws(()=>verifyPublishedWorkspace(root),/upstream/i);
 const remote=path.join(root,'artifacts','remote.git');
 git('init','--bare','--quiet',remote);git('remote','add','origin',remote);
 const branch=git('branch','--show-current');git('push','--set-upstream','origin',branch);
 const head=git('rev-parse','HEAD');
 assert.equal(verifyPublishedWorkspace(root).commit,head);
 assert.equal(verifyPublishedWorkspace(root).remoteCommit,head);
 assert.throws(()=>verifyPublishedWorkspace(root,{expectedCommit:'0'.repeat(40)}),/commit/i);
 put('src/value.ts','changed');assert.throws(()=>verifyPublishedWorkspace(root),/uncommitted/i);
 git('add','src/value.ts');assert.throws(()=>verifyPublishedWorkspace(root),/uncommitted/i);
 git('restore','--staged','--worktree','src/value.ts');
 put('extra.txt','untracked');assert.throws(()=>verifyPublishedWorkspace(root),/uncommitted/i);
 fs.unlinkSync(path.join(root,'extra.txt'));
 git('commit','--allow-empty','--quiet','--message','unpublished');
 assert.throws(()=>verifyPublishedWorkspace(root),/remote/i);
 git('push');assert.equal(verifyPublishedWorkspace(root).commit,git('rev-parse','HEAD'));
 // A cached tracking ref cannot prove what is currently on the server.
 git('update-ref','refs/heads/'+branch,head);
 git('update-ref','refs/remotes/origin/'+branch,head);
 assert.throws(()=>verifyPublishedWorkspace(root),/remote/i);
}));

test('release closeout verifies pushed records and rejects unrelated post-release source changes',()=>fixture(({root,put,git})=>{
 const pointerFile=path.join(root,'docs/project/fabric-v2-active-workspace.json');
 const pointer=JSON.parse(fs.readFileSync(pointerFile,'utf8'));
 const id='verified-release',receiptFile='artifacts/releases/'+id+'/release-result.json';
 pointer.currentRelease={id};put('docs/project/fabric-v2-active-workspace.json',JSON.stringify(pointer));
 git('add','docs/project/fabric-v2-active-workspace.json');
 const source=commitWorkspace(root,{message:'released source'}).commit;
 put(receiptFile,JSON.stringify({state:'released',sourceGit:{commit:source},gitCloseout:'pending'}));
 const remote=path.join(root,'artifacts','remote.git');git('init','--bare','--quiet',remote);git('remote','add','origin',remote);
 git('push','--set-upstream','origin',git('branch','--show-current'));
 put('docs/project/项目现状.md','released');git('add','docs/project/项目现状.md');
 commitWorkspace(root,{message:'release records'});git('push');
 assert.equal(finalizeWorkspace(root).releaseGitCloseout,'verified');
 const receipt=JSON.parse(fs.readFileSync(path.join(root,receiptFile),'utf8'));
 assert.equal(receipt.gitCloseoutProof.commit,git('rev-parse','HEAD'));
 put(receiptFile,JSON.stringify({...receipt,gitCloseout:'pending'}));
 put('docs/unrelated.md','unrelated');git('add','docs/unrelated.md');
 commitWorkspace(root,{message:'different task'});git('push');
 assert.throws(()=>finalizeWorkspace(root),/source changed after release/i);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,receiptFile),'utf8')).gitCloseout,'pending');
}));
