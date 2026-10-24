/** Initialize local validation from a clean committed checkout; never grants release authority. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

export function initializeWorkspace(directory){
 const root=fs.realpathSync(directory),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trimEnd();
 if(git('status','--porcelain=v1','-uall'))throw Error('Initialize only a clean committed checkout');
 const pointer=JSON.parse(fs.readFileSync(path.join(root,'docs/project/fabric-v2-active-workspace.json'),'utf8'));
 if(pointer.role!=='application')throw Error('Initialize the committed application checkout, not its controller');
 const rel=pointer.sourceManifest;
 if(typeof rel!=='string'||!rel.startsWith('artifacts/')||rel.includes('\\')||rel.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Unsafe local manifest path');
 const target=path.resolve(root,rel);
 let ancestor=root;
 for(const part of rel.split('/')){
  ancestor=path.join(ancestor,part);
  if(fs.existsSync(ancestor)&&fs.lstatSync(ancestor).isSymbolicLink())throw Error('Manifest ancestor/path is a link');
 }
 const tracked=new Set(git('ls-files','-z').split('\0').filter(Boolean)),files=[];
 const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 const add=name=>{
  const file=path.join(root,name);
  if(!tracked.has(name))throw Error('Uncommitted or ignored source: '+name);
  if(fs.lstatSync(file).isSymbolicLink())throw Error('Source link: '+name);
  files.push({path:name,sha256:sha(file)});
 };
 const walk=dir=>{
  for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
   const name=dir+'/'+entry.name;
   if(name==='scripts/generate_mockup.py')continue; // Documented machine-local helper, excluded from Git/source manifests.
   if(entry.isSymbolicLink())throw Error('Source link: '+name);
   if(entry.isDirectory())walk(name);else if(entry.isFile())add(name);
  }
 };
 for(const dir of ['src','server','scripts','tests','tools'])if(fs.existsSync(path.join(root,dir)))walk(dir);
 for(const name of tracked)if(!name.includes('/')&&(/\.(?:json|html|[cm]?js|tsx?)$/.test(name)||name==='AGENTS.md'))add(name);
 const requirement='docs/project/项目需求总览.md';
 add(requirement);
 const details='docs/product-master/product-master-v2-requirements.md';
 if(tracked.has(details))add(details);
 const head=git('rev-parse','HEAD');
 if(fs.existsSync(target)){
  const current=JSON.parse(fs.readFileSync(target,'utf8'));
  const validFiles=Array.isArray(current.files)&&current.files.length>0;
  const listed=new Map(validFiles?current.files.map(f=>[f.path,f.sha256]):[]);
  const requiredSource=files.filter(f=>/^(?:src|server|scripts|tests|tools)\//.test(f.path));
  if(current.workspace!==root||current.baseHead!==head||current.workspacePreservation?.kind!=='local-git-preservation'||current.releaseAuthorized===true||
     current.requirements?.path!==requirement||current.requirements?.sha256!==sha(path.join(root,requirement))||
     !validFiles||listed.size!==current.files.length||requiredSource.some(f=>listed.get(f.path)!==f.sha256)||
     current.files.some(f=>!tracked.has(f.path)||!fs.existsSync(path.join(root,f.path))||sha(path.join(root,f.path))!==f.sha256))throw Error('Existing manifest validation failed; reconcile it explicitly');
  return {status:'already-initialized',workspace:root,head,releaseAuthorized:false};
 }
 const manifest={schemaVersion:1,workspace:root,baseHead:head,requirements:{path:requirement,sha256:sha(path.join(root,requirement))},files:files.sort((a,b)=>a.path.localeCompare(b.path,'en')),workspacePreservation:{kind:'local-git-preservation',initializedFrom:'clean-committed-checkout'},releaseAuthorized:false};
 fs.mkdirSync(path.dirname(target),{recursive:true});
 fs.writeFileSync(target,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 return {status:'initialized-local-source',workspace:root,head,files:files.length,releaseAuthorized:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(initializeWorkspace(path.resolve(fileURLToPath(new URL('../',import.meta.url)))),null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
