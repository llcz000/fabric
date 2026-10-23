import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {affectedUiFiles,reviewContext,createReview,validateReview} from './ui-quality-gate.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const manifest=files=>({files:Object.entries(files).map(([p,v])=>({path:p,sha256:v}))});
test('UI gate scopes frontend changes but backend-only and unit-only remain lightweight',()=>{
 const before=manifest({'server/service.ts':'old','src/components/Fabric.tsx':'old','src/components/Fabric.test.ts':'old','src/components/lib.css':'old'});
 const backend=affectedUiFiles(before,manifest({'server/service.ts':'new','src/components/Fabric.tsx':'old','src/components/Fabric.test.ts':'new','src/components/lib.css':'old'}));
 assert.deepEqual(backend.ui,[]);
 const client=affectedUiFiles(before,manifest({'server/service.ts':'old','src/components/Fabric.tsx':'new','src/components/Fabric.test.ts':'old','src/components/lib.css':'new'}));
 assert.deepEqual(client.ui,['src/components/Fabric.tsx','src/components/lib.css']);
});
test('UI review blocks stale source, stale baseline, missing screenshots and forged status',()=>{
 const active=path.resolve(import.meta.dirname,'../..');
 const project=path.resolve(active,'../..');
 const scratch=fs.mkdtempSync(path.join(project,'artifacts','ui-gate-fixture-'));
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-ui-check-'));
 try{
  const baseline='verified-release-fixture';
  const relative='artifacts/candidate/source-manifest.json';
  const old=path.join(workspace,'artifacts/releases',baseline,'package/source-manifest.json');
  const candidate=path.join(workspace,relative);
  fs.mkdirSync(path.dirname(old),{recursive:true});fs.mkdirSync(path.dirname(candidate),{recursive:true});
  fs.writeFileSync(old,JSON.stringify(manifest({'src/components/Fabric.tsx':'old','server/index.ts':'unchanged'})));
  fs.writeFileSync(candidate,JSON.stringify(manifest({'src/components/Fabric.tsx':'new','server/index.ts':'unchanged'})));
  const ctx=reviewContext({pointer:{sourceManifest:relative,currentRelease:{id:baseline}},baseline:{releaseId:baseline},workspace});
  assert.equal(ctx.ui.length,1);
  const shots=['desktop.png','dialog.png'].map(name=>{
   const file=path.join(scratch,name);
   fs.writeFileSync(file,Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(600)]));
   return path.relative(active,file);
  });
  const proof=createReview(ctx,{page:'面料库',reviewer:'visual QA',screenshots:shots});
  assert.equal(validateReview(ctx,proof).required,true);
  assert.throws(()=>validateReview({...ctx,sourceSha256:'other'},proof),/stale/);
  assert.throws(()=>validateReview({...ctx,baselineReleaseId:'other'},proof),/stale/);
  assert.throws(()=>validateReview(ctx,{...proof,decision:'pending'}),/missing\/failed/);
  assert.throws(()=>validateReview(ctx,{...proof,userAcceptance:'user-approved'}),/may not be forged/);
  assert.throws(()=>createReview(ctx,{page:'foo',reviewer:'QA',screenshots:[shots[0]]}),/screenshots required/);
  fs.appendFileSync(path.join(scratch,'desktop.png'),'changed');
  assert.throws(()=>validateReview(ctx,proof),/changed since review/);
 }finally{fs.rmSync(scratch,{recursive:true,force:true});fs.rmSync(workspace,{recursive:true,force:true});}
});
test('UI candidate pointer must match verified production baseline and stay inside workspace',()=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-ui-scope-'));
 try{
  assert.throws(()=>reviewContext({pointer:{currentRelease:{id:'A'}},baseline:{releaseId:'B'},workspace}),/differ/);
  assert.throws(()=>reviewContext({pointer:{currentRelease:{id:'A'},sourceManifest:'../outside.json'},baseline:{releaseId:'A'},workspace}),/unsafe/);
 }finally{fs.rmSync(workspace,{recursive:true,force:true});}
});
