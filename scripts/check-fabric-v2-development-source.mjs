/** Read-only local source identity gate. This never authorizes a release. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const pointer=JSON.parse(fs.readFileSync(path.join(root,'docs/project/fabric-v2-active-workspace.json'),'utf8'));
const manifestPath=path.resolve(root,pointer.sourceManifest);
if(path.relative(root,manifestPath).startsWith('..')||path.isAbsolute(path.relative(root,manifestPath)))throw Error('Source manifest must stay in the active workspace');
const sha=data=>createHash('sha256').update(data).digest('hex');
try{
 const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
 if(fs.realpathSync(root)!==fs.realpathSync(manifest.workspace))
  throw Error('Current V2 development source is '+manifest.workspace+'; this checkout is a historical source.');
 const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 if(head!==manifest.baseHead)throw Error('Git baseline changed; reconcile the source manifest before continuing.');
 const check=(relative,expected)=>{
  const target=path.resolve(root,relative);
  if(path.relative(root,target).startsWith('..')||path.isAbsolute(path.relative(root,target)))throw Error('Invalid manifest path');
  if(sha(fs.readFileSync(target))!==expected)throw Error('Source changed since validation: '+relative);
 };
 check(manifest.requirements.path,manifest.requirements.sha256);
 for(const file of manifest.files)check(file.path,file.sha256);
 const expected=new Set(manifest.files.map(file=>file.path));
 const walk=dir=>{
  for(const item of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
   const relative=dir+'/'+item.name;
   if(relative==='scripts/generate_mockup.py')continue; // Machine-local helper; every other source stays protected.
   if(item.isSymbolicLink())throw Error('Unexpected source link: '+relative);
   if(item.isDirectory())walk(relative);
   else if(item.isFile()&&!expected.has(relative))throw Error('Unvalidated new source: '+relative);
  }
 };
 for(const dir of ['src','server','scripts','tests','tools'])if(fs.existsSync(path.join(root,dir)))walk(dir);
 console.log(JSON.stringify({status:'verified-local-source',workspace:root,baseHead:head,files:manifest.files.length,requirementsSha256:manifest.requirements.sha256,releaseAuthorized:false},null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
