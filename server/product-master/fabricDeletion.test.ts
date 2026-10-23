import assert from 'node:assert/strict';
import test from 'node:test';
import {deleteFabric,getFabric,listFabrics,updateFabric} from './fabrics';
import type {AppPrincipal} from '../access/types';
const actor:AppPrincipal={userId:'2',sessionId:'9',username:'sales',displayName:'Sales',role:'sales',canManageOwnOrders:false,canManageProducts:true};
class Db{
 deleted=false;referenced=false;failRetire=false;retired=false;revoked=false;commits=0;rollbacks=0;
 row={id:'1',fabric_no:'F01',fabric_name:'雪纺',is_active:1};
 async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
  if(sql.includes('FROM v2_access_users'))return [[{id:'2',role:'sales',is_active:1}],[]];
  if(sql.includes('FROM v2_access_sessions'))return [[{id:'9'}],[]];
  if(sql.includes('FROM v2_fabrics'))return [this.deleted&&sql.includes('deleted_at IS NULL')?[]:[this.row],[]];
  if(sql.includes('FROM v2_products'))return [this.referenced?[{id:'3'}]:[],[]];
  if(sql.includes('FROM sample_cards')&&sql.startsWith('SELECT'))return [[{id:'7'}],[]];
  if(sql.startsWith('UPDATE sample_cards')){
   if(this.failRetire)throw Error('retirement failed');
   this.retired=true;return [{affectedRows:1},[]];
  }
  if(sql.startsWith('UPDATE sample_card_tokens')){this.revoked=true;return [{affectedRows:1},[]];}
  if(sql.startsWith('UPDATE v2_fabrics SET deleted_at=')){this.deleted=true;this.row.is_active=0;return [{affectedRows:1},[]];}
  if(sql.startsWith('INSERT INTO business_delete_events'))return [{affectedRows:1},[]];
  throw Error('Unexpected SQL '+sql);
 }
 async getConnection(){
  const before={deleted:this.deleted,retired:this.retired,revoked:this.revoked,row:{...this.row}};
  return {query:this.query.bind(this),beginTransaction:async()=>{},commit:async()=>{this.commits++;},
   rollback:async()=>{Object.assign(this,before);this.rollbacks++;},release(){}};
 }
}
test('zero products: deleting fabric retires cards and revokes QR while retaining historical rows',async()=>{
 const db=new Db();
 assert.deepEqual(await deleteFabric(db,actor,'1'),{id:'1',deleted:true});
 assert(db.deleted);assert(db.retired);assert(db.revoked);assert.equal(db.commits,1);
 assert.equal(db.row.fabric_no,'F01');
 assert.deepEqual(await listFabrics(db,{includeInactive:true}),[]);
 await assert.rejects(getFabric(db,'1'),e=>(e as any).status===404);
 await assert.rejects(updateFabric(db,actor,'1',{isActive:true}),e=>(e as any).status===404);
});
test('product references still block fabric deletion before any card or fabric mutation',async()=>{
 const db=new Db();db.referenced=true;
 await assert.rejects(deleteFabric(db,actor,'1'),e=>(e as any).status===409);
 assert(!db.deleted);assert(!db.retired);assert(!db.revoked);assert.equal(db.rollbacks,1);
});
test('card retirement failure rolls back fabric and QR changes',async()=>{
 const db=new Db();db.failRetire=true;
 await assert.rejects(deleteFabric(db,actor,'1'),/retirement failed/);
 assert(!db.deleted);assert(!db.retired);assert(!db.revoked);assert.equal(db.commits,0);
});
