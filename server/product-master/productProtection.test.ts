import assert from 'node:assert/strict';
import test from 'node:test';
import {deleteUnusedV2Product,deactivateV2Product,ProductMutationError} from './productProtection';
import type {AppPrincipal} from '../access/types';
const admin:AppPrincipal={userId:'1',role:'admin',username:'admin',displayName:'Admin',sessionId:'8',canManageOwnOrders:true,canManageProducts:true};
const sales:AppPrincipal={...admin,userId:'2',role:'sales',canManageProducts:true};
class Db{
 statements:{sql:string;params:unknown[]}[]=[];commits=0;rollbacks=0;
 hasReference=false;hasImage=false;invalidUser=false;deniedGrant=false;throwFk=false;
 async getConnection(){
 const o=this;
 return {async beginTransaction(){},async commit(){o.commits++},async rollback(){o.rollbacks++},release(){},
  async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
   o.statements.push({sql,params});
   if(sql.includes('FROM v2_access_users')&&sql.includes('FOR SHARE'))
    return [[o.invalidUser?[]:{id:params[0],role:'sales',is_active:1,can_manage_products:o.deniedGrant?0:1,can_manage_own_orders:0}].flat(),[]];
   if(sql.includes('FROM v2_access_sessions')&&sql.includes('FOR SHARE'))return [[{id:8}],[]];
   if(sql.includes('FROM v2_products WHERE id=? FOR UPDATE'))return [[{id:7,is_active:1}],[]];
   if(sql.includes('FROM order_items')&&sql.includes('v2_product_id'))return [[{total:o.hasReference?1:0}],[]];
   if(sql.includes('FROM v2_product_image_assets'))return [o.hasImage?[{id:'19',product_id:'7',asset_id:'a1111111-1111-4111-8111-111111111111',role:'detail',sort_order:0}]:[],[]];
   if(sql.includes('FROM image_assets WHERE id IN'))return [[{id:'a1111111-1111-4111-8111-111111111111',status:'ready',ref_count:0}],[]];
   if(sql.startsWith('DELETE FROM v2_product_image_assets'))return [{affectedRows:0},[]];
   if(sql.startsWith('DELETE FROM v2_products')){if(o.throwFk){const e=new Error('FK failed') as Error&{code:string};e.code='ER_ROW_IS_REFERENCED_2';throw e;}return [{affectedRows:1},[]];}
   if(sql.startsWith('UPDATE v2_products SET is_active=0'))return [{affectedRows:1},[]];
   throw Error('Unexpected '+sql);
  }};
 }
}
test('P6-5 product hard delete is restricted by order links, rollback, no asset detaching',async()=>{
 const db=new Db();db.hasReference=true;
 await assert.rejects(deleteUnusedV2Product(db,sales,'7'),e=>e instanceof ProductMutationError&&e.status===409);
 assert.equal(db.commits,0);assert.equal(db.rollbacks,1);
 assert(!db.statements.some(x=>x.sql.startsWith('DELETE FROM v2_products')));
 assert(!db.statements.some(x=>x.sql.includes('DELETE FROM image_assets')));
});
test('P7-2 inconsistent asset reference ledger blocks deletion and FK races map to conflict',async()=>{
 const db=new Db();db.hasImage=true;
 await assert.rejects(deleteUnusedV2Product(db,sales,'7'),e=>e instanceof ProductMutationError&&e.status===409);
 const db2=new Db();db2.throwFk=true;
 await assert.rejects(deleteUnusedV2Product(db2,sales,'7'),e=>e instanceof ProductMutationError&&e.status===409);
 assert.equal(db2.rollbacks,1);
});
test('P6-5 deactivation preserves order link; deprecated product grants do not block sales',async()=>{
 const db=new Db();
 assert.equal((await deactivateV2Product(db,sales,'7')).active,false);
 assert.equal(db.commits,1);
 assert(!db.statements.some(x=>x.sql.startsWith('DELETE')));
 const denied=new Db();denied.deniedGrant=true;
 assert.equal((await deactivateV2Product(denied,{...sales,canManageProducts:false},'7')).active,false);
 assert.equal(denied.commits,1);
});
test('P6-5 product mutations reject invalid IDs before DB, never rely on client flags',async()=>{
 const db=new Db();
 for(const invalid of ['0','-1','1 OR 1=1','1.2','18446744073709551616'])
  await assert.rejects(deleteUnusedV2Product(db,admin,invalid),ProductMutationError);
 assert.equal(db.statements.length,0);
});
