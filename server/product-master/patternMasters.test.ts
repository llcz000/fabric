import assert from 'node:assert/strict';
import test from 'node:test';
import type {AppPrincipal} from '../access/types';
import {createPatternMaster,listPatternMasters,updatePatternMaster,deletePatternMaster,PatternMasterError} from './patternMasters';
import express from 'express';
import type {Server} from 'node:http';
import {hashSessionToken} from '../access/password';
import {createPatternMasterRouter} from './patternMastersRoutes';

const actor:AppPrincipal={userId:'2',sessionId:'9',username:'sales',displayName:'Sales',role:'sales',canManageProducts:true,canManageOwnOrders:false};
type Master={id:string;master_no:string;is_active:number;next_colorway_no:string};
class TestDb {
 items:Master[]=[]; id=1; granted=true; active=true; session=true; referenced=false; versions=false;
 statements:string[]=[]; commits=0; rollbacks=0; deletes=0; failInsert=false;
 cards:Record<string,unknown>[]=[];cardFailure='';
 async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  this.statements.push(sql);
  if(sql.includes('FROM v2_access_users'))return [this.active?[{id:'2',role:'sales',is_active:1,can_manage_products:this.granted?1:0}]:[],[]];
  if(sql.includes('FROM v2_access_sessions'))return [this.session?[{id:'9'}]:[],[]];
  if(sql.startsWith('INSERT INTO pattern_masters')){
   if(this.failInsert)throw Object.assign(Error('duplicate sensitive SQL'),{code:'ER_DUP_ENTRY'});
   const master_no=String(params[0]);
   if(this.items.some(r=>r.master_no===master_no))throw Object.assign(Error('duplicate sensitive SQL'),{code:'ER_DUP_ENTRY'});
   const value={id:String(this.id++),master_no,is_active:1,next_colorway_no:'1'};
   this.items.push(value);return [{insertId:value.id,affectedRows:1},[]];
  }
  if(sql.startsWith('SELECT')&&sql.includes('FROM pattern_masters')) {
   let a=[...this.items];
   if(sql.includes('WHERE id=?'))a=a.filter(r=>r.id===String(params[0]));
   if(sql.includes('WHERE is_active=1'))a=a.filter(r=>r.is_active===1);
   return [a,[]];
  }

  if(sql.includes('FROM sample_cards')){
   if(this.cardFailure==='MALFORMED')return [{affectedRows:1},[]];
   if(this.cardFailure)throw Object.assign(Error('PRIVATE SELECT sample_cards'),{code:this.cardFailure});
   const column=sql.includes('fabric_id=?')?'fabric_id':'master_id';
   return [this.cards.filter(card=>card[column]===String(params[0])&&
    (!sql.includes('is_active=1')||card.is_active===1)),[]];
  }
  if(sql.includes('FROM v2_products'))return [this.referenced?[{id:'3'}]:[],[]];
  if(sql.includes('FROM pattern_colorways'))return [this.versions?[{id:'4'}]:[],[]];
  if(sql.startsWith('UPDATE pattern_masters')){
   const item=this.items.find(r=>r.id===String(params[params.length-1]));
   if(!item)return [{affectedRows:0},[]];
   if(sql.includes('master_no='))item.master_no=String(params[0]);
   if(sql.includes('is_active='))item.is_active=Number(params[sql.includes('master_no=')?1:0]);
   return [{affectedRows:1},[]];
  }
  if(sql.startsWith('DELETE FROM pattern_masters')){
   if(this.versions)throw Object.assign(Error('fk'),{code:'ER_ROW_IS_REFERENCED_2'});
   const before=this.items.length;this.items=this.items.filter(r=>r.id!==String(params[0]));
   this.deletes++;return [{affectedRows:before-this.items.length},[]];
  }
  throw Error('Unexpected SQL: '+sql);
 }
 async getConnection(){
  const snapshot=structuredClone(this.items);
  return {query:this.query.bind(this),beginTransaction:async()=>{},commit:async()=>{this.commits++;},
   rollback:async()=>{this.items=snapshot;this.rollbacks++;},release:()=>{}};
 }
}
const errorStatus=(status:number)=>(error:unknown)=>error instanceof PatternMasterError&&error.status===status;
test('B2-3 card-only master reference locks identity for active and inactive cards',async()=>{
 for(const active of [1,0]){
  const db=new TestDb(),item=await createPatternMaster(db,actor,{masterNo:'A01'});
  db.cards=[{id:'71',master_id:item.id,is_active:active}];db.statements=[];
  await assert.rejects(updatePatternMaster(db,actor,item.id,{masterNo:'A02'}),errorStatus(409));
  await assert.rejects(deletePatternMaster(db,actor,item.id),errorStatus(409));
  assert.equal(db.items[0].master_no,'A01');assert.equal(db.rollbacks,2);assert.equal(db.deletes,0);
  assert(!db.statements.some(q=>q.startsWith('UPDATE pattern_masters')||q.startsWith('DELETE FROM pattern_masters')));
  const parent=db.statements.findIndex(q=>q.includes('FROM pattern_masters')&&q.includes('FOR UPDATE'));
  const card=db.statements.findIndex(q=>q.includes('FROM sample_cards'));
  assert(parent>=0&&card>parent);assert(db.statements[card].includes('FOR SHARE'));
  assert(!db.statements[card].includes('is_active'));
 }
});
test('B2-3 referenced master can toggle status and keep same number without card query',async()=>{
 const db=new TestDb(),item=await createPatternMaster(db,actor,{masterNo:'A01'});
 db.cards=[{id:'71',master_id:item.id,is_active:0}];db.cardFailure='ER_TABLEACCESS_DENIED_ERROR';
 db.statements=[];
 const updated=await updatePatternMaster(db,actor,item.id,{masterNo:'a01',isActive:false});
 assert.equal(updated.masterNo,'A01');assert.equal(updated.isActive,false);
 assert(!db.statements.some(q=>q.includes('sample_cards')));
});
test('B2-3 missing phase-two card table retains phase-one master identity rules',async()=>{
 const db=new TestDb(),item=await createPatternMaster(db,actor,{masterNo:'A01'});
 db.cardFailure='ER_NO_SUCH_TABLE';
 assert.equal((await updatePatternMaster(db,actor,item.id,{masterNo:'A02'})).masterNo,'A02');
 db.referenced=true;
 await assert.rejects(updatePatternMaster(db,actor,item.id,{masterNo:'A03'}),errorStatus(409));
 await assert.rejects(deletePatternMaster(db,actor,item.id),errorStatus(409));
 db.referenced=false;assert.equal((await deletePatternMaster(db,actor,item.id)).deleted,true);
});
test('B2-3 failed card lookup aborts master identity writes and rolls back',async()=>{
 for(const failure of ['ER_BAD_FIELD_ERROR','ER_TABLEACCESS_DENIED_ERROR','ER_LOCK_DEADLOCK','DRIVER_FAILURE','MALFORMED']){
  for(const action of ['rename','delete']){
   const db=new TestDb(),item=await createPatternMaster(db,actor,{masterNo:'A01'});
   db.cardFailure=failure;db.statements=[];
   await assert.rejects(action==='rename'?updatePatternMaster(db,actor,item.id,{masterNo:'A02'}):deletePatternMaster(db,actor,item.id));
   assert.equal(db.rollbacks,1);assert.equal(db.commits,1);assert.equal(db.items[0].master_no,'A01');
   assert(!db.statements.some(q=>q.startsWith('UPDATE pattern_masters')||q.startsWith('DELETE FROM pattern_masters')));
  }
 }
});
test('B2-3 master HTTP card conflict is 409 and card driver error is safe 503',async()=>{
 const db=new HttpDb(),item=await createPatternMaster(db,actor,{masterNo:'A01'});
 db.cards=[{id:'71',master_id:item.id,is_active:0}];
 await httpServer(db,async base=>{
  const request=(method:string,body?:unknown)=>fetch(base+'/pattern-masters/'+item.id,{method,
   headers:{authorization:'Bearer '+'a'.repeat(64),'content-type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.equal((await request('PATCH',{masterNo:'A02'})).status,409);
  assert.equal((await request('DELETE')).status,409);
  assert.equal((await request('PATCH',{isActive:false})).status,200);
  db.cardFailure='ER_TABLEACCESS_DENIED_ERROR';
  for(const method of ['PATCH','DELETE']){
   const res=await request(method,method==='PATCH'?{masterNo:'A02'}:undefined);
   assert.equal(res.status,503);assert(!/PRIVATE|SELECT|sample_cards/.test(await res.text()));
  }
 });
});


test('P3-1a master identity normalizes and list preserves DB identity without counter consumption',async()=>{
 const db=new TestDb();const created=await createPatternMaster(db,actor,{masterNo:' ab001 '});
 assert.deepEqual(created,{id:'1',masterNo:'AB001',isActive:true,nextColorwayNo:1});
 assert.equal(db.commits,1);
 const listed=await listPatternMasters(db);
 assert.equal(listed.length,1);assert.equal(listed[0].masterNo,'AB001');
 assert(!db.statements.some(q=>q.startsWith('UPDATE pattern_masters SET next_colorway_no')));
});
test('P3-1a defaults to active masters and allows explicitly listing inactive ones',async()=>{
 const db=new TestDb();
 const a=await createPatternMaster(db,actor,{masterNo:'A01'});
 const b=await createPatternMaster(db,actor,{masterNo:'B02'});
 await updatePatternMaster(db,actor,b.id,{isActive:false});
 assert.deepEqual((await listPatternMasters(db)).map(x=>x.id),[a.id]);
 assert.deepEqual((await listPatternMasters(db,{includeInactive:true})).map(x=>x.id),[a.id,b.id]);
});
test('P3-1a invalid input and client-controlled identity rejected before opening transaction',async()=>{
 const db=new TestDb();
 for(const body of [{masterNo:'A-1'},{masterNo:''},{masterNo:'A'.repeat(65)},{masterNo:3},
  {masterNo:'123',nextColorwayNo:9},{masterNo:'AA',isActive:false},null,[]])
  await assert.rejects(createPatternMaster(db,actor,body),errorStatus(400));
 assert.equal(db.statements.length,0);
});
test('P3-1a rejects duplicate identities, leaves existing row intact and does not disclose SQL',async()=>{
 const db=new TestDb();await createPatternMaster(db,actor,{masterNo:'A01'});
 await assert.rejects(createPatternMaster(db,actor,{masterNo:'a01'}),errorStatus(409));
 assert.equal(db.items.length,1);assert.equal(db.rollbacks,1);
});
test('P3-1a manager session is rechecked in transaction, even if caller stale',async()=>{
 for(const field of ['active','session'] as const){
  const db=new TestDb();db[field]=false;
  await assert.rejects(createPatternMaster(db,actor,{masterNo:'A01'}),errorStatus(401));
  assert.equal(db.items.length,0);assert.equal(db.rollbacks,1);
 }
 const oldGrant=new TestDb();oldGrant.granted=false;
 await createPatternMaster(oldGrant,actor,{masterNo:'A01'});
});
test('P3-1a update allows status and unreferenced rename but protects referenced numbering',async()=>{
 const db=new TestDb();const master=await createPatternMaster(db,actor,{masterNo:'A01'});
 let updated=await updatePatternMaster(db,actor,master.id,{masterNo:'b02',isActive:false});
 assert.equal(updated.masterNo,'B02');assert.equal(updated.isActive,false);
 db.referenced=true;
 updated=await updatePatternMaster(db,actor,master.id,{isActive:true});
 assert.equal(updated.isActive,true);
 await assert.rejects(updatePatternMaster(db,actor,master.id,{masterNo:'C03'}),errorStatus(409));
 assert.equal(db.items[0].master_no,'B02');
});
test('P3-1a rename serializes against insertion referencing existing colorway',async()=>{
 const db=new TestDb();db.versions=true;
 const item=await createPatternMaster(db,actor,{masterNo:'A01'});
 await updatePatternMaster(db,actor,item.id,{masterNo:'B02'});
 const childLock=db.statements.findIndex(q=>q.includes('FROM pattern_colorways')&&q.includes('FOR UPDATE'));
 const productCheck=db.statements.findIndex(q=>q.includes('FROM v2_products'));
 assert(childLock>=0&&productCheck>childLock,'must lock every child version before checking products');
});
test('P3-1a deletion checks children, product references and database FK failures',async()=>{
 const db=new TestDb();const master=await createPatternMaster(db,actor,{masterNo:'A01'});
 db.versions=true;await assert.rejects(deletePatternMaster(db,actor,master.id),errorStatus(409));
 assert.equal(db.items.length,1);db.versions=false;db.referenced=true;
 await assert.rejects(deletePatternMaster(db,actor,master.id),errorStatus(409));
 db.referenced=false;assert.deepEqual(await deletePatternMaster(db,actor,master.id),{id:master.id,deleted:true});
 assert.equal(db.items.length,0);
});
test('P3-1a not found and strict IDs fail safely',async()=>{
 const db=new TestDb();
 await assert.rejects(updatePatternMaster(db,actor,'5',{isActive:false}),errorStatus(404));
 await assert.rejects(deletePatternMaster(db,actor,'5'),errorStatus(404));
 for(const identity of ['0','01','-1','18446744073709551616'])
  await assert.rejects(deletePatternMaster(db,actor,identity),errorStatus(400));
});
class HttpDb extends TestDb {
 tokenValid=true;revokeAfterHttp=false;unavailable=false;
 override async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  if(this.unavailable)throw Error('PRIVATE DB ERROR');
  if(sql.includes('JOIN v2_access_users')){
   if(!this.tokenValid||params[0]!==hashSessionToken('a'.repeat(64)))return [[],[]];
   return [[{user_id:'2',username:'sales',display_name:'Sales',role:'sales',can_manage_own_orders:0,can_manage_products:this.granted?1:0,session_id:'9'}],[]];
  }
  if(this.revokeAfterHttp&&sql.includes('FROM v2_access_users'))return [[{id:'2',role:'sales',is_active:1,can_manage_products:0}],[]];
  return super.query(sql,params);
 }
}
async function httpServer(db:HttpDb,act:(base:string)=>Promise<void>){
 const app=express();app.use('/api/v2',createPatternMasterRouter(db,db));
 const server:Server=await new Promise((resolve,reject)=>{
  const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));instance.once('error',reject);
 });
 try{const address=server.address();assert(address&&typeof address!=='string');await act('http://127.0.0.1:'+address.port+'/api/v2');}
 finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}
test('P3-1a HTTP list/create/update/delete require current login and server-side grant',async()=>{
 const db=new HttpDb();
 await httpServer(db,async base=>{
  const request=(path:string,method='GET',body?:unknown,token='a'.repeat(64))=>
   fetch(base+path,{method,headers:{authorization:token?'Bearer '+token:'','content-type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.equal((await request('/pattern-masters','GET',undefined,'')).status,401);
  const created=await request('/pattern-masters','POST',{masterNo:' abc9 '});
  assert.equal(created.status,201);assert.equal((await created.json() as {masterNo:string}).masterNo,'ABC9');
  assert.equal((await request('/pattern-masters','POST',{masterNo:'ABC9'})).status,409);
  const list=await request('/pattern-masters');assert.equal(list.status,200);
  assert.equal(list.headers.get('cache-control'),'no-store');
  assert.equal((await list.json() as {items:unknown[]}).items.length,1);
  const edited=await request('/pattern-masters/1','PATCH',{isActive:false});
  assert.equal(edited.status,200);
  assert.equal((await request('/pattern-masters').then(r=>r.json()) as {items:unknown[]}).items.length,0);
  assert.equal((await request('/pattern-masters?includeInactive=true').then(r=>r.json()) as {items:unknown[]}).items.length,1);
  db.granted=false;assert.equal((await request('/pattern-masters','POST',{masterNo:'D2'})).status,201);
  db.granted=true;db.revokeAfterHttp=true;
  assert.equal((await request('/pattern-masters/1','PATCH',{isActive:true})).status,200);
  db.revokeAfterHttp=false;
  const deleted=await request('/pattern-masters/1','DELETE');assert.equal(deleted.status,200);
  assert.equal((await request('/pattern-masters')).status,200);
  db.unavailable=true;
  const failed=await request('/pattern-masters');assert.equal(failed.status,503);
  assert.equal((await failed.text()).includes('PRIVATE DB ERROR'),false);
 });
});
test('P3-1a HTTP rejects malformed JSON and non-JSON content without leaking stacks',async()=>{
 const db=new HttpDb();
 await httpServer(db,async base=>{
  const headers={authorization:'Bearer '+'a'.repeat(64),'content-type':'application/json'};
  const malformed=await fetch(base+'/pattern-masters',{method:'POST',headers,body:'{invalid'});
  assert.equal(malformed.status,400);assert.equal(malformed.headers.get('content-type')?.includes('application/json'),true);
  assert.equal((await malformed.text()).includes('<html>'),false);
  const wrongType=await fetch(base+'/pattern-masters',{method:'POST',headers:{...headers,'content-type':'text/plain'},body:'masterNo=ABC'});
  assert.equal(wrongType.status,400);assert.equal(db.items.length,0);
 });
});