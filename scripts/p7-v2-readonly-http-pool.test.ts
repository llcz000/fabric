import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type {Server} from 'node:http';
import {createV2CatalogAssembly} from '../server/product-master/v2CatalogAssembly';
import {createP7ReadonlyHttpPool} from './p7-v2-readonly-http-pool';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
// Load the existing ESM SSH reader only in the explicitly opted-in remote test.
// esbuild's CJS test runner must not bundle its import.meta entrypoint guard.
const loadReadOnly=async()=>await import(pathToFileURL(resolve('scripts/check-v2-p7-mysql-readonly.mjs')).href);

const IDENTITY_SQL='SELECT DATABASE() AS database_name, @@server_uuid AS server_uuid';
const fakeBearer='b'.repeat(64);
async function withHttp(go:(base:string)=>Promise<void>,query:(sql:string)=>Promise<string[]>){
 const bridge=createP7ReadonlyHttpPool(query);
 const app=express();
 app.use('/api/v2',await createV2CatalogAssembly(bridge.database,bridge.pool,{
  database:'fabric_v2_test_20261012_p6documents',confirmation:'I_ACKNOWLEDGE_SANDBOX'
 }));
 const server:Server=await new Promise((resolve,reject)=>{
  const started=app.listen(0,'127.0.0.1',()=>resolve(started));
  started.on('error',reject);
 });
 try{
  const addr=server.address();assert(addr&&typeof addr!=='string');
  await go('http://127.0.0.1:'+addr.port+'/api/v2');
 }finally{
  await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
 }
 return bridge.stats();
}
function makeSelect(requests:string[],row='fabric_v2_test_20261012_p6documents\tserver-uuid-readonly'){
 return async(sql:string)=>{
  requests.push(sql);
  if(sql==='SELECT DATABASE(), @@server_uuid')return [row];
  if(sql.startsWith('SELECT '))return [];
  throw Error('Unexpected SQL');
 };
}
test('P7-4f SSH adapter only emits readonly allowlisted MySQL statements and rejects transaction actions',async()=>{
 const statements:string[]=[];
 const bridge=createP7ReadonlyHttpPool(makeSelect(statements));
 const conn=await bridge.pool.getConnection();
 assert.deepEqual((await conn.query(IDENTITY_SQL))[0],[{
  database_name:'fabric_v2_test_20261012_p6documents',server_uuid:'server-uuid-readonly'
 }]);
 await assert.rejects(conn.query('UPDATE orders SET x=1'),/select|readonly|allowlist/i);
 await assert.rejects(conn.query('SELECT * FROM orders'),/select|readonly|allowlist/i);
 await assert.rejects(conn.beginTransaction(),/readonly|transaction|write/i);
 await assert.rejects(conn.commit(),/readonly|transaction|write/i);
 await assert.rejects(conn.rollback(),/readonly|transaction|write/i);
 conn.release();
 assert.equal(bridge.stats().released,1);
 assert.deepEqual(statements,['SELECT DATABASE(), @@server_uuid']);
});
test('P7-4f real Express V2 assembly validates startup target and reads missing-login/session against only SELECT',async()=>{
 const statements:string[]=[];
 const stats=await withHttp(async base=>{
  for(const path of ['/access/me','/pattern-masters','/products','/fabrics','/documents','/document-products/selector']){
   const anon=await fetch(base+path);
   assert.equal(anon.status,401,'anonymous must not gain read access: '+path);
  }
  const missing=await fetch(base+'/access/me',{headers:{authorization:'Bearer '+fakeBearer}});
  assert.equal(missing.status,401,'unknown bearer must be checked against session table');
  const login=await fetch(base+'/access/login',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({username:'p7readonlyabsent',password:'p7readonlydummy'})});
  assert.equal(login.status,401,'missing test user must not create a session');
  for(const path of ['/products','/documents']){
   const req=await fetch(base+path,{method:'GET',headers:{authorization:'Bearer '+fakeBearer}});
   assert.equal(req.status,401);
  }
  const denied=await fetch(base+'/products',{method:'POST',
   headers:{authorization:'Bearer '+fakeBearer,'content-type':'application/json'},
   body:JSON.stringify({fabricId:'1',patternColorwayId:'1'})});
  assert.equal(denied.status,401,'write is guarded by real empty DB auth');
 },makeSelect(statements));
 assert.equal(stats.writes,0,'no writes or transaction paths');
 assert(stats.released>=5,'startup+all request connections returned');
 assert(statements.every(sql=>sql.startsWith('SELECT ')));
 assert(statements.some(sql=>sql.includes('FROM v2_access_sessions')));
 assert(statements.some(sql=>sql.includes('FROM v2_access_users WHERE username_normalized')));
});
test('P7-4f sandbox drift refuses assembly before exposing any API listener',async()=>{
 for(const identity of ['fabric_db\tserver-uuid-readonly','fabric_v2_test_20261012_p6documents\t']){
  const statements:string[]=[];
  await assert.rejects(withHttp(async()=>{},makeSelect(statements,identity)),/target|identity|mismatch|unavailable/i);
  assert.equal(statements.length,1);
 }
});
test('P7-4f unexpected remote credential rows fail closed, never return user/token',async()=>{
 const statements:string[]=[];
 const source=async(sql:string)=>{
  statements.push(sql);
  if(sql==='SELECT DATABASE(), @@server_uuid')return ['fabric_v2_test_20261012_p6documents\tserver-uuid-readonly'];
  return ['1\tsecret-hash\t1'];
 };
 await withHttp(async base=>{
  const response=await fetch(base+'/access/login',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({username:'p7readonlyabsent',password:'p7readonlydummy'})});
  assert.equal(response.status,503,'unexpected credentials must not be accepted');
  const body=JSON.stringify(await response.json());
  assert(!body.includes('secret-hash'));
 },source);
});
test('P7-4f remote SSH MySQL real empty sandbox Express unauthorized/negative login HTTP',
 {skip:process.env.FABRIC_V2_READONLY_TEST!=='I_ACKNOWLEDGE_READONLY'},async()=>{
 const {createSshSelect,auditP7ReadOnly,P7_READONLY_DB}=await loadReadOnly();
 const execute=createSshSelect();
 const audit=await auditP7ReadOnly(execute);
 assert.equal(audit.database,P7_READONLY_DB);
 const sqls:string[]=[];
 const stats=await withHttp(async base=>{
  for(const path of ['/access/me','/products','/pattern-masters','/fabrics','/documents']){
   assert.equal((await fetch(base+path)).status,401,'unauthorized '+path);
  }
  assert.equal((await fetch(base+'/access/me',{headers:{authorization:'Bearer '+fakeBearer}})).status,401);
  const response=await fetch(base+'/access/login',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({username:'p7readonlyabsent',password:'p7readonlydummy'})});
  assert.equal(response.status,401);
  assert.equal((await fetch(base+'/products',{headers:{authorization:'Bearer '+fakeBearer}})).status,401);
  assert.equal((await fetch(base+'/documents',{headers:{authorization:'Bearer '+fakeBearer}})).status,401);
 },async sql=>{sqls.push(sql);return execute(sql);});
 assert.equal(stats.writes,0);
 assert(sqls.some(sql=>sql.includes('v2_access_sessions')),'real DB session query happened');
 assert(sqls.some(sql=>sql.includes('v2_access_users')),'real DB login query happened');
});
