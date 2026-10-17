import test from 'node:test';
import assert from 'node:assert/strict';
import type {Server} from 'node:http';
import {createV2SandboxPreviewApp,resolveV2SandboxPreviewConfig} from './v2SandboxPreview';

const uuid='12345678-1234-1234-1234-123456789abc';
const env=()=>({
 FABRIC_V2_SANDBOX_PREVIEW:'I_ACKNOWLEDGE_SANDBOX',
 FABRIC_V2_SANDBOX_DATABASE:'fabric_v2_test_p7_preview',
 FABRIC_V2_SANDBOX_EXPECTED_UUID:uuid,
 NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3456',
 DB_HOST:'127.0.0.1',DB_PORT:'3307',DB_DATABASE:'fabric_v2_test_p7_preview',
 DB_USER:'isolated-preview',DB_PASSWORD:'local-secret'
});
const noop=async()=>{};
function fakeStorage(actual={database_name:'fabric_v2_test_p7_preview',server_uuid:uuid},failure=false){
 let released=0,reads=0;
 const query=async(sql:string):Promise<[unknown,unknown]>=>{
  reads++;
  if(failure)throw Error('password and SQL must not leak');
  assert.equal(sql,'SELECT DATABASE() AS database_name, @@server_uuid AS server_uuid');
  return [[actual],[]];
 };
 const pool={getConnection:async()=>({query,beginTransaction:noop,commit:noop,rollback:noop,release(){released++;}})};
 return {database:{query},pool,counts:()=>({reads,released})};
}
test('P7 isolated preview requires explicit sandbox identity, localhost DB proxy and opt-in',()=>{
 const cfg=resolveV2SandboxPreviewConfig(env());
 assert.equal(cfg.database,'fabric_v2_test_p7_preview');
 assert.equal(cfg.listenHost,'127.0.0.1');
 assert.equal(cfg.listenPort,3456);
 assert.equal(cfg.serverUuid,uuid);
 assert.equal(cfg.dbPort,3307);
 assert.equal(cfg.dbHost,'127.0.0.1');
 assert.equal(cfg.dbUser,'isolated-preview');
});
test('P7 preview rejects missing opt-in, production, unsafe listen host and remote DB endpoints',()=>{
 const bads=[
  {FABRIC_V2_SANDBOX_PREVIEW:undefined},{FABRIC_V2_SANDBOX_PREVIEW:'true'},
  {NODE_ENV:'production'},{NODE_ENV:'PRODUCTION'}, {HOST:'0.0.0.0'}, {HOST:'::1'},
  {DB_HOST:'mysql.example.com'},{DB_HOST:'192.168.1.3'},
  {FABRIC_V2_SANDBOX_DATABASE:'fabric_production'},
  {FABRIC_V2_SANDBOX_DATABASE:'fabric_v2_test_prod_1'},
  {DB_DATABASE:'fabric_db'},{DB_DATABASE:'fabric_v2_test_other'},
  {FABRIC_V2_SANDBOX_EXPECTED_UUID:''},{FABRIC_V2_SANDBOX_EXPECTED_UUID:'test-uuid'},
  {DB_USER:''},{DB_PASSWORD:''},
  {PORT:'0'},{PORT:'0x3456'},{PORT:'65536'},{PORT:'3000 '},
  {DB_PORT:'abc'}, {DB_PORT:'0'}
 ];
 for(const change of bads){
  assert.throws(()=>resolveV2SandboxPreviewConfig({...env(),...change}),/sandbox|preview|target|mode|config/i,JSON.stringify(change));
 }
});
test('P7 preview never listens nor routes if independently pinned UUID differs or storage fails',async()=>{
 const cfg=resolveV2SandboxPreviewConfig(env());
 for(const s of [fakeStorage({database_name:cfg.database,server_uuid:'87654321-1234-1234-1234-123456789abc'}),
  fakeStorage({database_name:'fabric_production',server_uuid:uuid}),fakeStorage(undefined,true)]){
  await assert.rejects(()=>createV2SandboxPreviewApp(cfg,s.database,s.pool),/sandbox|preview|identity|unavailable/i);
  assert(s.counts().reads>=1);
 }
});
test('P7 preview mounts real V2 routes, not old login/orders and does not grant anonymous reads',async()=>{
 const cfg=resolveV2SandboxPreviewConfig(env());
 const store=fakeStorage();
 const app=await createV2SandboxPreviewApp(cfg,store.database,store.pool);
 assert(store.counts().released>=2,'startup pooled identity probes release connections');
 const server=await new Promise<Server>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
 try{
  const addr=server.address();assert(addr&&typeof addr!=='string');
  const base='http://127.0.0.1:'+addr.port;
  const live=await fetch(base+'/health');
  assert.equal(live.status,200);assert.deepEqual(await live.json(),{status:'sandbox-preview',releaseAuthorized:false});
  for(const route of ['/api/login','/api/orders','/api/company','/uploads/private.png']){
   const res=await fetch(base+route);
   assert.equal(res.status,404,route);
  }
  const unauthorized=await fetch(base+'/api/v2/products');
  assert.equal(unauthorized.status,401);
  assert.equal(unauthorized.headers.get('cache-control'),'no-store');
 }finally{
  await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
 }
});
test('P7 runtime has no fallback when expected identity differs across two physical checks',async()=>{
 const cfg=resolveV2SandboxPreviewConfig(env());
 let count=0,released=0,leased=0;
 const query=async():Promise<[unknown,unknown]>=>[[{database_name:cfg.database,server_uuid:++count>=3?'12345678-1234-1234-1234-aaaaaaaaaaaa':uuid}],[]];
 const storage={database:{query},pool:{getConnection:async()=>{leased++;return {query,release(){released++},beginTransaction:noop,commit:noop,rollback:noop};}}};
 await assert.rejects(()=>createV2SandboxPreviewApp(cfg,storage.database,storage.pool),/identity|sandbox|unavailable/i);
 assert(leased>=1);
 assert.equal(released,leased,'all actually opened connections released after error');
});
