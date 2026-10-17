import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {assessPhase1,PHASE1_EVIDENCE_GATES,loadEvidence} from './check-fabric-v2-phase1-delivery.mjs';

test('P0-P7 release readiness defaults to blocked; local isolated tests never prove production',()=>{
 const r=assessPhase1({server:"import express from 'express'; const app=express();",app:"const ProductLibrary=lazy(()=>import('./components/ProductLibrary'));",evidence:{}});
 assert.equal(r.readyForReview,false);
 assert.equal(r.releaseAuthorized,false);
 assert.equal(r.sourceGates.backendMount.ok,false);
 assert.equal(r.sourceGates.frontendMount.ok,false);
 assert.equal(r.evidenceGates.filter(x=>!x.ok).length,PHASE1_EVIDENCE_GATES.length);
});

test('P7 backend and P4 frontend source mount requires explicit V2 markers, not comments or legacy names',()=>{
 const a=assessPhase1({server:"// createV2CatalogAssembly at /api/v2? not mounted",app:"// ProductCatalogWorkspaceV2 future",evidence:{}});
 assert.equal(a.sourceGates.backendMount.ok,false);
 assert.equal(a.sourceGates.frontendMount.ok,false);
 const b=assessPhase1({server:"const routes = await createV2CatalogAssembly(db,pool,opts); app.use('/api/v2',routes);",app:"const Page=lazy(()=>import('./components/product-master-v2/ProductCatalogWorkspaceV2')); return <Page/>;",evidence:{}});
 assert.equal(b.sourceGates.backendMount.ok,true);
 assert.equal(b.sourceGates.frontendMount.ok,true);
});

test('evidence never silently passes from missing, non-pass or partial records',()=>{
 const src={server:"const r=await createV2CatalogAssembly(db,pool,opts);app.use('/api/v2',r)",app:"import('./components/product-master-v2/ProductCatalogWorkspaceV2')"};
 const incomplete=Object.fromEntries(PHASE1_EVIDENCE_GATES.map(id=>[id,{status:'passed'}]));
 const r=assessPhase1({...src,evidence:incomplete});
 assert.equal(r.readyForReview,false);
 assert.equal(r.evidenceGates.filter(x=>x.ok).length,0);
});

test('all independently witnessed evidence can satisfy pre-release review, never grant deployment',()=>{
 const src={server:"const r=await createV2CatalogAssembly(db,pool,opts);app.use('/api/v2',r)",app:"import('./components/product-master-v2/ProductCatalogWorkspaceV2')"};
 const evidence=Object.fromEntries(PHASE1_EVIDENCE_GATES.map(id=>[id,{status:'passed',proof:'docs/operations/phase1-release-evidence.md#'+id,reviewedBy:'independent-qa',proofSha256:'a'.repeat(64)}]));
 const r=assessPhase1({...src,evidence});
 assert.equal(r.readyForReview,true);
 assert.equal(r.releaseAuthorized,false);
});

test('P7 source gate rejects unbound assembly strings, comment tricks and misleading literals',()=>{
 const evidence=Object.fromEntries(PHASE1_EVIDENCE_GATES.map(id=>[id,{status:'passed',proof:'docs/operations/phase1-evidence.md#'+id,reviewedBy:'independent-qa',proofSha256:'a'.repeat(64)}]));
 const variants=[
  {server:"const proof=\"const r=await createV2CatalogAssembly(db,p,o);app.use('/api/v2',r)\";",app:"const fake=\"import('./components/product-master-v2/Example')\";"},
  {server:"const r=await createV2CatalogAssembly(db,p,o);const x=\"app.use('/api/v2',r)\";",app:"const Page=lazy(()=>import('./components/product-master-v2/ProductCatalogWorkspaceV2'));"},
  {server:"const r=await createV2CatalogAssembly(db,p,o);app.use('/api/v2',unknownRouter);",app:"const Page=lazy(()=>import('./components/product-master-v2/ProductCatalogWorkspaceV2'));"},
 ];
 for(const v of variants){
  const r=assessPhase1({...v,evidence});
  assert.equal(r.sourceGates.backendMount.ok,false,v.server);
  assert.equal(r.readyForReview,false);
 }
 const good=assessPhase1({server:"const routes=await createV2CatalogAssembly(db,p,o);app.use('/api/v2',routes);",app:"const Page=lazy(()=>import('./components/product-master-v2/ProductCatalogWorkspaceV2'));",evidence});
 assert.equal(good.readyForReview,true);
 assert.equal(good.releaseAuthorized,false);
});

test('P7 independently reviewed evidence rejects tampered proof file after signoff',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-v2-release-proof-'));
 try{
  const dir=path.join(root,'docs','operations');fs.mkdirSync(dir,{recursive:true});
  const proofFile=path.join(dir,'phase1-proof.md'),manifest=path.join(dir,'phase1-attestation.json');
  fs.writeFileSync(proofFile,'reviewed proof version A');
  const digest=createHash('sha256').update(fs.readFileSync(proofFile)).digest('hex');
  const write=(hash)=>fs.writeFileSync(manifest,JSON.stringify({format:'fabric-v2-phase1-evidence-v1',gates:{
   P1_production_schema_and_migration:{status:'passed',reviewedBy:'independent-qa',proof:'docs/operations/phase1-proof.md',proofSha256:hash}
  }}));
  write(digest);
  const evidence=loadEvidence(root,['--evidence','docs/operations/phase1-attestation.json']);
  assert.equal(evidence.P1_production_schema_and_migration.proofSha256,digest);
  fs.writeFileSync(proofFile,'altered proof version B');
  assert.throws(()=>loadEvidence(root,['--evidence','docs/operations/phase1-attestation.json']),/digest|hash|integrity/i);
  write('invalid');
  assert.throws(()=>loadEvidence(root,['--evidence','docs/operations/phase1-attestation.json']),/digest|hash|integrity/i);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('P7 release evidence rejects symlinks, missing files and manifests with fake reviewer',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-v2-release-symlink-'));
 try{
  const dir=path.join(root,'docs','operations');fs.mkdirSync(dir,{recursive:true});
  const proof=path.join(dir,'evidence.md'),manifest=path.join(dir,'phase1.json');
  fs.writeFileSync(proof,'independent evidence');
  const sha=createHash('sha256').update(fs.readFileSync(proof)).digest('hex');
  const row={status:'passed',reviewedBy:'independent-qa',proof:'docs/operations/evidence.md',proofSha256:sha};
  const set=v=>fs.writeFileSync(manifest,JSON.stringify({format:'fabric-v2-phase1-evidence-v1',gates:{P1_production_schema_and_migration:v}}));
  set({...row,reviewedBy:''});
  assert.throws(()=>loadEvidence(root,['--evidence','docs/operations/phase1.json']),/review|proof|evidence/i);
  set({...row,proof:'docs/operations/no-such.md'});
  assert.throws(()=>loadEvidence(root,['--evidence','docs/operations/phase1.json']),/proof|file|evidence/i);
  const moved=path.join(dir,'real.md');fs.renameSync(proof,moved);
  let linked=false;
  try{fs.symlinkSync('real.md',proof);linked=true;}
  catch(e){if(!['EPERM','EACCES','ENOTSUP'].includes(e.code))throw e;
   t.diagnostic('Windows environment lacks symlink privilege; skipped this assertion only');}
  if(linked){set(row);assert.throws(()=>loadEvidence(root,['--evidence','docs/operations/phase1.json']),/symbolic|symlink|path|proof/i);}
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('real current Fabric entrypoints fail closed without production evidence',()=>{
 const cli=path.resolve('scripts/check-fabric-v2-phase1-delivery.mjs');
 const r=spawnSync(process.execPath,[cli,'--status'],{encoding:'utf8',timeout:20000,cwd:process.cwd()});
 assert.equal(r.status,2,r.stderr);
 const report=JSON.parse(r.stdout);
 assert.equal(report.readyForReview,false);
 assert.equal(report.releaseAuthorized,false);
 assert.ok(report.evidenceGates.length>=8);
});
