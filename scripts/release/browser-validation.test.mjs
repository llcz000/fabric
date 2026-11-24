import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {selectBrowserValidation,executeBrowserValidation,deletionGuidanceReviewedFiles,adminDocumentLookupReviewedFiles,releaseBasics} from './browser-validation.mjs';

const gallery='src/components/product-master-v2/ModelGalleryV2.tsx';
const fabric='src/components/product-master-v2/FabricLibraryV2.tsx';
const gallerySpec='tests/ui/model-gallery.spec.ts';
const smoke=releaseBasics.map(test=>test.file);
const customerRenamePaths=['server/customer-samples/sessionDirectory.test.ts','server/customer-samples/sessionDirectory.ts',
 'server/customer-samples/sessionRead.ts','server/customers/model.ts','server/customers/routes.test.ts','server/customers/routes.ts',
 'server/customers/service.test.ts','server/customers/service.ts','server/customers/sessionBridge.ts',
 'src/components/customers/customerModel.test.ts','src/components/customers/customerModel.ts'];
const customerSpecs=['tests/ui/customer-delete-address.spec.ts','tests/ui/sample-directory.spec.ts',
 'tests/ui/scan-selection.spec.ts','tests/ui/sample-card-review.spec.ts'];
const customerFormSpec='tests/ui/customer-delete-address.spec.ts';
const customerFormPaths=['src/components/customers/CustomerContactPasteDialog.tsx','src/components/customers/CustomerProfileDialog.tsx',
 'src/components/customers/CustomerProfileForm.tsx','src/components/customers/customerContactText.test.ts',
 'src/components/customers/customerContactText.ts',customerFormSpec,'tools/ui-preview/customerWorkspaceReview.tsx'];
const customerFormUnits=['src/components/customers/customerContactText.test.ts','src/components/customers/customerModel.test.ts',
 'src/components/customers/CompactCustomerChoice.test.tsx','src/components/document-product-selector/V2DocumentWorkspace.test.ts'];
const customerUnits=['server/customers/service.test.ts','server/customers/routes.test.ts','server/customers/documentIntegration.test.ts',
 'server/customer-samples/sessionDirectory.test.ts','server/customer-samples/sessionDirectoryRoutes.test.ts',
 'server/customer-samples/sessionRead.test.ts','server/customer-samples/scanRepository.test.ts',
 'server/order-v2/documents.test.ts','src/components/customers/customerModel.test.ts'];
const printView='src/components/document-product-selector/V2DocumentPrintView.tsx';
const printQa='scripts/document-output-browser-qa.mjs';
const printSpec='tests/ui/document-delete.spec.ts';
const printUnits=['src/components/document-product-selector/V2DocumentPrintView.test.ts',
 'src/lib/documentPrintModel.test.ts','server/documentExcel.test.ts','server/order-v2/print.test.ts'];
const printRegistration=[printView,printQa,'scripts/release/browser-validation.mjs','scripts/release/browser-validation.test.mjs'];
const imageIngressUnits=['server/image-assets/policy.test.ts','server/image-assets/routes.test.ts',
 'server/image-assets/service.test.ts','server/image-assets/companyImages.test.ts','src/lib/imageAssets.test.ts'];
const files=[gallery,fabric,gallerySpec,...smoke,...imageIngressUnits,'src/components/product-master-v2/FabricLibraryV2.test.ts',
 'tests/ui/internal-fabric-design.spec.ts','tests/ui/internal-fabric-weight-unit.spec.ts','tests/ui/related-products.spec.ts',
 'scripts/release/targeted-fabric-ui.mjs','tools/ui-preview/modelGalleryReview.tsx',
 'tools/ui-preview/entries/ui-ux-model-gallery.html','tools/ui-preview/internalFabricReview.tsx',
 'tools/ui-preview/entries/ui-ux-internal-fabrics.html','docs/project/项目需求总览.md',
 printView,printQa,printSpec,...printUnits,
 ...new Set([...customerRenamePaths,...customerSpecs,...customerUnits,...customerFormPaths,...customerFormUnits])];
function context(changes,options={}){
 const previous={files:files.map(path=>({path,sha256:'old'}))};
 const current={files:previous.files.map(f=>({...f,sha256:changes.includes(f.path)?'new':f.sha256}))};
 for(const p of changes)if(!files.includes(p)){previous.files.push({path:p,sha256:'old'});current.files.push({path:p,sha256:'new'});}
 return {previous,current,baselineReleaseId:'verified-release',sourceSha256:'candidate-sha',...options};
}

test('active sample product reference scope includes only product browser checks and permits the registered migration file',()=>{
 const spec='tests/ui/catalog-number-sort.spec.ts',schema='server/customer-samples/activeProductReferenceSchema.ts';
 const candidate=context([spec,schema,'scripts/release/browser-validation.mjs','scripts/release/migrations.ts',
  gallerySpec,'tools/ui-preview/internalFabricReview.tsx','tests/ui/dual-qr.spec.ts',
  'server/customer-samples/schemaContract.test.ts','server/product-master/productSearch.test.ts',
  'src/components/product-master-v2/ProductCatalogV2.test.ts','src/components/product-master-v2/productCardAssociation.test.ts',
  'src/components/product-master-v2/uiExperience.test.ts'],{migrations:['active-sample-product-reference']});
 candidate.previous.files=candidate.previous.files.filter(file=>file.path!==schema);
 const result=selectBrowserValidation(candidate);
 assert.equal(result.mode,'scoped');
 assert.deepEqual(result.profiles,['product-deletion']);
 assert.deepEqual(result.specs,[spec,...smoke].sort());
 assert.deepEqual(result.releaseChecks,['node','python']);
});

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
test('the customer form release selects its browser tests, shared smoke and the real document quick-create regression',()=>{
 const result=selectBrowserValidation(context([...customerFormPaths,'docs/project/项目需求总览.md']));
 assert.equal(result.mode,'scoped');assert.deepEqual(result.profiles,['customer-profile']);
 assert.deepEqual(result.specs,[customerFormSpec,...smoke].sort());
 assert.deepEqual(result.unitFiles,[...customerFormUnits].sort());
 for(const p of customerFormPaths)assert.equal(selectBrowserValidation(context([p])).mode,'scoped',p);
});
test('a customer form and customer-selection change keeps the required checks of both',()=>{
 const result=selectBrowserValidation(context([...customerFormPaths,'server/customers/service.ts']));
 assert.equal(result.mode,'scoped');assert.deepEqual(result.profiles,['customer-profile','customer-selection']);
 assert.deepEqual(result.specs,[...customerSpecs,...smoke].sort());
 assert.deepEqual(result.unitFiles,[...new Set([...customerUnits,...customerFormUnits])].sort());
});
test('missing quick-create coverage or an unrelated unregistered file cannot use the customer form scope',()=>{
 const unknown='src/components/document-product-selector/V2DocumentWorkspace.tsx';
 const mixed=selectBrowserValidation(context([...customerFormPaths,unknown]));
 assert.equal(mixed.mode,'full');assert.deepEqual(mixed.unmappedFiles,[unknown]);
 const ctx=context(customerFormPaths);
 ctx.current.files=ctx.current.files.filter(f=>f.path!=='src/components/document-product-selector/V2DocumentWorkspace.test.ts');
 assert.equal(selectBrowserValidation(ctx).reason,'added-or-removed-code');
 for(const side of ['previous','current'])ctx[side].files=ctx[side].files.filter(f=>f.path!=='src/components/document-product-selector/V2DocumentWorkspace.test.ts');
 assert.equal(selectBrowserValidation(ctx).reason,'missing-required-check');
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
  'playwright.ui.config.ts','tests/ui/acceptance-layout.spec.ts','tests/ui/unknown.spec.ts','tools/ui-preview/unknown.tsx']){
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
test('document print layout changes select document browser, print-model and post-build print checks',()=>{
 const result=selectBrowserValidation(context([printView,printQa]));
 assert.equal(result.mode,'scoped');
 assert.deepEqual(result.profiles,['document-print']);
 assert.deepEqual(result.specs,[...smoke,printSpec].sort());
 assert.deepEqual(result.unitFiles,[...printUnits].sort());
 assert.deepEqual(result.postBuildScripts,[printQa]);
 const missing=context([printView]);
 missing.current.files=missing.current.files.filter(file=>file.path!==printSpec);
 assert.equal(selectBrowserValidation(missing).mode,'full');
});
test('the document print scope registration can ship with the exact reviewed fix on its verified baseline',()=>{
 const options={quickUi:true,baselineReleaseId:'20261116t014419464-d2a31ac2'};
 const result=selectBrowserValidation(context(printRegistration,options));
 assert.equal(result.mode,'scoped');
 assert.deepEqual(result.profiles,['document-print']);
 assert.equal(selectBrowserValidation(context(printRegistration)).mode,'full');
 for(const changes of [printRegistration.slice(1),[...printRegistration,'scripts/release/cli.mjs'],[...printRegistration,gallery]]){
  assert.throws(()=>selectBrowserValidation(context(changes,options)),/quick-ui/);
 }
 for(const extra of [{baselineReleaseId:'later-release'},{migrations:['sample-contact']},{fullUi:true}]){
  assert.throws(()=>selectBrowserValidation(context(printRegistration,{...options,...extra})),/quick-ui/);
 }
 const added=context(printRegistration,options);
 added.previous.files=added.previous.files.filter(file=>file.path!==printQa);
 assert.throws(()=>selectBrowserValidation(added),/quick-ui/);
});
test('duplicate manifests fail closed instead of hiding changed ownership',()=>{
 const ctx=context([gallery]);ctx.current.files.push({...ctx.current.files[0]});
 assert.throws(()=>selectBrowserValidation(ctx),/duplicate/);
});
test('deletion guidance registration is bound to the reviewed production baseline and bytes',()=>{
 const files=Object.keys(deletionGuidanceReviewedFiles);
 const tools=['scripts/release/browser-validation.mjs','scripts/release/browser-validation.test.mjs'];
 const required=['tests/ui/deletion-guidance.spec.ts','tests/ui/catalog-number-sort.spec.ts',
  'tests/ui/related-products.spec.ts','tests/ui/document-delete.spec.ts',...smoke];
 const units=['server/product-master/catalogExport.test.ts','server/product-master/productsV2.test.ts','server/product-master/productProtection.test.ts',
  'server/product-master/patternDeletion.test.ts','server/product-master/colorwayIdentity.test.ts',
  'server/product-master/v2CatalogAssembly.test.ts','src/components/product-master-v2/PatternLibraryV2.test.ts',
  'src/components/product-master-v2/patternBulkImportModel.test.ts','src/components/document-product-selector/documentSearchModel.test.ts',
  'src/components/document-product-selector/V2DocumentBrowser.test.ts'];
 const options={quickUi:true,baselineReleaseId:'20261117t142934116-1e66c997'};
 const candidate=(extra={})=>{
  const ctx=context([...files,...tools],{...options,...extra});
  for(const file of ctx.current.files)if(deletionGuidanceReviewedFiles[file.path])file.sha256=deletionGuidanceReviewedFiles[file.path];
  ctx.previous.files=ctx.previous.files.filter(f=>f.path!=='tests/ui/deletion-guidance.spec.ts');
  for(const p of units)if(!ctx.current.files.some(f=>f.path===p))for(const side of ['current','previous'])ctx[side].files.push({path:p,sha256:'old'});
  return ctx;
 };
 const result=selectBrowserValidation(candidate());
 assert.equal(result.mode,'scoped');
 assert.equal(result.reason,'reviewed-deletion-guidance-registration');
 assert.deepEqual(result.specs,required.sort());
 for(const p of ['server/order-v2/orderQueries.test.ts','server/product-master/p7MediaOrderLifecycle.test.ts'])assert(result.unitFiles.includes(p));
 for(const extra of [{baselineReleaseId:'other-baseline'},{migrations:['product-auto-cards']},{fullUi:true}]){
  assert.throws(()=>selectBrowserValidation(candidate(extra)),/quick-ui/);
 }
 assert.equal(selectBrowserValidation(candidate({quickUi:false})).mode,'full');
 const changed=candidate();changed.current.files.find(f=>f.path==='scripts/release/remote.py').sha256='another-executor';
 assert.throws(()=>selectBrowserValidation(changed),/quick-ui/);
 const missing=candidate();missing.current.files=missing.current.files.filter(f=>f.path!==smoke[1]);
 assert.throws(()=>selectBrowserValidation(missing),/quick-ui/);
 const unknown=candidate();unknown.current.files.push({path:'server/unknown.ts',sha256:'new'});
 assert.throws(()=>selectBrowserValidation(unknown),/quick-ui/);
});

test('administrator document lookup takes the reviewed scope only on the current deletion baseline',()=>{
 const tools=['scripts/release/browser-validation.mjs','scripts/release/browser-validation.test.mjs'];
 const reviewed=Object.keys(adminDocumentLookupReviewedFiles),shared='src/components/product-master-v2/V2App.tsx';
 const specs=['tests/ui/deletion-guidance.spec.ts','tests/ui/catalog-number-sort.spec.ts',
  'tests/ui/related-products.spec.ts','tests/ui/document-delete.spec.ts',...smoke];
 const candidate=(overrides={})=>{
  const ctx=context([...reviewed,...tools],{quickUi:true,baselineReleaseId:'20261124t055326487-fcc99aa4',...overrides});
  for(const file of ctx.current.files)if(adminDocumentLookupReviewedFiles[file.path])file.sha256=adminDocumentLookupReviewedFiles[file.path];
  for(const p of Object.keys(deletionGuidanceReviewedFiles).concat(['server/product-master/catalogExport.test.ts',
   'server/product-master/productsV2.test.ts','server/product-master/productProtection.test.ts','server/product-master/patternDeletion.test.ts',
   'server/product-master/colorwayIdentity.test.ts','server/product-master/v2CatalogAssembly.test.ts',
   'src/components/product-master-v2/PatternLibraryV2.test.ts','src/components/product-master-v2/patternBulkImportModel.test.ts','src/components/document-product-selector/documentSearchModel.test.ts',
   'src/components/document-product-selector/V2DocumentBrowser.test.ts']))if(!ctx.current.files.some(f=>f.path===p))
   for(const side of ['current','previous'])ctx[side].files.push({path:p,sha256:'old'});
  return ctx;
 };
 const result=selectBrowserValidation(candidate());
 assert.equal(result.mode,'scoped');
 assert.equal(result.reason,'reviewed-admin-document-lookup');
 assert.deepEqual(result.specs,specs.sort());
 assert(result.unitFiles.includes('server/order-v2/orderQueries.test.ts'));
 assert(result.unitFiles.includes('src/components/product-master-v2/productCardAssociation.test.ts'));
 for(const override of [{baselineReleaseId:'different-release'},{migrations:['test-migration']},{fullUi:true}])
  assert.throws(()=>selectBrowserValidation(candidate(override)),/quick-ui/);
 assert.equal(selectBrowserValidation(candidate({quickUi:false})).mode,'full');
 for(const mutate of [
  ctx=>{ctx.current.files.find(f=>f.path===shared).sha256='unreviewed';},
  ctx=>{ctx.previous.files=ctx.previous.files.filter(f=>f.path!==shared);},
  ctx=>{ctx.current.files=ctx.current.files.filter(f=>f.path!==smoke[0]);},
  ctx=>{ctx.current.files.push({path:'server/extra.ts',sha256:'new'});},
 ]){const ctx=candidate();mutate(ctx);assert.throws(()=>selectBrowserValidation(ctx),/quick-ui/);}
});

test('image asset backend-only fixes skip browser acceptance while unrelated changes and overrides still force validation',()=>{
 const files=['server/image-assets/policy.ts','server/image-assets/policy.test.ts',
  'server/image-assets/processor.ts','server/image-assets/routes.ts','server/image-assets/routes.test.ts',
  'server/image-assets/service.test.ts','server/image-assets/validator.ts',
  'scripts/release/browser-validation.mjs','scripts/release/browser-validation.test.mjs'];
 const result=selectBrowserValidation(context(files));
 assert.equal(result.mode,'none');assert.equal(result.reason,'server-image-assets-only-no-ui-impact');
 assert.deepEqual(result.specs,[]);assert.deepEqual(result.unitFiles,[...imageIngressUnits].sort());
 assert.deepEqual(result.releaseChecks,['node']);
 assert.equal(selectBrowserValidation(context([...files,'src/components/product-master-v2/PatternLibraryV2.tsx'])).mode,'full');
 assert.equal(selectBrowserValidation(context([...files,'server/auth.ts'])).mode,'full');
 assert.equal(selectBrowserValidation(context(files,{migrations:['image-assets']})).mode,'full');
 assert.equal(selectBrowserValidation(context(files,{fullUi:true})).mode,'full');
 assert.equal(selectBrowserValidation(context(files,{quickUi:true})).mode,'none');
});

function reportFor(specs,root){return JSON.stringify({config:{rootDir:path.join(root,'tests/ui')},errors:[],
 stats:{expected:specs.length,unexpected:0,flaky:0,skipped:0},
 suites:[{specs:specs.map(file=>{
  const basic=releaseBasics.find(test=>test.file===file);
  return {file:path.relative(path.join(root,'tests/ui'),path.join(root,file)),title:basic?.title??'affected test',
   tags:basic?['p0']:[],tests:[{status:'expected',results:[{status:'passed'}]}]};
 })}]});}
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
 assert.equal(calls[0].options.env.FABRIC_UI_UX_RUN_ID,'run');
 assert(calls[0].args.includes(path.join(dir,'ui-browser-output')));
 assert(calls[0].args.includes('--max-failures=1'));
 assert.equal(calls[0].options.timeout,10*60_000);
 assert.equal(result.passed,3);assert.equal(result.mode,'scoped');
});
test('full browser regression uses the longer time budget and runs the entire suite',()=>{
 const plan=selectBrowserValidation(context([gallery],{fullUi:true})),root=path.resolve('fixture-root');
 const result=executeBrowserValidation(plan,{root,dir:root,run(_exe,args,options){
  assert.equal(options.timeout,45*60_000);
  assert.equal(args.at(-1),'--reporter=line,json');
  return reportFor([gallerySpec,...smoke],root);
 }});
 assert.equal(result.mode,'full');assert.equal(result.passed,3);
 assert.deepEqual(result.passedByPriority,{p0:2,p1:1});
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

test('registered image migration selects the actual image upload flow when new checks ship with the fix',()=>{
 const spec='tests/ui/product-image-upload.spec.ts';
 const files=['server/product-master/productsV2.ts','server/product-master/schema.ts',
  'server/product-master/schemaContract.ts','server/product-master/productImageCategoryReuseSchema.ts',
  'src/components/product-master-v2/PatternColorwayEditor.tsx','src/components/product-master-v2/productEditorModel.ts',
  'scripts/release/cli.mjs','scripts/release/core.mjs','scripts/release/migrations.ts',
  'scripts/release/remote.py','scripts/release/remote_test.py','scripts/release/browser-validation.mjs',
  'scripts/release/browser-validation.test.mjs','tests/ui/pattern-dimensions.spec.ts','tests/ui/automatic-product-cards.spec.ts',
  'tests/ui/catalog-number-sort.spec.ts', spec,'server/product-master/productsV2.test.ts','server/product-master/schemaContract.test.ts',
  'server/product-master/productImageCategoryReuseSchema.test.ts','server/product-master/v2ProductionMigration.test.ts',
  'server/product-master/p7MediaOrderLifecycle.test.ts','src/components/product-master-v2/ProductEditorV2.test.ts',
  'src/components/product-master-v2/PatternLibraryV2.test.ts','scripts/release/release.test.mjs',
  'server/product-master/fabricNumberSchema.test.ts','server/product-master/fabrics.test.ts',
  'server/product-master/fabricExcelPreview.test.ts','server/product-master/fabricExcelImport.test.ts'];
 const ctx=context(files,{quickUi:true,migrations:['product-auto-cards','product-image-category-reuse']});
 ctx.previous.files=ctx.previous.files.filter(file=>![spec,'server/product-master/productImageCategoryReuseSchema.ts'].includes(file.path));
 const result=selectBrowserValidation(ctx);
 assert.equal(result.mode,'scoped');
 assert(result.specs.includes(spec));
 assert(result.unitFiles.includes('server/product-master/productImageCategoryReuseSchema.test.ts'));
 assert(result.unitFiles.includes('server/product-master/fabricExcelImport.test.ts'));
 assert.deepEqual(result.migrations,ctx.migrations);
 assert.deepEqual(result.releaseChecks,['node','python']);
 for(const migrations of [['product-image-category-reuse','sample-contact'],['product-auto-cards']]){
  const plan=selectBrowserValidation({...ctx,migrations,quickUi:false});
  assert.equal(plan.mode,'full');assert(plan.unmappedMigrations.length>0);
 }
 const unknown=selectBrowserValidation({...ctx,quickUi:false,current:{files:[...ctx.current.files,{path:'server/other.ts',sha256:'new'}]}});
 assert.deepEqual(unknown.unmappedFiles,['server/other.ts']);
});

test('the release runs short checks and verifies the build before starting browser tests',()=>{
 const plan=selectBrowserValidation(context([fabric])),root=path.resolve('fixture-root'),steps=[];
 executeBrowserValidation(plan,{root,dir:root,buildCandidate(){steps.push('build');},run(_exe,args,options){
  steps.push(options.label);
  if(options.label==='uiBrowserTests')return reportFor(plan.specs,root);
 }});
 assert.deepEqual(steps,['uiFocusedUnit','build','uiBrowserTests']);
 assert.throws(()=>executeBrowserValidation(plan,{root,dir:root,buildCandidate(){throw Error('source drift after build');},
  run(_exe,_args,options){assert.equal(options.label,'uiFocusedUnit');}}),/source drift after build/);
});
test('backend-only impact still executes its focused tests and the build',()=>{
 const ctx=context(['server/image-assets/processor.ts','scripts/release/core.mjs']);
 const plan=selectBrowserValidation(ctx),steps=[],root=path.resolve('fixture-root');
 const result=executeBrowserValidation(plan,{root,dir:root,buildCandidate(){steps.push('build');},run(_exe,_args,options){steps.push(options.label);}});
 assert.deepEqual(steps,['releaseScopeCheck','uiFocusedUnit','build']);
 assert.equal(result.executed,false);
 assert.deepEqual(result.unitFiles,plan.unitFiles);
});

test('scoped releases select two basic cases and affected coverage, not unrelated or specialist cases',()=>{
 const plan=selectBrowserValidation(context([gallery]));
 assert.deepEqual(plan.priorities.p0.map(test=>test.file),[
  'tests/ui/internal-table-chrome.spec.ts','tests/ui/wechat-card-api.spec.ts']);
 assert.deepEqual(plan.priorities.p1,[gallerySpec]);
 const root=path.resolve('fixture-root'),dir=path.join(root,'artifacts/priority');
 const calls=[];
 executeBrowserValidation(plan,{root,dir,run(_exe,args){calls.push(args);return reportFor(plan.specs,root);}});
 const args=calls[0];
 assert.match(args[args.indexOf('--grep')+1],/@p0/);
 assert.match(args[args.indexOf('--grep-invert')+1],/@p2/);
 const pattern=new RegExp(args[args.indexOf('--grep')+1]);
 assert(pattern.test('model-gallery.spec.ts covered model case'));
 assert(!pattern.test('internal-table-chrome.spec.ts sortable headers'));
});
test('release evidence refuses a report where one required P0 test was skipped',()=>{
 const plan=selectBrowserValidation(context([gallery])),root=path.resolve('fixture-root');
 const report=JSON.parse(reportFor(plan.specs,root));
 const p0=report.suites[0].specs.find(spec=>spec.tags?.includes('p0'));
 assert(p0);
 p0.tests=[{status:'skipped',results:[{status:'skipped'}]}];
 assert.throws(()=>executeBrowserValidation(plan,{root,dir:root,run(){return JSON.stringify(report);}}),/P0/);
});
test('a local-only Excel or demo-only test update does not turn into release browser testing',()=>{
 const plan=selectBrowserValidation(context(['tests/ui/fabric-import.spec.ts','tests/ui/sample-card-ux.spec.ts']));
 assert.equal(plan.mode,'none');
 assert.equal(plan.reason,'browser-specialist-only');
});

test('image-editor-only release opens the upload fixture without unrelated catalog or dimensions specs',()=>{
 const file='tests/ui/product-image-upload.spec.ts';
 const ctx=context(['src/components/product-master-v2/productEditorModel.ts',file]);
 const units=['server/product-master/productsV2.test.ts','server/product-master/schemaContract.test.ts',
  'server/product-master/v2ProductionMigration.test.ts','server/product-master/productImageCategoryReuseSchema.test.ts',
  'server/product-master/p7MediaOrderLifecycle.test.ts','src/components/product-master-v2/ProductEditorV2.test.ts',
  'src/components/product-master-v2/PatternLibraryV2.test.ts'];
 for(const side of ['previous','current'])ctx[side].files.push(...units.map(path=>({path,sha256:'old'})));
 const plan=selectBrowserValidation(ctx);
 assert.equal(plan.mode,'scoped');
 assert.deepEqual(plan.priorities.p1,[file]);
 assert.deepEqual(plan.specs,[...smoke,file].sort());
});
test('release evidence refuses an unrelated passing test from a shared file',()=>{
 const plan=selectBrowserValidation(context([gallery])),root=path.resolve('fixture-root');
 const report=JSON.parse(reportFor(plan.specs,root));
 report.suites[0].specs.push({file:'internal-table-chrome.spec.ts',title:'unplanned sort case',
  tests:[{status:'expected',results:[{status:'passed'}]}]});
 report.stats.expected++;
 assert.throws(()=>executeBrowserValidation(plan,{root,dir:root,run(){return JSON.stringify(report);}}),/out-of-scope/);
});

test('P0 passing alone in a shared file does not satisfy required P1 coverage',()=>{
 const files=['tests/ui/internal-table-chrome.spec.ts','tests/ui/mobile-library-actions.spec.ts'];
 const plan=selectBrowserValidation(context(files)),root=path.resolve('fixture-root');
 assert.equal(plan.mode,'scoped');
 assert.throws(()=>executeBrowserValidation(plan,{root,dir:root,run(){return reportFor(plan.specs,root);}}),/P1/);
});
