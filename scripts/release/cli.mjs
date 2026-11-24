import {assertPreparedSampleReferenceRetry,requireSampleCardReviewMigration,requireSampleContactMigration,requireSampleContactIdentityMigration} from './core.mjs';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomBytes,pbkdf2Sync,createDecipheriv,createHash} from 'node:crypto';
import {migrationIds,parseArgs,validateProfile,hash,collectBrowserFiles,verifyFiles,assertWritable,runPhases,phasePlan,assertPublishedEvidence,releaseTimingReport,readReleaseProgress,recordRollbackReceipt,requireBusinessSimplificationMigration,requireProductCardsMigration,requireModelGalleryMigration,requireProductImageCategoryReuseMigration} from './core.mjs';
import {reviewContext} from './ui-quality-gate.mjs';
import {seal as sealUiWorkflow,verify as verifyUiWorkflow} from '../ui-workflow-gate.mjs';
import {reviewedSourceDiff,syncVerifiedPointer} from './source-automation.mjs';
import {selectBrowserValidation,executeBrowserValidation,runBrowserWithProgress} from './browser-validation.mjs';
import {verifyPublishedWorkspace} from '../fabric-workspace.mjs';

const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));process.chdir(root);
const args=parseArgs(process.argv.slice(2));
const profile=validateProfile(JSON.parse(fs.readFileSync('scripts/release/production.json','utf8')));
const privateRoot=path.resolve(path.dirname(profile.sshConfig),'../release-state');
const baselinePath=path.join(privateRoot,'baseline.json');
const json=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const write=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});const next=p+'.next';fs.writeFileSync(next,JSON.stringify(v,null,2));fs.renameSync(next,p);};
function processRun(exe,argv,{input,log,timeout=600000,acceptRemoteFailure=false}={}){
 const r=spawnSync(exe,argv,{cwd:root,input,encoding:'utf8',timeout,maxBuffer:20*1024*1024});
 if(log)fs.writeFileSync(log,(r.stdout??'')+(r.stderr??''));
 if(r.error||r.status!==0){let failure;try{failure=JSON.parse(r.stdout?.trim());}catch{}if(!r.error&&r.status!==null&&acceptRemoteFailure&&failure?.ok===false)return r.stdout;throw Error(failure?.error||'Command failed ('+exe+'); inspect '+(log??'local environment'));}return r.stdout;
}
function transport(){
 const c=json(profile.sshConfig).ssh;if(!c||!/^[A-Za-z0-9.:-]+$/.test(c.host)||!/^[A-Za-z0-9_-]+$/.test(c.username)||!Number.isInteger(c.port)||c.port<1||c.port>65535)throw Error('Invalid private SSH configuration');
 return {host:c.username+'@'+c.host,opts:['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes'],port:String(c.port)};
}
function historicalTarget(frozen){
 return Boolean(frozen&&['production','stageRoot','backupRoot'].some(key=>frozen[key]!==profile[key]));
}
function remote(action,run,extra={}){
 const frozenProfile=run?.manifest.profile;
 const historical=historicalTarget(frozenProfile);
 if(historical&&!['status','verify','rollback'].includes(action))throw Error('Historical releases cannot deploy; prepare a new release for /opt/fabric');
 const c=transport();const request={action,profile,baseline:run?.manifest.baseline??null,id:run?.id,archiveSha256:run?.archiveSha256,manifestSha256:run?.manifestSha256,...(historical?{frozenProfile}:{}),...extra};
 const frozenExecutor=run&&fs.readFileSync(path.join(run.dir,'package/remote.py'));
 if(run&&hash(frozenExecutor)!==run.manifest.executorSha256)throw Error('Frozen executor drift');
 const executor=historical||!run?fs.readFileSync('scripts/release/remote.py'):frozenExecutor;
 const output=processRun('ssh',[...c.opts,'-p',c.port,c.host,'python3 - '+Buffer.from(JSON.stringify(request)).toString('base64')],{input:executor,log:run?path.join(run.dir,'remote-'+action+'.log'):undefined,acceptRemoteFailure:true});
 const response=JSON.parse(output.trim());if(response.ok!==true){if(run&&response.automaticRollback){recordRollbackReceipt(run,response.automaticRollback);write(path.join(run.dir,'run.json'),run);}throw Error(response.error??'Remote operation failed');}return response.result;
}
function copy(source,destination,log){const c=transport();return processRun('scp',[...c.opts,'-P',c.port,source,destination],{log});}
function snapshot(manifest){const names=new Set([...manifest.files.map(x=>x.path),manifest.requirements.path,'package.json','package-lock.json','tsconfig.json']);return Object.fromEntries([...names].filter(x=>fs.existsSync(x)).sort().map(n=>[n,hash(fs.readFileSync(n))]));}
function toolInputs(){return Object.fromEntries(['scripts/fabric-release.mjs','scripts/fabric-workspace.mjs',...fs.readdirSync('scripts/release').filter(n=>fs.statSync('scripts/release/'+n).isFile()).map(n=>'scripts/release/'+n)].sort().map(n=>[n,hash(fs.readFileSync(n))]));}
function publishedSource(evidencePath,baseline){
 const dir=path.dirname(path.resolve(evidencePath)),e=json(evidencePath),a=json(path.join(dir,'artifact.json')),pkg=path.join(dir,'package');
 assertPublishedEvidence(e,a,baseline);
 const archive=a.archive??path.join(dir,'release.tar.gz');if(hash(fs.readFileSync(archive))!==a.sha256)throw Error('Published archive drift');verifyFiles(pkg,a.manifest.files);
 if(hash(fs.readFileSync(path.join(pkg,'source-manifest.json')))!==a.manifest.sourceManifestSha256)throw Error('Published source evidence drift');
 return {pkg,sourcePath:path.join(pkg,'source-manifest.json'),evidenceSha256:hash(fs.readFileSync(evidencePath))};
}
function migrationSource(source,roots=['server']){const expected=source.files.filter(f=>roots.some(root=>f.path.startsWith(root+'/'))),actual=[];const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const n=d+'/'+e.name;if(e.isSymbolicLink())throw Error('Migration dependency symlink');if(e.isDirectory())walk(n);else actual.push(n);}};roots.forEach(walk);if(JSON.stringify(actual.sort())!==JSON.stringify(expected.map(x=>x.path).sort()))throw Error('Unvalidated migration dependency added/removed');for(const f of expected)if(hash(fs.readFileSync(f.path))!==f.sha256)throw Error('Registered migration dependency drift: '+f.path);}
function checkHttpContract(dir){
 const checker=path.join(dir,'http-contract-check.cjs');
 processRun(process.execPath,['--input-type=module','-e',"import {build} from 'esbuild';await build({entryPoints:['scripts/release/http-contract-check.ts'],outfile:process.argv[1],bundle:true,platform:'node',format:'cjs',target:'node20'});",checker],{log:path.join(dir,'http-contract-build.log')});
 return JSON.parse(processRun(process.execPath,[checker,'--run-release-http-contract'],{log:path.join(dir,'http-contract-check.log')}));
}
const candidateMigrationGuards=[requireBusinessSimplificationMigration,requireProductCardsMigration,
 requireProductImageCategoryReuseMigration,requireModelGalleryMigration,requireSampleCardReviewMigration,
 requireSampleContactMigration,requireSampleContactIdentityMigration];
function migrationRequirements(changed,migrations){
 const requirements=candidateMigrationGuards.flatMap(check=>{try{check(changed,migrations);return [];}catch(e){return [e.message];}});
 if(changed.includes('server/customer-samples/activeProductReferenceSchema.ts')&&!migrations.includes('active-sample-product-reference'))
  requirements.push('This candidate requires --migrations active-sample-product-reference and isolated restore rehearsal');
 return requirements;
}
function prepare(){
 const sourceGit=verifyPublishedWorkspace(root);
 if(!fs.existsSync(baselinePath))throw Error('Initialize a verified baseline first: baseline --evidence <release-result.json>');
 const baseline=json(baselinePath),pointer=json('docs/project/fabric-v2-active-workspace.json');
 const candidate=args.fromRelease?null:reviewContext({pointer,baseline});
 const missingMigrations=candidate?migrationRequirements(candidate.changed,args.migrations):[];
 if(missingMigrations.length)throw Error(missingMigrations.join(' | '));
 const plannedBrowser=candidate&&!args.reusePrintReview&&!args.retryPrepared?selectBrowserValidation({...candidate,...args}):null;
 if(plannedBrowser?.mode==='full'&&!args.fullUi)
  throw Error('Browser scope requires confirmation before preparation. Register impact or explicitly pass --full-ui: '+JSON.stringify(plannedBrowser));
 const id=args.id??new Date().toISOString().replace(/[-:.]/g,'').toLowerCase().replace('z','')+'-'+randomBytes(4).toString('hex');
 const dir=path.join(root,'artifacts/releases',id);if(fs.existsSync(dir))throw Error('Release ID already exists; use status/run/resume');fs.mkdirSync(dir,{recursive:true});
 const start=Date.now(),releaseStartedAt=new Date(start).toISOString();
 let stage='prepare',stageStarted=start;
 const progress=(status,extra={})=>write(path.join(dir,'prepare-progress.json'),{id,stage,status,ownerPid:process.pid,startedAt:new Date(stageStarted).toISOString(),releaseStartedAt,...extra});
 progress('running');console.log(JSON.stringify({id,stage,status:'running',progressCommand:'node scripts/release/cli.mjs progress '+id}));
 try{
 let sourcePath=json('docs/project/fabric-v2-active-workspace.json').sourceManifest;if(typeof sourcePath!=='string'||sourcePath.includes('..')||path.isAbsolute(sourcePath))throw Error('Unsafe source manifest pointer');
 const preparation={},timed=(name,run)=>{
  stage=name;stageStarted=Date.now();progress('running');
  const result=run(),durationMs=Date.now()-stageStarted;preparation[name]=(preparation[name]??0)+durationMs;
  progress('passed',{durationMs});return result;
 };
 const retry=args.retryPrepared?loadRun(args.retryPrepared,true):null;
 const reuse=retry?{pkg:path.join(retry.dir,'package')}:args.fromRelease?publishedSource(args.fromRelease,baseline):null;
 let before,source,localHttpContract,uiReport,uiQualityGate={required:false},browserValidation={mode:'reused',reason:'verified-published-artifact-reuse'};
 if(!reuse)timed('uiStandards',()=>processRun(process.execPath,['scripts/ui-workflow-gate.mjs','preflight'],{log:path.join(dir,'ui-standards.log')}));
 if(retry){
  timed('source',()=>processRun(process.execPath,['scripts/check-fabric-v2-development-source.mjs'],{log:path.join(dir,'source.log')}));
  source=json(sourcePath);before=toolInputs();
  assertPreparedSampleReferenceRetry(retry,baseline,json(path.join(reuse.pkg,'source-manifest.json')),source);
  if(JSON.stringify(retry.manifest.profile)!==JSON.stringify(profile))throw Error('Prepared retry target drift');
  const sourceSha=hash(fs.readFileSync(sourcePath));
  localHttpContract=retry.manifest.localHttpContract;
  uiQualityGate={...retry.manifest.uiQualityGate,reusedFromRelease:retry.id};
  browserValidation={...retry.manifest.browserValidation,candidateManifestSha256:sourceSha,reusedFromRelease:retry.id};
  write(path.join(dir,'browser-validation-plan.json'),browserValidation);
  write(path.join(dir,'browser-validation-result.json'),browserValidation.result);
  console.log(JSON.stringify({stage:'browser-validation',result:'reused',id:retry.id,passed:browserValidation.result.passed}));
  timed('releaseGuard',()=>processRun('python',['scripts/release/remote_test.py'],{log:path.join(dir,'release-remote-check.log')}));
 }else if(reuse){if(args.quickUi)throw Error('Quick UI verification is only available for a reviewed new source build');sourcePath=reuse.sourcePath;source=json(sourcePath);before=toolInputs();timed('source',()=>migrationSource(source,['server','src']));localHttpContract=timed('httpContract',()=>checkHttpContract(dir));write(path.join(dir,'source.log.json'),{application:'verified-published-artifact',evidenceSha256:reuse.evidenceSha256,businessWorkingTreeValidated:true,toolInputs:before});}
 else{timed('source',()=>processRun(process.execPath,['scripts/check-fabric-v2-development-source.mjs'],{log:path.join(dir,'source.log')}));source=json(sourcePath);const sourceSha=hash(fs.readFileSync(sourcePath));before=snapshot(source);
  const checkSource=name=>timed(name,()=>{
   processRun(process.execPath,['scripts/check-fabric-v2-development-source.mjs'],{log:path.join(dir,name+'.log')});
   if(hash(fs.readFileSync(sourcePath))!==sourceSha||JSON.stringify(snapshot(source))!==JSON.stringify(before))throw Error('Candidate source changed during preparation');
  });
  const uiOptions={root,active:root,pointer};
  const reviewed=timed('uiWorkflow',()=>sealUiWorkflow(uiOptions));
  if(reviewed.sourceManifestSha256!==sourceSha)throw Error('Candidate source changed during UI review');
  write(path.join(dir,'ui-workflow.log'),reviewed);
  if(reviewed.required!==false){
   uiReport=reviewed;
   uiQualityGate={required:true,page:reviewed.page,reviewer:reviewed.reviewer,uiFiles:reviewed.changedUiFiles,
    sourceSha256:sourceSha,baselineReleaseId:candidate.baselineReleaseId,screenshots:reviewed.screenshots,reportSha256:reviewed.reportSha256};
  }
  if(args.reusePrintReview){
   const reviewedCommit='d70a4d6abfe88a05b95046557cac014aa6ee52b7';
   const releaseChanges=new Set(['scripts/release/cli.mjs','scripts/release/core.mjs','docs/operations/统一发布工具.md']);
   processRun('git',['merge-base','--is-ancestor',reviewedCommit,sourceGit.commit]);
   const subsequentChanges=processRun('git',['-c','core.quotePath=false','diff','--name-only',reviewedCommit,sourceGit.commit,'--']).trim().split(/\r?\n/).filter(Boolean);
   if(candidate.baselineReleaseId!=='20261116t040357563-79ebffd7'||subsequentChanges.some(file=>!releaseChanges.has(file))||
      reviewed.required===false||reviewed.status!=='pass'||reviewed.changedUiFiles!==1||reviewed.browserChecks!==82)
    throw Error('Print review reuse requires the exact reviewed print changes and the verified baseline');
   browserValidation={version:1,baselineReleaseId:candidate.baselineReleaseId,candidateManifestSha256:sourceSha,
    changedFiles:candidate.changed,mode:'none',reason:'reuse-verified-print-review',profiles:['document-print'],
    specs:[],unitFiles:[],postBuildScripts:[],reviewedCommit,reviewSha256:reviewed.reportSha256,reusedChecks:reviewed.browserChecks};
  }else browserValidation=plannedBrowser;
  write(path.join(dir,'browser-validation-plan.json'),browserValidation);
  console.log(JSON.stringify({stage:'browser-validation',mode:browserValidation.mode,reason:browserValidation.reason,profiles:browserValidation.profiles,priorities:browserValidation.priorities,specs:browserValidation.specs,unmappedFiles:browserValidation.unmappedFiles}));
  const browserResult=executeBrowserValidation(browserValidation,{root,dir,
   run:(exe,argv,{label,...options})=>timed(label,()=>options.liveLog?runBrowserWithProgress(exe,argv,{root,...options}):processRun(exe,argv,options)),
   buildCandidate:()=>{
    localHttpContract=timed('httpContract',()=>checkHttpContract(dir));
    timed('build',()=>processRun(process.platform==='win32'?(process.env.ComSpec??'cmd.exe'):'npm',
     process.platform==='win32'?['/d','/s','/c','npm run build']:['run','build'],{log:path.join(dir,'build.log')}));
    checkSource('source-after-build');
   }
  });
  browserValidation={...browserValidation,result:browserResult};
  write(path.join(dir,'browser-validation-result.json'),browserResult);
  if(uiReport)timed('uiEvidenceAfterBrowser',()=>{
   const checked=verifyUiWorkflow(uiOptions);
   if(checked.reportSha256!==uiReport.reportSha256||checked.sourceManifestSha256!==sourceSha)throw Error('UI review changed during browser validation');
   write(path.join(dir,'ui-evidence-after-browser.log'),checked);
  });
  if(args.customerHistoryHotfix)timed('customerHistoryDate',()=>processRun(process.execPath,
   ['--import','tsx','--test','--test-name-pattern','activity uses the selection creation instant','server/customers/v12.test.ts'],{log:path.join(dir,'customer-history-date.log')}));
  if(args.customerHistoryHotfix)timed('browserAssetIdentity',()=>{
   const published=json(path.join(root,'artifacts/releases',candidate.baselineReleaseId,'package/manifest.json'));
   const fresh=collectBrowserFiles(path.join(root,'dist')).map(file=>'dist/'+file).sort();
   if(published.id!==candidate.baselineReleaseId||published.files['dist/index.html'].sha256!==baseline.index||
    JSON.stringify(fresh)!==JSON.stringify([...published.browserFiles].sort())||
    fresh.some(file=>hash(fs.readFileSync(file))!==published.files[file].sha256))throw Error('Customer history date hotfix changed browser assets');
  });
  for(const script of browserValidation.postBuildScripts)timed('uiFocusedBrowser',()=>processRun(process.execPath,[script],{log:path.join(dir,'ui-focused-browser.log'),timeout:60000}));
  checkSource('source-after-validation');}
 const appRoot=reuse?reuse.pkg:root;
 const pkg=path.join(dir,'package');fs.mkdirSync(pkg);const files={};const browserFiles=collectBrowserFiles(path.join(appRoot,'dist')).map(x=>'dist/'+x);
 if(retry&&JSON.stringify([...browserFiles].sort())!==JSON.stringify([...retry.manifest.browserFiles].sort()))
  throw Error('Prepared retry browser asset inventory drift');
 const add=(name,source,expectedSha256)=>{
  const dest=path.join(pkg,name),data=fs.readFileSync(source),sha256=hash(data);
  if(expectedSha256&&sha256!==expectedSha256)throw Error('Verified evidence changed before freezing: '+name);
  fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,data);files[name]={sha256,size:data.length};
 };
 for(const n of [...browserFiles,'dist/server.cjs'])add(n,path.join(appRoot,n),retry?.manifest.files[n]?.sha256);add('remote.py','scripts/release/remote.py');add('source-manifest.json',sourcePath);add('http-contract.json','scripts/release/http-contract.json');
 if(uiReport)add('ui-review.json',path.join(root,uiReport.report),uiReport.reportSha256);
 if(retry)add('ui-review.json',path.join(reuse.pkg,'ui-review.json'),retry.manifest.files['ui-review.json'].sha256);
 if(!reuse||retry)for(const name of ['browser-validation-plan.json','browser-validation-result.json'])add(name,path.join(dir,name));
 let migrationPlans={};if(args.migrations.length){timed('migrationBundle',()=>awaitlessBuildMigration(pkg));migrationPlans=JSON.parse(processRun(process.execPath,[path.join(pkg,'operator.cjs'),'plans','-','-','-',args.migrations.join(',')]));add('operator.cjs',path.join(pkg,'operator.cjs'));}
 if(reuse&&JSON.stringify(toolInputs())!==JSON.stringify(before))throw Error('Release tool changed during preparation');
 if(reuse&&args.migrations.length)migrationSource(source);
 if(retry&&hash(fs.readFileSync(sourcePath))!==browserValidation.candidateManifestSha256)throw Error('Prepared retry source changed before freezing');
 if(!reuse&&JSON.stringify(snapshot(source))!==JSON.stringify(before))throw Error('Source changed while bundling registered migrations');
 verifyPublishedWorkspace(root,{expectedCommit:sourceGit.commit});
 const manifest={sourceGit,localHttpContract,kind:'fabric-release-v1',id,createdAt:new Date().toISOString(),profile,baseline,files,browserFiles,migrations:args.migrations,migrationPlans,rehearse:args.rehearse||args.migrations.length>0,sourceManifestSha256:hash(fs.readFileSync(sourcePath)),sourceFiles:source.files.length,applicationSource:retry?'verified-prepared-artifact':reuse?'verified-published-artifact':'validated-working-tree',buildReused:Boolean(reuse),toolInputSha256:hash(JSON.stringify(toolInputs())),inputSha256:hash(JSON.stringify(before)),executorSha256:files['remote.py'].sha256,fullSuiteRun:false,uiQualityGate,uiBrowserScope:browserValidation.mode,browserFullSuiteRun:browserValidation.mode==='full',browserValidation};
 write(path.join(pkg,'manifest.json'),manifest);fs.copyFileSync(sourcePath,path.join(pkg,'source-manifest.json'));verifyFiles(pkg,files);
 const archive=path.join(dir,'release.tar.gz');timed('archive',()=>processRun('tar',['-czf',archive,'-C',pkg,'.'],{log:path.join(dir,'archive.log')}));
 const run={id,dir,archive,archiveSha256:hash(fs.readFileSync(archive)),manifestSha256:hash(fs.readFileSync(path.join(pkg,'manifest.json'))),manifest,phases:{},preparation,preparedMs:Date.now()-start};write(path.join(dir,'run.json'),run);
 write(path.join(dir,'artifact.json'),{sha256:run.archiveSha256,manifest});
 stage='prepare';stageStarted=start;progress('passed',{durationMs:run.preparedMs});
 console.log(JSON.stringify({stage:'prepare',result:'passed',id,files:Object.keys(files).length,migrations:args.migrations,durationMs:run.preparedMs}));return run;
 }catch(error){progress('failed',{durationMs:Date.now()-stageStarted,error:error.message});throw error;}
}
function awaitlessBuildMigration(pkg){
 // Run esbuild in a separate native process so the prepared bundle is fully flushed before hashing.
 processRun(process.execPath,['--input-type=module','-e',"import {build} from 'esbuild'; await build({entryPoints:['scripts/release/migrations.ts'],outfile:process.argv[1],bundle:true,platform:'node',format:'cjs',target:'node20'});",path.join(pkg,'operator.cjs')],{log:path.join(path.dirname(pkg),'migration-build.log')});
}
function loadRun(id,forRetry=false){const dir=path.join(root,'artifacts/releases',id),run=json(path.join(dir,'run.json'));if(run.id!==id||run.dir!==dir||run.archive!==path.join(dir,'release.tar.gz'))throw Error('Release state identity drift');const manifestFile=path.join(dir,'package/manifest.json');if(hash(fs.readFileSync(manifestFile))!==run.manifestSha256||JSON.stringify(json(manifestFile))!==JSON.stringify(run.manifest))throw Error('Frozen manifest drift');verifyFiles(path.join(dir,'package'),run.manifest.files);if(hash(fs.readFileSync(run.archive))!==run.archiveSha256)throw Error('Frozen archive drift');if(run.rolledBack&&!forRetry&&!['status','report','help'].includes(args.command))throw Error('Release was rolled back; prepare a new immutable release');return run;}
async function offsiteProof(encrypted,key){
 const fd=fs.openSync(encrypted,'r'),header=Buffer.alloc(16);try{fs.readSync(fd,header,0,16,0);}finally{fs.closeSync(fd);}if(header.subarray(0,8).toString()!=='Salted__')throw Error('Encrypted backup header mismatch');
 const material=pbkdf2Sync(fs.readFileSync(key,'utf8').trim(),header.subarray(8,16),10000,48,'sha256'),decipher=createDecipheriv('aes-256-cbc',material.subarray(0,32),material.subarray(32));
 const cipherHash=createHash('sha256').update(header),plainHash=createHash('sha256');
 try{for await(const chunk of fs.createReadStream(encrypted,{start:16})){cipherHash.update(chunk);plainHash.update(decipher.update(chunk));}plainHash.update(decipher.final());}finally{material.fill(0);}
 return {verified:true,encryptedSha256:cipherHash.digest('hex'),decryptedSha256:plainHash.digest('hex'),bytes:fs.statSync(encrypted).size,keyStoredSeparately:true};
}
async function offsite(run,backup){
 const c=transport(),encrypted=path.join(run.dir,'database.sql.gz.enc'),key=path.join(privateRoot,run.id+'.passphrase.local');
 fs.mkdirSync(privateRoot,{recursive:true});copy(c.host+':'+backup.encrypted,encrypted,path.join(run.dir,'offsite-download.log'));copy(c.host+':'+backup.key,key,path.join(run.dir,'offsite-key-download.log'));
 const proof=await offsiteProof(encrypted,key);
 if(proof.encryptedSha256!==backup.encryptedSha256||proof.decryptedSha256!==backup.sqlSha256)throw Error('Offsite cipher/decrypted backup mismatch');
 write(path.join(run.dir,'offsite.json'),proof);remote('offsite',run,{offsite:proof,resume:args.command==='resume'});return proof;
}
async function prune(){
 const baseline=json(baselinePath);
 const plan=remote('retention-plan',null,{baseline});
 const localProofs={};
 for(const [id,expected] of Object.entries(plan.candidates)){
  const dir=path.join(root,'artifacts/releases',id);
  const archive=path.join(dir,'release.tar.gz'),encrypted=path.join(dir,'database.sql.gz.enc'),key=path.join(privateRoot,id+'.passphrase.local');
  if(![archive,encrypted,key].every(file=>fs.existsSync(file)&&fs.lstatSync(file).isFile()))continue;
  try{
   const proof=await offsiteProof(encrypted,key);
   if(proof.encryptedSha256===expected.encryptedSha256&&proof.decryptedSha256===expected.sqlSha256&&hash(fs.readFileSync(archive))===expected.archiveSha256)localProofs[id]=expected;
  }catch{ /* The remote pair remains available if local verification fails. */ }
 }
 if(args.apply)console.log(JSON.stringify(remote('retention-apply',null,{baseline,localProofs})));
 else console.log(JSON.stringify({kept:plan.kept,rollbackReleaseId:plan.rollbackReleaseId,eligible:Object.keys(localProofs),retainedWithoutLocalProof:Object.keys(plan.candidates).filter(id=>!(id in localProofs))}));
}
async function publicVerify(run){
 const get=p=>new Promise((resolve,reject)=>{const req=https.get(profile.url+p,{timeout:20000},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({code:res.statusCode,body:Buffer.concat(chunks)}));});req.on('timeout',()=>req.destroy(Error('Public timeout')));req.on('error',reject);});
 for(const n of run.manifest.browserFiles){const r=await get('/'+n.slice(5));if(r.code!==200||hash(r.body)!==run.manifest.files[n].sha256)throw Error('Independent public resource mismatch '+n);}
 const runtime=await get('/api/runtime');if(runtime.code!==200)throw Error('Public runtime unavailable');assertWritable(JSON.parse(runtime.body));const health=await get('/api/health');const h=JSON.parse(health.body);if(health.code!==200||h.storage!=='mysql'||h.mode!=='v2')throw Error('Public health mismatch');
 return {defaultTlsValidation:true,browserFiles:run.manifest.browserFiles.length,runtime:'writable-v2-mysql',utc:new Date().toISOString()};
}
async function phases(run,last){
 await runPhases(run.phases,phasePlan(last==='verify'?'deploy':last,run.manifest.rehearse),async phase=>{
  const start=Date.now();
  const extra={resume:args.command==='resume'};let result;
  if(phase==='upload'){remote('stage',run);const c=transport();copy(run.archive,c.host+':'+profile.stageRoot+'/'+run.id+'/release.tar.gz',path.join(run.dir,'upload.log'));result=remote('unpack',run,extra);}
  else if(phase==='offsite')result=await offsite(run,run.phases.backup.result);
  else if(phase==='verify'){result={remote:remote('verify',run,extra),independentPublic:await publicVerify(run)};const v=result.remote.version;write(baselinePath,{...run.manifest.baseline,index:v.index,backend:v.backend,releaseId:run.id,archiveSha256:run.archiveSha256,verifiedAt:new Date().toISOString()});}
  else if(phase==='deploy'){
   if(!run.manifest.sourceGit?.commit)throw Error('Prepared release lacks a published Git source commit; prepare a new release');
   verifyPublishedWorkspace(root,{expectedCommit:run.manifest.sourceGit.commit});
   result=remote(phase,run,extra);
  }else result=remote(phase,run,extra);
  console.log(JSON.stringify({stage:phase,result:'passed',id:run.id,durationMs:Date.now()-start}));return result;
 },()=>write(path.join(run.dir,'run.json'),run));
 if(run.phases.verify?.status==='passed'){
  const v=run.phases.verify.result.remote.version;const receipt={state:'released',sourceGit:run.manifest.sourceGit,gitCloseout:'pending',artifactSha256:run.archiveSha256,indexSha256:v.index,backendSha256:v.backend,sourceManifestSha256:run.manifest.sourceManifestSha256,migrations:run.manifest.migrations,backup:run.phases.backup.result.folder,fullSuiteRun:false,browserFullSuiteRun:run.manifest.browserFullSuiteRun??false,uiBrowserScope:run.manifest.uiBrowserScope,browserValidation:run.manifest.browserValidation??null,browserUiAcceptance:'pending',phases:Object.fromEntries(Object.entries(run.phases).map(([k,v])=>[k,{status:v.status,durationMs:v.durationMs}])),utc:new Date().toISOString()};
  write(path.join(run.dir,'release-result.json'),receipt);syncVerifiedPointer(root,run,receipt);
  const onlineUiCheck=run.manifest.uiQualityGate?.required?{
   tool:'ego-browser',status:'pending',evidence:path.relative(root,path.join(run.dir,'online-ui-check.json'))}:undefined;
  console.log(JSON.stringify({stage:'release-pointer',result:'synced',id:run.id,gitCloseout:'pending',onlineUiCheck,
   next:onlineUiCheck?'Record the Ego read-only UI check, then commit and push release records and run npm run workspace:verify':
    'Commit and push release records, then run npm run workspace:verify'}));
 }
 return run;
}
async function main(){
 if(args.command==='help'){console.log('npm run release -- plan [--migrations IDs] [--quick-ui|--full-ui] | test | baseline --evidence <release-result.json> | prepare [--full-ui] [--migrations IDs] [--rehearse] | preflight|rehearse|deploy|verify|rollback|status|report|resume <id> | progress [id] | run [id] | prune [--apply]\nprepare builds once; run/deploy publish; rehearse restores in an isolated DB without deploying; progress/verify/status/report never deploy. Browser validation is selected automatically; --full-ui forces full browser regression. No full business unit suite is run.');return;}
 if(args.command==='progress'){
  const releases=path.join(root,'artifacts/releases');
  const id=args.id??(fs.existsSync(releases)?fs.readdirSync(releases,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&/^\d{8}t\d{9}-[a-f0-9]{8}$/.test(entry.name)).map(entry=>entry.name).sort().findLast(name=>['prepare-progress.json','run.json'].some(file=>fs.existsSync(path.join(releases,name,file)))):undefined);
  if(!id)throw Error('No release progress found');
  console.log(JSON.stringify(readReleaseProgress(path.join(releases,id),id)));return;
 }
 if(args.command==='test'){const dir=path.join(root,'artifacts/release-tool-validation',new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(dir,{recursive:true});for(const [name,exe,argv]of [['workspace-git',process.execPath,['--test','scripts/fabric-workspace-local-helper.test.mjs']],['local',process.execPath,['--test','scripts/release/release.test.mjs']],['browser-validation',process.execPath,['--test','scripts/release/browser-validation.test.mjs']],['source-automation',process.execPath,['--test','scripts/release/source-automation.test.mjs']],['ui-quality',process.execPath,['--test','scripts/release/ui-quality-gate.test.mjs']],['ui-workflow',process.execPath,['scripts/ui-workflow-gate.test.mjs']],['remote-faults','python',['scripts/release/remote_test.py']],['http-contract',process.execPath,['scripts/run-ts-tests.mjs','scripts/release/http-contract-check.test.ts']]]){const start=Date.now();processRun(exe,argv,{log:path.join(dir,name+'.log')});console.log(JSON.stringify({stage:name,result:'passed',durationMs:Date.now()-start}));}console.log(JSON.stringify({evidence:path.relative(root,dir),productionModified:false}));return;}
 if(args.command==='plan'){
  let browserValidation=null;
  if(fs.existsSync(baselinePath)){
   const head=processRun('git',['rev-parse','HEAD']).trim();
   const draft=reviewedSourceDiff({root,head});
   const context=reviewContext({pointer:draft.pointer,baseline:json(baselinePath)});
   if(draft.changed.length){
    context.current={...context.current,files:[...draft.actual].map(([path,sha256])=>({path,sha256}))};
    context.sourceSha256=null; // A draft plan is never release evidence.
   }
   const plan=selectBrowserValidation({...context,...args});
   browserValidation={...plan,sourceReviewPending:draft.changed,missingMigrations:migrationRequirements(plan.changedFiles,args.migrations),
    explicitFullUiRequired:!args.fullUi&&plan.mode==='full',restoreRehearsalRequired:args.rehearse||args.migrations.length>0};
  }
  console.log(JSON.stringify({profile:profile.name,production:profile.production,process:profile.process,recoveryProcess:profile.recoveryProcess,url:profile.url,baselineInitialized:fs.existsSync(baselinePath),browserValidation,
   flow:['source and impact review','source-bound visual evidence if UI changed','focused engineering and release-tool checks','complete production HTTP contract check','build once and verify candidate source','scoped or explicitly authorized full browser validation','freeze artifact and browser references','preflight','consistent backup','encrypted offsite readback','restore rehearsal if migrations','registered migrations','atomic deploy','server and independent public verify','guarded code rollback on verification failure','Ego read-only production UI check after successful verification if UI changed'],
   migrationsAvailable:migrationIds,fullSuiteRun:false}));return;
 }
 if(args.command==='prune')return prune();
 if(args.command==='baseline'){
  if(!args.evidence)throw Error('A previously verified release-result.json is required');const evidence=json(path.resolve(args.evidence));const artifact=json(path.join(path.dirname(path.resolve(args.evidence)),'artifact.json'));
  if(evidence.state!=='released'||artifact.sha256!==evidence.artifactSha256)throw Error('Evidence is not a verified release');const a=remote('inventory');const seed={index:evidence.indexSha256,backend:evidence.backendSha256,starter:artifact.manifest.expectedStarter??artifact.manifest.baseline?.starter,nginx:artifact.manifest.expectedNginx??artifact.manifest.baseline?.nginx,serverUuid:profile.serverUuid};for(const [k,v]of Object.entries(seed))if(a[k]!==v)throw Error('Live release does not match verified evidence: '+k);
  write(baselinePath,{...seed,releaseId:artifact.manifest.id,archiveSha256:evidence.artifactSha256,evidenceSha256:hash(fs.readFileSync(args.evidence)),verifiedAt:new Date().toISOString()});console.log(JSON.stringify({stage:'baseline',result:'verified',businessWrites:false}));return;
 }
 let run=args.command==='prepare'||args.command==='run'&&!args.id?prepare():loadRun(args.id);
 if(args.command==='prepare')return;
 if(args.command==='report'){console.log(JSON.stringify(releaseTimingReport(run),null,2));return;}
 if(historicalTarget(run.manifest.profile)&&!['status','report','verify','rollback'].includes(args.command))throw Error('This release uses a retired storage or production target; prepare a new release');
 if(args.command==='status'||args.command==='resume'){
  const remoteStatus=remote('status',run);write(path.join(run.dir,'remote-status.json'),remoteStatus);
  if(remoteStatus.state.archiveSha256&&remoteStatus.state.archiveSha256!==run.archiveSha256)throw Error('Remote release identity mismatch');
  if(remoteStatus.state.automaticRollback){recordRollbackReceipt(run,remoteStatus.state.automaticRollback);write(path.join(run.dir,'run.json'),run);if(args.command==='resume')throw Error('Remote rollback recorded; inspect status and prepare a new immutable release');}
  if(args.command==='status'){const compact=s=>Object.fromEntries(Object.entries(s).map(([k,v])=>[k,{status:v.status,error:v.error,durationMs:v.durationMs}]));console.log(JSON.stringify({id:run.id,local:compact(run.phases),remote:compact(remoteStatus.state.phases),automaticRollback:remoteStatus.state.automaticRollback,retired:remoteStatus.state.retired===true,live:remoteStatus.inventory}));return;}
  for(const [phase,s]of Object.entries(run.phases)){if(s.status==='passed')continue;const remotePhase=remoteStatus.state.phases[phase==='upload'?'unpack':phase];if(remotePhase?.status==='passed'&&phase!=='verify')run.phases[phase]={status:'passed',result:remotePhase.result,recoveredFromRemoteReceipt:true};else if(s.status==='failed'||['upload','preflight','offsite','verify'].includes(phase))delete run.phases[phase];}
  write(path.join(run.dir,'run.json'),run);
 }
 if(args.command==='rollback'){const result=remote('rollback',run);write(path.join(run.dir,'rollback.json'),result);run.rolledBack=true;write(path.join(run.dir,'run.json'),run);write(baselinePath,{...run.manifest.baseline,verifiedAt:new Date().toISOString(),rolledBackRelease:run.id});console.log(JSON.stringify(result));return;}
 if(args.command==='verify'){const status=remote('status',run);if(status.state.phases.deploy?.status!=='passed')throw Error('Verify requires an installed release; it never triggers deployment');const result={remote:remote('verify',run),independentPublic:await publicVerify(run)};run.phases.verify={status:'passed',result};write(path.join(run.dir,'run.json'),run);console.log(JSON.stringify({stage:'verify',result:'passed',id:run.id}));return;}
 await phases(run,['run','resume','deploy'].includes(args.command)?'verify':args.command);
 console.log(JSON.stringify({id:run.id,state:run.phases.verify?.status==='passed'?'released-and-verified':'ready-through-'+args.command,evidence:path.relative(root,run.dir)}));
}
main().catch(e=>{console.error(JSON.stringify({result:'failed',error:e.message,next:'Inspect the release evidence and status; do not blindly rebuild/retry.'}));process.exitCode=1;});
