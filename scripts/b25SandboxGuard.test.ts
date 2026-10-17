import assert from 'node:assert/strict';
import test from 'node:test';
import {assertFreshB25SandboxTarget,B25_SANDBOX_NAME} from './b25SandboxGuard';
const PIN='3f3fa763-c4b5-4f65-99b8-95ae90e912a4';

function root(config:{selected?:string|null;version?:string;uuid?:string;existing?:boolean}={}){
 const calls:{sql:string;params?:unknown[]}[]=[];
 const db={async query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>{
  calls.push({sql,params});
  assert.match(sql,/^SELECT\s/,'guard must not write remote MySQL');
  if(sql==='SELECT DATABASE() AS selected_database, VERSION() AS mysql_version, @@server_uuid AS server_uuid')
   return [[{selected_database:config.selected??null,mysql_version:config.version??'8.0.46',server_uuid:config.uuid??PIN}],[]];
  if(sql==='SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME=?')
   return [config.existing?[{SCHEMA_NAME:B25_SANDBOX_NAME}]:[],[]];
  throw Error('Unsupported SQL');
 }};
 return {db,calls};
}
test('B2-5f exact acknowledged fresh sandbox is the only target; preflight uses just SELECT',async()=>{
 const r=root();
 assert.equal(await assertFreshB25SandboxTarget(r.db,'I_ACKNOWLEDGE_B25_DISPOSABLE_TEST',PIN),B25_SANDBOX_NAME);
 assert.equal(r.calls.length,2);
 assert.deepEqual(r.calls[1].params,[B25_SANDBOX_NAME]);
 assert(r.calls.every(c=>/^SELECT\s/.test(c.sql)));
});
test('B2-5f no acknowledgment and incorrect acknowledgment refuse before connecting',async()=>{
 for(const ack of ['', 'I_ACKNOWLEDGE_SANDBOX','yes']){
  const r=root();
  await assert.rejects(assertFreshB25SandboxTarget(r.db,ack,PIN),/explicit|acknowledge|test/i);
  assert.deepEqual(r.calls,[]);
 }
});
test('B2-5f preflight refuses a preexisting sandbox without touching it',async()=>{
 const r=root({existing:true});
 await assert.rejects(assertFreshB25SandboxTarget(r.db,'I_ACKNOWLEDGE_B25_DISPOSABLE_TEST',PIN),/exists|already|occupied/i);
 assert.equal(r.calls.length,2);
});
test('B2-5f selected business database and non-MySQL8 targets refuse before schema probe',async()=>{
 for(const r of [root({selected:'fabric_db'}),root({version:'5.7.42'}),root({uuid:''})]){
  await assert.rejects(assertFreshB25SandboxTarget(r.db,'I_ACKNOWLEDGE_B25_DISPOSABLE_TEST',PIN),/target|identity|MySQL|version|UUID/i);
  assert.equal(r.calls.length,1);
 }
});
test('B2-5f guards fail closed for malformed metadata',async()=>{
 const bad={query:async():Promise<[unknown,unknown]>=>[[],[]]};
 await assert.rejects(assertFreshB25SandboxTarget(bad,'I_ACKNOWLEDGE_B25_DISPOSABLE_TEST',PIN),/identity|target|unavailable/i);
});
