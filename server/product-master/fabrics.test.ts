import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type {Server} from 'node:http';
import {hashSessionToken} from '../access/password';
import type {AppPrincipal} from '../access/types';
import {createFabric,listFabrics,getFabric,updateFabric,deleteFabric,FabricError} from './fabrics';
import {createFabricRouter} from './fabricsRoutes';

const actor:AppPrincipal={userId:'2',sessionId:'9',username:'sales',displayName:'Sales',
 role:'sales',canManageOwnOrders:false,canManageProducts:true};
type Row={id:string;fabric_no:string;fabric_name:string;composition:string|null;weight_value:string|null;
 weight_unit:'gsm'|'mm'|null;width_value:string|null;remark:string|null;is_active:number};
class DB{
 items:Row[]=[];next=1;grant=true;active=true;session=true;role:'admin'|'sales'='sales';
 referenced=false;fkFailure=false;failUpdate=false;databaseError=false;
 statements:string[]=[];commits=0;rollbacks=0;reprintMarks=0;
 cards:Record<string,unknown>[]=[];cardFailure='';
 async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  this.statements.push(sql);
  if(this.databaseError)throw Error('PRIVATE DATABASE CREDENTIALS');
  if(sql.includes('JOIN v2_access_users')){
   if(params[0]!==hashSessionToken('a'.repeat(64))||!this.active||!this.session)return [[],[]];
   return [[{user_id:'2',role:this.role,username:'sales',display_name:'Sales',
    can_manage_products:this.grant?1:0,can_manage_own_orders:0,session_id:'9'}],[]];
  }
  if(sql.includes('FROM v2_access_users'))return [this.active?[{id:'2',role:this.role,is_active:1,
   can_manage_products:this.grant?1:0}]:[],[]];
  if(sql.includes('FROM v2_access_sessions'))return [this.session?[{id:'9'}]:[],[]];

  if(sql.startsWith('UPDATE sample_cards SET reprint_revision=')){
   if(this.cardFailure)throw Object.assign(Error('PRIVATE UPDATE sample_cards'),{code:this.cardFailure});
   this.reprintMarks++;return [{affectedRows:1},[]];
  }
  if(sql.startsWith('UPDATE sample_cards SET deleted_at=')){
   if(this.cardFailure)throw Error('PRIVATE UPDATE sample_cards');
   this.cards.forEach(card=>{if(card.fabric_id===String(params[0])){card.deleted_at='now';card.is_active=0;}});
   return [{affectedRows:1},[]];
  }
  if(sql.startsWith('UPDATE sample_card_tokens'))return [{affectedRows:1},[]];
  if(sql.startsWith('UPDATE v2_fabrics SET deleted_at=')){
   const row=this.items.find(x=>x.id===String(params[0]));
   if(!row)return [{affectedRows:0},[]];
   row.is_active=0;(row as any).deleted_at='now';return [{affectedRows:1},[]];
  }
  if(sql.includes('FROM sample_cards')){
   if(this.cardFailure==='MALFORMED')return [{affectedRows:1},[]];
   if(this.cardFailure)throw Object.assign(Error('PRIVATE SELECT sample_cards'),{code:this.cardFailure});
   const column=sql.includes('fabric_id=?')?'fabric_id':'master_id';
   return [this.cards.filter(card=>card[column]===String(params[0])&&
    (!sql.includes('is_active=1')||card.is_active===1)),[]];
  }
  if(sql.startsWith('SELECT')&&sql.includes('FROM v2_products'))
   return [this.referenced?[{id:'20'}]:[],[]];
  if(sql.startsWith('INSERT INTO v2_fabrics')){
   const no=String(params[0]);
   if(this.items.some(x=>x.fabric_no===no))throw Object.assign(Error('secret'),{code:'ER_DUP_ENTRY'});
   const item:Row={id:String(this.next++),fabric_no:no,fabric_name:String(params[1]),
    composition:params[2] as string|null,weight_value:params[3]==null?null:String(params[3]),
    weight_unit:params[4] as Row['weight_unit'],width_value:params[5]==null?null:String(params[5]),
    remark:params[6] as string|null,is_active:1};
   this.items.push(item);return [{insertId:item.id,affectedRows:1},[]];
  }
  if(sql.startsWith('SELECT')&&sql.includes('FROM v2_fabrics')){
   let items=this.items.filter(x=>!sql.includes('deleted_at IS NULL')||!(x as any).deleted_at);
   if(sql.includes('WHERE id=?'))items=items.filter(x=>x.id===String(params[0]));
   if(sql.includes('is_active=1'))items=items.filter(x=>x.is_active===1);
   if(sql.includes('LIKE ? ESCAPE')) {
    const needle=String(params[sql.includes('is_active=1')?0:0]).slice(1,-1).replaceAll('!%','%').replaceAll('!_','_').replaceAll('!!','!');
    items=items.filter(x=>[x.fabric_no,x.fabric_name,x.composition??''].some(t=>t.toLowerCase().includes(needle.toLowerCase())));
   }
   const limIdx=sql.indexOf(' LIMIT ? OFFSET ?');
   if(limIdx>=0)items=items.slice(Number(params.at(-1)),Number(params.at(-1))+Number(params.at(-2)));
   return [items,[]];
  }
  if(sql.startsWith('UPDATE v2_fabrics')){
   if(this.failUpdate)throw Error('PRIVATE UPDATE FAILURE');
   const row=this.items.find(x=>x.id===String(params[params.length-1]));
   if(!row)return [{affectedRows:0},[]];
   if(this.items.some(x=>x.id!==row.id&&x.fabric_no===String(params[0])))
    throw Object.assign(Error('database uniqueness'),{code:'ER_DUP_ENTRY'});
   const keys=['fabric_no','fabric_name','composition','weight_value','weight_unit','width_value','remark','is_active'] as const;
   keys.forEach((k,i)=>{const value=params[i];(row as unknown as Record<string,unknown>)[k]=k==='is_active'?Number(value):value==null?null:String(value);});
   return [{affectedRows:1},[]];
  }
  if(sql.startsWith('DELETE FROM v2_fabrics')){
   if(this.fkFailure)throw Object.assign(Error('fk secret'),{code:'ER_ROW_IS_REFERENCED_2'});
   const size=this.items.length;this.items=this.items.filter(x=>x.id!==String(params[0]));
   return [{affectedRows:size-this.items.length},[]];
  }
  if(sql.startsWith('INSERT INTO business_delete_events'))return [{affectedRows:1},[]];
  throw Error('Unrecognized SQL '+sql);
 }
 async getConnection(){
  const before=structuredClone(this.items);
  return {query:this.query.bind(this),beginTransaction:async()=>{},
   commit:async()=>{this.commits++;},rollback:async()=>{this.rollbacks++;this.items=before;},release:()=>{}};
 }
}
const status=(value:number)=>(error:unknown)=>error instanceof FabricError&&error.status===value;
test('P3-3 create with normalized unique fabric number and optional attributes',async()=>{
 const db=new DB();
 const created=await createFabric(db,actor,{fabricNo:' f018 ',fabricName:' 轻柔雪纺 '});
 assert.deepEqual(created,{id:'1',fabricNo:'F018',fabricName:'轻柔雪纺',composition:null,
  weightValue:null,weightUnit:null,widthValue:null,remark:null,isActive:true});
 assert.equal(db.items[0].fabric_no,'F018');
 await assert.rejects(createFabric(db,actor,{fabricNo:'f018',fabricName:'别名'}),status(409));
 assert.equal(db.items.length,1);assert.equal(db.rollbacks,1);
});
test('AC-98 B2-5 real fabric printed-value updates mark all linked cards; unchanged and remark-only edits do not',async()=>{
 const db=new DB(),item=await createFabric(db,actor,{fabricNo:'f018',fabricName:'绸'});
 await updateFabric(db,actor,item.id,{fabricName:'绸改名'});
 assert.equal(db.reprintMarks,1);
 await updateFabric(db,actor,item.id,{remark:'只改内部备注'});
 await updateFabric(db,actor,item.id,{fabricName:'绸改名'});
 assert.equal(db.reprintMarks,1);
 await updateFabric(db,actor,item.id,{composition:'100%真丝',weightValue:16,weightUnit:'mm'});
 assert.equal(db.reprintMarks,2);
});
test('P3-3 gsm/mm weight, cm width, remarks and decimal strings from DB',async()=>{
 const db=new DB();
 const a=await createFabric(db,actor,{fabricNo:'s23',fabricName:'棉布',composition:' 100%棉 ',
  weightValue:95.123,weightUnit:'gsm',widthValue:145.25,remark:' 轻薄 '});
 const b=await createFabric(db,actor,{fabricNo:'s24',fabricName:'真丝',weightValue:18.5,weightUnit:'mm'});
 assert.equal(a.weightValue,95.123);assert.equal(a.widthValue,145.25);assert.equal(a.composition,'100%棉');
 assert.equal(b.weightUnit,'mm');assert.equal(b.widthValue,null);
 const fromDb=await getFabric(db,a.id);
 assert.deepEqual(fromDb,a);assert.equal(db.items.length,2);
});
test('P3-3 required fields, invalid combinations and precision fail before SQL',async()=>{
 const db=new DB();
 const wrong:unknown[]=[
 {},{fabricNo:'x'},{fabricName:'Name',fabricNo:''},{fabricName:'Name',fabricNo:'  '},
 {fabricNo:'S1',fabricName:' '},
 {fabricNo:'S1',fabricName:'Name',weightUnit:'gsm'},
 {fabricNo:'S1',fabricName:'Name',weightValue:2},
 {fabricNo:'S1',fabricName:'Name',weightValue:0,weightUnit:'gsm'},
 {fabricNo:'S1',fabricName:'Name',weightValue:-1,weightUnit:'mm'},
 {fabricNo:'S1',fabricName:'Name',weightValue:5,weightUnit:'kg'},
 {fabricNo:'S1',fabricName:'Name',weightValue:1.2345,weightUnit:'mm'},
 {fabricNo:'S1',fabricName:'Name',weightValue:2,weightUnit:'gsm',widthValue:1.234},
 {fabricNo:'S1',fabricName:'Name',widthValue:0},
 {fabricNo:'S1',fabricName:'Name',widthValue:-1},
 {fabricNo:'S1',fabricName:'Name',isActive:false},
 {fabricNo:'S1',fabricName:'Name',id:'88'},
 {fabricNo:'S1',fabricName:'Name',composition:'x'.repeat(501)},
 {fabricNo:'S1',fabricName:'Name',fabricNoValue:1}
 ];
 for(const data of wrong)await assert.rejects(createFabric(db,actor,data),status(400));
 assert.equal(db.statements.length,0);
});
test('P3-3 list defaults to active and supports inactive, safe search, bounded pagination',async()=>{
 const db=new DB();
 await createFabric(db,actor,{fabricNo:'A001',fabricName:'条纹'});
 const b=await createFabric(db,actor,{fabricNo:'B002',fabricName:'花布',composition:'纯棉'});
 db.items.find(x=>x.id===b.id)!.is_active=0;
 assert.deepEqual((await listFabrics(db)).map(x=>x.fabricNo),['A001']);
 assert.equal((await listFabrics(db,{includeInactive:true})).length,2);
 assert.equal((await listFabrics(db,{includeInactive:true,query:'  b002 ',limit:10,offset:0}))[0].id,b.id);
 await assert.rejects(listFabrics(db,{limit:101}),status(400));
 await assert.rejects(listFabrics(db,{offset:-1}),status(400));
 assert(db.statements.some(sql=>sql.includes("LIKE ? ESCAPE '!'")));
});
test('P3-3 search treats SQL wildcards literally and can match composition',async()=>{
 const db=new DB();
 const one=await createFabric(db,actor,{fabricNo:'A01',fabricName:'条纹_100%',composition:'纯棉'});
 await createFabric(db,actor,{fabricNo:'B01',fabricName:'普通条纹',composition:'涤纶'});
 const special=await listFabrics(db,{query:' _100% '});
 assert.deepEqual(special.map(x=>x.id),[one.id]);
 const cotton=await listFabrics(db,{query:'纯棉'});
 assert.deepEqual(cotton.map(x=>x.id),[one.id]);
 assert(db.statements.some(q=>q.includes("LIKE ? ESCAPE '!'")));
});
test('P3-3 referenced fabric can edit attributes/deactivate, but number locked and deletion blocked',async()=>{
 const db=new DB(),fabric=await createFabric(db,actor,{fabricNo:'F01',fabricName:'Old'});
 db.referenced=true;
 const updated=await updateFabric(db,actor,fabric.id,{fabricName:'New',composition:'棉',
  weightValue:18.5,weightUnit:'mm',widthValue:110,isActive:true});
 assert.equal(updated.fabricNo,'F01');assert.equal(updated.fabricName,'New');
 assert.equal(updated.isActive,true);assert.equal(updated.weightUnit,'mm');
 await assert.rejects(updateFabric(db,actor,fabric.id,{fabricNo:'F02'}),status(409));
 await assert.rejects(deleteFabric(db,actor,fabric.id),status(409));
 assert.equal(db.items.length,1);assert.equal(db.items[0].fabric_no,'F01');
});
test('P3-3 unreferenced rename, reuse no conflicts, independent deletion and FK fallback',async()=>{
 const db=new DB();
 const one=await createFabric(db,actor,{fabricNo:'AB1',fabricName:'One'});
 const two=await createFabric(db,actor,{fabricNo:'AB2',fabricName:'Two'});
 await assert.rejects(updateFabric(db,actor,one.id,{fabricNo:'ab2'}),status(409));
 assert.equal((await updateFabric(db,actor,one.id,{fabricNo:'ab3'})).fabricNo,'AB3');
 db.fkFailure=true;await assert.rejects(deleteFabric(db,actor,one.id),status(409));
 db.fkFailure=false;assert.deepEqual(await deleteFabric(db,actor,one.id),{id:one.id,deleted:true});
 assert.equal((await getFabric(db,two.id)).fabricNo,'AB2');
});
test('P3-3 partial weight edits cannot leave dangling unit, optional null clears',async()=>{
 const db=new DB();
 const f=await createFabric(db,actor,{fabricNo:'S1',fabricName:'Silk',weightValue:16.5,
  weightUnit:'mm',widthValue:140});
 await assert.rejects(updateFabric(db,actor,f.id,{weightValue:null}),status(400));
 await assert.rejects(updateFabric(db,actor,f.id,{weightUnit:null}),status(400));
 const cleared=await updateFabric(db,actor,f.id,{weightValue:null,weightUnit:null,widthValue:null});
 assert.equal(cleared.weightValue,null);assert.equal(cleared.weightUnit,null);
 assert.equal(cleared.widthValue,null);
});
test('P3-3 invalid ID and missing fabric safely reject updates/deletions',async()=>{
 const db=new DB();
 for(const id of ['0','01','-2','18446744073709551616'])
  await assert.rejects(deleteFabric(db,actor,id),status(400));
 await assert.rejects(getFabric(db,'25'),status(404));
 await assert.rejects(updateFabric(db,actor,'25',{fabricName:'No'}),status(404));
 await assert.rejects(deleteFabric(db,actor,'25'),status(404));
});
test('P3-3 revocation rechecked inside write transaction with rollback',async()=>{
 for(const field of ['active','session'] as const){
  const db=new DB();db[field]=false;
  await assert.rejects(createFabric(db,actor,{fabricNo:'S1',fabricName:'Name'}),status(401));
  assert.equal(db.items.length,0);assert.equal(db.rollbacks,1);
 }
 const oldGrant=new DB();oldGrant.grant=false;
 assert.equal((await createFabric(oldGrant,actor,{fabricNo:'S1',fabricName:'Name'})).fabricNo,'S1');
 const db=new DB();const f=await createFabric(db,actor,{fabricNo:'A1',fabricName:'Before'});
 db.failUpdate=true;
 await assert.rejects(updateFabric(db,actor,f.id,{fabricName:'After'}));
 assert.equal(db.items[0].fabric_name,'Before');
});
test('P3-3 rename locks fabric row before checking product references',async()=>{
 const db=new DB(),fabric=await createFabric(db,actor,{fabricNo:'AB1',fabricName:'Name'});
 await updateFabric(db,actor,fabric.id,{fabricNo:'AB2'});
 const lock=db.statements.findIndex(x=>x.includes('FROM v2_fabrics WHERE id=?')&&x.includes('FOR UPDATE'));
 const ref=db.statements.findIndex(x=>x.includes('FROM v2_products'));
 assert(lock>=0&&ref>lock);
});
async function serve(db:DB,callback:(base:string)=>Promise<void>){
 const app=express();app.use('/api/v2',createFabricRouter(db,db));
 const server:Server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',reject);});
 try{const a=server.address();assert(a&&typeof a!=='string');
  await callback('http://127.0.0.1:'+a.port+'/api/v2');
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}
const token='a'.repeat(64);
test('B2-3 card-only fabric reference locks identity for active and inactive cards',async()=>{
 for(const active of [1,0]){
  const db=new DB(),item=await createFabric(db,actor,{fabricNo:'F01',fabricName:'Before'});
  db.cards=[{id:'71',fabric_id:item.id,is_active:active}];
  db.statements=[];
  await assert.rejects(updateFabric(db,actor,item.id,{fabricNo:'F02'}),status(409));
  assert.deepEqual(await deleteFabric(db,actor,item.id),{id:item.id,deleted:true});
  assert.equal(db.items[0].fabric_no,'F01');assert.equal(db.rollbacks,1);
  assert.equal((await listFabrics(db,{includeInactive:true})).length,0);
  assert.equal(db.cards[0].is_active,0);assert(db.cards[0].deleted_at);
  const parent=db.statements.findIndex(q=>q.includes('FROM v2_fabrics')&&q.includes('FOR UPDATE'));
  const card=db.statements.findIndex(q=>q.includes('FROM sample_cards'));
  assert(parent>=0&&card>parent);
  assert(db.statements[card].includes('FOR SHARE'));
  assert(!db.statements[card].includes('is_active'));
 }
});
test('B2-5 changing printed fabric attributes requires card marker write or fully rolls back',async()=>{
 const db=new DB(),item=await createFabric(db,actor,{fabricNo:'F01',fabricName:'Before'});
 db.cards=[{id:'71',fabric_id:item.id,is_active:0}];db.cardFailure='ER_TABLEACCESS_DENIED_ERROR';
 db.statements=[];
 await assert.rejects(updateFabric(db,actor,item.id,{fabricNo:'f01',fabricName:'After',composition:'Cotton',
  weightValue:18,weightUnit:'mm',widthValue:140,remark:'Current',isActive:true}),/PRIVATE UPDATE/);
 assert.equal(db.items[0].fabric_name,'Before','failed reprint update must roll back fabric edit too');
 db.cardFailure='';
 const updated=await updateFabric(db,actor,item.id,{fabricNo:'f01',fabricName:'After',composition:'Cotton',
  weightValue:18,weightUnit:'mm',widthValue:140,remark:'Current',isActive:true});
 assert.equal(updated.fabricName,'After');assert.equal(db.reprintMarks,1);
 assert(db.statements.some(q=>q.startsWith('UPDATE sample_cards SET reprint_revision=')));
});
test('B2-3 missing phase-two card table retains phase-one fabric identity rules',async()=>{
 const db=new DB(),item=await createFabric(db,actor,{fabricNo:'F01',fabricName:'Name'});
 db.cardFailure='ER_NO_SUCH_TABLE';
 assert.equal((await updateFabric(db,actor,item.id,{fabricNo:'F02'})).fabricNo,'F02');
 db.referenced=true;
 await assert.rejects(updateFabric(db,actor,item.id,{fabricNo:'F03'}),status(409));
 await assert.rejects(deleteFabric(db,actor,item.id),status(409));
 db.referenced=false;assert.equal((await deleteFabric(db,actor,item.id)).deleted,true);
});
test('B2-3 failed card lookup aborts fabric identity writes and rolls back',async()=>{
 for(const failure of ['ER_BAD_FIELD_ERROR','ER_TABLEACCESS_DENIED_ERROR','ER_LOCK_DEADLOCK','DRIVER_FAILURE','MALFORMED']){
  for(const action of ['rename','delete']){
   const db=new DB(),item=await createFabric(db,actor,{fabricNo:'F01',fabricName:'Name'});
   db.cardFailure=failure;db.statements=[];
   await assert.rejects(action==='rename'?updateFabric(db,actor,item.id,{fabricNo:'F02'}):deleteFabric(db,actor,item.id));
   assert.equal(db.rollbacks,1);assert.equal(db.commits,1);assert.equal(db.items[0].fabric_no,'F01');
   assert(!db.statements.some(q=>q.startsWith('UPDATE v2_fabrics')||q.startsWith('DELETE FROM v2_fabrics')));
  }
 }
});
test('B2-3 fabric HTTP card conflict is 409 and card driver error is safe 503',async()=>{
 const db=new DB(),item=await createFabric(db,actor,{fabricNo:'F01',fabricName:'Name'});
 db.cards=[{id:'71',fabric_id:item.id,is_active:0}];
 await serve(db,async base=>{
  assert.equal((await send(base,'/fabrics/'+item.id,'PATCH',{fabricNo:'F02'})).status,409);
  assert.equal((await send(base,'/fabrics/'+item.id,'PATCH',{fabricName:'After'})).status,200);
  db.cardFailure='ER_TABLEACCESS_DENIED_ERROR';
  for(const method of ['PATCH','DELETE']){
   const res=await send(base,'/fabrics/'+item.id,method,method==='PATCH'?{fabricNo:'F02'}:undefined);
   assert.equal(res.status,503);assert(!/PRIVATE|SELECT|sample_cards/.test(await res.text()));
  }
  db.cardFailure='';
  assert.equal((await send(base,'/fabrics/'+item.id,'DELETE')).status,200);
  assert.equal((await send(base,'/fabrics/'+item.id)).status,404);
 });
});

function send(base:string,path:string,method='GET',body?:unknown,authenticated=true){
 return fetch(base+path,{method,headers:{...(authenticated?{authorization:'Bearer '+token}:{}),
  ...(body===undefined?{}:{'content-type':'application/json'})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});
}
test('P3-3 HTTP reads require bearer, writes require grant, CRUD statuses and no-store',async()=>{
 const db=new DB();
 await serve(db,async base=>{
  assert.equal((await send(base,'/fabrics','GET',undefined,false)).status,401);
  const cr=await send(base,'/fabrics','POST',{fabricNo:'F001',fabricName:'雪纺'});
  assert.equal(cr.status,201);const data=await cr.json() as {id:string};
  const list=await send(base,'/fabrics');assert.equal(list.status,200);
  assert.equal(list.headers.get('cache-control'),'no-store');
  assert.equal((await list.json() as {items:unknown[]}).items.length,1);
  assert.equal((await send(base,'/fabrics/'+data.id)).status,200);
  assert.equal((await send(base,'/fabrics','POST',{fabricNo:'F001',fabricName:'Other'})).status,409);
  db.grant=false;
  assert.equal((await send(base,'/fabrics/'+data.id,'PATCH',{fabricName:'共享更新'})).status,200);
  db.grant=true;db.referenced=true;
  assert.equal((await send(base,'/fabrics/'+data.id,'DELETE')).status,409);
  assert.equal((await send(base,'/fabrics/'+data.id,'PATCH',{isActive:false})).status,400);
  assert.equal((await send(base,'/fabrics')).status,200);
  assert.equal((await (await send(base,'/fabrics')).json() as {items:unknown[]}).items.length,1);
  assert.equal((await (await send(base,'/fabrics?includeInactive=true')).json() as {items:unknown[]}).items.length,1);
 });
});
test('P3-3 HTTP malformed body, invalid parameters, DB exception not leak stack',async()=>{
 const db=new DB();
 await serve(db,async base=>{
  assert.equal((await send(base,'/fabrics?includeInactive=bogus')).status,400);
  assert.equal((await send(base,'/fabrics?limit=99999')).status,400);
  assert.equal((await send(base,'/fabrics/0')).status,400);
  assert.equal((await send(base,'/fabrics/1')).status,404);
  const wrongType=await fetch(base+'/fabrics',{method:'POST',
   headers:{authorization:'Bearer '+token,'content-type':'text/plain'},body:'secret'});
  assert.equal(wrongType.status,400);
  const malformed=await fetch(base+'/fabrics',{method:'POST',
   headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:'{broken'});
  assert.equal(malformed.status,400);assert.equal((await malformed.text()).includes('<html>'),false);
  db.databaseError=true;const fail=await send(base,'/fabrics');
  assert.equal(fail.status,503);assert.equal((await fail.text()).includes('PRIVATE DATABASE CREDENTIALS'),false);
 });
});
test('fabric numbers accept nonempty supplier text and still reject blank values',async()=>{
 const db=new DB();
 for(const fabricNo of ['10151-8','底布 / A_01','12.5','0']){
  const saved=await createFabric(db,actor,{fabricNo,fabricName:'底布'});
  assert.equal(saved.fabricNo,fabricNo);
 }
 await assert.rejects(createFabric(db,actor,{fabricNo:'  ',fabricName:'底布'}),status(400));
});
