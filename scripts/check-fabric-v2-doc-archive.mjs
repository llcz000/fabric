/** Read-only evidence gate for retiring superseded Fabric project process notes.
 * Run after extracting unique facts and removing current links, before archive removal.
 * This validates stated evidence; it does NOT prove human acceptance or delete files.
 * Usage: node scripts/check-fabric-v2-doc-archive.mjs <review-plan.json>
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const root=process.cwd();
const fail=(why)=>{throw Error(why);};
const sha=(data)=>createHash('sha256').update(data).digest('hex');
function documentPath(rel){
 if(typeof rel!=='string'||!rel.startsWith('docs/')||rel.includes('\\')||rel.includes(':')||
    rel.split('/').some(p=>!p||p==='.'||p==='..')||path.posix.normalize(rel)!==rel)
  fail('Invalid docs-relative path');
 return path.resolve(root,rel);
}
function mustReadDoc(rel){
 const target=documentPath(rel);
 if(!fs.existsSync(target)||!fs.lstatSync(target).isFile())fail('Required evidence document missing: '+rel);
 return fs.readFileSync(target,'utf8');
}
function linkedFromOtherDocs(source,excluded){
 const target=documentPath(source),hits=[];
 function walk(dir){
  for(const item of fs.readdirSync(dir,{withFileTypes:true})){
   if(item.isSymbolicLink())continue;
   const f=path.join(dir,item.name);
   if(item.isDirectory())walk(f);
   else if(item.isFile()&&f.endsWith('.md')){
    if(excluded.has(path.resolve(f)))continue;
    const lines=fs.readFileSync(f,'utf8').split(/\r?\n/);
    let fenced=false;
    for(let i=0;i<lines.length;i++){
     if(/^\s*(?:```|~~~)/.test(lines[i])){fenced=!fenced;continue;}
     if(fenced)continue;
     for(const m of lines[i].matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)){
      const url=m[1].split(/\s+"/)[0];
      if(/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(url))continue;
      let rel;try{rel=decodeURI(url.split('#')[0]);}catch{continue;}
      if(path.resolve(path.dirname(f),rel)===target)hits.push(path.relative(root,f)+':'+(i+1));
     }
    }
   }
  }
 }
 walk(path.join(root,'docs'));
 return hits;
}
function evaluate(entry,excluded){
 const s=entry.source;
 documentPath(s);
 if(!(/^docs\/product-master\/[^/]+\.md$/.test(s)||
     /^docs\/retrospectives\/development\/[^/]+\.md$/.test(s)||
     /^docs\/superpowers\/plans\/\d{4}-\d{2}-\d{2}-[^/]+\.md$/.test(s)||
     /^docs\/(?:operations|maintenance)\/\d{4}-\d{2}-\d{2}-[^/]+\.md$/.test(s)||
     /^docs\/ui-design\/[^/]+-\d{4}-\d{2}-\d{2}(?:-[^/]+)?\.md$/.test(s)||
     /^docs\/superpowers\/specs\/\d{4}-\d{2}-\d{2}-[^/]+\.md$/.test(s)||
     ['docs/decisions/README.md','docs/solutions/architecture-patterns/fabric-dms-architecture-audit.md',
      'docs/solutions/architecture-patterns/image-asset-operations.md',
      'docs/ui-design/project-structure-audit.md'].includes(s)))fail('Not a process-history document: '+s);
 if(['product-positioning.md','wechat-card-share.md','ui-page-visual-review.md'].some(name=>s==='docs/ui-design/'+name))
  fail('Protected current UI rule: '+s);
 const retiredModuleIndex=s==='docs/product-master/product-master-v2-progress.md'&&
  entry.reason==='superseded'&&entry.replacement==='docs/project/项目现状.md';
 const mergedDecision=s==='docs/product-master/product-master-v2-b2-5-approved-decisions.md'&&
  entry.reason==='superseded'&&entry.replacement==='docs/project/数据与API.md';
 const retiredDecisionIndex=s==='docs/decisions/README.md'&&
  entry.reason==='superseded'&&entry.replacement==='docs/project/项目设计.md';
 if(/\/README\.md$|requirements\.md$|progress\.md$|approved-decisions\.md$/.test(s)&&
    !retiredModuleIndex&&!mergedDecision&&!retiredDecisionIndex)
  fail('Protected business/decision/status document: '+s);
 if(!fs.existsSync(documentPath(s)))fail('Original is missing; review before removal: '+s);
 if(entry.reason!=='superseded'&&entry.reason!=='fully_accepted')fail('Explicit archive reason required: '+s);
 if(typeof entry.replacement!=='string'||s===entry.replacement)fail('Independent replacement required: '+s);
 mustReadDoc(entry.replacement);
 const evidence=mustReadDoc(entry.evidence);
 if(typeof entry.evidence_phrase!=='string'||entry.evidence_phrase.length<12||!evidence.includes(entry.evidence_phrase))
  fail('Missing review or completion evidence: '+s);
 if(entry.unique_information_reviewed!==true||entry.open_gates_reviewed!==true)
  fail('Explicit unique-facts and pending-gates review required: '+s);
 if(!Array.isArray(entry.retained_facts)||entry.retained_facts.length===0)
  fail('At least one retained unique constraint or lesson must be linked: '+s);
 for(const f of entry.retained_facts){
  if(typeof f.phrase!=='string'||f.phrase.length<8||!mustReadDoc(f.file).includes(f.phrase))
   fail('Retained fact is not findable in current docs: '+s);
 }
 if(!Array.isArray(entry.pending_gates))fail('Declare pending_gates, even if empty: '+s);
 if(entry.reason==='fully_accepted'){
  if(entry.acceptance_confirmed!==true||entry.pending_gates.length)
   fail('Fully accepted work cannot retain pending gates or lack acceptance confirmation: '+s);
 }
 for(const gate of entry.pending_gates){
  if(typeof gate.phrase!=='string'||gate.phrase.length<8||!mustReadDoc(gate.file).includes(gate.phrase))
   fail('Open Gate has no durable replacement: '+s);
 }
 if(!/^[0-9a-f]{64}$/.test(entry.sha256))fail('SHA256 required: '+s);
 if(typeof entry.archive_copy!=='string'||!path.isAbsolute(entry.archive_copy))
  fail('Absolute external archive path required: '+s);
 const backup=path.resolve(entry.archive_copy),relative=path.relative(root,backup);
 if(!relative||relative==='.'||!relative.startsWith('..'+path.sep)&&relative!=='..')
  fail('Backup cannot reside inside the project: '+s);
 if(!fs.existsSync(backup)||!fs.lstatSync(backup).isFile())fail('Archived copy missing: '+s);
 const original=fs.readFileSync(documentPath(s)),copy=fs.readFileSync(backup);
 if(sha(original)!==entry.sha256||sha(copy)!==entry.sha256||original.length!==copy.length)
  fail('Original/archive hash mismatch: '+s);
 const links=linkedFromOtherDocs(s,excluded);
 if(links.length)fail('Current Markdown links still refer to '+s+' from '+links.join(', '));
 return {source:s,sha256:entry.sha256,reason:entry.reason};
}
try{
 const [, ,planFile]=process.argv;
 if(!planFile||process.argv.length!==3)fail('Usage: node scripts/check-fabric-v2-doc-archive.mjs <review-plan.json>');
 const plan=JSON.parse(fs.readFileSync(path.resolve(planFile),'utf8'));
 if(plan.format!=='fabric-v2-doc-archive-plan-v1'||!Array.isArray(plan.entries)||plan.entries.length<1)
  fail('Invalid archive review-plan format');
 const excluded=new Set(plan.entries.map(x=>documentPath(x.source)));
 const seen=new Set();
 for(const entry of plan.entries){
  if(seen.has(entry.source))fail('Duplicate source: '+entry.source);
  seen.add(entry.source);
  const result=evaluate(entry,excluded);
  console.log('PASS '+result.source+' ['+result.reason+']');
 }
 console.log('PASS '+plan.entries.length+' document(s) ready for separately authorized selective archival');
}catch(error){
 console.log('FAIL '+String(error?.message||error));
 process.exitCode=2;
}
