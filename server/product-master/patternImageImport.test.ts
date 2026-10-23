import assert from 'node:assert/strict';
import test from 'node:test';
import type {AppPrincipal} from '../access/types';
import {importPatternImageAsColorway} from './patternImageImport';
import {PatternMasterError,deletePatternMaster} from './patternMasters';
import express from 'express';
import type {Server} from 'node:http';
import {hashSessionToken} from '../access/password';
import {createPatternMasterRouter} from './patternMastersRoutes';
const actor:AppPrincipal={userId:'2',sessionId:'9',username:'sales',displayName:'Sales',role:'sales',canManageProducts:true,canManageOwnOrders:false};
const a='a1111111-1111-4111-8111-111111111111';
class MemoryDb {
 masters:{id:string;master_no:string;next_colorway_no:string;is_active:number;deleted_at?:string}[]=[];
 versions:{id:string;master_id:string;colorway_no:string;pattern_image_asset_id:string|null;remark:string;is_active:number}[]=[];
 assets=[{id:a,status:'ready',purpose:'product_image',ref_count:0}];
 cards=false;products=false;commits=0;rollbacks=0;nextMasterId=1;nextVersionId=11;queries:string[]=[];
 async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
  this.queries.push(sql);
  if(sql.includes('FROM v2_access_users'))return [[{id:'2',role:'sales',is_active:1}],[]];
  if(sql.includes('FROM v2_access_sessions'))return [[{id:'9'}],[]];
  if(sql.startsWith('SELECT')&&sql.includes('FROM pattern_masters')){
   return [this.masters.filter(m=>!sql.includes('deleted_at IS NULL')||!m.deleted_at).filter(m=>sql.includes('WHERE master_no=?')?m.master_no===args[0]:sql.includes('WHERE id=?')?m.id===args[0]:true),[]];
  }
  if(sql.startsWith('INSERT INTO pattern_masters')){
   if(this.masters.some(m=>!m.deleted_at&&m.master_no===args[0]))throw Object.assign(Error('duplicate'),{code:'ER_DUP_ENTRY'});
   const m={id:String(this.nextMasterId++),master_no:String(args[0]),next_colorway_no:'1',is_active:1};
   this.masters.push(m);return [{insertId:m.id,affectedRows:1},[]];
  }
  if(sql.startsWith('UPDATE pattern_masters SET next_colorway_no=')){
   this.masters.find(m=>m.id===args[1])!.next_colorway_no=String(args[0]);return [{affectedRows:1},[]];
  }
  if(sql.startsWith('INSERT INTO pattern_colorways')){
   if(this.versions.some(v=>v.master_id===args[0]&&v.colorway_no===String(args[1])))throw Object.assign(Error('duplicate'),{code:'ER_DUP_ENTRY'});
   const v={id:String(this.nextVersionId++),master_id:String(args[0]),colorway_no:String(args[1]),pattern_image_asset_id:null,remark:'',is_active:1};
   this.versions.push(v);return [{insertId:v.id,affectedRows:1},[]];
  }
  if(sql.includes('FROM image_assets'))return [this.assets.filter(x=>args.includes(x.id)),[]];
  if(sql.startsWith('UPDATE image_assets SET ref_count=ref_count+1')){this.assets.find(x=>x.id===args[0])!.ref_count++;return [{affectedRows:1},[]];}
  if(sql.startsWith('UPDATE image_assets SET status=IF')){const asset=this.assets.find(x=>x.id===args[0])!;asset.ref_count--;if(!asset.ref_count)asset.status='recycled';return [{affectedRows:1},[]];}
  if(sql.startsWith('UPDATE pattern_colorways SET pattern_image_asset_id=')){
   this.versions.find(x=>x.id===args[1])!.pattern_image_asset_id=args[0] as string|null;return [{affectedRows:1},[]];
  }
  if(sql.includes('FROM sample_cards'))return [this.cards?[{id:'91'}]:[],[]];
  if(sql.startsWith('SELECT')&&sql.includes('FROM pattern_colorways'))return [this.versions.filter(v=>v.master_id===String(args[0])&&(!sql.includes('colorway_no=?')||v.colorway_no===String(args[1]))),[]];
  if(sql.includes('FROM v2_products'))return [this.products?[{id:'44'}]:[],[]];
  if(sql.startsWith('DELETE FROM pattern_colorways')){const n=this.versions.length;this.versions=this.versions.filter(v=>v.master_id!==args[0]);return [{affectedRows:n-this.versions.length},[]];}
  if(sql.startsWith('UPDATE pattern_masters SET deleted_at=')){const m=this.masters.find(m=>m.id===args[0]);if(!m)return [{affectedRows:0},[]];m.deleted_at='now';m.is_active=0;return [{affectedRows:1},[]];}
  if(sql.startsWith('DELETE FROM pattern_masters')){const n=this.masters.length;this.masters=this.masters.filter(m=>m.id!==args[0]);return [{affectedRows:n-this.masters.length},[]];}
  if(sql.startsWith('INSERT INTO business_delete_events'))return [{affectedRows:1},[]];
  throw Error('Unexpected SQL: '+sql);
 }
 async getConnection(){
  const snapshot=structuredClone({masters:this.masters,versions:this.versions,assets:this.assets,nextMasterId:this.nextMasterId,nextVersionId:this.nextVersionId});
  return {query:this.query.bind(this),beginTransaction:async()=>{},commit:async()=>{this.commits++;},
   rollback:async()=>{Object.assign(this,structuredClone(snapshot));this.rollbacks++;},release:()=>{}};
 }
}
const bad=(status:number)=>(e:unknown)=>e instanceof PatternMasterError&&e.status===status;
test('explicit import builds master + immutable numbered version and increments image count atomically',async()=>{
 const db=new MemoryDb();
 assert.equal((await importPatternImageAsColorway(db,actor,{masterNo:'G0008',colorwayNo:1,patternImageAssetId:a})).patternNo,'G0008-1');
 assert.equal((await importPatternImageAsColorway(db,actor,{masterNo:'G0008',colorwayNo:3,patternImageAssetId:a})).patternNo,'G0008-3');
 assert.equal(db.masters[0].next_colorway_no,'4');assert.equal(db.versions.length,2);assert.equal(db.assets[0].ref_count,2);
 await importPatternImageAsColorway(db,actor,{masterNo:'G0008',colorwayNo:2,patternImageAssetId:a});
 assert.equal(db.versions.length,3);assert.equal(db.masters[0].next_colorway_no,'4');
});
test('whole master deletion removes all colorways/images once and keeps references safe',async()=>{
 const db=new MemoryDb();
 for(const number of [1,2])await importPatternImageAsColorway(db,actor,{masterNo:'G0008',colorwayNo:number,patternImageAssetId:a});
 db.cards=true;await assert.rejects(deletePatternMaster(db,actor,'1'),bad(409));
 db.cards=false;db.products=true;await assert.rejects(deletePatternMaster(db,actor,'1'),bad(409));
 assert.equal(db.versions.length,2);assert.equal(db.assets[0].ref_count,2);
 db.products=false;assert.deepEqual(await deletePatternMaster(db,actor,'1'),{id:'1',deleted:true});
 assert.equal(db.masters.filter(m=>!m.deleted_at).length,0);assert.equal(db.versions.length,0);assert.equal(db.assets[0].ref_count,0);assert.equal(db.assets[0].status,'recycled');
});
test('import malformed identity fails without writes, missing image rolls back its new master',async()=>{
 const db=new MemoryDb();
 for(const body of [{masterNo:'A-1',colorwayNo:1,patternImageAssetId:a},{masterNo:'G0008',colorwayNo:0,patternImageAssetId:a},{masterNo:'G0008',colorwayNo:1,patternImageAssetId:'bad'}])
  await assert.rejects(importPatternImageAsColorway(db,actor,body),bad(400));
 db.assets[0].status='processing';
 await assert.rejects(importPatternImageAsColorway(db,actor,{masterNo:'G0008',colorwayNo:1,patternImageAssetId:a}),bad(409));
 assert.equal(db.masters.filter(m=>!m.deleted_at).length,0);assert.equal(db.versions.length,0);assert.equal(db.assets[0].ref_count,0);
});
class HttpDb extends MemoryDb {
 override async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
  if(sql.includes('JOIN v2_access_users')){
   if(args[0]!==hashSessionToken('a'.repeat(64)))return [[],[]];
   return [[{user_id:'2',username:'sales',display_name:'Sales',role:'sales',can_manage_own_orders:0,can_manage_products:1,session_id:'9'}],[]];
  }
  return super.query(sql,args);
 }
}
test('bulk image import and whole-master delete HTTP enforce identity, conflict and reference safety',async()=>{
 const db=new HttpDb(),app=express();
 app.use('/api/v2',createPatternMasterRouter(db,db));
 const server:Server=await new Promise((resolve,reject)=>{
  const current=app.listen(0,'127.0.0.1',()=>resolve(current));current.once('error',reject);
 });
 try{
  const address=server.address();assert(address&&typeof address!=='string');
  const base='http://127.0.0.1:'+address.port+'/api/v2';
  const submit=(url:string,method:string,body?:unknown,token='a'.repeat(64))=>
   fetch(base+url,{method,headers:{authorization:token?'Bearer '+token:'','content-type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const payload={masterNo:'G0008',colorwayNo:1,patternImageAssetId:a};
  assert.equal((await submit('/pattern-catalog/import','POST',payload,'')).status,401);
  assert.equal((await submit('/pattern-catalog/import','POST',{...payload,colorwayNo:0})).status,400);
  const saved=await submit('/pattern-catalog/import','POST',payload);
  assert.equal(saved.status,201);assert.equal((await saved.json() as {patternNo:string}).patternNo,'G0008-1');
  assert.equal((await submit('/pattern-catalog/import','POST',payload)).status,201);
  db.cards=true;assert.equal((await submit('/pattern-masters/1','DELETE')).status,409);
  db.cards=false;db.products=true;assert.equal((await submit('/pattern-masters/1','DELETE')).status,409);
  db.products=false;assert.equal((await submit('/pattern-masters/1','DELETE')).status,200);
  assert.equal(db.masters.filter(m=>!m.deleted_at).length,0);assert.equal(db.versions.length,0);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});


const b='b2222222-2222-4222-8222-222222222222';
test('same-number import replaces image in place and keeps attributes/sequence; repeated same asset is a no-op',async()=>{
 const db=new MemoryDb();
 const payload={masterNo:'G0008',colorwayNo:1,patternImageAssetId:a};
 const first=await importPatternImageAsColorway(db,actor,payload);
 db.versions[0].remark='keep';db.versions[0].is_active=0;db.products=true;
 db.assets.push({id:b,status:'ready',purpose:'product_image',ref_count:0});
 const replaced=await importPatternImageAsColorway(db,actor,{...payload,patternImageAssetId:b});
 assert.equal(replaced.colorwayId,first.colorwayId);assert.equal(db.versions.length,1);
 assert.equal(db.versions[0].remark,'keep');assert.equal(db.versions[0].is_active,0);
 assert.equal(db.versions[0].pattern_image_asset_id,b);assert.equal(db.assets[0].ref_count,0);
 assert.equal(db.assets[0].status,'recycled');assert.equal(db.assets[1].ref_count,1);
 await importPatternImageAsColorway(db,actor,{...payload,patternImageAssetId:b});
 assert.equal(db.assets[1].ref_count,1);assert.equal(db.masters[0].next_colorway_no,'2');
 db.assets[0].status='processing';
 await assert.rejects(importPatternImageAsColorway(db,actor,payload),bad(409));
 assert.equal(db.versions[0].pattern_image_asset_id,b);assert.equal(db.assets[1].ref_count,1);
});
test('deleted master number imports as a new identity without resurrecting history',async()=>{
 const db=new MemoryDb();const payload={masterNo:'G0008',colorwayNo:1,patternImageAssetId:a};
 const old=await importPatternImageAsColorway(db,actor,payload);
 await deletePatternMaster(db,actor,old.masterId);
 db.assets[0].status='ready';
 const next=await importPatternImageAsColorway(db,actor,payload);
 assert.notEqual(next.masterId,old.masterId);assert.notEqual(next.colorwayId,old.colorwayId);
 assert(db.masters[0].deleted_at);assert.equal(db.masters.filter(x=>!x.deleted_at).length,1);
});
