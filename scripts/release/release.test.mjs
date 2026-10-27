import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateProfile,assertWritable,collectBrowserFiles,verifyFiles,runPhases,parseArgs,hash,phasePlan,assertPublishedEvidence,releaseTimingReport,recordRollbackReceipt} from './core.mjs';
const profile={name:'production',url:'https://124.223.97.60',production:'/opt/fabric-v2-production-20261019-11910f5f',stageRoot:'/opt/fabric-releases',backupRoot:'/var/backups/fabric',process:'fabric-v2-production-20261019',recoveryProcess:'fabric-v2-production-readonly-20261019',starter:'start-v2.cjs',nginx:'/etc/nginx/sites-enabled/fabric',database:'fabric_db',serverUuid:'a937ff09-72b6-11f1-b04e-52540034488b',port:3008,recoveryPort:3009,sshConfig:'D:/fabric/.local/server/_config/ssh.local.json'};
test('strict writable contract accepts missing/false only',()=>{for(const r of [{mode:'v2'},{mode:'v2',readOnly:false}])assertWritable(r);for(const r of [null,[],{mode:'v1'},{mode:'v2',readOnly:true},{mode:'v2',readOnly:0},{mode:'v2',readOnly:'false'},{mode:'v2',readOnly:null}])assert.throws(()=>assertWritable(r));});
test('profile rejects unsafe target paths, identifiers, URLs and unexpected fields',()=>{assert.deepEqual(validateProfile(profile),profile);for(const change of [{production:'/opt/../etc'},{production:'/opt'},{stageRoot:'/opt'},{database:'fabric_db; DROP DATABASE x'},{process:'x;id'},{url:'https://user:password@host'},{port:'3008'},{nginx:'/etc/../tmp/x'},{extra:true}])assert.throws(()=>validateProfile({...profile,...change}));});
test('CLI rejects arbitrary commands and unknown flags',()=>{assert.deepEqual(parseArgs(['status','abc123']),{command:'status',id:'abc123',migrations:[],rehearse:false});assert.throws(()=>parseArgs(['exec','rm']));assert.throws(()=>parseArgs(['run','--skip-backup']));assert.throws(()=>parseArgs(['deploy','../x']));assert.throws(()=>parseArgs(['prepare','--migrations','unknown']));});
test('explicit quick UI flag is only for a fresh run or prepare',()=>{
 assert.equal(parseArgs(['run','--quick-ui']).quickUi,true);
 assert.equal(parseArgs(['prepare','--quick-ui']).quickUi,true);
 assert.throws(()=>parseArgs(['run','existing','--quick-ui']),/Preparation flags/);
 assert.throws(()=>parseArgs(['deploy','existing','--quick-ui']),/Unknown/);
});
function fixture(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-release-'));try{fs.mkdirSync(path.join(dir,'assets'));fs.writeFileSync(path.join(dir,'index.html'),'<link rel="icon" href="/favicon.svg"><script src="/assets/app.js"></script><link href="/assets/app.css" rel="stylesheet">');fs.writeFileSync(path.join(dir,'favicon.svg'),'<svg/>');fs.writeFileSync(path.join(dir,'assets/app.js'),'export {};');fs.writeFileSync(path.join(dir,'assets/app.css'),'.a{background:url(./sample.png)}');fs.writeFileSync(path.join(dir,'assets/sample.png'),'png');fs.writeFileSync(path.join(dir,'server.cjs'),'private backend');return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
test('browser manifest includes actual root favicon and CSS dependencies but excludes backend',()=>fixture(dir=>{const names=collectBrowserFiles(dir);assert(names.includes('favicon.svg'));assert(names.includes('assets/sample.png'));assert(!names.includes('server.cjs'));}));
test('content-addressed favicon is accepted without overwriting an existing immutable favicon',()=>fixture(dir=>{
 const html=path.join(dir,'index.html');
 fs.writeFileSync(html,'<link rel="icon" href="/favicon-6dc80a36.svg"><script src="/assets/app.js"></script><link href="/assets/app.css" rel="stylesheet">');
 fs.writeFileSync(path.join(dir,'favicon-6dc80a36.svg'),'<svg/>');
 const files=collectBrowserFiles(dir);
 assert(files.includes('favicon-6dc80a36.svg'));
 assert(!files.includes('favicon.svg'));
 fs.writeFileSync(html,fs.readFileSync(html,'utf8').replace('favicon-6dc80a36.svg','favicon-unversioned.svg'));
 assert.throws(()=>collectBrowserFiles(dir),/static allowlist/);
}));
test('missing favicon is rejected before upload or service restart',()=>fixture(dir=>{fs.unlinkSync(path.join(dir,'favicon.svg'));assert.throws(()=>collectBrowserFiles(dir),/favicon/);}));
test('missing CSS dependency and traversal are rejected locally',()=>fixture(dir=>{fs.unlinkSync(path.join(dir,'assets/sample.png'));assert.throws(()=>collectBrowserFiles(dir),/sample/);fs.writeFileSync(path.join(dir,'assets/app.css'),'url(../../secret.png)');assert.throws(()=>collectBrowserFiles(dir),/outside/);}));
test('frozen artifact rejects changed, missing or escaped paths',()=>fixture(dir=>{const files={'index.html':{sha256:hash(fs.readFileSync(path.join(dir,'index.html'))),size:fs.statSync(path.join(dir,'index.html')).size}};verifyFiles(dir,files);fs.appendFileSync(path.join(dir,'index.html'),'changed');assert.throws(()=>verifyFiles(dir,files));assert.throws(()=>verifyFiles(dir,{'../x':files['index.html']}));}));
test('migration pipeline orders backup, offsite readback and restore before installation',async()=>{const calls=[],state={};await runPhases(state,['preflight','backup','offsite','rehearse','deploy','verify'],async p=>{calls.push(p);return {ok:true};});assert.deepEqual(calls,['preflight','backup','offsite','rehearse','deploy','verify']);assert.equal(state.verify.status,'passed');});
test('resume skips successful stages and never automatically retries an uncertain mutation',async()=>{const calls=[],state={preflight:{status:'passed'},backup:{status:'running'}};await assert.rejects(runPhases(state,['preflight','backup','deploy'],async p=>calls.push(p)),/uncertain/);assert.deepEqual(calls,[]);});
test('failed preflight stops before backup and install, retaining a concise failure receipt',async()=>{const calls=[],state={};await assert.rejects(runPhases(state,['preflight','backup','deploy'],async p=>{calls.push(p);throw Error('identity drift');}),/identity drift/);assert.deepEqual(calls,['preflight']);assert.equal(state.preflight.status,'failed');assert.match(state.preflight.error,/identity drift/);});
test('resume does not silently retry failed stages',async()=>{await assert.rejects(runPhases({deploy:{status:'failed'}},['deploy'],async()=>{}),/failed/);});
test('read-only commands never include deploy; migrations force restore before installation',()=>{assert.deepEqual(phasePlan('verify'),['verify']);assert.deepEqual(phasePlan('status'),[]);assert.deepEqual(phasePlan('report'),[]);assert.equal(parseArgs(['report','abc123']).command,'report');assert.deepEqual(phasePlan('preflight'),['upload','preflight']);assert.deepEqual(phasePlan('rehearse'),['upload','preflight','backup','offsite','rehearse']);const p=phasePlan('deploy',true);assert(p.indexOf('rehearse')<p.indexOf('deploy'));assert(!phasePlan('deploy').includes('rehearse'));});
test('nested assets are rejected before deployment because the application serves flat asset names',()=>fixture(dir=>{fs.mkdirSync(path.join(dir,'assets/nested'));fs.writeFileSync(path.join(dir,'assets/nested/app.js'),'');assert.throws(()=>collectBrowserFiles(dir),/static allowlist/);}));
test('resuming an immutable release cannot silently change its migration plan',()=>{assert.throws(()=>parseArgs(['run','existing','--migrations','card-share']));assert.throws(()=>parseArgs(['run','existing','--rehearse']));assert.deepEqual(parseArgs(['--help']).command,'help');});
test('published artifact reuse must match the verified archive and actual program digests',()=>{const e={state:'released',artifactSha256:'archive',indexSha256:'index',backendSha256:'backend'},a={sha256:'archive',manifest:{files:{'dist/index.html':{sha256:'index'},'dist/server.cjs':{sha256:'backend'}}}},b={archiveSha256:'archive',index:'index',backend:'backend'};assertPublishedEvidence(e,a,b);assert.throws(()=>assertPublishedEvidence({...e,artifactSha256:'other'}, {...a,sha256:'other'},b));assert.throws(()=>assertPublishedEvidence(e,{...a,manifest:{files:{'dist/index.html':{sha256:'different'},'dist/server.cjs':{sha256:'backend'}}}},b));});

test('timing report sums non-overlapping recorded stages and counts failures without nested verification twice',()=>{
 const run={id:'fixture',preparedMs:8,phases:{deploy:{status:'failed',durationMs:11,result:{verification:{durationMs:99}}},verify:{status:'passed',durationMs:5}},rolledBack:true};const result=releaseTimingReport(run);assert.equal(result.measuredTotalMs,24);assert.equal(result.failedStageMs,11);assert.equal(result.rolledBack,true);assert.equal(result.phases.deploy.durationMs,11);
});
test('confirmed automatic rollback is retained locally and prevents treating the failed release as resumable',()=>{
 const run={};recordRollbackReceipt(run,{state:'code-rolled-back',databaseRestored:false,newTablesAndBusinessWritesPreserved:true});assert.equal(run.rolledBack,true);assert.equal(run.automaticRollback.databaseRestored,false);const unknown={};recordRollbackReceipt(unknown,{state:'guarded-rollback-failed'});assert.notEqual(unknown.rolledBack,true);assert.equal(unknown.automaticRollback.state,'guarded-rollback-failed');
});

test('UI browser release gate runs from the single repository root, not a retired parent workspace',()=>{
 const cli=fs.readFileSync(new URL('./cli.mjs',import.meta.url),'utf8');
 assert.match(cli,/npm run test:ui:ux/);
 assert.doesNotMatch(cli,/npm --prefix \.\.\/\.\. run test:ui:ux/);
});

test('business simplification requires its registered migration before building a new delete writer',async()=>{const {requireBusinessSimplificationMigration}=await import('./core.mjs');assert.throws(()=>requireBusinessSimplificationMigration(['server/audit/deletionAudit.ts'],[]),/requires/);assert.doesNotThrow(()=>requireBusinessSimplificationMigration(['server/audit/deletionAudit.ts'],['business-simplification']));assert.deepEqual(parseArgs(['prepare','--migrations','business-simplification']).migrations,['business-simplification']);});
test('automatic product cards require their registered supplement before release',async()=>{
 const {requireProductCardsMigration}=await import('./core.mjs');
 assert.deepEqual(parseArgs(['prepare','--migrations','product-auto-cards']).migrations,['product-auto-cards']);
 assert.throws(()=>requireProductCardsMigration(['server/product-master/productsV2.ts'],[]),/requires/);
 assert.doesNotThrow(()=>requireProductCardsMigration(['server/product-master/productsV2.ts'],['product-auto-cards']));
});
