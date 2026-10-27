import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {reviewedSourceDiff,acceptReviewedSource,acceptReviewedRequirements,syncVerifiedPointer,targetedFabricUiAllowed} from './source-automation.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
function workspace(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-source-flow-'));
 try{
  fs.mkdirSync(path.join(root,'src'),{recursive:true});
  fs.mkdirSync(path.join(root,'server'),{recursive:true});
  fs.mkdirSync(path.join(root,'scripts'),{recursive:true});
  fs.mkdirSync(path.join(root,'docs/project'),{recursive:true});
  fs.mkdirSync(path.join(root,'artifacts/candidate'),{recursive:true});
  fs.writeFileSync(path.join(root,'src/app.tsx'),'original');
  fs.writeFileSync(path.join(root,'server/db.ts'),'untouched');
  fs.writeFileSync(path.join(root,'scripts/tool.mjs'),'untouched');
  fs.writeFileSync(path.join(root,'docs/project/requirements.md'),'fixed');
  const source={workspace:root,baseHead:'base',requirements:{path:'docs/project/requirements.md',sha256:sha('fixed')},
   files:['src/app.tsx','server/db.ts','scripts/tool.mjs'].map(p=>({path:p,sha256:sha(fs.readFileSync(path.join(root,p)))}))};
  fs.writeFileSync(path.join(root,'artifacts/candidate/manifest.json'),JSON.stringify(source));
  const pointer={sourceManifest:'artifacts/candidate/manifest.json',currentRelease:{id:'old'}};
  fs.writeFileSync(path.join(root,'docs/project/fabric-v2-active-workspace.json'),JSON.stringify(pointer));
  return fn(root);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('source accept requires an exact reviewed file set and never blesses unrelated drift',()=>workspace(root=>{
 fs.writeFileSync(path.join(root,'src/app.tsx'),'approved');
 fs.writeFileSync(path.join(root,'server/db.ts'),'unreviewed');
 const ctx={root,head:'base'};
 assert.deepEqual(reviewedSourceDiff(ctx).changed,['server/db.ts','src/app.tsx']);
 assert.throws(()=>acceptReviewedSource(ctx,['src/app.tsx']),/unreviewed/i);
 assert.throws(()=>acceptReviewedSource(ctx,['../secret']),/Unsafe/);
 assert.throws(()=>acceptReviewedSource(ctx,['src/app.tsx','src/app.tsx']),/duplicate/i);
 assert.equal(fs.readFileSync(path.join(root,'artifacts/candidate/manifest.json'),'utf8').includes('approved'),false);
 const changes=acceptReviewedSource(ctx,['server/db.ts','src/app.tsx']);
 assert.equal(changes.length,2);
 assert.deepEqual(reviewedSourceDiff(ctx).changed,[]);
}));
test('accept allows only explicitly reviewed AGENTS and package entry files, not unknown pinned config',()=>workspace(root=>{
 const ctx={root,head:'base'};
 for(const name of ['AGENTS.md','package.json','config.json']){
  fs.writeFileSync(path.join(root,name),'original');
 }
 const manifestFile=path.join(root,'artifacts/candidate/manifest.json');
 const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
 manifest.files.push(...['AGENTS.md','package.json','config.json'].map(name=>({path:name,sha256:sha('original')})));
 fs.writeFileSync(manifestFile,JSON.stringify(manifest));
 fs.writeFileSync(path.join(root,'AGENTS.md'),'new rules');
 fs.writeFileSync(path.join(root,'package.json'),'new scripts');
 assert.deepEqual(reviewedSourceDiff(ctx).changed,['AGENTS.md','package.json']);
 assert.throws(()=>acceptReviewedSource(ctx,['AGENTS.md','package.json','config.json']),/Unsafe/);
 assert.deepEqual(acceptReviewedSource(ctx,['AGENTS.md','package.json']),['AGENTS.md','package.json']);
 assert.deepEqual(reviewedSourceDiff(ctx).changed,[]);
 fs.writeFileSync(path.join(root,'config.json'),'malicious edit');
 assert.throws(()=>acceptReviewedSource(ctx,['config.json']),/Unsafe/);
}));
test('typecheck config requires an exact reviewed source set and unrelated configs stay blocked',()=>workspace(root=>{
 const ctx={root,head:'base'},file='tsconfig.json';
 fs.writeFileSync(path.join(root,file),'original');
 const manifestFile=path.join(root,'artifacts/candidate/manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
 manifest.files.push({path:file,sha256:sha('original')});fs.writeFileSync(manifestFile,JSON.stringify(manifest));
 fs.writeFileSync(path.join(root,file),'reviewed artifact exclusion');
 fs.writeFileSync(path.join(root,'src/app.tsx'),'pending source');
 assert.throws(()=>acceptReviewedSource(ctx,[file]),/Unreviewed/);
 assert.throws(()=>acceptReviewedSource(ctx,[file,'src/app.tsx','config.json']),/Unsafe/);
 assert.deepEqual(acceptReviewedSource(ctx,['src/app.tsx',file]),['src/app.tsx',file]);
 assert.deepEqual(reviewedSourceDiff(ctx).changed,[]);
}));

test('source guard blocks unapproved file additions and requirements changes',()=>workspace(root=>{
 fs.writeFileSync(path.join(root,'src/untracked.ts'),'new');
 const ctx={root,head:'base'};
 assert.throws(()=>acceptReviewedSource(ctx,['src/app.tsx']),/unreviewed/i);
 fs.rmSync(path.join(root,'src/untracked.ts'));
 fs.writeFileSync(path.join(root,'docs/project/requirements.md'),'changed');
 assert.throws(()=>acceptReviewedSource(ctx,[]),/requirements/i);
}));
test('explicit requirement acceptance pins reviewed hashes without accepting source drift',()=>workspace(root=>{
 const ctx={root,head:'base'},file='docs/project/requirements.md';
 fs.writeFileSync(path.join(root,file),'approved requirement');fs.writeFileSync(path.join(root,'src/app.tsx'),'unreviewed code');
 assert.throws(()=>acceptReviewedRequirements(ctx,[{path:file,sha256:sha('wrong')}]),/hash/i);
 assert.throws(()=>acceptReviewedRequirements(ctx,[{path:'src/app.tsx',sha256:sha('unreviewed code')}]),/requirement/i);
 assert.deepEqual(acceptReviewedRequirements(ctx,[{path:file,sha256:sha('approved requirement')}]),[file]);
 assert.deepEqual(reviewedSourceDiff(ctx).changed,['src/app.tsx']);
 fs.writeFileSync(path.join(root,file),'changed again');assert.throws(()=>reviewedSourceDiff(ctx),/Requirements changed/);
}));
test('requirement and AC hashes must both be explicitly reviewed while code remains pending',()=>workspace(root=>{
 const ctx={root,head:'base'},ac='docs/product-master/product-master-v2-requirements.md',req='docs/project/requirements.md';
 fs.mkdirSync(path.join(root,'docs/product-master'),{recursive:true});fs.writeFileSync(path.join(root,ac),'old AC');
 const file=path.join(root,'artifacts/candidate/manifest.json'),manifest=JSON.parse(fs.readFileSync(file,'utf8'));
 manifest.files.push({path:ac,sha256:sha('old AC')});fs.writeFileSync(file,JSON.stringify(manifest));
 fs.writeFileSync(path.join(root,ac),'approved AC');fs.writeFileSync(path.join(root,req),'approved rule');fs.writeFileSync(path.join(root,'src/app.tsx'),'pending code');
 assert.throws(()=>acceptReviewedRequirements(ctx,[{path:req,sha256:sha('approved rule')}]),/Unreviewed requirement/);
 acceptReviewedRequirements(ctx,[{path:req,sha256:sha('approved rule')},{path:ac,sha256:sha('approved AC')}]);
 assert.deepEqual(reviewedSourceDiff(ctx).changed,['src/app.tsx']);
}));

test('reviewed source refresh preserves the documented local mockup helper exclusion only',()=>workspace(root=>{
 const ctx={root,head:'base'};
 fs.writeFileSync(path.join(root,'scripts/generate_mockup.py'),'private local helper');
 assert.deepEqual(reviewedSourceDiff(ctx).changed,[]);
 fs.writeFileSync(path.join(root,'src/app.tsx'),'reviewed');
 assert.deepEqual(acceptReviewedSource(ctx,['src/app.tsx']),['src/app.tsx']);
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'artifacts/candidate/manifest.json')));
 assert(!manifest.files.some(entry=>entry.path==='scripts/generate_mockup.py'));
 fs.writeFileSync(path.join(root,'scripts/other_local.py'),'not approved');
 assert.deepEqual(reviewedSourceDiff(ctx).changed,['scripts/other_local.py']);
 assert.throws(()=>acceptReviewedSource(ctx,[]),/unreviewed/i);
}));
test('quick browser gate only accepts dedicated Fabric list component changes',()=>{
 assert(targetedFabricUiAllowed(['src/components/product-master-v2/FabricLibraryV2.tsx']));
 assert(targetedFabricUiAllowed(['src/components/product-master-v2/FabricLibraryV2.test.ts','src/components/product-master-v2/FabricLibraryV2.tsx']));
 assert(!targetedFabricUiAllowed(['src/components/product-master-v2/FabricImportV2.tsx']));
 assert(!targetedFabricUiAllowed(['src/components/product-master-v2/FabricLibraryV2.tsx','server/auth.ts']));
 assert(!targetedFabricUiAllowed([]));
});

test('tooling relocation registers exact UI entries and test files without allowing arbitrary configuration',()=>workspace(root=>{
 fs.mkdirSync(path.join(root,'tests/ui'),{recursive:true});
 const paths=['package-lock.json','playwright.ui.config.ts','tests/ui/local.spec.ts','tools/ui-preview/entries/ui-ux-pilot.html'];
 for(const file of paths){const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,'reviewed tooling');}
 assert.deepEqual(reviewedSourceDiff({root,head:'base'}).changed,paths);
 assert.throws(()=>acceptReviewedSource({root,head:'base'},paths.slice(1)),/Unreviewed/);
 assert.deepEqual(acceptReviewedSource({root,head:'base'},paths),paths);
 assert.deepEqual(reviewedSourceDiff({root,head:'base'}).changed,[]);
 assert.throws(()=>acceptReviewedSource({root,head:'base'},['unrelated-config.json']),/Unsafe/);
}));
test('release pointer changes only after actual verified release evidence and preserves other fields',()=>workspace(root=>{
 const release={id:'new-release',dir:path.join(root,'artifacts/releases/new-release'),
  archiveSha256:'a'.repeat(64),manifest:{baseline:{releaseId:'old'}},
  phases:{verify:{status:'passed',result:{remote:{version:{index:'abc',backend:'def'}}}}}};
 const receipt={state:'released',artifactSha256:'a'.repeat(64),indexSha256:'abc',backendSha256:'def',utc:'2026-10-22T07:00:00Z'};
 assert.throws(()=>syncVerifiedPointer(root,release,{...receipt,backendSha256:'wrong'}),/mismatch/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'docs/project/fabric-v2-active-workspace.json'))).currentRelease.id,'old');
 assert.equal(syncVerifiedPointer(root,release,receipt).currentRelease.id,'new-release');
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'docs/project/fabric-v2-active-workspace.json'))).sourceManifest,'artifacts/candidate/manifest.json');
 assert.equal(syncVerifiedPointer(root,release,receipt).currentRelease.id,'new-release');
 assert.throws(()=>syncVerifiedPointer(root,{...release,id:'another'},receipt),/mismatch|baseline|Unverified/);
}));
