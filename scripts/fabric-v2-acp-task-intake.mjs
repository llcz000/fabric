/** Read-only focused ACP task gate. Do not dispatch generic multi-AC profiles verbatim.
 *
 * node scripts/fabric-v2-acp-task-intake.mjs --audit
 * node scripts/fabric-v2-acp-task-intake.mjs --task ./tmp/one-ac-task.json
 *
 * One AC + explicit remaining Gate + exact edits + minimal read list.
 * Captures source file SHA256 to let main owner recheck versions before merging.
 * Ownership claims are policy, NOT OS-level filesystem isolation or release approval.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {buildBrief,profileIds} from './fabric-v2-agent-brief.mjs';

const ROOTS=['server/','src/','scripts/','docs/product-master/','docs/development/',
 'docs/retrospectives/development/','docs/ui-design/'];
const MAX_BYTES=600_000;
const protectedEdit=new Set(['AGENTS.md','server.ts','src/App.tsx',
 'server/product-master/v2CatalogAssembly.ts',
 'docs/product-master/product-master-v2-progress.md',
 'docs/product-master/product-master-v2-requirements.md']);
const hash=buf=>createHash('sha256').update(buf).digest('hex');
function cleanRel(value){
 if(typeof value!=='string'||!value||value.length>260||
   path.isAbsolute(value)||value.includes('\\')||value.includes(':')||
   !/^[a-zA-Z0-9_./\-]+$/.test(value)||
   value.split('/').some(v=>!v||v==='.'||v==='..')||path.posix.normalize(value)!==value)return null;
 if(value==='AGENTS.md')return value;
 if(!ROOTS.some(p=>value.startsWith(p)))return null;
 if(/(?:^|\/)(?:\.env|\.git|\.local|node_modules|tmp)(?:\/|$)/i.test(value)||
  /(?:secret|credential|id_rsa|id_ed25519|\.pem|\.key)$/i.test(value))return null;
 return value;
}
function owns(allowed,file){return allowed.some(p=>p.endsWith('/')?file.startsWith(p):p===file);}
function statFile(root,rel){
 const name=path.join(root,rel);
 if(!fs.existsSync(name))return null;
 const st=fs.lstatSync(name);
 if(st.isSymbolicLink()||!st.isFile()||st.size>MAX_BYTES)throw Error('Unsafe or oversized source');
 return fs.readFileSync(name);
}
function canonicalList(value,max,issues,label){
 if(!Array.isArray(value)||value.length<1||value.length>max){issues.push(label+': count outside 1-'+max);return [];}
 const out=[];
 for(const input of value){const normalized=cleanRel(input);
  if(!normalized||out.includes(normalized))issues.push(label+': unsafe or duplicate path');
  else out.push(normalized);
 }
 return out;
}
export function auditAcpProfiles(root=process.cwd()){
 const issues=[],profiles=profileIds(),records=[];
 for(const id of profiles){
  const b=buildBrief(id);
  for(const file of b.contextFiles){
   if(!cleanRel(file))issues.push(id+': unsafe context');
   else if(!fs.existsSync(path.join(root,file)))issues.push(id+': missing context '+file);
   else if(fs.statSync(path.join(root,file)).isDirectory())issues.push(id+': directory context '+file);
  }
  for(const owned of b.ownedPaths){
   const check=owned.endsWith('/')?owned.slice(0,-1):owned;
   if(!cleanRel(check))issues.push(id+': unsafe ownership path');
  }
  records.push({agent:id,contextFiles:b.contextFiles.length,ownedPaths:b.ownedPaths.length});
 }
 for(let i=0;i<profiles.length;i++){
  const a=buildBrief(profiles[i]);
  for(let j=i+1;j<profiles.length;j++){
   const b=buildBrief(profiles[j]);
   for(const x of a.ownedPaths)for(const y of b.ownedPaths){
    if(x===y||x.endsWith('/')&&y.startsWith(x)||y.endsWith('/')&&x.startsWith(y))
     issues.push('overlap '+a.agent+'/'+b.agent+': '+x+' and '+y);
   }
  }
 }
 return {ok:issues.length===0,profileCount:profiles.length,records,issues};
}
export function evaluateAcpTask(spec,root=process.cwd()){
 const issues=[];
 if(!spec||typeof spec!=='object'||Array.isArray(spec)||spec.format!=='fabric-v2-acp-task-v1'){
  return {ok:false,issues:['Invalid task format']};
 }
 const validRole=profileIds().includes(spec.agent);
 if(!validRole)issues.push('Unknown owner');
 let b;
 if(validRole)b=buildBrief(spec.agent);
 if(typeof spec.task!=='string'||spec.task.trim().length<12||spec.task.length>320)
  issues.push('Task must name one narrow deliverable');
 if(typeof spec.remainingGate!=='string'||spec.remainingGate.trim().length<12||spec.remainingGate.length>320)
  issues.push('Explicit still-open Gate required');
 if(typeof spec.ac!=='string'||!/^AC-(?:[1-9][0-9]{0,2})$/.test(spec.ac))
  issues.push('Single named AC required');
 const read=canonicalList(spec.read,8,issues,'read');
 const edit=canonicalList(spec.edit,6,issues,'edit');
 if(!validRole)return {ok:false,issues};
 if(typeof spec.ac==='string'&&!b.acceptance.includes(spec.ac))
  issues.push('AC not assigned to selected agent profile');
 let requirements;
 try{requirements=fs.readFileSync(path.join(root,'docs/product-master/product-master-v2-requirements.md'),'utf8');}
 catch{issues.push('Current PRD absent');}
 if(requirements&&typeof spec.ac==='string'&&
  !new RegExp('\\b'+spec.ac.replace('-','\\-')+'\\b').test(requirements))
  issues.push('AC not found in current PRD');
 const fingerprints=[];
 for(const file of edit){
  if(protectedEdit.has(file)||!owns(b.ownedPaths,file)){issues.push('Edit outside exact owner scope: '+file);continue;}
  try{
   const bytes=statFile(root,file);
   // missing file is only allowed under an owned existing parent directory
   if(bytes===null&&(!fs.existsSync(path.dirname(path.join(root,file)))||
      !fs.statSync(path.dirname(path.join(root,file))).isDirectory()))
     issues.push('New file parent missing: '+file);
   fingerprints.push({path:file,exists:bytes!==null,sha256:bytes===null?null:hash(bytes)});
  }catch{issues.push('Unsafe edit file: '+file);}
 }
 for(const file of read){
  try{if(statFile(root,file)===null)issues.push('Missing read source: '+file);}
  catch{issues.push('Unsafe read source: '+file);}
 }
 if(edit.some(x=>read.includes(x)))issues.push('Read and edit file lists must be distinct');
 if(issues.length)return {ok:false,issues};
 return {ok:true,issues:[],brief:{
  agent:spec.agent,task:spec.task,acceptance:[spec.ac],
  remainingGate:spec.remainingGate,read,edit,fingerprints,
  status:'PREPARED_NOT_DISPATCHED',
  policy:'snapshot-freshness -> independent registered ACP Project -> scoped TDD -> three-way SHA256 Gate -> coordinator review and integration',
  limits:'No main workspace edits, Git destructive commands, remote MySQL/COS writes or deployments; no inference of release readiness.'
 }};
}
export function formatAcpTaskBrief(b){
 return [
  '# Fabric V2 ACP单AC任务 | '+b.agent,
  'AC: '+b.acceptance[0],
  '任务: '+b.task,
  '仍开放Gate: '+b.remainingGate,
  '只读文件（按需读相关函数、不要整库检索）:',
  ...b.read.map(p=>'- '+p),
  '允许修改的精确文件（不许扩大范围）:',
  ...b.edit.map(p=>'- '+p),
  '派发时SHA256：',...b.fingerprints.map(x=>'- '+x.path+': '+(x.sha256??'NEW')),
  'RED→GREEN专项后交回：修改路径、测试计数、未完成Gate、文档保留/归档候选/不适用。',
  '仅隔离Project工作，主仓由总控三方检查与合并；禁止远程MySQL写入、COS删除、部署或Git清理。',
 ].join('\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [flag,file]=process.argv.slice(2);
  if(flag==='--audit'&&!file){
   const report=auditAcpProfiles();console.log(JSON.stringify(report,null,2));
   if(!report.ok)process.exitCode=2;
  }else if(flag==='--task'&&file){
   const data=JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
   const result=evaluateAcpTask(data);
   if(result.ok)console.log(formatAcpTaskBrief(result.brief));
   else {console.log(JSON.stringify(result,null,2));process.exitCode=2;}
  }else throw Error('Usage: --audit | --task PATH_TO_MANIFEST_JSON');
 }catch(e){console.error('ACP intake refused: '+String(e.message));process.exitCode=2;}
}
