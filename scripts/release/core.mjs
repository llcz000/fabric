import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const hash=b=>createHash('sha256').update(b).digest('hex');
export const commands=new Set(['help','test','plan','prepare','preflight','rehearse','deploy','verify','rollback','status','report','run','resume','baseline']);
export function parseArgs(argv){
 const [first='help',...rest]=argv;const command=['--help','-h'].includes(first)?'help':first;if(!commands.has(command))throw Error('Unknown release command');
 const result={command,id:undefined,migrations:[],rehearse:false};
 for(let i=0;i<rest.length;i++){const v=rest[i];if(v==='--quick-ui'&&['prepare','run'].includes(command))result.quickUi=true;else if(v==='--rehearse')result.rehearse=true;else if(v==='--from-release'&&['prepare','run'].includes(command)){result.fromRelease=rest[++i];if(!result.fromRelease||result.fromRelease.startsWith('-'))throw Error('Published release evidence required');}else if(v==='--evidence'&&command==='baseline'){result.evidence=rest[++i];if(!result.evidence||result.evidence.startsWith('-'))throw Error('Evidence path required');}else if(v==='--migrations'){if(!rest[i+1])throw Error('Missing migration IDs');result.migrations=rest[++i].split(',');if(!result.migrations.length||new Set(result.migrations).size!==result.migrations.length||result.migrations.some(x=>!['business-simplification','card-share','light-customers','customer-v12','fabric-deletion','pattern-deletion','pattern-number-reuse','fabric-number-nonempty'].includes(x)))throw Error('Unknown/duplicate migration');}else if(!v.startsWith('-')&&!result.id&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(v))result.id=v;else throw Error('Unknown/unsafe argument');}
 if(!['help','test','plan','prepare','run','baseline'].includes(command)&&!result.id)throw Error('Release ID required');
 if((!['prepare','run'].includes(command)||command==='run'&&result.id)&&(result.migrations.length||result.rehearse||result.fromRelease||result.quickUi))throw Error('Preparation flags require a new prepare/run');return result;
}
export function validateProfile(p){
 const keys=['name','url','production','stageRoot','backupRoot','process','recoveryProcess','starter','nginx','database','serverUuid','port','recoveryPort','sshConfig'];
 if(!p||Object.keys(p).length!==keys.length||keys.some(k=>!(k in p)))throw Error('Invalid release profile fields');
 for(const k of ['production','stageRoot','backupRoot','nginx'])if(typeof p[k]!=='string'||!p[k].startsWith('/')||path.posix.normalize(p[k])!==p[k]||!/^[\w/.-]+$/.test(p[k])||p[k].split('/').length<3)throw Error('Unsafe target '+k);
 if(p.production===p.stageRoot||p.production.startsWith(p.stageRoot+'/')||p.stageRoot.startsWith(p.production+'/'))throw Error('Release and production directories overlap');
 for(const k of ['name','process','recoveryProcess','starter','database'])if(typeof p[k]!=='string'||!(/^[A-Za-z0-9_-]+(?:\.cjs)?$/).test(p[k]))throw Error('Unsafe identity '+k);
 if(p.process===p.recoveryProcess||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(p.serverUuid))throw Error('Invalid physical target identity');
 for(const k of ['port','recoveryPort'])if(!Number.isInteger(p[k])||p[k]<1024||p[k]>65535)throw Error('Invalid port');
 const u=new URL(p.url);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Unsafe public URL');
 if(typeof p.sshConfig!=='string'||!path.isAbsolute(p.sshConfig))throw Error('SSH configuration must be an absolute local path');return p;
}
export function assertWritable(r){if(!r||Array.isArray(r)||r.mode!=='v2'||('readOnly' in r&&r.readOnly!==false))throw Error('Invalid writable V2 runtime contract');}
export function safeRelative(name){if(typeof name!=='string'||!name||name.includes('\\')||name.startsWith('/')||name.split('/').some(x=>!x||x==='.'||x==='..')||!(/^[A-Za-z0-9_./-]+$/).test(name))throw Error('Unsafe artifact path');return name;}
export function collectBrowserFiles(dist){
 if(!fs.lstatSync(path.join(dist,'index.html')).isFile())throw Error('Index must be a regular file');
 const names=new Set(['index.html']);const files=(dir,prefix)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const n=prefix+e.name;if(e.isSymbolicLink())throw Error('Browser asset symlink');if(e.isDirectory())throw Error('Nested assets are outside the production static allowlist');else if(e.isFile()){if(!(/\.(?:js|css|woff2?|png|jpe?g|webp|svg|ico)$/).test(n))throw Error('Unsupported browser asset '+n);names.add(n);}}};
 if(fs.existsSync(path.join(dist,'assets')))files(path.join(dist,'assets'),'assets/');
 function ref(raw,owner){if(!raw||/^(?:https?:|data:|blob:|#|\/\/)/i.test(raw))return;const clean=decodeURIComponent(raw.split(/[?#]/)[0]);const name=clean.startsWith('/')?clean.slice(1):path.posix.join(path.posix.dirname(owner),clean);if(name==='..'||name.startsWith('../'))throw Error('Resource outside dist');safeRelative(name);if(!name.startsWith('assets/')&&!['index.html','favicon.ico','favicon.svg'].includes(name)&&!/^favicon-[a-f0-9]{8}\.svg$/.test(name))throw Error('Resource is outside public static allowlist: '+name);if(!fs.existsSync(path.join(dist,name)))throw Error('Missing browser resource '+name);if(fs.lstatSync(path.join(dist,name)).isSymbolicLink())throw Error('Resource symlink');names.add(name);}
 const html=fs.readFileSync(path.join(dist,'index.html'),'utf8');for(const m of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g))ref(m[1],'index.html');
 for(const name of [...names])if(name.endsWith('.css'))for(const m of fs.readFileSync(path.join(dist,name),'utf8').matchAll(/url\(\s*["']?([^\s)'";]+)["']?\s*\)/g))ref(m[1],name);
 for(const name of [...names])if(name.endsWith('.js'))for(const m of fs.readFileSync(path.join(dist,name),'utf8').matchAll(/(?:import\s*\(|from\s*)["'](\.[^"']+)["']/g))ref(m[1],name);
 return [...names].sort();
}
export function verifyFiles(root,files){for(const [name,want]of Object.entries(files)){safeRelative(name);const f=path.join(root,name);if(!fs.existsSync(f)||!fs.lstatSync(f).isFile()||hash(fs.readFileSync(f))!==want.sha256||fs.statSync(f).size!==want.size)throw Error('Frozen artifact drift: '+name);}}
export async function runPhases(state,phases,run,save=()=>{}){
 for(const phase of phases){const old=state[phase];if(old?.status==='passed')continue;if(old?.status==='running')throw Error('Stage outcome uncertain: '+phase+'; inspect status before recovery');if(old?.status==='failed')throw Error('Stage failed: '+phase+'; inspect evidence before retry');const start=Date.now();state[phase]={status:'running',startedAt:new Date().toISOString()};save();try{const result=await run(phase);state[phase]={status:'passed',durationMs:Date.now()-start,result};save();}catch(e){state[phase]={status:'failed',durationMs:Date.now()-start,error:e.message};save();throw e;}}
 return state;
}
export function phasePlan(command,rehearse=false){
 if(['verify','rollback'].includes(command))return [command];if(['status','report','plan','help','baseline','test','prepare'].includes(command))return [];
 const ordered=['upload','preflight','backup','offsite',...(rehearse||command==='rehearse'?['rehearse']:[]),'deploy','verify'];
 const last=['run','resume','deploy'].includes(command)?'verify':command;if(!ordered.includes(last))throw Error('No phase plan');return ordered.slice(0,ordered.indexOf(last)+1);
}
export function assertPublishedEvidence(e,a,b){
 if(e.state!=='released'||e.artifactSha256!==a.sha256||e.artifactSha256!==b.archiveSha256||e.indexSha256!==b.index||e.backendSha256!==b.backend||a.manifest.files['dist/index.html']?.sha256!==b.index||a.manifest.files['dist/server.cjs']?.sha256!==b.backend)throw Error('Reuse is limited to the currently verified published version');
}

export function releaseTimingReport(run){
 const phases=Object.fromEntries(Object.entries(run.phases??{}).map(([name,s])=>[name,{status:s.status,durationMs:s.durationMs??0,...(s.error?{error:s.error}:{})}]));
 const duration=(s)=>Number.isFinite(s.durationMs)&&s.durationMs>=0?s.durationMs:0;
 return {id:run.id,preparationMs:run.preparedMs??0,preparation:run.preparation??null,phases,measuredTotalMs:(run.preparedMs??0)+Object.values(phases).reduce((n,s)=>n+duration(s),0),failedStageMs:Object.values(phases).filter(s=>s.status==='failed').reduce((n,s)=>n+duration(s),0),rolledBack:run.rolledBack===true,automaticRollback:run.automaticRollback??null,note:'Recorded local stage intervals only; excludes human/debugging gaps and does not add nested remote work again.'};
}
export function recordRollbackReceipt(run,receipt){
 if(receipt&&typeof receipt==='object')run.automaticRollback=receipt;
 if(receipt?.state==='code-rolled-back'&&receipt.databaseRestored===false&&receipt.newTablesAndBusinessWritesPreserved===true)run.rolledBack=true;
 return run;
}
export function validateHttpContract(c){
 const route=p=>typeof p==='string'&&/^\/[a-z0-9]+(?:[-/][a-z0-9]+)*$/.test(p);
 if(!c||c.version!==1||Object.keys(c).sort().join(',')!=='anonymousDenied,retiredRoutes,version'||!Array.isArray(c.retiredRoutes)||!Array.isArray(c.anonymousDenied)||!c.retiredRoutes.length||!c.anonymousDenied.length||c.retiredRoutes.some(r=>!r||Object.keys(r).sort().join(',')!=='path,status'||!route(r.path)||![404,410].includes(r.status))||c.anonymousDenied.some(p=>!route(p))||new Set([...c.retiredRoutes.map(r=>r.path),...c.anonymousDenied]).size!==c.retiredRoutes.length+c.anonymousDenied.length)throw Error('Invalid release HTTP contract');
 return c;
}

/** A new deletion writer requires its schema/data migration; no silent table creation at runtime. */
export function requireBusinessSimplificationMigration(changed,migrations){
 if(changed.includes('server/audit/deletionAudit.ts')&&!migrations.includes('business-simplification'))throw Error('This candidate requires --migrations business-simplification and isolated restore rehearsal');
}
