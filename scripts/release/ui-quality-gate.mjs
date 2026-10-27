/** Risk-scoped, offline UI release evidence gate. No production, secrets or network use. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
const project=path.resolve(root,'../..');
const digest=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const inside=(base,file)=>file===base||file.startsWith(base+path.sep);
const assert=(ok,message)=>{if(!ok)throw Error('UI quality gate: '+message);};
const evidenceRoots=[path.join(root,'artifacts')];
const controllerPointer=path.join(project,'docs/project/fabric-v2-active-workspace.json');
if(fs.existsSync(controllerPointer)){
 const locator=read(controllerPointer);
 // Previously frozen reviews may refer to the registered controller's screenshots.
 if(locator.role==='controller'&&path.resolve(project,locator.workspace)===root)evidenceRoots.push(path.join(project,'artifacts'));
}
export function affectedUiFiles(before,after){
 const old=new Map(before.files.map(x=>[x.path,x.sha256]));
 const neu=new Map(after.files.map(x=>[x.path,x.sha256]));
 const changes=[...new Set([...old.keys(),...neu.keys()])].filter(name=>old.get(name)!==neu.get(name)).sort();
 const isUI=name=>{
  if(!name.startsWith('src/')||/\.(?:test|spec)\.[jt]sx?$/.test(name)||name.includes('/__tests__/'))return false;
  // src/ is the shipped browser application: even a shared .ts model can alter visible behavior.
  return /\.(?:tsx?|jsx?|css|scss)$/.test(name);
 };
 return {changed:changes,ui:changes.filter(isUI)};
}
export function reviewContext({pointer,baseline,workspace=root}){
 assert(pointer?.currentRelease?.id===baseline?.releaseId,'currentRelease and signed production baseline differ');
 const rel=pointer?.sourceManifest;
 assert(typeof rel==='string'&&!path.isAbsolute(rel)&&!rel.includes('..'),'unsafe candidate manifest');
 const currentFile=path.resolve(workspace,rel);
 assert(inside(workspace,currentFile)&&fs.statSync(currentFile).isFile(),'candidate outside active workspace');
 const previousFile=path.join(workspace,'artifacts','releases',baseline.releaseId,'package','source-manifest.json');
 assert(fs.existsSync(previousFile),'verified previous release source manifest missing');
 const current=read(currentFile),previous=read(previousFile);
 return {previous,current,previousFile,currentFile,sourceSha256:digest(currentFile),
  baselineReleaseId:baseline.releaseId,...affectedUiFiles(previous,current)};
}
function screenshotFile(file){
 const resolved=path.resolve(root,file);
 assert(evidenceRoots.some(base=>inside(base,resolved)),'screenshot must be under application or registered controller artifacts');
 assert(/\.png$/i.test(file)&&fs.statSync(resolved).isFile(),'PNG screenshot missing');
 assert(fs.statSync(resolved).size>500,'screenshot invalid/too small');
 const magic=fs.readFileSync(resolved).subarray(0,8).toString('hex');
 assert(magic==='89504e470d0a1a0a','screenshot is not a PNG');
 return {path:path.relative(root,resolved).replaceAll('\\','/'),sha256:digest(resolved)};
}
export function freezeScreenshots(workspace,identity,records){
 assert(/^[a-f0-9]{64}$/.test(identity),'invalid screenshot identity');
 const folder='artifacts/ui-quality-gate/snapshots/'+identity;
 return records.map((record,index)=>{
  const source=path.resolve(workspace,record.path);
  assert(inside(path.join(workspace,'artifacts'),source),'screenshot source outside artifacts');
  const bytes=fs.readFileSync(source);
  assert(createHash('sha256').update(bytes).digest('hex')===record.sha256,'screenshot changed before freezing');
  const relative=folder+'/'+index+'-'+record.sha256+'.png',target=path.join(workspace,relative);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  if(fs.existsSync(target))assert(!fs.lstatSync(target).isSymbolicLink()&&digest(target)===record.sha256,'immutable screenshot snapshot changed');
  else fs.writeFileSync(target,bytes,{flag:'wx'});
  return {path:relative,sha256:record.sha256};
 });
}
export function createReview(ctx,{page,reviewer,screenshots}){
 assert(ctx.ui.length>0,'not a UI candidate; do not create UI proof');
 assert(typeof page==='string'&&page.trim().length>=2&&page.length<=100,'reviewed page missing');
 assert(typeof reviewer==='string'&&reviewer.trim().length>=2&&reviewer.length<=100,'named human/agent reviewer missing');
 assert(Array.isArray(screenshots)&&screenshots.length>=2,'desktop and dialog/mobile screenshots required');
 const images=screenshots.map(screenshotFile);
 assert(new Set(images.map(x=>x.path)).size===images.length,'duplicate screenshots');
 return {version:1,decision:'visual-review-pass',page:page.trim(),reviewer:reviewer.trim(),
  userAcceptance:'not-attested-by-tool',sourceSha256:ctx.sourceSha256,
  baselineReleaseId:ctx.baselineReleaseId,affectedUiFiles:ctx.ui,screenshots:images};
}
export function validateReview(ctx,proof){
 assert(ctx.ui.length>0,'review supplied for no UI changes');
 assert(proof?.version===1&&proof.decision==='visual-review-pass','missing/failed visual decision');
 assert(proof?.userAcceptance==='not-attested-by-tool','user acceptance may not be forged by a release script');
 assert(proof?.sourceSha256===ctx.sourceSha256&&proof?.baselineReleaseId===ctx.baselineReleaseId,'stale source/baseline proof');
 assert(JSON.stringify(proof?.affectedUiFiles)===JSON.stringify(ctx.ui),'scope mismatch');
 assert(typeof proof?.page==='string'&&proof.page.trim().length>=2,'missing page');
 assert(typeof proof?.reviewer==='string'&&proof.reviewer.trim().length>=2,'missing reviewer');
 assert(Array.isArray(proof?.screenshots)&&proof.screenshots.length>=2,'missing screenshots');
 const paths=new Set();
 for(const item of proof.screenshots){
  assert(typeof item?.path==='string'&&!paths.has(item.path),'invalid/duplicate image path');
  paths.add(item.path);
  const actual=screenshotFile(item.path);
  assert(item.sha256===actual.sha256,'screenshot changed since review');
 }
 return {required:true,page:proof.page,reviewer:proof.reviewer,uiFiles:ctx.ui.length,
   sourceSha256:ctx.sourceSha256,baselineReleaseId:ctx.baselineReleaseId,
   screenshots:proof.screenshots.length};
}
export function evidencePath(ctx){return path.join(root,'artifacts','ui-quality-gate',ctx.sourceSha256+'.json');}
export function inspectReleaseUi(pointer,baseline){
 const ctx=reviewContext({pointer,baseline});
 if(!ctx.ui.length)return {summary:{required:false,changedFiles:ctx.changed.length,baselineReleaseId:ctx.baselineReleaseId},proof:null};
 const file=evidencePath(ctx);
 assert(fs.existsSync(file),'visual review evidence absent; run ui-quality-gate.mjs record --page <page> --reviewer <reviewer> --screenshot <PNG> --screenshot <PNG>');
 const proof=read(file);
 return {summary:validateReview(ctx,proof),proof};
}
async function main(){
 const args=process.argv.slice(2),cmd=args.shift();
 assert(['inspect','record'].includes(cmd),'use inspect or record');
 const pointer=read('docs/project/fabric-v2-active-workspace.json');
 // Inspector reads the active published ID; release prepare separately supplies the verified private baseline.
 const baseline={releaseId:pointer.currentRelease.id};
 const ctx=reviewContext({pointer,baseline});
 if(cmd==='inspect'){
  const result=ctx.ui.length?{...inspectReleaseUi(pointer,baseline).summary,changedUiPaths:ctx.ui}:{required:false,changedFiles:ctx.changed.length};
  console.log(JSON.stringify(result,null,2));return;
 }
 const option=(name)=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
 const shots=[];
 for(let i=0;i<args.length;i++)if(args[i]==='--screenshot')shots.push(args[i+1]);
 const allowed=new Set(['--page','--reviewer','--screenshot']);
 for(let i=0;i<args.length;i+=2)assert(allowed.has(args[i])&&args[i+1]&&!args[i+1].startsWith('--'),'invalid review arguments');
 const file=evidencePath(ctx);
 assert(!fs.existsSync(file),'immutable UI review evidence already exists');
 const proof=createReview(ctx,{page:option('--page'),reviewer:option('--reviewer'),screenshots:shots});
 proof.screenshots=freezeScreenshots(root,ctx.sourceSha256,proof.screenshots);
 fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file,JSON.stringify(proof,null,2)+'\n');
 console.log(JSON.stringify({evidence:file,summary:validateReview(ctx,proof)},null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(e=>{console.error(e.message);process.exitCode=1;});
}
