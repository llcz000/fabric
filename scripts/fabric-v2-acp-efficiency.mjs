/** ACP efficiency event ledger: observed milestones, not estimated gains.
 * CLI: node scripts/fabric-v2-acp-efficiency.mjs begin RUN ROLE AC
 *      node scripts/fabric-v2-acp-efficiency.mjs mark RUN red|green|agent_done|blocked [TEST_COUNT]
 *      node scripts/fabric-v2-acp-efficiency.mjs verify|salvage RUN TESTS CHANGED_FILES REWORK [OBSERVED_USED_TOKENS]
 *      node scripts/fabric-v2-acp-efficiency.mjs report
 * Event timestamps are recorded by the current host, not supplied by Agent.
 * No prompts, client data, credentials, paths, or raw identifiers persisted.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const allowed=['started','red','green','agent_done','agent_cancelled','verified','salvaged','blocked'];
const roles=['A','B','C','D','E','MAIN'];
const stampDate=v=>{
 if(!(v instanceof Date)||!Number.isFinite(v.getTime()))throw Error('Time source invalid');
 return v.toISOString();
};
const number=v=>Number.isSafeInteger(v)&&v>=0;
const cleanRun=v=>typeof v==='string'&&/^[a-z0-9][a-z0-9-]{2,89}$/.test(v);
function assertEvent(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid event');
 if(Object.keys(input).some(k=>!['run','role','ac','kind','tests','changedFiles','rework','tokens'].includes(k)))
  throw Error('Unknown event field');
 if(!cleanRun(input.run)||!roles.includes(input.role)||
  !/^(?:AC|SCAN|QUERY|STATS|DOC|EX)-[0-9]{2,3}$/.test(input.ac)||!allowed.includes(input.kind))
  throw Error('Invalid event identity');
 const isTerminal=input.kind==='verified'||input.kind==='salvaged';
 if(['red','green','verified','salvaged'].includes(input.kind)&&!number(input.tests))
  throw Error('Missing valid tests count');
 if(!['red','green','verified','salvaged'].includes(input.kind)&&input.tests!==undefined)
  throw Error('Tests not applicable');
 if(isTerminal&&(!number(input.changedFiles)||!number(input.rework)))
  throw Error('Verified delivery requires changedFiles and rework');
 if(!isTerminal&&(input.changedFiles!==undefined||input.rework!==undefined||input.tokens!==undefined))
  throw Error('Metrics only allowed at verification');
 if(input.tokens!==undefined&&!number(input.tokens))throw Error('Invalid reported tokens');
}
function load(file){
 if(!fs.existsSync(file))return [];
 const bytes=fs.readFileSync(file,'utf8');
 if(bytes.length>2_000_000)throw Error('Efficiency log too large');
 const rows=bytes.split(/\r?\n/).filter(Boolean);
 const events=[];
 for(const row of rows){
  const v=JSON.parse(row);
  const {observedAt:storedAt,...event}=v;
  assertEvent(event);
  if(typeof v.observedAt!=='string' || !Number.isFinite(Date.parse(v.observedAt)))throw Error('Invalid ledger timestamp');
  events.push(v);
 }
 return events;
}
function currentState(events,run){
 const all=events.filter(e=>e.run===run);
 return all.map(x=>x.kind);
}
function ensureSequence(events,input){
 const all=events.filter(e=>e.run===input.run);
 if(all.some(e=>e.role!==input.role||e.ac!==input.ac))throw Error('Run identity changed');
 const kinds=currentState(events,input.run);
 if(input.kind==='started'){
  if(kinds.length)throw Error('Duplicate start');
  return;
 }
 if(!kinds.includes('started'))throw Error('Run must be started first');
 if(kinds.includes('verified')||kinds.includes('salvaged')||kinds.includes('blocked'))throw Error('Terminal run cannot accept more events');
 if(kinds.includes(input.kind))throw Error('Duplicate event');
 const previous=kinds.at(-1);
 const must={
  red:['started'],green:['red'],agent_done:['started','red','green'],
  agent_cancelled:['started','red','green'],
  verified:['agent_done'],salvaged:['agent_cancelled'],
  blocked:['started','red','green','agent_done','agent_cancelled'],
 };
 if(!must[input.kind].includes(previous))throw Error('Invalid event sequence');
}
export function recordEvent(file,input,clock=()=>new Date()){
 assertEvent(input);
 const events=load(file);
 ensureSequence(events,input);
 const observedAt=stampDate(clock());
 if(events.some(e=>e.run===input.run&&Date.parse(observedAt)<Date.parse(e.observedAt)))
  throw Error('Nonmonotonic clock');
 const persisted={...input,observedAt};
 fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.appendFileSync(file,JSON.stringify(persisted)+'\n',{encoding:'utf8',flag:'a'});
 return persisted;
}
export function summarizeEfficiency(file){
 const events=load(file),byRun=new Map();
 for(const e of events){
  if(!byRun.has(e.run))byRun.set(e.run,[]);
  byRun.get(e.run).push(e);
 }
 let completedDeliveries=0,salvagedDeliveries=0,agentSuccessfulDeliveries=0;
 let verifiedTests=0,totalRework=0,verifiedFiles=0,reportedTokens=0,tokenReports=0;
 const runs=[];
 for(const [run,rows] of byRun){
  const get=key=>rows.find(e=>e.kind===key);
  const start=get('started'),red=get('red'),green=get('green'),done=get('agent_done');
  const verified=get('verified'),salvaged=get('salvaged'),cancelled=get('agent_cancelled'),blocked=get('blocked');
  const delivered=verified??salvaged;
  if(!start)throw Error('Orphan run');
  const diff=(a,b)=>a&&b?(Date.parse(b.observedAt)-Date.parse(a.observedAt))/1000:null;
  if(delivered){
   completedDeliveries++;if(salvaged)salvagedDeliveries++;else agentSuccessfulDeliveries++;
   verifiedTests+=delivered.tests;totalRework+=delivered.rework;
   verifiedFiles+=delivered.changedFiles;
   if(delivered.tokens!==undefined){reportedTokens+=delivered.tokens;tokenReports++;}
  }
  runs.push({run,role:start.role,ac:start.ac,status:verified?'verified':salvaged?'salvaged':blocked?'blocked':cancelled?'agent_cancelled':done?'agent_done':'active',
   verified:Boolean(delivered),agentCompleted:Boolean(done),
   wallSeconds:diff(start,delivered??blocked??cancelled??done??green??red),
   secondsToRed:diff(start,red),secondsAgentWork:diff(start,done??cancelled),
   integrationSeconds:diff(done??cancelled,delivered),
   testCount:delivered?.tests??null,changedFiles:delivered?.changedFiles??null,
   rework:delivered?.rework??null,tokens:delivered?.tokens??null});
 }
 return {format:'fabric-v2-acp-efficiency-v1',sampleRuns:runs.length,
  completedDeliveries,agentSuccessfulDeliveries,salvagedDeliveries,
  speedupPercent:null,serialBaselineAvailable:false,
  aggregate:{verifiedTests,totalRework,verifiedFiles,reportedTokens:tokenReports?reportedTokens:null,tokenReports},
  runs};
}
const defaultFile=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../docs/product-master/fabric-v2-acp-efficiency-events.jsonl');
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [action,run,arg1,arg2,arg3,arg4]=process.argv.slice(2);
  if(action==='report'&&process.argv.length===3)console.log(JSON.stringify(summarizeEfficiency(defaultFile),null,2));
  else if(action==='begin'&&process.argv.length===6){
   console.log(JSON.stringify(recordEvent(defaultFile,{run,role:arg1,ac:arg2,kind:'started'})));
  }else if(action==='mark'&&(process.argv.length===5||process.argv.length===6)){
   const existing=load(defaultFile).find(e=>e.run===run&&e.kind==='started');
   if(!existing)throw Error('Unknown run');
   console.log(JSON.stringify(recordEvent(defaultFile,{run,role:existing.role,ac:existing.ac,
    kind:arg1,...(arg2===undefined?{}:{tests:Number(arg2)})})));
  }else if(['verify','salvage'].includes(action)&&[7,8].includes(process.argv.length)){
   const existing=load(defaultFile).find(e=>e.run===run&&e.kind==='started');
   if(!existing)throw Error('Unknown run');
   console.log(JSON.stringify(recordEvent(defaultFile,{run,role:existing.role,ac:existing.ac,
    kind:action==='salvage'?'salvaged':'verified',tests:Number(arg1),changedFiles:Number(arg2),rework:Number(arg3),
    ...(arg4===undefined?{}:{tokens:Number(arg4)})})));
  }else throw Error('Usage: begin RUN ROLE AC | mark RUN KIND [TESTS] | verify RUN TESTS FILES REWORK | report');
 }catch(e){console.error('ACP metrics refused: '+String(e.message));process.exitCode=2;}
}
