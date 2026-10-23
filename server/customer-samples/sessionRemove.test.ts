import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type {AppPrincipal} from '../access/types';
import {readSampleSession} from './sessionRead';
import {getSampleSchemaStatements} from './schema';
import {removeSampleSessionItem,SampleSessionRemoveError} from './sessionRemove';
import {createSampleSessionRemoveRouter} from './sessionRemoveRoutes';

const actor:AppPrincipal={userId:'6',sessionId:'1',username:'sales',displayName:'Sales',role:'sales',canManageOwnOrders:false,canManageProducts:false};
type Row=Record<string,unknown>;
class RemovalDb{
 user:Row|null={id:'6',role:'sales',is_active:1};login=true;granted=true;
 session:Row|null={id:'11',status:'open'};
 item:Row|null={id:'81',session_id:'11',product_id:'8',selected_by_user_id:'7',selected_at:'2026-10-01',removed_at:null,removed_by_user_id:null};
 events:Row[]=[];sources=[{product_id:'8',card_id:'12',card_no:'G041-F023',deleted_at:null,first_scan_event_id:'31'}];
 cards=['12'];calls:{sql:string;args:unknown[]}[]=[];
 begins=0;commits=0;rollbacks=0;releases=0;failAt='';
 async getConnection(){
  const db=this;let backup:{item:Row|null;events:Row[]}|undefined;
  return {
   async beginTransaction(){db.begins++;backup={item:db.item?{...db.item}:null,events:db.events.map(e=>({...e}))};},
   async commit(){if(db.failAt==='commit')throw Error('PRIVATE commit failure');db.commits++;backup=undefined;},
   async rollback(){db.rollbacks++;if(backup){db.item=backup.item;db.events=backup.events;}},
   release(){db.releases++;},
   async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
    db.calls.push({sql,args});
    if(sql.includes('FROM v2_access_users'))return [db.user?[db.user]:[],[]];
    if(sql.includes('FROM v2_access_sessions'))return [db.login?[{id:'1'}]:[],[]];
    if(sql.includes('FROM customer_sample_session_access'))return [db.granted?[{can_manage:1}]:[],[]];
    if(sql.includes('AS selected_card_count'))return [[{customer_reference:'Customer A',total:db.item&&(!sql.includes('i.removed_at IS NULL')||db.item.removed_at===null)?1:0,selected_card_count:db.cards.length}],[]];
    if(sql.includes('FROM customer_sample_sessions'))return [db.session&&args[0]==='11'?[db.session]:[],[]];
    if(sql.includes('FROM customer_sample_item_sources'))return [db.sources,[]];
    if(sql.startsWith('SELECT')&&sql.includes('FROM customer_sample_items')){
     const item=db.item;
     if(!item||args[0]!==item.session_id||sql.includes('id=?')&&args[1]!==undefined&&args[1]!==item.id&&!sql.includes('JOIN v2_products'))return [[],[]];
     if(sql.includes('JOIN v2_products'))return [item.removed_at!==null&&sql.includes('i.removed_at IS NULL')?[]:[{...item,product_no:'G041-1-F023',master_no:'G041',colorway_no:1,fabric_no:'F023',fabric_name:'Silk',composition:null,weight_value:null,weight_unit:null,width_value:null}],[]];
     return [[{...item}],[]];
    }
    if(sql.startsWith('UPDATE customer_sample_items')){
     if(db.failAt==='update')throw Error('PRIVATE update failure');
     assert.match(sql,/removed_at=UTC_TIMESTAMP\(\)/);assert.match(sql,/removed_by_user_id=\?/);
     assert.deepEqual(args,['6','11','81']);assert(db.item);
     db.item={...db.item,removed_at:'2026-10-15 10:00:00',removed_by_user_id:args[0]};
     return [{affectedRows:1},[]];
    }
    if(sql.startsWith('INSERT INTO customer_sample_item_removal_events')){
     if(db.failAt==='audit')throw Error('PRIVATE audit failure');
     assert.deepEqual(args,['11','81']);assert(db.item);
     db.events.push({session_id:'11',product_id:'8',actor_user_id:db.item.removed_by_user_id,removed_at:db.item.removed_at});
     return [{affectedRows:1,insertId:db.events.length},[]];
    }
    throw Error('Unexpected SQL: '+sql);
   }
  };
 }
}
const status=(n:number)=>(e:unknown)=>e instanceof SampleSessionRemoveError&&e.status===n;
test('B3 explicitly granted admin may remove one item; revoked grant and mismatched role must not write',async()=>{
 const admin={...actor,role:'admin' as const};
 const db=new RemovalDb();db.user!.role='admin';
 const result=await removeSampleSessionItem(db,admin,'11','81');
 assert.equal(result.removed,true);
 assert.equal(db.item?.removed_by_user_id,admin.userId);
 assert.equal(db.events.length,1);
 const blocked=new RemovalDb();blocked.user!.role='admin';blocked.granted=false;
 await assert.rejects(removeSampleSessionItem(blocked,admin,'11','81'),status(404));
 assert.equal(blocked.events.length,0);
 assert(!blocked.calls.some(c=>c.sql.startsWith('UPDATE')||c.sql.startsWith('INSERT')));
 const stale=new RemovalDb();stale.user!.role='sales';
 await assert.rejects(removeSampleSessionItem(stale,admin,'11','81'),status(403));
 assert.equal(stale.events.length,0);
});
test('B3 remove retains original item/source/card identity and appends audit; repeats are idempotent',async()=>{
 const db=new RemovalDb(),before={...db.item},sources=JSON.stringify(db.sources),cards=[...db.cards];
 const result=await removeSampleSessionItem(db,actor,'11','81');
 assert.deepEqual(result,{sessionId:'11',itemId:'81',productId:'8',removed:true});
 assert.deepEqual(db.item,{...before,removed_at:'2026-10-15 10:00:00',removed_by_user_id:'6'});
 assert.deepEqual(db.events,[{session_id:'11',product_id:'8',actor_user_id:'6',removed_at:'2026-10-15 10:00:00'}]);
 assert.equal(JSON.stringify(db.sources),sources);assert.deepEqual(db.cards,cards);
 assert.deepEqual((await readSampleSession(db,actor,'11')).items,[]);
 await removeSampleSessionItem(db,actor,'11','81');assert.equal(db.events.length,1);assert.equal(db.commits,3);
 const writes=db.calls.filter(c=>!/^(SELECT)/.test(c.sql));
 assert.equal(writes.length,2);assert(writes.every(c=>/^(UPDATE customer_sample_items|INSERT INTO customer_sample_item_removal_events)/.test(c.sql)));
 const locks=db.calls.slice(0,5);
 assert.match(locks[0].sql,/v2_access_users.*FOR SHARE/);assert.deepEqual(locks[0].args,['6']);
 assert.match(locks[1].sql,/v2_access_sessions.*revoked_at IS NULL.*expires_at>UTC_TIMESTAMP\(\).*FOR SHARE/);assert.deepEqual(locks[1].args,['1','6']);
 assert.match(locks[2].sql,/customer_sample_sessions.*FOR UPDATE/);assert.match(locks[3].sql,/customer_sample_session_access.*FOR UPDATE/);
 assert.match(locks[4].sql,/customer_sample_items.*session_id=\?.*id=\?.*FOR UPDATE/);
});
test('B3 removal denies stale user/login or mismatched actor role before private reads',async()=>{
 for(const change of ['inactive','role','user','login'] as const){
  const db=new RemovalDb();
  if(change==='inactive')db.user!.is_active=0;if(change==='role')db.user!.role='admin';
  if(change==='user')db.user=null;if(change==='login')db.login=false;
  await assert.rejects(removeSampleSessionItem(db,actor,'11','81'),status(403));
  assert(!db.calls.some(c=>/customer_sample/.test(c.sql)));assert.equal(db.rollbacks,1);assert.equal(db.releases,1);
 }
 const db=new RemovalDb();await assert.rejects(removeSampleSessionItem(db,{...actor,role:'admin',canManageProducts:true,canManageOwnOrders:true},'11','81'),status(403));
 assert.equal(db.begins,1);
 assert.equal(db.rollbacks,1);
 assert(!db.calls.some(c=>c.sql.includes('FROM customer_sample_items')));
});
test('B3 missing grant hides session status and item; missing/cross-session item returns 404',async()=>{
 for(const closed of [false,true]){
  const db=new RemovalDb();db.granted=false;db.session!.status=closed?'closed':'open';
  await assert.rejects(removeSampleSessionItem(db,{...actor,canManageOwnOrders:true,canManageProducts:true},'11','81'),status(404));
  assert(!db.calls.some(c=>c.sql.includes('FROM customer_sample_items')));assert.equal(db.events.length,0);
 }
 for(const change of ['session','item','otherSession'] as const){
  const db=new RemovalDb();if(change==='session')db.session=null;if(change==='item')db.item=null;if(change==='otherSession')db.item!.session_id='12';
  await assert.rejects(removeSampleSessionItem(db,actor,'11','81'),status(404));assert.equal(db.events.length,0);
 }
 const db=new RemovalDb();await assert.rejects(removeSampleSessionItem(db,actor,'11','82'),status(404));
});
test('B3 closed session rejects removal without changing item or audit',async()=>{
 const db=new RemovalDb();db.session!.status='closed';const before=JSON.stringify(db.item);
 await assert.rejects(removeSampleSessionItem(db,actor,'11','81'),status(409));
 assert.equal(JSON.stringify(db.item),before);assert.equal(db.events.length,0);assert.equal(db.rollbacks,1);
});
test('B3 missing item returns 404 in an authorized closed session too',async()=>{
 const db=new RemovalDb();db.session!.status='closed';db.item=null;
 await assert.rejects(removeSampleSessionItem(db,actor,'11','81'),status(404));
 assert.equal(db.events.length,0);assert.equal(db.rollbacks,1);
});
test('B3 isolated HTTP DELETE returns the transaction result and removes only the selected item',async()=>{
 const db=new RemovalDb(),app=express();app.use(express.json());
 app.use('/api/v2/customer-samples',createSampleSessionRemoveRouter((_req,res,next)=>{res.locals.principal=actor;next();},db));
 const server=await new Promise<ReturnType<typeof app.listen>>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try{
  const addr=server.address();assert(addr&&typeof addr!=='string');
  const response=await fetch('http://127.0.0.1:'+addr.port+'/api/v2/customer-samples/sessions/11/items/81',{method:'DELETE'});
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{sessionId:'11',itemId:'81',productId:'8',removed:true});
  assert.equal(db.events.length,1);assert.equal(db.item!.removed_by_user_id,'6');assert.equal(db.sources[0].first_scan_event_id,'31');
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
test('B3 isolated HTTP permits explicitly granted admin removal with a preserved actor audit',async()=>{
 const admin={...actor,role:'admin' as const};
 const db=new RemovalDb();db.user!.role='admin';
 const app=express();app.use('/api/v2/customer-samples',createSampleSessionRemoveRouter((_req,res,next)=>{
  res.locals.principal=admin;next();
 },db));
 const server=await new Promise<ReturnType<typeof app.listen>>(resolve=>{const x=app.listen(0,'127.0.0.1',()=>resolve(x));});
 try{
  const addr=server.address();assert(addr&&typeof addr!=='string');
  const url='http://127.0.0.1:'+addr.port+'/api/v2/customer-samples/sessions/11/items/81';
  const response=await fetch(url,{method:'DELETE'});
  assert.equal(response.status,200);
  assert.equal(db.events[0].actor_user_id,admin.userId);
  assert.equal(db.events.length,1);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
test('B3 malformed identity fails before connection',async()=>{
 for(const invalid of ['','0','01','-1','18446744073709551616']){
  const db=new RemovalDb();await assert.rejects(removeSampleSessionItem(db,actor,invalid,'81'),status(400));
  await assert.rejects(removeSampleSessionItem(db,actor,'11',invalid),status(400));
  await assert.rejects(removeSampleSessionItem(db,{...actor,sessionId:invalid},'11','81'),status(403));assert.equal(db.begins,0);
 }
});
test('B3 update/audit/commit failures roll back removal with audit and release connection',async()=>{
 for(const failAt of ['update','audit','commit']){
  const db=new RemovalDb();db.failAt=failAt;const before=JSON.stringify(db.item);
  await assert.rejects(removeSampleSessionItem(db,actor,'11','81'),/PRIVATE/);
  assert.equal(JSON.stringify(db.item),before);assert.deepEqual(db.events,[]);assert.equal(db.commits,0);assert.equal(db.rollbacks,1);assert.equal(db.releases,1);
 }
});
test('B3 removed item disappears from read total/page while selected card and source identity stay intact',async()=>{
 const db=new RemovalDb();db.item!.removed_at='2026-10-15';db.item!.removed_by_user_id='6';
 const page=await readSampleSession(db,actor,'11');
 assert.equal(page.total,0);assert.deepEqual(page.items,[]);assert.equal(page.selectedCardCount,1);
 assert.equal(db.sources[0].first_scan_event_id,'31');assert.equal(db.item!.id,'81');
});
test('B3 fresh schema defines reversible removal and a separate retained removal audit',()=>{
 const tables=getSampleSchemaStatements(),item=tables.find(t=>t.name==='customer_sample_items')!.sql;
 assert.match(item,/removed_at DATETIME NULL/);assert.match(item,/removed_by_user_id BIGINT UNSIGNED NULL/);
 const audit=tables.find(t=>t.name==='customer_sample_item_removal_events');assert(audit);
 assert.match(audit.sql,/FOREIGN KEY \(session_id,product_id\) REFERENCES customer_sample_items\(session_id,product_id\) ON DELETE RESTRICT/);
 assert.match(audit.sql,/actor_user_id BIGINT UNSIGNED NOT NULL/);assert.match(audit.sql,/removed_at DATETIME NOT NULL/);
});