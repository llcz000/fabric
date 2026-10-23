import assert from 'node:assert/strict';
import test from 'node:test';
import {deletePatternMaster,listPatternMasters,updatePatternMaster} from './patternMasters';
const actor:any={userId:'2',sessionId:'9',username:'sales',displayName:'Sales',role:'sales',canManageProducts:true,canManageOwnOrders:false};
class Db{
 deleted=false;products=false;currentCards=false;versions=2;failUpdate=false;rollbacks=0;
 master={id:'1',master_no:'G0008',is_active:1,next_colorway_no:'3'};
 async query(sql:string):Promise<[unknown,unknown]>{
  if(sql.includes('FROM v2_access_users'))return [[{id:'2',role:'sales',is_active:1}],[]];
  if(sql.includes('FROM v2_access_sessions'))return [[{id:'9'}],[]];
  if(sql.includes('FROM pattern_masters'))return [this.deleted&&sql.includes('deleted_at IS NULL')?[]:[this.master],[]];
  if(sql.includes('FROM sample_cards'))return [sql.includes('deleted_at IS NULL')&&!this.currentCards?[]:[{id:'10'}],[]];
  if(sql.includes('FROM v2_products'))return [this.products?[{id:'20'}]:[],[]];
  if(sql.startsWith('SELECT')&&sql.includes('FROM pattern_colorways'))return [Array.from({length:this.versions},(_,i)=>({id:String(i+5),pattern_image_asset_id:null})),[]];
  if(sql.startsWith('DELETE FROM pattern_colorways')){const count=this.versions;this.versions=0;return [{affectedRows:count},[]];}
  if(sql.startsWith('UPDATE pattern_masters SET deleted_at=')){
   if(this.failUpdate)throw Error('deletion write failed');this.deleted=true;this.master.is_active=0;return [{affectedRows:1},[]];
  }
  if(sql.startsWith('INSERT INTO business_delete_events'))return [{affectedRows:1},[]];
  throw Error('Unexpected SQL '+sql);
 }
 async getConnection(){
  const before={deleted:this.deleted,versions:this.versions,master:{...this.master}};
  return {query:this.query.bind(this),beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{Object.assign(this,before);this.rollbacks++;},release(){}};
 }
}
test('G0008 with two colorways and only retired card history can delete without removing history identity',async()=>{
 const db=new Db();
 assert.deepEqual(await deletePatternMaster(db,actor,'1'),{id:'1',deleted:true});
 assert(db.deleted);assert.equal(db.versions,0);assert.equal(db.master.next_colorway_no,'3');
 assert.deepEqual(await listPatternMasters(db,{includeInactive:true}),[]);
 await assert.rejects(updatePatternMaster(db,actor,'1',{isActive:true}),(e:any)=>e.status===404);
});
test('products and existing nondeleted cards still prevent pattern deletion',async()=>{
 for(const key of ['products','currentCards'] as const){const db=new Db();db[key]=true;
  await assert.rejects(deletePatternMaster(db,actor,'1'),(e:any)=>e.status===409);
  assert(!db.deleted);assert.equal(db.versions,2);
 }
});
test('failed master retirement restores all colorways in the transaction',async()=>{
 const db=new Db();db.failUpdate=true;
 await assert.rejects(deletePatternMaster(db,actor,'1'),/deletion write failed/);
 assert.equal(db.versions,2);assert(!db.deleted);assert.equal(db.rollbacks,1);
});
