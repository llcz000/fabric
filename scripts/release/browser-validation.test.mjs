import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {selectBrowserValidation,executeBrowserValidation} from './browser-validation.mjs';

const gallery='src/components/product-master-v2/ModelGalleryV2.tsx';
const fabric='src/components/product-master-v2/FabricLibraryV2.tsx';
const gallerySpec='tests/ui/model-gallery.spec.ts';
const smoke=['tests/ui/internal-table-chrome.spec.ts','tests/ui/mobile-library-actions.spec.ts'];
const customerRenamePaths=['server/customer-samples/sessionDirectory.test.ts','server/customer-samples/sessionDirectory.ts',
 'server/customer-samples/sessionRead.ts','server/customers/model.ts','server/customers/routes.test.ts','server/customers/routes.ts',
 'server/customers/service.test.ts','server/customers/service.ts','server/customers/sessionBridge.ts',
 'src/components/customers/customerModel.test.ts','src/components/customers/customerModel.ts',
 'tests/ui/customer-delete-address.spec.ts','tools/ui-preview/customerWorkspaceReview.tsx'];
const customerSpecs=['tests/ui/customer-delete-address.spec.ts','tests/ui/sample-directory.spec.ts',
 'tests/ui/scan-selection.spec.ts','tests/ui/sample-card-review.spec.ts'];
const customerUnits=['server/customers/service.test.ts','server/customers/routes.test.ts','server/customers/documentIntegration.test.ts',
 'server/customer-samples/sessionDirectory.test.ts','server/customer-samples/sessionDirectoryRoutes.test.ts',
 'server/customer-samples/sessionRead.test.ts','server/customer-samples/scanRepository.test.ts',
 'server/order-v2/documents.test.ts','src/components/customers/customerModel.test.ts'];
const files=[gallery,fabric,gallerySpec,...smoke,'src/components/product-master-v2/FabricLibraryV2.test.ts',
 'tests/ui/internal-fabric-design.spec.ts','tests/ui/internal-fabric-weight-unit.spec.ts','tests/ui/related-products.spec.ts',
 'scripts/release/targeted-fabric-ui.mjs','tools/ui-preview/modelGalleryReview.tsx',
 'tools/ui-preview/entries/ui-ux-model-gallery.html','tools/ui-preview/internalFabricReview.tsx',
 'tools/ui-preview/entries/ui-ux-internal-fabrics.html','docs/project/项目需求总览.md',
 ...new Set([...customerRenamePaths,...customerSpecs,...customerUnits])];
function context(changes,options={}){
 const previous={files:files.map(path=>({path,sha256:'old'}))};
 const current={files:previous.files.map(f=>({...f,sha256:changes.includes(f.path)?'new':f.sha256}))};
 for(const p of changes)if(!files.includes(p)){previous.files.push({path:p,sha256:'old'});current.files.push({path:p,sha256:'new'});}
 return {previous,current,baselineReleaseId:'verified-release',sourceSha256:'candidate-sha',...options};
}

test('gallery changes and their exact fixture/spec select module checks plus shared smoke from manifest differences',()=>{
 const ctx=context([gallery,gallerySpec,'tools/ui-preview/modelGalleryReview.tsx','docs/project/项目需求总览.md']);
 const result=selectBrowserValidation(ctx);
 assert.equal(result.mode,'scoped');assert.deepEqual(result.profiles,['model-gallery']);
 assert.deepEqual(result.specs,[gallerySpec,...smoke].sort());
 assert.equal(result.baselineReleaseId,'verified-release');assert.equal(result.candidateManifestSha256,'candidate-sha');
 assert.deepEqual(result.changedFiles,[gallery,gallerySpec,'tools/ui-preview/modelGalleryReview.tsx','docs/project/项目需求总览.md'].sort());
});
test('fabric scope preserves unit and post-build geometry checks and unions multiple known pages without duplicate smoke',()=>{
 const result=selectBrowserValidation(context([fabric,gallery]));
 assert.equal(result.mode,'scoped');assert.deepEqual(result.profiles,['fabric-library','model-gallery']);
 assert.deepEqual(result.unitFiles,['src/components/product-master-v2/FabricLibraryV2.test.ts']);
 assert.deepEqual(result.postBuildScripts,['scripts/release/targeted-fabric-ui.mjs']);
 assert.equal(result.specs.filter(f=>f===smoke[0]).length,1);
});
test('the customer rename release selects customer and sampling flows with service and order regression',()=>{
 const result=selectBrowserValidation(context(customerRenamePaths));
 assert.equal(result.mode,'scoped');assert.deepEqual(result.profiles,['customer-selection']);
 assert.deepEqual(result.specs,[...customerSpecs,...smoke].sort());
 assert.deepEqual(result.unitFiles,[...customerUnits].sort());
});
test('a customer change with an unregistered permission file or a missing order check still runs full regression',()=>{
 assert.equal(selectBrowserValidation(context([...customerRenamePaths,'server/customers/access.ts'])).mode,'full');
 const ctx=context(customerRenamePaths);
 for(const side of ['previous','current'])ctx[side].files=ctx[side].files.filter(f=>f.path!=='server/order-v2/documents.test.ts');
 assert.equal(selectBrowserValidation(ctx).reason,'missing-required-check');
});
test('shared code, server, runner, config and unknown scope force full browser regression even beside a known page',()=>{
 for(const p of ['src/components/ui/Toast.tsx','src/components/product-master-v2/modelGalleryClient.ts',
  'src/components/product-master-v2/ProductTryOnDialog.tsx','src/components/product-master-v2/v2Experience.css',
  'src/App.tsx','server/auth.ts','scripts/release/cli.mjs','package-lock.json','vite.config.ts',
  'playwright.ui.config.ts',smoke[0],'tests/ui/unknown.spec.ts','tools/ui-preview/unknown.tsx']){
  const result=selectBrowserValidation(context([gallery,p]));
  assert.equal(result.mode,'full',p);assert.deepEqual(result.specs,[]);assert.match(result.reason,/unmapped/);
 }
});
test('added/deleted registered paths and missing selected tests cannot use scoped validation',()=>{
 for(const side of ['previous','current']){
  const ctx=context([gallery]);ctx[side].files=ctx[side].files.filter(f=>f.path!==gallery);
  assert.equal(selectBrowserValidation(ctx).mode,'full');
 }
 const ctx=context([gallery]);for(const side of ['previous','current'])ctx[side].files=ctx[side].files.filter(f=>f.path!==gallerySpec);
 assert.equal(selectBrowserValidation(ctx).mode,'full');
});
test('migration and explicit full UI overrides cannot be downgraded by quick UI; documents alone need no browser run',()=>{
 assert.equal(selectBrowserValidation(context([gallery],{migrations:['model-gallery']})).mode,'full');
 assert.equal(selectBrowserValidation(context([gallery],{fullUi:true})).mode,'full');
 assert.throws(()=>selectBrowserValidation(context([gallery,'server/auth.ts'],{quickUi:true})),/quick-ui/);
 assert.throws(()=>selectBrowserValidation(context([],{quickUi:true})),/quick-ui/);
 assert.equal(selectBrowserValidation(context(['docs/project/项目需求总览.md'])).mode,'none');
 assert.equal(selectBrowserValidation(context([gallerySpec])).mode,'scoped');
});
test('customer history date hotfix omits browser regression only for the existing approved files',()=>{
 const date='server/customers/service.ts';
 const options={customerHistoryHotfix:true,baselineReleaseId:'20261110t020116583-0e0eb9e3'};
 const changes=[date,'server/customers/service.testFixture.ts','server/customers/v12.test.ts','scripts/release/cli.mjs'];
 const plan=selectBrowserValidation(context(changes,options));
 assert.equal(plan.mode,'none');assert.equal(plan.reason,'customer-history-date-hotfix');
 assert.equal(selectBrowserValidation(context(changes)).mode,'full');
 for(const extra of [gallery,'server/customers/access.ts','scripts/release/remote.py'])assert.throws(()=>selectBrowserValidation(context([...changes,extra],options)),/date hotfix/);
 assert.throws(()=>selectBrowserValidation(context(changes.slice(1),options)),/date hotfix/);
 assert.throws(()=>selectBrowserValidation(context(changes,{...options,baselineReleaseId:'later-release'})),/date hotfix/);
 assert.throws(()=>selectBrowserValidation(context(changes,{...options,migrations:['sample-contact']})),/date hotfix/);
 const added=context(changes,options);added.previous.files=added.previous.files.filter(file=>file.path!==date);
 assert.throws(()=>selectBrowserValidation(added),/date hotfix/);
});
test('duplicate manifests fail closed instead of hiding changed ownership',()=>{
 const ctx=context([gallery]);ctx.current.files.push({...ctx.current.files[0]});
 assert.throws(()=>selectBrowserValidation(ctx),/duplicate/);
});

function reportFor(specs,root){return JSON.stringify({config:{rootDir:path.join(root,'tests/ui')},errors:[],
 stats:{expected:specs.length,unexpected:0,flaky:0,skipped:0},
 suites:[{specs:specs.map(file=>({file:path.relative(path.join(root,'tests/ui'),path.join(root,file)),
  tests:[{status:'expected',results:[{status:'passed'}]}]}))}]});}
test('execution streams browser progress separately from the machine-readable release report',()=>{
 const plan=selectBrowserValidation(context([gallery])),root=path.resolve('fixture-root'),calls=[];
 const dir=path.join(root,'artifacts/run');
 const result=executeBrowserValidation(plan,{root,dir,execPath:'node',run(exe,args,options){
  calls.push({exe,args,options});return reportFor(plan.specs,root);
 }});
 assert.equal(calls.length,1);assert.equal(calls[0].exe,'node');
 assert(calls[0].args.includes('--reporter=line,json'));assert.deepEqual(calls[0].args.slice(-3),plan.specs);
 assert.equal(calls[0].options.liveLog,path.join(dir,'ui-browser-progress.log'));
 assert.equal(calls[0].options.env.PLAYWRIGHT_JSON_OUTPUT_FILE,path.join(dir,'ui-browser-tests.log'));
 assert.equal(result.passed,3);assert.equal(result.mode,'scoped');
});
test('zero tests, omitted required specs, malformed reports and browser failures block release',()=>{
 const plan=selectBrowserValidation(context([gallery])),root=path.resolve('fixture-root');
 for(const output of ['not json',JSON.stringify({stats:{expected:0,unexpected:0},errors:[]}),reportFor(smoke,root),
  JSON.stringify({stats:{expected:3,unexpected:1},errors:[]})]){
  assert.throws(()=>executeBrowserValidation(plan,{root,dir:root,run(){return output;}}),/browser validation/i);
 }
 assert.throws(()=>executeBrowserValidation(plan,{root,dir:root,run(){throw Error('browser command failed');}}),/browser command failed/);
});
test('fabric unit failures stop before browser execution and no-change plans execute nothing',()=>{
 const root=path.resolve('fixture-root'),calls=[];
 assert.throws(()=>executeBrowserValidation(selectBrowserValidation(context([fabric])),{root,dir:root,run(_exe,args){calls.push(args);throw Error('unit failure');}}),/unit failure/);
 assert.equal(calls.length,1);assert(calls[0].includes('scripts/run-ts-tests.mjs'));
 executeBrowserValidation(selectBrowserValidation(context([])),{root,dir:root,run(){assert.fail('must not execute');}});
});
