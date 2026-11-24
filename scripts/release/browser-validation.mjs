/** Browser scope is derived only from verified-release/candidate manifests, never Git dirt. */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const smoke=['tests/ui/internal-table-chrome.spec.ts','tests/ui/mobile-library-actions.spec.ts'];
const customerHistoryBaseline='20261110t020116583-0e0eb9e3';
const customerHistoryFiles=['server/customers/service.ts','server/customers/service.testFixture.ts','server/customers/v12.test.ts'];
const customerHistoryToolFiles=['scripts/release/browser-validation.mjs','scripts/release/browser-validation.test.mjs',
 'scripts/release/cli.mjs','scripts/release/core.mjs','scripts/release/release.test.mjs'];
const printView='src/components/document-product-selector/V2DocumentPrintView.tsx';
const printQa='scripts/document-output-browser-qa.mjs';
const printRegistrationBaseline='20261116t014419464-d2a31ac2';
const scopeRegistrationTools=['scripts/release/browser-validation.mjs','scripts/release/browser-validation.test.mjs'];
// One registration on the verified production baseline. Only the selector and
// its tests can differ from the already reviewed candidate bytes.
const deletionGuidanceBaseline='20261117t142934116-1e66c997';
export const deletionGuidanceReviewedFiles=Object.freeze({
 'scripts/release/candidate.py':'74478e03fa56cf88d1fd99a50b1930630d4692668d9c9b6efb25a5c50593e0c1',
 'scripts/release/cli.mjs':'fe0826dd905f25f36b19bfb538a6ab257b3cd59b296b11c96053646080a7c63f',
 'scripts/release/core.mjs':'43918f12e40e3b370faf5141db5ecb70e7d372b311117407f13b4da16131b9b9',
 'scripts/release/ecosystem.config.cjs':'176204b0ec6fc7edc2860c5c1458e91d613c14ea93199ec939be475165cdffa6',
 'scripts/release/host/certbot-requirements.txt':'50c2d73b6a95966d31e64af4bbd632f4089823fc19b60ef776933f711c1da62f',
 'scripts/release/host/fabric-certbot-renew.service':'f49258d8a37da0d538488f2e5cec7db6e3f21e24a81207107aac4a5591801eb8',
 'scripts/release/host/fabric-certbot-renew.timer':'9a98ffa93163e423d747d6b9930eb186a9f1d653f7418a478eb430a45329a4c0',
 'scripts/release/host/fabric-domain.conf':'dfbd96f81e45911d28e2783437f51a65d9fb14ca33d54bffab66b24b28926772',
 'scripts/release/host/fabric-site.conf':'2c71bee99e39761a69d7033aada1ff03376d1328a44018207c1c8f86e86cc0db',
 'scripts/release/host/fabric-v2-camera.conf':'10ffbf6f9f83817f749a7125ecd1201719a6e5a68bc9f821e0e73ad54f15457f',
 'scripts/release/host/pm2-root.service':'41ba0c739ce492ac21c43b375b1154c0bbb110855084ab86696f17562639acb2',
 'scripts/release/host/pm2-wait-for-fabric.sh':'25d1d352699ddb8ae53f70e4048cb8e54a9d7c58eb31691c3f697ee77dffcb2d',
 'scripts/release/host/reload-nginx-after-certbot.sh':'980197605ee3230c4c4463817ff53a734a5f9c9aa9b6c2b1672cd168a35de8e5',
 'scripts/release/host/start-recovery.cjs':'6f46cfb67ed7f8658558764087ab8e126cf21fb6480abfec6cdf7597d479bf88',
 'scripts/release/host/start-v2.cjs':'70f50fe36a406b5fffcff78b55c3d4f23639d12290f016a4a417b268a99e8186',
 'scripts/release/production.json':'56fbbe5ac2dacce73326ef754258d2ac027006706f2547e7c179574997fba334',
 'scripts/release/release.test.mjs':'7a2ba050935a023e3b82d6157ae8c82c60d2e90e37822bcc44a624ddce0375d4',
 'scripts/release/remote.py':'dc5c648a08df94a1a06523ae73637a74b8ed66b3c742746a1d2de600fc5ba205',
 'scripts/release/remote_test.py':'324e7b432e1b8e2b0f6c7a1e3f9bb243817369a820758d94699b6fe263a89932',
 'server/order-v2/lines.ts':'281575801896d35d8be79f7ebe7821bf5663c61c91ecf6844b7ce51493d65e65',
 'server/order-v2/orderQueries.test.ts':'57771fbf0568dfc7c664bd7ac84fdbe8d32fb7b47392e9da4154c0d1ae0b0dfa',
 'server/order-v2/orderQueries.ts':'d45558cb3e8a41a6ef2a0a8b3b6b3421d8575617b483ca6ed4e2a4165eae7489',
 'server/product-master/catalogExportWorkbook.ts':'3f1e17e5f65c3720c111dd96a63bcd95bc3418a6a8da085dd70745eb85d7014a',
 'server/product-master/colorwayIdentityRoutes.ts':'002f3b3d17fda0fb9d88a1d0cd9324ba76f08f15a1a53fe39572104abbd99a31',
 'server/product-master/p7MediaOrderLifecycle.test.ts':'5688cc70ba20f9855862891be19f560f55aa41f6d601d1122aa000de6188e145',
 'server/product-master/patternCatalog.ts':'648e4b9511d43beefeb7d39c9725b6beabe958258c6ddd0dee0ce2bce12d7062',
 'server/product-master/patternMastersRoutes.ts':'1b3bf31f80772db1c2e6d1936282b91cd25d164b30e90d1ba75e3e1293ab2760',
 'server/product-master/productCardAssociation.test.ts':'ee345b348de98151e76acbb0932b1dd057f83da256c764b9beeea3af89859aa8',
 'server/product-master/productSearch.test.ts':'526acae3c5089564f4f99c37ccf055cbdc67dff3860ec216fae977ab3fd2b6d7',
 'server/product-master/productSearch.ts':'c4de039aee9e59b40a8b45cb4e73b9bf31bdfd6c7d8ebf003d706c9999a40581',
 'server/product-master/productsV2Routes.ts':'699c55dd77b02450995f7129aa681681c7f4e9f41d33a0ae942a4b6872b4bca0',
 'server/product-master/relatedProducts.test.ts':'30f5696bed702a32e1137e9858494e2571f0f8d7c4f4f21ec395d39acd25c20d',
 'src/components/document-product-selector/V2DocumentBrowser.tsx':'0132945b91acd94d7b0f182f4fbdab05261e6117371a231d03b456fd246a4907',
 'src/components/document-product-selector/documentSearchModel.ts':'030c42872679e1bcf0f307d2ccbab097f6ff5e83bc3bb64fd5874c164eac9305',
 'src/components/product-master-v2/PatternColorwayEditor.tsx':'95d2da10e8fb1c06c4e45724187df5d8731432e4209cd89bf945a4550b799d9a',
 'src/components/product-master-v2/PatternDeleteDialog.tsx':'49a3f72331b2afa929b600fae508ed360c2a8b4d7512032c06a5c5dcf1eede9e',
 'src/components/product-master-v2/PatternLibraryV2.tsx':'d285cf9870e6249dd25dc6996fb70e86742fc271017ffdc3ee74f199553bee7d',
 'src/components/product-master-v2/ProductCatalogV2.test.ts':'c65a5accc48bdf9eb5db30f29c7f3cea3f23df01021315cf9c94156caeaf278c',
 'src/components/product-master-v2/ProductCatalogV2.tsx':'6d07a195f3e347ad0aa0bfa605a155daef4290c20e6c23cc011997d61f457668',
 'src/components/product-master-v2/RelatedProductsDialog.tsx':'be08ad90beaf8e3ae0f064cb38bad7d05a57f4c4bbe55858cf40b639e8a5b58f',
 'src/components/product-master-v2/SampleCardLibraryV2.tsx':'0ddab23422e4d0322fbc86bcf99c902fed40f41751dc819f903c06701a6a564e',
 'src/components/product-master-v2/V2App.tsx':'2f1e223a60766771fd313ad0345adc3632ecd5d430543c04589ecde2148d8f65',
 'src/components/product-master-v2/catalogModel.ts':'bacec7bd8aec7e5fedb0b05b898c76fd6bc681001b34aa7a410069c240b0e2d4',
 'src/components/product-master-v2/patternBulkImportModel.ts':'84fe5ce21c7d50752d30f33f91929e2256cf44f719eb75d69572885f42d46813',
 'src/components/product-master-v2/patternModel.ts':'79786749fbb6708e6f925dfa4d2d91968a2bc249f54a48591aa277d64ff7c626',
 'src/components/product-master-v2/uiExperience.test.ts':'fd253ddaf424012da7340268fc551c9fcc579805d677d15bb68c7d41b451c398',
 'tests/ui/catalog-number-sort.spec.ts':'1714d83ab8f90c20b3e5e411e1f42cae1ed23401738fce5a205a0828948bb86a',
 'tests/ui/deletion-guidance.spec.ts':'030652592e87dc0b7e8d1cadfe1866f72aa8ce333b8c2594e882df9938b1e23b',
 'tools/ui-preview/fixtures/relatedProducts.ts':'2246c08596ee3aaeafc57b41800a0ae9a1c5f362aa04828e7af1991653394549',
 'tools/ui-preview/internalFabricReview.tsx':'ab73cf06d0734010589f564b26d796ea7d9101fc3912c085f6c7ef7b5d697c75',
 'tools/ui-preview/internalPatternReview.tsx':'fc3dd9e47e3c0fbadb6bbb51f4179eee2a59c9a0e292093dc54664fac99d5f3b',
});
const deletionGuidanceSpecs=['tests/ui/deletion-guidance.spec.ts','tests/ui/catalog-number-sort.spec.ts',
 'tests/ui/related-products.spec.ts','tests/ui/document-delete.spec.ts'];
const deletionGuidanceUnits=[
 'server/product-master/productCardAssociation.test.ts','server/product-master/productSearch.test.ts',
 'server/product-master/catalogExport.test.ts','server/product-master/relatedProducts.test.ts',
 'server/product-master/productsV2.test.ts','server/product-master/productProtection.test.ts',
 'server/product-master/patternDeletion.test.ts','server/product-master/colorwayIdentity.test.ts',
 'server/product-master/v2CatalogAssembly.test.ts','server/product-master/p7MediaOrderLifecycle.test.ts',
 'server/order-v2/orderQueries.test.ts','src/components/product-master-v2/ProductCatalogV2.test.ts',
 'src/components/product-master-v2/PatternLibraryV2.test.ts','src/components/product-master-v2/patternBulkImportModel.test.ts',
 'src/components/product-master-v2/uiExperience.test.ts','src/components/document-product-selector/documentSearchModel.test.ts',
 'src/components/document-product-selector/V2DocumentBrowser.test.ts',
];
const profiles=[{
 id:'model-gallery',paths:['src/components/product-master-v2/ModelGalleryV2.tsx',
  'tests/ui/model-gallery.spec.ts','tools/ui-preview/modelGalleryReview.tsx',
  'tools/ui-preview/entries/ui-ux-model-gallery.html'],
 specs:['tests/ui/model-gallery.spec.ts'],unitFiles:[],postBuildScripts:[],
},{
 id:'fabric-library',paths:['src/components/product-master-v2/FabricLibraryV2.tsx',
  'src/components/product-master-v2/FabricLibraryV2.test.ts','tests/ui/internal-fabric-design.spec.ts',
  'tests/ui/internal-fabric-weight-unit.spec.ts','tools/ui-preview/internalFabricReview.tsx',
  'tools/ui-preview/entries/ui-ux-internal-fabrics.html'],
 specs:['tests/ui/internal-fabric-design.spec.ts','tests/ui/internal-fabric-weight-unit.spec.ts','tests/ui/related-products.spec.ts'],
 unitFiles:['src/components/product-master-v2/FabricLibraryV2.test.ts'],
 postBuildScripts:['scripts/release/targeted-fabric-ui.mjs'],
},{
 id:'document-print',
 paths:[printView,printQa],
 specs:['tests/ui/document-delete.spec.ts'],
 unitFiles:['src/components/document-product-selector/V2DocumentPrintView.test.ts',
  'src/lib/documentPrintModel.test.ts','server/documentExcel.test.ts','server/order-v2/print.test.ts'],
 postBuildScripts:[printQa],
},{
 id:'customer-profile',
 paths:['src/components/customers/CustomerContactPasteDialog.tsx','src/components/customers/CustomerProfileDialog.tsx',
  'src/components/customers/CustomerProfileForm.tsx','src/components/customers/customerContactText.test.ts',
  'src/components/customers/customerContactText.ts','tests/ui/customer-delete-address.spec.ts',
  'tools/ui-preview/customerWorkspaceReview.tsx'],
 specs:['tests/ui/customer-delete-address.spec.ts'],
 unitFiles:['src/components/customers/customerContactText.test.ts','src/components/customers/customerModel.test.ts',
  'src/components/customers/CompactCustomerChoice.test.tsx','src/components/document-product-selector/V2DocumentWorkspace.test.ts'],
 postBuildScripts:[],
},{
 id:'customer-selection',
 paths:['server/customer-samples/sessionDirectory.test.ts','server/customer-samples/sessionDirectory.ts',
  'server/customer-samples/sessionRead.ts','server/customers/model.ts','server/customers/routes.test.ts',
  'server/customers/routes.ts','server/customers/service.test.ts','server/customers/service.ts',
  'server/customers/sessionBridge.ts','src/components/customers/customerModel.test.ts',
  'src/components/customers/customerModel.ts'],
 specs:['tests/ui/customer-delete-address.spec.ts','tests/ui/sample-directory.spec.ts',
  'tests/ui/scan-selection.spec.ts','tests/ui/sample-card-review.spec.ts'],
 unitFiles:['server/customers/service.test.ts','server/customers/routes.test.ts','server/customers/documentIntegration.test.ts',
  'server/customer-samples/sessionDirectory.test.ts','server/customer-samples/sessionDirectoryRoutes.test.ts',
  'server/customer-samples/sessionRead.test.ts','server/customer-samples/scanRepository.test.ts',
  'server/order-v2/documents.test.ts','src/components/customers/customerModel.test.ts'],
 postBuildScripts:[],
}];
const sortedUnique=items=>[...new Set(items)].sort();
function manifestFiles(manifest){
 if(!Array.isArray(manifest?.files))throw Error('Browser validation: manifest files required');
 const result=new Map();
 for(const file of manifest.files){
  if(typeof file?.path!=='string'||typeof file.sha256!=='string'||result.has(file.path))throw Error('Browser validation: invalid/duplicate manifest file');
  result.set(file.path,file.sha256);
 }
 return result;
}
export function selectBrowserValidation({previous,current,baselineReleaseId,sourceSha256,migrations=[],fullUi=false,quickUi=false,customerHistoryHotfix=false}){
 const old=manifestFiles(previous),next=manifestFiles(current);
 const changedFiles=sortedUnique([...old.keys(),...next.keys()]).filter(p=>old.get(p)!==next.get(p));
 const code=changedFiles.filter(p=>!p.startsWith('docs/'));
 const selected=profiles.filter(profile=>code.some(p=>profile.paths.includes(p)));
 const base={version:1,rulesVersion:'fabric-browser-scope-v1',baselineReleaseId,candidateManifestSha256:sourceSha256,
  changedFiles,profiles:[],specs:[],unitFiles:[],postBuildScripts:[]};
 if(customerHistoryHotfix){
  if(baselineReleaseId!==customerHistoryBaseline||migrations.length||fullUi||quickUi||
   customerHistoryFiles.some(p=>!code.includes(p))||
   code.some(p=>!old.has(p)||!next.has(p)||![...customerHistoryFiles,...customerHistoryToolFiles].includes(p)))
   throw Error('Customer history date hotfix requires its verified baseline and exact file scope');
  return {...base,mode:'none',reason:'customer-history-date-hotfix'};
 }
 if(quickUi&&baselineReleaseId===deletionGuidanceBaseline&&!migrations.length&&!fullUi){
  const reviewed=Object.entries(deletionGuidanceReviewedFiles);
  const expected=[...reviewed.map(([p])=>p),...scopeRegistrationTools];
  const specs=sortedUnique([...smoke,...deletionGuidanceSpecs]);
  if(code.length===expected.length&&expected.every(p=>code.includes(p))&&
     scopeRegistrationTools.every(p=>old.has(p)&&next.has(p))&&
     reviewed.every(([p,digest])=>next.get(p)===digest)&&
     [...specs,...deletionGuidanceUnits].every(p=>next.has(p))){
   return {...base,mode:'scoped',reason:'reviewed-deletion-guidance-registration',profiles:['deletion-guidance'],
    specs,unitFiles:sortedUnique(deletionGuidanceUnits)};
  }
 }
 // Let this registration ship with the reviewed print fix on its original verified baseline.
 const printRegistration=[printView,printQa,...scopeRegistrationTools];
 const registeringPrintScope=quickUi&&baselineReleaseId===printRegistrationBaseline&&
  code.length===printRegistration.length&&printRegistration.every(p=>code.includes(p));
 const unmappedFiles=code.filter(p=>!selected.some(profile=>profile.paths.includes(p))&&
  !(registeringPrintScope&&scopeRegistrationTools.includes(p)));
 let result;
 if(fullUi)result={...base,mode:'full',reason:'explicit-full-ui'};
 else if(migrations.length)result={...base,mode:'full',reason:'database-migrations'};
 else if(!code.length)result={...base,mode:'none',reason:'no-code-changes'};
 else if(code.some(p=>!old.has(p)||!next.has(p)))result={...base,mode:'full',reason:'added-or-removed-code'};
 else if(unmappedFiles.length)result={...base,mode:'full',reason:'unmapped-or-shared-code',unmappedFiles};
 else{
  const specs=sortedUnique([...smoke,...selected.flatMap(p=>p.specs)]);
  const unitFiles=sortedUnique(selected.flatMap(p=>p.unitFiles));
  const postBuildScripts=sortedUnique(selected.flatMap(p=>p.postBuildScripts));
  const required=[...specs,...unitFiles,...postBuildScripts];
  result=required.some(p=>!old.has(p)||!next.has(p))?{...base,mode:'full',reason:'missing-required-check'}:
   {...base,mode:'scoped',reason:'exact-registered-page-scope',profiles:selected.map(p=>p.id).sort(),specs,unitFiles,postBuildScripts};
 }
 if(quickUi&&result.mode!=='scoped')throw Error('--quick-ui requires an exact registered page scope without migrations; use automatic/full validation');
 return result;
}

export function runBrowserWithProgress(executable,args,{root,log,liveLog,env,timeout}){
 const output=fs.openSync(liveLog,'w');let result;
 try{result=spawnSync(executable,args,{cwd:root,env:{...process.env,...env},timeout,stdio:['ignore',output,output]});}
 finally{fs.closeSync(output);}
 if(result.error||result.status!==0)throw Error('Browser validation failed; inspect '+liveLog);
 return fs.readFileSync(log,'utf8');
}

export function executeBrowserValidation(plan,{root,dir,execPath=process.execPath,run}){
 if(plan.mode==='none')return {mode:'none',passed:0,skipped:0,executed:false};
 if(!['full','scoped'].includes(plan.mode))throw Error('Browser validation: invalid mode');
 if(plan.unitFiles.length)run(execPath,['scripts/run-ts-tests.mjs',...plan.unitFiles],
  {log:path.join(dir,'ui-focused-unit.log'),label:'uiFocusedUnit'});
 const args=['node_modules/@playwright/test/cli.js','test','--config=playwright.ui.config.ts','--reporter=line,json',...plan.specs];
 const log=path.join(dir,'ui-browser-tests.log');
 const timeout=(plan.mode==='full'?45:10)*60_000;
 const output=run(execPath,args,{log,liveLog:path.join(dir,'ui-browser-progress.log'),
  env:{PLAYWRIGHT_JSON_OUTPUT_FILE:log},timeout,label:'uiBrowserTests'});
 let report;try{report=JSON.parse(output);}catch{throw Error('Browser validation: malformed Playwright JSON report');}
 if(!report.stats||!Number.isInteger(report.stats.expected)||report.stats.expected<=0||
    !Number.isInteger(report.stats.skipped)||report.stats.skipped<0||report.stats.unexpected!==0||report.stats.flaky!==0||
    !Array.isArray(report.errors)||report.errors.length)throw Error('Browser validation: failed, flaky or zero passing tests');
 const rootDir=path.resolve(root,'tests/ui');
 if(path.resolve(report.config?.rootDir??'')!==rootDir)throw Error('Browser validation: wrong test root');
 const passedFiles=new Set();
 const visit=suites=>{for(const suite of suites??[]){
  for(const spec of suite.specs??[]){
   if(spec.tests?.some(t=>t.status==='expected'&&t.results?.some(r=>r.status==='passed')))
    passedFiles.add(path.resolve(rootDir,spec.file));
  }
  visit(suite.suites);
 }};visit(report.suites);
 if(!passedFiles.size||plan.specs.some(p=>!passedFiles.has(path.resolve(root,p))))
  throw Error('Browser validation: required spec omitted or has no passing test');
 return {mode:plan.mode,executed:true,passed:report.stats.expected,skipped:report.stats.skipped,
  command:{executable:execPath,args},passedFiles:[...passedFiles].map(p=>path.relative(root,p).replaceAll('\\','/')).sort()};
}
