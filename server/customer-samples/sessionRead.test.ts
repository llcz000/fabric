import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {hashSessionToken} from '../access/password';
import type {AppPrincipal} from '../access/types';
import {readSampleSession,SampleSessionReadError} from './sessionRead';
import {createSampleSessionReadRouter} from './sessionReadRoutes';
const bearer='d'.repeat(64);
const actor:AppPrincipal={userId:'2',sessionId:'9',username:'sales',displayName:'Sales',role:'sales',canManageOwnOrders:false,canManageProducts:false};
class Db{
 imageAsset:string|null='a1111111-1111-4111-8111-111111111111';role:'sales'|'admin'='sales';active=true;login=true;granted=true;exists=true;closed=false;fail=false;badSnapshot=false;missingSpecs=false;total=1;manual=false;
 calls:{sql:string;params:unknown[]}[]=[];begins=0;commits=0;rollbacks=0;releases=0;
 async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  this.calls.push({sql,params});if(this.fail)throw Error('PRIVATE_SQL_PASSWORD');
  if(sql.includes('JOIN v2_access_users'))return [this.active&&this.login&&params[0]===hashSessionToken(bearer)?[{user_id:'2',username:'sales',display_name:'Sales',role:this.role,session_id:'9',can_manage_products:0,can_manage_own_orders:0}]:[],[]];
  if(sql.includes('FROM v2_access_users'))return [this.active?[{id:'2',role:this.role,is_active:1}]:[],[]];
  if(sql.includes('FROM v2_access_sessions'))return [this.login?[{id:'9'}]:[],[]];
  if(sql.includes('FROM customer_sample_session_access'))return [this.granted?[{can_manage:1}]:[],[]];
  if(sql.includes('AS selected_card_count'))return [[{customer_reference:'客户A',total:this.total,selected_card_count:2}],[]];
  if(sql.includes('FROM customer_sample_sessions'))return [this.exists?[{id:'51',status:this.closed?'closed':'open'}]:[],[]];
  if(sql.includes('FROM customer_sample_items'))return [[sql.includes('JOIN v2_products')?{id:'61',product_id:'81',product_no:'0012-1-F018',master_no:'0012',colorway_no:1,pattern_image_asset_id:this.imageAsset,fabric_no:'F018',fabric_name:this.badSnapshot?null:'最新丝绸',composition:this.missingSpecs?null:'最新成分',weight_value:this.missingSpecs?null:'18.000',weight_unit:this.missingSpecs?null:'gsm',width_value:this.missingSpecs?null:'145.00'}:{id:'61',product_id:'81',product_snapshot_json:JSON.stringify({productNo:'0012-1-F018',fabricName:'旧品名',composition:'原始成分',weightValue:'16',weightUnit:'mm',widthCm:'140'})}],[]];
  if(sql.includes('FROM customer_sample_item_sources')){
   assert.deepEqual(params,['51','81']);
   return [[{product_id:'81',card_id:'12',card_no:'0012-F018',deleted_at:'2026-10-14 12:00:00',first_scan_event_id:'71'},{product_id:'81',card_id:'13',card_no:'0012-F018',deleted_at:null,first_scan_event_id:'72'}],[]];
  }
  if(sql.includes('FROM customer_sample_manual_events'))return [this.manual?[{product_id:'81',card_id:'14',card_no:'0012-F020',deleted_at:null,first_manual_event_id:'73'}]:[],[]];
  throw Error('Unexpected SQL');
 }
 async getConnection(){
  const db=this;return {query:db.query.bind(db),async beginTransaction(){db.begins++;},async commit(){db.commits++;},async rollback(){db.rollbacks++;},release(){db.releases++;}};
 }
}
const status=(n:number)=>(e:unknown)=>e instanceof SampleSessionReadError&&e.status===n;

test('B3 admin and sales both read explicitly granted selections, but a revoked grant hides customer details',async()=>{
 const admin={...actor,role:'admin' as const};
 const db=new Db();db.role='admin';
 const page=await readSampleSession(db,admin,'51');
 assert.equal(page.session.customerReference,'客户A');assert.equal(page.items.length,1);
 db.granted=false;db.calls=[];
 await assert.rejects(readSampleSession(db,admin,'51'),status(404));
 assert(!db.calls.some(c=>c.sql.includes('customer_reference')||c.sql.includes('FROM customer_sample_items')));
});
test('card-only manual sources are shown alongside scans without fabricating a scan event',async()=>{
 const db=new Db();db.manual=true;
 const result=await readSampleSession(db,actor,'51');
 assert.deepEqual(result.items[0].sources.at(-1),{cardId:'14',cardNo:'0012-F020',retired:false,firstScanEventId:null,firstManualEventId:'73'});
});
test('B3 authorized history reads latest master fields and preserves retired/recreated card sources with pagination',async()=>{
 const db=new Db();db.closed=true;db.total=2;
 const result=await readSampleSession(db,actor,'51',{limit:1,offset:1});
 assert.equal(result.session.customerReference,'客户A');assert.equal(result.session.status,'closed');
 assert.equal(result.total,2);assert.equal(result.selectedCardCount,2);assert.equal(result.items.length,1);
 assert.equal(result.items[0].current.fabricName,'最新丝绸');assert.equal(result.items[0].current.composition,'最新成分');assert.equal(result.items[0].current.weightUnit,'gsm');assert.equal(result.items[0].current.widthCm,'145.00');
 assert.deepEqual(result.items[0].sources.map(x=>[x.cardId,x.retired]),[['12',true],['13',false]]);
 assert.equal(result.limit,1);assert.equal(result.offset,1);assert.equal(db.commits,1);assert.equal(db.releases,1);
 assert(db.calls.every(c=>/^SELECT/.test(c.sql)),'read-only SQL without DDL or DML');
 assert(db.calls.some(c=>c.sql.includes('JOIN v2_products')&&c.sql.includes('JOIN v2_fabrics')),'authorized read joins current product and fabric data');
 assert(!db.calls.some(c=>/qr_payload|token_hash/.test(c.sql)),'history must never expose QR payload');
 const sessionLock=db.calls.findIndex(c=>/customer_sample_sessions.*FOR SHARE/.test(c.sql));
 const grant=db.calls.findIndex(c=>c.sql.includes('FROM customer_sample_session_access'));
 const privateRead=db.calls.findIndex(c=>c.sql.includes('customer_reference'));
 assert(sessionLock>=0&&sessionLock<grant&&grant<privateRead,'grant precedes any customer detail query');
});
test('B3 missing grant, revoked login and changed role deny before customer details; unrelated flags do not grant access',async()=>{
 for(const cause of ['granted','active','login','role'] as const){
  const db=new Db();if(cause==='role')db.role='admin';else db[cause]=false;
  await assert.rejects(readSampleSession(db,actor,'51'),status(cause==='granted'?404:403));
  assert(!db.calls.some(c=>c.sql.includes('customer_reference')||c.sql.includes('FROM customer_sample_items')));
  assert.equal(db.rollbacks,1);assert.equal(db.releases,1);
 }
 const db=new Db();await assert.rejects(readSampleSession(db,{...actor,role:'admin'},'51'),status(403));
 assert(db.calls.some(c=>c.sql.includes('FROM v2_access_users')));
 assert(!db.calls.some(c=>c.sql.includes('customer_reference')||c.sql.includes('FROM customer_sample_items')));
});
test('B3 malformed IDs/pagination fail before connection; missing session returns 404',async()=>{
 const db=new Db();
 for(const [sessionId,q] of [['0',{}],['18446744073709551616',{}],['51',{limit:0}],['51',{offset:-1}],['51',{limit:101}],['51',{ownerId:'2'}]] as const)
  await assert.rejects(readSampleSession(db,actor,sessionId,q as never),status(400));
 assert.equal(db.begins,0);
 db.exists=false;await assert.rejects(readSampleSession(db,actor,'51'),status(404));assert.equal(db.rollbacks,1);
});
test('B3 malformed live master row fails safely and releases the read transaction',async()=>{
 const db=new Db();db.badSnapshot=true;await assert.rejects(readSampleSession(db,actor,'51'),status(409));assert.equal(db.rollbacks,1);assert.equal(db.releases,1);
});
test('B3 live nullable fabric specifications stay null rather than fabricated zeros',async()=>{
 const db=new Db();db.missingSpecs=true;
 const result=await readSampleSession(db,actor,'51');
 assert.equal(result.items[0].current.composition,null);
 assert.equal(result.items[0].current.weightValue,null);
 assert.equal(result.items[0].current.weightUnit,null);
 assert.equal(result.items[0].current.widthCm,null);
});
async function http(run:(base:string,db:Db)=>Promise<void>){
 const db=new Db(),app=express();app.use('/api/v2/customer-samples',createSampleSessionReadRouter(db,db));
 const server=await new Promise<ReturnType<typeof app.listen>>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try{const addr=server.address();assert(addr&&typeof addr!=='string');await run('http://127.0.0.1:'+addr.port+'/api/v2/customer-samples/sessions/51',db);}
 finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}
test('B3 private HTTP permits both roles only with explicit grant; revoked/anonymous access denied',async()=>{
 await http(async(url,db)=>{
  const get=(auth=true)=>fetch(url,{headers:auth?{authorization:'Bearer '+bearer}:{}});
  assert.equal((await get(false)).status,401);assert.equal(db.calls.length,0);
  const ok=await get();assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'no-store');assert.equal((await ok.json()).items[0].current.fabricName,'最新丝绸');
  db.granted=false;assert.equal((await get()).status,404);
  db.granted=true;db.role='admin';assert.equal((await get()).status,200);
  db.granted=false;assert.equal((await get()).status,404);
  db.active=false;assert.equal((await get()).status,401);
 });
});
test('B3 HTTP strictly parses pagination and hides backend diagnostics',async()=>{
 await http(async(url,db)=>{
  for(const q of ['?limit=0','?offset=-1','?limit[]=2','?ownerId=2'])assert.equal((await fetch(url+q,{headers:{authorization:'Bearer '+bearer}})).status,400);
  db.fail=true;const unavailable=await fetch(url,{headers:{authorization:'Bearer '+bearer}});
  assert.equal(unavailable.status,503);assert(!((await unavailable.text()).includes('PRIVATE_SQL_PASSWORD')));
 });
});

test('B3 inaccessible and absent sessions share 404 and never reveal private metadata',async()=>{
 await http(async(url,db)=>{
  const get=()=>fetch(url,{headers:{authorization:'Bearer '+bearer}});
  db.granted=false;const denied=await get();assert.equal(denied.status,404);const body=await denied.text();
  db.exists=false;const absent=await get();assert.equal(absent.status,404);assert.equal(await absent.text(),body);
  assert(!db.calls.some(c=>c.sql.includes('customer_reference')));
 });
});

test('selected session exposes current pattern asset through its existing authorized join',async()=>{const db=new Db(),result=await readSampleSession(db,actor,'51');assert.equal((result.items[0].current as any).patternImageAssetId,db.imageAsset);assert(db.calls.some(c=>c.sql.includes('c.pattern_image_asset_id')));db.imageAsset=null;assert.equal((await readSampleSession(db,actor,'51')).items[0].current.patternImageAssetId,null);});
