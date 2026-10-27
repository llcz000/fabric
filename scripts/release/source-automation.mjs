/** Fabric reviewed-source refresh and verified-release pointer; never contacts or mutates production. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const sha=data=>createHash('sha256').update(data).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const relativeSafe=name=>typeof name==='string'&&/^(?:src|server|scripts|tests|tools)\/(?:[A-Za-z0-9_./-]+)$/.test(name)&&!name.split('/').some(x=>x==='..'||x==='.'||!x);
const toolingEntries=['tsconfig.json','package-lock.json','playwright.ui.config.ts',...['pilot','share-demo','wechat-review','wechat-route','internal-chrome','internal-cards','internal-fabrics','internal-patterns'].map(x=>'ui-ux-'+x+'.html')];
// Explicit user-reviewed entry files may change with UI workflow work, never arbitrary pinned configuration.
const reviewedPathAllowed=name=>relativeSafe(name)||name==='AGENTS.md'||name==='package.json'||toolingEntries.includes(name);
function atomicJson(file,value){const next=file+'.next';fs.writeFileSync(next,JSON.stringify(value,null,2)+'\n','utf8');fs.renameSync(next,file);}
export function reviewedSourceDiff({root,head,requirementsReview}){
 const pointer=read(path.join(root,'docs/project/fabric-v2-active-workspace.json'));
 const rel=pointer.sourceManifest;
 if(typeof rel!=='string'||path.isAbsolute(rel)||rel.includes('..'))throw Error('Unsafe source manifest pointer');
 const file=path.resolve(root,rel);
 if(!file.startsWith(root+path.sep))throw Error('Unsafe source manifest');
 const manifest=read(file);
 if(fs.realpathSync(root)!==fs.realpathSync(manifest.workspace)||manifest.baseHead!==head)
  throw Error('Unverified workspace or git baseline drift');
 const req=path.resolve(root,manifest.requirements.path);
 if(!req.startsWith(root+path.sep)||sha(fs.readFileSync(req))!==manifest.requirements.sha256&&
  !(requirementsReview?.path===manifest.requirements.path&&requirementsReview.sha256===sha(fs.readFileSync(req))))
  throw Error('Requirements changed; review and update requirements separately');
 const previous=new Map();
 for(const entry of manifest.files){
  if(typeof entry.path!=='string'||entry.path.startsWith('/')||entry.path.includes('\\')||entry.path.split('/').some(x=>!x||x==='..'||x==='.')||previous.has(entry.path))throw Error('Unsafe or duplicate manifest path');
  previous.set(entry.path,entry.sha256);
 }
 const actual=new Map();
 // The signed source manifest also contains pinned root/config and requirement files.
 // Recheck those hashes, but never authorize their changes through the narrow source-sync command.
 for(const [name] of previous){
  if(relativeSafe(name))continue;
  const target=path.resolve(root,name);
  if(!target.startsWith(root+path.sep)||!fs.existsSync(target)||fs.lstatSync(target).isSymbolicLink())throw Error('Unsafe pinned manifest file');
  actual.set(name,sha(fs.readFileSync(target)));
 }
 const walk=dir=>{
  for(const item of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
   const name=dir+'/'+item.name,target=path.join(root,name);
   if(name==='scripts/generate_mockup.py')continue; // Same documented local-only exception as the source gate and initializer.
   if(item.isSymbolicLink())throw Error('Unexpected source symlink: '+name);
   if(item.isDirectory())walk(name);
   else if(item.isFile())actual.set(name,sha(fs.readFileSync(target)));
  }
 };
 for(const dir of ['src','server','scripts','tests','tools'])if(fs.existsSync(path.join(root,dir)))walk(dir);
 for(const name of toolingEntries)if(fs.existsSync(path.join(root,name))){
  if(fs.lstatSync(path.join(root,name)).isSymbolicLink())throw Error('Unexpected tooling symlink: '+name);
  actual.set(name,sha(fs.readFileSync(path.join(root,name))));
 }
 const changed=[...new Set([...actual.keys(),...previous.keys()])].filter(name=>actual.get(name)!==previous.get(name)).sort();
 return {pointer,manifest,file,changed,actual};
}
export function acceptReviewedSource(ctx,reviewed){
 if(!Array.isArray(reviewed)||reviewed.some(name=>!reviewedPathAllowed(name)))throw Error('Unsafe approved source path');
 if(new Set(reviewed).size!==reviewed.length)throw Error('Duplicate reviewed path');
 const state=reviewedSourceDiff(ctx),wanted=[...reviewed].sort();
 if(JSON.stringify(state.changed)!==JSON.stringify(wanted))throw Error('Unreviewed source changes: '+state.changed.join(', '));
 if(!state.changed.length)return [];
 const manifest={...state.manifest,files:[...state.actual.entries()].sort(([a],[b])=>a.localeCompare(b,'en')).map(([file,sha256])=>({path:file,sha256}))};
 // Preserve any optional per-file metadata on preexisting entries.
 const old=new Map(state.manifest.files.map(f=>[f.path,f]));
 manifest.files=manifest.files.map(f=>({...old.get(f.path),...f}));
 atomicJson(state.file,manifest);
 return state.changed;
}
/** Requirement approval is separate from code approval and names every exact new digest. */
export function acceptReviewedRequirements(ctx,reviewed){
 const pointer=read(path.join(ctx.root,'docs/project/fabric-v2-active-workspace.json'));
 if(typeof pointer.sourceManifest!=='string'||!pointer.sourceManifest.startsWith('artifacts/')||pointer.sourceManifest.includes('..'))throw Error('Unsafe source manifest');
 const manifest=read(path.join(ctx.root,pointer.sourceManifest));
 const allowed=[manifest.requirements.path,'docs/product-master/product-master-v2-requirements.md'];
 if(!Array.isArray(reviewed)||!reviewed.length||new Set(reviewed.map(r=>r.path)).size!==reviewed.length||
  reviewed.some(r=>!allowed.includes(r.path)||!r.path.startsWith('docs/')||r.path.includes('..')||!(/^[a-f0-9]{64}$/).test(r.sha256)))throw Error('Exact requirement paths and hashes required');
 for(const r of reviewed)if(sha(fs.readFileSync(path.join(ctx.root,r.path)))!==r.sha256)throw Error('Reviewed requirement hash mismatch');
 const state=reviewedSourceDiff({...ctx,requirementsReview:reviewed.find(r=>r.path===manifest.requirements.path)});
 const changed=[...new Set([...state.changed.filter(p=>allowed.includes(p)),
  ...(sha(fs.readFileSync(path.join(ctx.root,manifest.requirements.path)))!==manifest.requirements.sha256?[manifest.requirements.path]:[])])].sort();
 if(JSON.stringify(changed)!==JSON.stringify(reviewed.map(r=>r.path).sort()))throw Error('Unreviewed requirement changes');
 const accepted=new Map(reviewed.map(r=>[r.path,r.sha256]));
 const next={...state.manifest,requirements:{...state.manifest.requirements,sha256:accepted.get(manifest.requirements.path)??manifest.requirements.sha256},
  files:state.manifest.files.map(f=>accepted.has(f.path)?{...f,sha256:accepted.get(f.path)}:f)};
 atomicJson(state.file,next);return changed;
}
/** Only an explicitly selected, narrow Fabric table UI change may use focused browser QA. */
export function targetedFabricUiAllowed(changed){
 const ok=new Set(['src/components/product-master-v2/FabricLibraryV2.tsx','src/components/product-master-v2/FabricLibraryV2.test.ts']);
 return Array.isArray(changed)&&changed.includes('src/components/product-master-v2/FabricLibraryV2.tsx')&&changed.every(p=>ok.has(p));
}
export function syncVerifiedPointer(root,run,receipt){
 if(receipt?.state!=='released'||run?.phases?.verify?.status!=='passed'||run?.id!==path.basename(run.dir))
  throw Error('Unverified release receipt');
 const v=run.phases.verify.result?.remote?.version;
 if(receipt.artifactSha256!==run.archiveSha256||!v||
  receipt.indexSha256!==v.index||receipt.backendSha256!==v.backend)
  throw Error('Verified release artifact/version mismatch');
 const file=path.join(root,'docs/project/fabric-v2-active-workspace.json'),pointer=read(file);
 const current=pointer.currentRelease?.id;
 if(current!==run.manifest?.baseline?.releaseId&&current!==run.id)
  throw Error('Active pointer baseline mismatch; reconcile before recording release');
 const evidence='artifacts/releases/'+run.id+'/release-result.json';
 const next={...pointer,currentRelease:{id:run.id,utc:receipt.utc,artifactSha256:receipt.artifactSha256,evidence}};
 if(current!==run.id)atomicJson(file,next);
 return next;
}
async function main(){
 const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
 const [command,...args]=process.argv.slice(2),head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 const ctx={root,head};
 if(command==='inspect'){const state=reviewedSourceDiff(ctx);console.log(JSON.stringify({changed:state.changed,files:state.actual.size,mutation:false}));return;}
 if(command==='accept'){const changed=acceptReviewedSource(ctx,args);console.log(JSON.stringify({accepted:changed,files:reviewedSourceDiff(ctx).actual.size}));return;}
 if(command==='accept-requirements'){
  if(!args.length||args.length%2)throw Error('Use accept-requirements <exact-path> <reviewed-sha256> ...');
  const reviewed=[];for(let i=0;i<args.length;i+=2)reviewed.push({path:args[i],sha256:args[i+1]});
  console.log(JSON.stringify({acceptedRequirements:acceptReviewedRequirements(ctx,reviewed),codeAccepted:false}));return;
 }
 if(command==='sync-pointer'){
  if(args.length!==1||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(args[0]))throw Error('Invalid release ID');
  const id=args[0],dir=path.join(root,'artifacts/releases',id),run=read(path.join(dir,'run.json')),receipt=read(path.join(dir,'release-result.json'));
  if(run.id!==id||run.dir!==dir)throw Error('Release identity mismatch');
  const profile=read(path.join(root,'scripts/release/production.json'));
  const baseline=read(path.join(path.dirname(profile.sshConfig),'../release-state/baseline.json'));
  if(baseline.releaseId!==id||baseline.archiveSha256!==receipt.artifactSha256||baseline.index!==receipt.indexSha256||
    baseline.backend!==receipt.backendSha256)throw Error('Local verified production baseline mismatch');
  console.log(JSON.stringify(syncVerifiedPointer(root,run,receipt).currentRelease));return;
 }
 throw Error('Use inspect | accept <exact-reviewed-path> ... | sync-pointer <verified-release-id>');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(e=>{console.error(e.message);process.exitCode=1;});
}
