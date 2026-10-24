// Read-only Fabric documentation navigation contract. Never starts services or touches databases.
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const pointer=JSON.parse(fs.readFileSync(path.join(root,'docs/project/fabric-v2-active-workspace.json'),'utf8'));
const application=pointer.role==='application'?root:path.resolve(root,pointer.workspace);
const read=(rel)=>fs.readFileSync(path.join(root,rel),'utf8');
const checks=[];
const must=(name,check)=>{try{check();checks.push({name,ok:true});}
catch(error){checks.push({name,ok:false,reason:String(error.message)});}};
const assert=(condition,message)=>{if(!condition)throw Error(message);};
const has=(file,pattern)=>assert(pattern.test(read(file)),file+' missing '+pattern);
const stage='docs/product-master/README.md';
const home='docs/00-首页.md';
const classification='docs/文档分类与检索.md';
must('one current business spec and status',()=>{
 has(stage,/product-master-v2-requirements\.md/);
 has(stage,/product-master-v2-progress\.md/);
 const version=/^\|\s*版本\s*\|\s*(v[0-9]+\.[0-9]+)(?:\s|（|\|)/m.exec(read('docs/product-master/product-master-v2-requirements.md'))?.[1];
 assert(version,'Current requirement version absent');
 assert(read(stage).includes('V2唯一需求'+version),'Stage entry requirement version is stale');
});
must('stage-to-source/test/gate routing',()=>{
 has(home,/阶段任务/);
 has(stage,/## 阶段任务快速定位/);
 for(const word of ['P1','P2','P3','P4','P5','P6','P7','B1','B2','B3','Agent']){
  assert(read(stage).includes('| '+word+' '),'Stage routing missing: '+word);
 }
 for(const route of ['server/customer-samples/','server/customer-share/','server/order-v2/',
  'server/product-master/','src/components/product-master-v2/','scripts/run-ts-tests.mjs']){
  assert(read(stage).includes(route),'Source/test locator missing '+route);
 }
 has(stage,/正式接线|上线|迁移/);
});
must('all stage code/test locators exist',()=>{
 const section=read(stage).split('## 阶段任务快速定位')[1].split('## 开发与验收按专题看')[0];
 let checked=0;
 for(const line of section.split(/\r?\n/)){
  if(!/^\| (?:P[0-7]|B[1-3]|Agent) /.test(line))continue;
  for(const match of line.matchAll(/`([^`]+)`/g)){
   const loc=match[1].replace(/^node /,'').split(' ')[0];
   if(!loc.includes('/'))continue;
   checked++;
   assert(fs.existsSync(path.join(application,loc)),'Missing active stage source/test locator: '+loc);
  }
 }
 assert(checked>=20,'Stage code locator coverage suspiciously low');
 console.log('Checked '+checked+' code/test locators');
});
must('current agent source of truth',()=>{
 const guide=read('docs/product-master/product-master-v2-agent-context-handbook.md');
 assert(guide.includes('product-master-v2-requirements.md'),'Current requirement link absent');
 const version=/^\|\s*版本\s*\|\s*(v[0-9]+\.[0-9]+)(?:\s|（|\|)/m.exec(read('docs/product-master/product-master-v2-requirements.md'))?.[1];
 assert(version,'Current requirement version absent');
 for(const match of guide.matchAll(/现行\s*(v[0-9]+\.[0-9]+)/g)){
  assert(match[1]===version,'Outdated current requirement '+match[1]);
 }
 has('docs/development/Fabric并行开发与合并规范.md',/默认单 Agent/);
 has('docs/product-master/product-master-v2-agent-context-handbook.md',/fabric-v2-workspace-freshness/);
});
must('search synonyms for active workflows',()=>{
 const index=read(classification);
 for(const word of ['基线','SHA256','Agent','并发','扫码','移除','重扫','审计','迁移','单据','xlsx','授权']){
  assert(index.includes(word),'Keyword index missing '+word);
 }
});
must('ACP isolation and three-way merge gates',()=>{
 const guide='docs/product-master/product-master-v2-agent-context-handbook.md';
 for(const name of ['fabric-v2-acp-prepare.mjs','fabric-v2-acp-prepare.test.mjs',
  'fabric-v2-acp-merge-gate.mjs','fabric-v2-acp-merge-gate.test.mjs',
  'fabric-v2-workspace-freshness.mjs']){
  assert(fs.existsSync(path.join(application,'scripts',name)),'Missing ACP tool: '+name);
 }
 for(const word of ['coding_agent_start','coding_agent_observe','idempotency_key',
  'fabric-v2-acp-merge-gate.mjs','fabric-v2-acp-prepare.mjs','TDD','双重审查']){
  assert(read(guide).includes(word),'ACP handoff missing '+word);
 }
 has('AGENTS.md',/ACP协作强制执行/);
 has(guide,/SHA256三方检查/);
});
must('focused single-AC ACP intake after documentation cleanup',()=>{
 for(const file of ['scripts/fabric-v2-acp-task-intake.mjs','scripts/fabric-v2-acp-task-intake.test.mjs']){
  assert(fs.existsSync(path.join(application,file)),'Missing ACP intake tool/test: '+file);
 }
 has('AGENTS.md',/fabric-v2-acp-task-intake\.mjs/);
 has('docs/product-master/product-master-v2-agent-context-handbook.md',/更新后资料的 ACP 单AC派发检查/);
 has('docs/product-master/README.md',/fabric-v2-acp-task-intake\.mjs/);
});
must('observed ACP efficiency accounting stays required',()=>{
 for(const name of ['fabric-v2-acp-efficiency.mjs','fabric-v2-acp-efficiency.test.mjs']){
  assert(fs.existsSync(path.join(application,'scripts',name)),'Missing ACP measured-efficiency module: '+name);
 }
 has('AGENTS.md',/ACP实测收益强制记账/);
 has('docs/product-master/product-master-v2-agent-context-handbook.md',/持续衡量 ACP 收益/);
 has('docs/product-master/README.md',/fabric-v2-acp-efficiency\.mjs/);
});
must('current multi-agent orchestrator queue is discoverable and read-only by default',()=>{
 for(const name of ['scripts/fabric-v2-orchestrator.mjs','scripts/fabric-v2-orchestrator.test.mjs',
  'docs/project/fabric-v2-agent-queue.json','docs/project/Fabric-Multi-Agent-Orchestrator-V2.md']){
  assert(fs.existsSync(path.join(name.startsWith('scripts/')?application:root,name)),'Missing orchestrator component: '+name);
 }
 has('AGENTS.md',/Orchestrator V2/);
 has('docs/project/项目现状.md',/Fabric-Multi-Agent-Orchestrator-V2\.md/);
 has('docs/product-master/README.md',/fabric-v2-orchestrator\.mjs/);
 has('docs/project/Fabric-Multi-Agent-Orchestrator-V2.md',/尚未自动调用|尚未自动/);
});
must('mandatory task-completion archive policy',()=>{
 const archiveRule='docs/maintenance/知识维护规则.md';
 has('AGENTS.md',/强制任务收尾 Gate/);
 has(archiveRule,/## 任务完成后的强制归档 Gate/);
 for(const flag of ['fully_accepted','superseded','SHA256','review-plan.json','开放Gate','机器只读预检']){
  assert(read(archiveRule).includes(flag),'Archive policy missing '+flag);
 }
 for(const route of ['scripts/check-fabric-v2-doc-archive.mjs','scripts/check-fabric-v2-doc-archive.test.mjs']){
  assert(fs.existsSync(path.join(application,route)),'Archive preflight tool/test missing: '+route);
 }
 has('docs/development/开发与验证规范.md',/归档候选/);
 has('.agents/skills/fabric-product-master-v2/SKILL.md',/Mandatory doc-lifecycle handoff/);
 has('docs/Templates/开发复盘模板.md',/历史文档归档判定/);
 has('docs/product-master/product-master-v2-agent-context-handbook.md',/每项子任务收尾须给文档判定/);
});
must('valid local Markdown destinations and main navigation anchors',()=>{
 const sources=[];
 function walk(dir){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
   if(entry.name.startsWith('.')||entry.name==='history')continue;
   const f=path.join(dir,entry.name);
   if(entry.isDirectory())walk(f);
   else if(entry.isFile()&&f.endsWith('.md'))sources.push(f);
  }
 }
 walk(path.join(root,'docs'));
 let total=0;
 for(const source of sources){
  const lines=fs.readFileSync(source,'utf8').split(/\r?\n/);
  let fenced=false;
  for(let n=0;n<lines.length;n++){
   const line=lines[n];
   if(/^\s*(?:```|~~~)/.test(line)){fenced=!fenced;continue;}
   if(fenced)continue;
   for(const match of line.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)){
    const url=match[1].split(/\s+"/)[0];
    if(/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(url))continue;
    const [rel]=url.split('#');
    let decoded;try{decoded=decodeURI(rel);}catch{throw Error(source+':'+(n+1)+' bad URL encoding');}
    total++;
    assert(fs.existsSync(path.resolve(path.dirname(source),decoded)),source+':'+(n+1)+' missing '+rel);
   }
  }
 }
 assert(total>0&&[home,stage].every(file=>sources.includes(path.join(root,file))),'Current navigation entrypoints were not scanned');
 const slug=(s)=>s.toLowerCase().replace(/[`*_]/g,'').replace(/[^\p{L}\p{N}\s-]/gu,'').trim().replace(/\s+/g,'-');
 for(const file of [home,stage,'docs/retrospectives/README.md','docs/development/开发与验证规范.md']){
  for(const match of read(file).matchAll(/\]\(([^)]*#[^)]*)\)/g)){
   if(match[1].includes('://'))continue;
   const [rel,fragment]=match[1].split('#');
   if(!fragment)continue;
   const dest=path.resolve(path.dirname(path.join(root,file)),decodeURI(rel));
   if(!fs.existsSync(dest))continue;
   const content=read(path.relative(root,dest));
   const headings=content.split(/\r?\n/)
    .filter(x=>/^#{1,6} /.test(x)).map(x=>slug(x.replace(/^#{1,6} /,'')));
   // The canonical project overview uses explicit GitHub-compatible anchors
   // (e.g. <a id="roles"></a>). They are valid links, not heading slugs.
   const explicit=[...content.matchAll(/<a\s+id=["']([a-z][a-z0-9-]{0,80})["']\s*>\s*<\/a>/gi)]
    .map(x=>x[1]);
   assert([...headings,...explicit].includes(decodeURIComponent(fragment)),
    file+' broken heading anchor '+match[1]);
  }
 }
 console.log('Checked '+sources.length+' documentation files and '+total+' local links');
});
for(const check of checks)console.log((check.ok?'PASS ':'FAIL ')+check.name+(check.reason?': '+check.reason:''));
if(checks.some(x=>!x.ok))process.exitCode=1;
