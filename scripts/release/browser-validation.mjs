/** Browser scope is derived only from verified-release/candidate manifests, never Git dirt. */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const smoke=['tests/ui/internal-table-chrome.spec.ts','tests/ui/mobile-library-actions.spec.ts'];
const customerHistoryBaseline='20261110t020116583-0e0eb9e3';
const customerHistoryFiles=['server/customers/service.ts','server/customers/service.testFixture.ts','server/customers/v12.test.ts'];
const customerHistoryToolFiles=['scripts/release/browser-validation.mjs','scripts/release/browser-validation.test.mjs',
 'scripts/release/cli.mjs','scripts/release/core.mjs','scripts/release/release.test.mjs'];
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
 id:'customer-selection',
 paths:['server/customer-samples/sessionDirectory.test.ts','server/customer-samples/sessionDirectory.ts',
  'server/customer-samples/sessionRead.ts','server/customers/model.ts','server/customers/routes.test.ts',
  'server/customers/routes.ts','server/customers/service.test.ts','server/customers/service.ts',
  'server/customers/sessionBridge.ts','src/components/customers/customerModel.test.ts',
  'src/components/customers/customerModel.ts','tests/ui/customer-delete-address.spec.ts',
  'tools/ui-preview/customerWorkspaceReview.tsx'],
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
 let result;
 if(fullUi)result={...base,mode:'full',reason:'explicit-full-ui'};
 else if(migrations.length)result={...base,mode:'full',reason:'database-migrations'};
 else if(!code.length)result={...base,mode:'none',reason:'no-code-changes'};
 else if(code.some(p=>!old.has(p)||!next.has(p)))result={...base,mode:'full',reason:'added-or-removed-code'};
 else if(code.some(p=>!selected.some(profile=>profile.paths.includes(p))))result={...base,mode:'full',reason:'unmapped-or-shared-code'};
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
 const output=run(execPath,args,{log,liveLog:path.join(dir,'ui-browser-progress.log'),
  env:{PLAYWRIGHT_JSON_OUTPUT_FILE:log},timeout:600000,label:'uiBrowserTests'});
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
