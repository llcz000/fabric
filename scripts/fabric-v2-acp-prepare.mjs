/** Source-only ACP isolated workspace preparation. Never modifies the main project.
 * CLI: node scripts/fabric-v2-acp-prepare.mjs --prepare ABSOLUTE_VERIFIED_SNAPSHOT E
 * Result can be registered as a separate WebCodex Project; that registration is a separate action.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const validName=id=>typeof id==='string'&&/^acp-[a-e]-[a-z0-9-]{3,60}$/.test(id);
function pathSafe(rel){
 if(typeof rel!=='string'||!rel||path.isAbsolute(rel)||rel.includes('\\')||rel.includes(':')||
  /[\x00-\x1f]/.test(rel)||rel.split('/').some(v=>!v||v==='.'||v==='..')||
  path.posix.normalize(rel)!==rel)throw Error('Invalid snapshot path');
 return rel;
}
export function prepareWorkspace(projectRoot,snapshot,role,name){
 if(!['A','B','C','D','E'].includes(role))throw Error('Unknown ACP role');
 if(!validName(name)||!name.startsWith('acp-'+role.toLowerCase()+'-'))
  throw Error('Invalid ACP workspace name');
 const workspaceRoot=path.join(projectRoot,'.agent-workspaces');
 const expectedStore=path.resolve(projectRoot,'..','fabric-agent-baselines');
 if(path.dirname(path.resolve(snapshot))!==expectedStore||!path.basename(snapshot).startsWith('v2-'))
  throw Error('ACP snapshot must be a verified sibling baseline');
 const manifest=JSON.parse(fs.readFileSync(path.join(snapshot,'manifest.json'),'utf8'));
 if(manifest.format!=='fabric-v2-safe-source-v1'||!Array.isArray(manifest.entries)||
  manifest.count!==manifest.entries.length||manifest.count<1)throw Error('Invalid ACP snapshot manifest');
 const seen=new Set();let total=0;
 // Read all files and validate BEFORE creating a workspace; no partial copy on bad baseline.
 const prepared=[];
 for(const item of manifest.entries){
  const file=pathSafe(item.file);
  if(seen.has(file)||typeof item.sha256!=='string'||!/^[0-9a-f]{64}$/.test(item.sha256)||
    !Number.isSafeInteger(item.bytes)||item.bytes<0)throw Error('Invalid ACP snapshot entry');
  seen.add(file);
  const absolute=path.join(snapshot,file),stat=fs.lstatSync(absolute);
  if(stat.isSymbolicLink()||!stat.isFile())throw Error('Invalid ACP snapshot file');
  const data=fs.readFileSync(absolute);
  if(data.length!==item.bytes||sha(data)!==item.sha256)throw Error('ACP snapshot hash integrity failure');
  prepared.push({file,data});
  total+=data.length;
 }
 if(total!==manifest.totalBytes)throw Error('ACP snapshot total integrity failure');
 fs.mkdirSync(workspaceRoot,{recursive:true});
 const destination=path.join(workspaceRoot,name);
 fs.mkdirSync(destination,{recursive:false}); // EEXIST is intentional: never overwrite.
 for(const {file,data} of prepared){
  const to=path.join(destination,file);
  fs.mkdirSync(path.dirname(to),{recursive:true});
  fs.writeFileSync(to,data,{flag:'wx'});
 }
 const recorded={format:'fabric-v2-acp-workspace-v1',role,snapshot:path.resolve(snapshot),
  baselineManifestSha256:sha(fs.readFileSync(path.join(snapshot,'manifest.json'))),
  count:prepared.length};
 fs.writeFileSync(path.join(destination,'.fabric-acp-workspace.json'),
  JSON.stringify(recorded,null,2)+'\n',{flag:'wx'});
 for(const item of manifest.entries){
  const x=fs.readFileSync(path.join(destination,item.file));
  if(x.length!==item.bytes||sha(x)!==item.sha256)throw Error('ACP copied workspace verification failed');
 }
 return {workspace:destination,role,copied:prepared.length,snapshot:path.resolve(snapshot),ready:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [cmd,snapshot,role]=process.argv.slice(2);
  if(cmd!=='--prepare'||!snapshot||!role||process.argv.length!==5)throw Error('Usage: --prepare SNAPSHOT ROLE');
  const basename='acp-'+role.toLowerCase()+'-'+new Date().toISOString().replace(/[:.]/g,'-').toLowerCase()+'-'+randomBytes(3).toString('hex');
  const result=prepareWorkspace(process.cwd(),path.resolve(snapshot),role,basename);
  console.log(JSON.stringify(result));
 }catch(error){console.error('ACP prepare refused: '+error.message);process.exitCode=2;}
}
