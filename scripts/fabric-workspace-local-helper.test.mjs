import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {commitWorkspace} from './fabric-workspace.mjs';

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
