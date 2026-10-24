/**
 * Fabric UI workflow gate: one canonical rule set in the shared project root,
 * explicitly checked/synced into its declared active worktree.
 *
 * Never deploys, accesses production, or writes outside --sync targets.
 * By default, every command is read-only.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const canonical=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const pointerFile=path.join(canonical,'docs/project/fabric-v2-active-workspace.json');
const docs=[
 'AGENTS.md',
 'docs/ui-design/README.md',
 'docs/ui-design/design-system.md',
 'docs/ui-design/component-rules.md',
 'docs/ui-design/ui-review-checklist.md',
 'docs/ui-design/product-positioning-2026-10-21.md',
 'docs/ui-design/one-pass-ui-review-2026-10-21.md',
 'docs/ui-design/ux-delivery-gate.md',
 'docs/ui-design/wechat-card-share-2026-10-21.md',
];
const skills=['fabric-ui-design','fabric-ui-ux-qa','ui-ux-pro-max','frontend-design','web-design-guidelines'];
const checksum=b=>createHash('sha256').update(b).digest('hex');
const sha=file=>checksum(fs.readFileSync(file));
const fail=message=>{throw Error('Fabric UI workflow NO-GO: '+message);};
const exists=file=>fs.existsSync(file)&&fs.statSync(file).isFile();
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const unix=p=>p.split(path.sep).join('/');
const within=(base,p)=>p.startsWith(base+path.sep)&&p!==base;

function fileList(dir){
 const out=[];
 function walk(folder){
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
   const file=path.join(folder,entry.name);
   if(entry.name==='__pycache__'||entry.name.endsWith('.pyc')||entry.name==='.DS_Store')continue;
   if(entry.isSymbolicLink())fail('symbolic link forbidden in canonical skill: '+file);
   if(entry.isDirectory())walk(file);
   else if(entry.isFile())out.push(file);
  }
 }
 walk(dir);
 return out;
}
function sources(){
 const paths=[...docs];
 for(const name of skills){
  const dir=path.join(canonical,'.agents/skills',name);
  if(!fs.existsSync(dir))fail('missing canonical skill '+name);
  paths.push(...fileList(dir).map(f=>unix(path.relative(canonical,f))));
 }
 return paths.sort();
}
export function activeWorkspace(base=canonical, pointer=pointerFile){
 if(!exists(pointer))fail('active workspace pointer missing');
 const data=json(pointer);
 if(data.role==='application'){
  const local=fs.realpathSync(base);
  if(!exists(path.join(local,'server.ts'))||!fs.existsSync(path.join(local,'src')))fail('standalone application source missing');
  return {root:local,active:local,pointer:data};
 }
 if(typeof data.workspace!=='string'||path.isAbsolute(data.workspace)||data.workspace.includes('..'))fail('unsafe workspace pointer');
 const candidate=path.resolve(base,data.workspace);
 if(!fs.existsSync(candidate))fail('declared active workspace is absent: '+candidate);
 const root=fs.realpathSync(base),active=fs.realpathSync(candidate);
 if(!within(root,active))fail('workspace must be contained inside canonical Fabric root');
 if(!exists(path.join(active,'package.json'))||!exists(path.join(active,'AGENTS.md')))fail('workspace bootstrap is incomplete');
 const activePointerFile=path.join(active,'docs/project/fabric-v2-active-workspace.json');
 if(!exists(activePointerFile))fail('active workspace release pointer is missing');
 const actual=json(activePointerFile);
 if(actual.workspace!==data.workspace||actual.sourceManifest!==data.sourceManifest)fail('root and active workspace identity/pointer path differ');
 // Root pointer only locates the worktree. The worktree's currentRelease is authoritative:
 // the shared root may lag by a verified release while preserving the same workspace path.
 return {root,active,pointer:actual};
}
function syncOrInspect(active,sync){
 let updated=0;const mismatched=[];
 for(const rel of sources()){
  const source=path.join(canonical,rel),dest=path.join(active,rel);
  if(!exists(source))fail('canonical file missing: '+rel);
  const same=exists(dest)&&sha(dest)===sha(source);
  if(same)continue;
  mismatched.push(rel);
  if(sync){
   if(fs.existsSync(dest)&&fs.lstatSync(dest).isSymbolicLink())fail('target symlink: '+rel);
   fs.mkdirSync(path.dirname(dest),{recursive:true});
   const temp=dest+'.ui-sync.tmp';
   fs.copyFileSync(source,temp);
   fs.renameSync(temp,dest);
   updated++;
  }
 }
 return {canonicalFiles:sources().length,mismatched,updated};
}
function requireRunner(root,active){
 for(const rel of ['playwright.ui.config.ts','scripts/serve-ui-ux-pilot.mjs']){
  if(!exists(path.join(active,rel)))fail('application UI test runner missing: '+rel);
 }
 const scripts=json(path.join(active,'package.json')).scripts??{};
 if(!scripts['test:ui:ux'])fail('root test:ui:ux entry missing');
 const localScripts=json(path.join(active,'package.json')).scripts??{};
 if(!localScripts['ui:preflight']||!localScripts['ui:verify'])fail('active npm UI entry points missing');
}
export function preflight({sync=false,root=canonical,active}={}){
 // Only the canonical project is permitted as the source of UI standards.
 if(fs.realpathSync(root)!==fs.realpathSync(canonical))fail('noncanonical root');
 active??=activeWorkspace().active;
 const state=syncOrInspect(active,sync);
 if(!sync&&state.mismatched.length)fail('stale/missing UI rules: '+state.mismatched.join(', ')+'; run npm run ui:preflight -- --sync');
 requireRunner(root,active);
 return {status:'pass',mode:sync?'sync':'inspect',active,canonicalFiles:state.canonicalFiles,updated:state.updated,uiRulesSha256:checksum(sources().map(rel=>rel+':'+sha(path.join(root,rel))).join('\n')),source:unix(root)+' canonical files',writes:sync?state.updated:0};
}
function artifact(root,active,rel,ext){
 if(typeof rel!=='string'||!rel||path.isAbsolute(rel)||rel.includes('..')||rel.includes('\\'))fail('invalid artifact path: '+rel);
 if(!rel.startsWith('artifacts/'))fail('evidence must be under artifacts/');
 const file=path.resolve(active,rel);
 if(!within(path.join(active,'artifacts'),file))fail('artifact path escapes workspace: '+rel);
 if(ext&&!file.toLowerCase().endsWith(ext))fail('incorrect evidence extension: '+rel);
 if(!exists(file))fail('evidence missing: '+rel);
 return file;
}
function codeFile(active,rel){
 if(typeof rel!=='string'||!/^src\/[a-z0-9_./-]+\.(?:tsx?|jsx?|css|scss)$/i.test(rel)||rel.includes('..'))fail('invalid changed UI source path: '+rel);
 const f=path.resolve(active,rel);
 if(!within(path.join(active,'src'),f))fail('UI source path escapes workspace: '+rel);
 return f;
}
export function uiSourceHash(active,paths){
 if(!Array.isArray(paths)||!paths.length||paths.length>250||new Set(paths).size!==paths.length)fail('invalid UI source list');
 return checksum([...paths].sort().map(rel=>{const file=codeFile(active,rel);return rel+':'+(exists(file)?sha(file):'[deleted]');}).join('\n'));
}
function manifestIdentity(active,pointer){
 const rel=pointer.sourceManifest;
 if(typeof rel!=='string'||!rel.startsWith('artifacts/')||rel.includes('..')||path.isAbsolute(rel))fail('invalid active source manifest pointer');
 const file=path.resolve(active,rel);
 if(!within(path.join(active,'artifacts'),file)||!exists(file))fail('candidate source manifest missing');
 return sha(file);
}
function candidateUiChanges(active,pointer){
 const releaseId=pointer.currentRelease?.id;
 if(typeof releaseId!=='string'||!/^[A-Za-z0-9_-]+$/.test(releaseId))fail('verified release id missing');
 const old=path.join(active,'artifacts','releases',releaseId,'package','source-manifest.json');
 if(!exists(old))fail('verified previous UI source manifest missing');
 const candidate=json(path.resolve(active,pointer.sourceManifest)),previous=json(old);
 if(!Array.isArray(candidate.files)||!Array.isArray(previous.files))fail('invalid source manifests');
 const before=new Map(previous.files.map(x=>[x.path,x.sha256])),after=new Map(candidate.files.map(x=>[x.path,x.sha256]));
 return [...new Set([...before.keys(),...after.keys()])]
  .filter(rel=>before.get(rel)!==after.get(rel))
  .filter(rel=>rel.startsWith('src/')&&/\.(?:tsx?|jsx?|css|scss)$/i.test(rel)&&!/\.(?:test|spec)\.[jt]sx?$/.test(rel)&&!rel.includes('/__tests__/'))
  .sort();
}
function screenshot(active,record){
 const rel=record?.path,f=artifact(canonical,active,rel,'.png'),data=fs.readFileSync(f);
 if(data.length<600||data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')fail('invalid PNG screenshot '+rel);
 if(record.sha256!==sha(f))fail('screenshot changed since review: '+rel);
 const width=data.readUInt32BE(16),height=data.readUInt32BE(20);
 if(!width||!height||width>20000||height>40000)fail('invalid screenshot geometry: '+rel);
 return {path:rel,sha256:record.sha256,width,height};
}
export function verify({reportPath,root=canonical,active,pointer}={}){
 active??=activeWorkspace().active;
 pointer??=activeWorkspace().pointer;
 const check=preflight({root,active});
 const identity=manifestIdentity(active,pointer);
 reportPath??='artifacts/ui-workflow/'+identity+'.json';
 const f=artifact(root,active,reportPath,'.json'),report=json(f);
 if(report?.version!==1||typeof report.page!=='string'||!report.page.trim())fail('invalid page review record');
 if(typeof report.reviewer!=='string'||report.reviewer.trim().length<2)fail('named actual reviewer required');
 if(report.candidateManifestSha256!==identity)fail('review is for a different source manifest');
 if(report.uiRulesSha256!==check.uiRulesSha256)fail('UI rules changed since review');
 const completeUiPaths=candidateUiChanges(active,pointer);
 if(JSON.stringify([...report.changedUiFiles??[]].sort())!==JSON.stringify(completeUiPaths)||!completeUiPaths.length)fail('review UI scope does not match full candidate-versus-release manifest');
 if(report.uiSourceSha256!==uiSourceHash(active,report.changedUiFiles))fail('UI code changed since review');
 if(report.visual?.status!=='pass'||!Array.isArray(report.visual.screenshots)||report.visual.screenshots.length<2)fail('visual review or desktop/dialog screenshot missing');
 const screens=report.visual.screenshots.map(s=>screenshot(active,s));
 if(new Set(screens.map(s=>s.path)).size!==screens.length)fail('duplicate screenshots');
 if(!screens.some(s=>s.width>=1000)||!screens.some(s=>s.width<=600))fail('actual desktop and narrow screenshots required');
 if(!report.visual.desktopViewport||!report.visual.narrowViewport)fail('desktop/narrow visual review not recorded');
 if(report.interaction?.status!=='pass'||!report.interaction.browserEvidence)fail('browser interaction PASS with evidence required');
 const browserFile=artifact(root,active,report.interaction.browserEvidence,'.json'),browser=json(browserFile);
 if(report.interaction.browserSha256!==sha(browserFile))fail('browser evidence changed since review');
 if(!Array.isArray(browser.checks)||!browser.checks.length||!Array.isArray(browser.errors)||browser.errors.length)fail('browser evidence has missing checks or errors');
 if(report.engineering?.status!=='pass'||!Array.isArray(report.engineering.evidence)||!report.engineering.evidence.length)fail('engineering PASS with real evidence required');
 report.engineering.evidence.forEach(e=>{const file=artifact(root,active,e?.path);if(e.sha256!==sha(file))fail('engineering evidence changed since review: '+e.path);});
 if(!['pending','not-attested-by-tool'].includes(report.userAcceptance))fail('tool cannot attest user acceptance; record pending');
 if(report.production!=='not-deployed')fail('tool cannot attest deployment; production must be not-deployed');
 if(!Array.isArray(report.unverified)||report.unverified.length||report.releaseReady!==false)fail('unverified checks or false release readiness; separate user authorization required');
 return {status:'pass',scope:'local UI workflow',page:report.page,changedUiFiles:report.changedUiFiles.length,screenshots:screens.length,browserChecks:browser.checks.length,engineeringEvidence:report.engineering.evidence.length,userAcceptance:report.userAcceptance,production:report.production,report:reportPath,sourceManifestSha256:identity,uiRulesSha256:check.uiRulesSha256,releaseReady:false};
}
function main(argv){
 const [command,...args]=argv;
 if(!['preflight','verify','source','template'].includes(command))fail('usage: preflight [--sync] | template --page 名称 --file src/... | verify [--report artifacts/...] | source --file src/...');
 const {active,pointer}=activeWorkspace();
 if(command==='preflight'){
  if(args.some(x=>x!=='--sync')||args.filter(x=>x==='--sync').length>1)fail('only --sync supported for preflight');
  return preflight({active,sync:args.includes('--sync')});
 }
 if(command==='source'){
  if(args.length<2||args.length%2!==0||args.some((v,i)=>i%2===0&&v!=='--file'))fail('use source --file src/... [--file src/...]');
  const files=args.filter((_,i)=>i%2===1);
  return {files,uiSourceSha256:uiSourceHash(active,files),candidateManifestSha256:manifestIdentity(active,pointer)};
 }
 if(command==='template'){
  preflight({active});
  if(args.length<4||args.length%2!==0||args.some((v,i)=>i%2===0&&!['--page','--file'].includes(v)))fail('use template --page 页面名 --file src/... [--file src/...]');
  const files=[],pages=[];
  for(let i=0;i<args.length;i+=2)(args[i]==='--page'?pages:files).push(args[i+1]);
  if(pages.length!==1||!files.length)fail('one page and at least one UI file required');
  const expected=candidateUiChanges(active,pointer);
  if(JSON.stringify([...files].sort())!==JSON.stringify(expected)||!expected.length)fail('template must cover all UI changes from the candidate manifest; expected='+JSON.stringify(expected)+' got='+JSON.stringify(files));
  const id=manifestIdentity(active,pointer);
  const rel='artifacts/ui-workflow/'+id+'.json',dest=path.resolve(active,rel);
  if(fs.existsSync(dest))fail('existing report not overwritten: '+rel);
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  const review={version:1,page:pages[0],reviewer:'',uiRulesSha256:preflight({active}).uiRulesSha256,
   candidateManifestSha256:id,changedUiFiles:files,uiSourceSha256:uiSourceHash(active,files),
   visual:{status:'not-verified',desktopViewport:'',narrowViewport:'',screenshots:[]},
   interaction:{status:'not-verified',browserEvidence:'',browserSha256:''},
   engineering:{status:'not-verified',evidence:[]},
   unverified:['视觉审核','完整交互','工程测试'],userAcceptance:'pending',production:'not-deployed',releaseReady:false};
  fs.writeFileSync(dest,JSON.stringify(review,null,2)+'\n');
  return {status:'template-created-not-verified',report:rel,sourceSha256:review.uiSourceSha256,next:'Fill actual evidence; run npm run ui:verify'};
 }
 if(args.length>2||(args.length===2&&args[0]!=='--report')||args.length===1)fail('verify accepts --report artifacts/... only');
 return verify({active,pointer,reportPath:args[1]});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(main(process.argv.slice(2)),null,2));}
 catch(e){console.error(e.message);process.exitCode=1;}
}
