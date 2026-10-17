import assert from 'node:assert/strict';
import test from 'node:test';
import {copyV2Document,deleteV2Document} from './documentLifecycle';
import type {AppPrincipal} from '../access/types';

const admin:AppPrincipal={userId:'1',sessionId:'9',role:'admin',username:'a',displayName:'Admin',canManageProducts:true,canManageOwnOrders:true};
const sales:AppPrincipal={...admin,userId:'2',role:'sales'};
type Row=Record<string,unknown>;
function db(owner:string|null='2',valid=true,role:'admin'|'sales'='sales'){
 const state={events:[] as string[],sql:[] as {query:string;args:unknown[]}[],rollbacks:0,commits:0,
  owner,valid,count:2,copyId:'321',deleteCount:1,itemsRemain:2,errors:false};
 const tx={
  async beginTransaction(){state.events.push('begin');},
  async commit(){state.commits++;state.events.push('commit');},
  async rollback(){state.rollbacks++;state.events.push('rollback');},
  release(){state.events.push('release');},
  async query(query:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
   state.sql.push({query,args});
   if(state.errors&&query.startsWith('INSERT INTO order_items'))throw Error('PRIVATE_DRIVER_FAILURE');
   if(query.includes('FROM v2_access_users'))return [[{id:2,role:state.valid?role:'revoked',is_active:state.valid?1:0,can_manage_own_orders:1}],[]];
   if(query.includes('FROM v2_access_sessions'))return [state.valid?[{id:9}]:[],[]];
   if(query.startsWith('SELECT id,created_by_user_id,order_no FROM orders'))return [[{id:'123',created_by_user_id:state.owner,order_no:'XS-ORIGINAL'}],[]];
   if(query.startsWith('SELECT id FROM orders WHERE order_no'))return [[],[]];
   if(query.startsWith('SELECT id FROM order_items'))return [Array.from({length:state.itemsRemain},(_,n)=>({id:String(n+1)})),[]];
   if(query.startsWith('INSERT INTO orders'))return [{insertId:state.copyId,affectedRows:1},[]];
   if(query.startsWith('INSERT INTO order_items'))return [{affectedRows:state.count},[]];
   if(query.startsWith('DELETE FROM order_items'))return [{affectedRows:state.itemsRemain},[]];
   if(query.startsWith('DELETE FROM orders'))return [{affectedRows:state.deleteCount},[]];
   throw Error('Unanticipated SQL '+query);
  }
 };
 return {state,pool:{async getConnection(){return tx;}}};
}
test('DOC-01 copy owns a new id and independent number; INSERT SELECT preserves frozen rows and never updates original',async()=>{
 const x=db();
 const result=await copyV2Document(x.pool,sales,'123',{orderNo:'XS-20261017-002',date:'2026-10-17'});
 assert.deepEqual(result,{id:'321',orderNo:'XS-20261017-002'});
 assert.equal(x.state.commits,1);
 assert(x.state.sql.some(x=>x.query.includes('INSERT INTO order_items')&&x.query.includes('SELECT')&&x.args.includes('123')));
 assert(x.state.sql.some(x=>x.query.includes('v2_product_snapshot')));
 assert(!x.state.sql.some(x=>x.query.startsWith('UPDATE ')||x.query.includes('DELETE FROM')));
 assert(x.state.sql.some(x=>x.query.startsWith('INSERT INTO orders')&&x.args.includes('2')));
});
test('DOC-01 sales cannot copy/delete another employee or unknown-owner legacy order; admin may manage',async()=>{
 for(const owner of ['3',null]){
  const x=db(owner);
  await assert.rejects(copyV2Document(x.pool,sales,'123',{orderNo:'XS-NEW',date:'2026-10-17'}),/not found/i);
  assert.equal(x.state.rollbacks,1);assert.equal(x.state.commits,0);
  const y=db(owner);
  await assert.rejects(deleteV2Document(y.pool,sales,'123',{confirm:true}),/not found/i);
  assert.equal(y.state.rollbacks,1);assert.equal(y.state.commits,0);
 }
 const a=db(null,true,'admin'); const result=await deleteV2Document(a.pool,admin,'123',{confirm:true});
 assert.deepEqual(result,{deleted:true});assert.equal(a.state.commits,1);
});
test('DOC-01 delete requires explicit exact confirmation, checks owner and deletes children before parent atomically',async()=>{
 const x=db();
 for(const bad of [null,{}, {confirm:false},{confirm:true,ownerId:'2'},{confirm:'true'}]){
  await assert.rejects(deleteV2Document(x.pool,sales,'123',bad),/confirm/i);
 }
 assert.equal(x.state.events.length,0,'invalid input must not acquire a database connection');
 assert.deepEqual(await deleteV2Document(x.pool,sales,'123',{confirm:true}),{deleted:true});
 const sql=x.state.sql.map(x=>x.query);
 const items=sql.findIndex(x=>x.startsWith('DELETE FROM order_items'));
 const order=sql.findIndex(x=>x.startsWith('DELETE FROM orders'));
 assert(items>=0&&order>items);assert.equal(x.state.commits,1);
});
test('DOC-01 copy refuses spoofed payloads, identical old number, wrong date, malformed IDs before SQL',async()=>{
 for(const body of [{}, {orderNo:'',date:'2026-10-17'},{orderNo:'XS-NEW',date:'2026-02-31'},
  {orderNo:'XS-NEW',date:'2026-10-17',ownerId:'9'}, {orderNo:'XS-NEW',date:'2026-10-17',items:[]},
  {orderNo:'XS-NEW',date:'bad'}]){
  const x=db();
  await assert.rejects(copyV2Document(x.pool,sales,'123',body),/invalid/i);
  assert.equal(x.state.events.length,0);
 }
 const x=db();
 await assert.rejects(copyV2Document(x.pool,sales,'0',{orderNo:'XS-NEW',date:'2026-10-17'}),/not found/i);
 assert.equal(x.state.events.length,0);
});
test('DOC-01 transaction rolls back driver errors and concurrent line changes; does not return partial created order',async()=>{
 const bad=db();bad.state.errors=true;
 await assert.rejects(copyV2Document(bad.pool,sales,'123',{orderNo:'XS-NEW',date:'2026-10-17'}));
 assert.equal(bad.state.rollbacks,1);assert.equal(bad.state.commits,0);
 const changed=db();changed.state.count=1;
 await assert.rejects(copyV2Document(changed.pool,sales,'123',{orderNo:'XS-NEW',date:'2026-10-17'}));
 assert.equal(changed.state.rollbacks,1);
 const gone=db();gone.state.deleteCount=0;
 await assert.rejects(deleteV2Document(gone.pool,sales,'123',{confirm:true}),/changed|not found/i);
 assert.equal(gone.state.rollbacks,1);
});
test('DOC-01 revoked session fails before any document mutation',async()=>{
 const x=db('2',false);
 await assert.rejects(deleteV2Document(x.pool,sales,'123',{confirm:true}));
 assert(!x.state.sql.some(x=>x.query.startsWith('DELETE')));
 assert.equal(x.state.rollbacks,1);
});
