import assert from 'node:assert/strict';
import test from 'node:test';
import {deleteV2Document as remove} from './documentLifecycle';
const deleteV2Document=(pool:Parameters<typeof remove>[0],actor:Parameters<typeof remove>[1],id:string)=>remove(pool,actor,id,{confirm:true});
import type {AppPrincipal} from '../access/types';
const actor:AppPrincipal={userId:'7',sessionId:'11',role:'sales',username:'sales',displayName:'业务员',canManageOwnOrders:true,canManageProducts:true};
function fixture(owner:string|null,fail=false){
 const calls:string[]=[];let lineCount=2,orderCount=1,commits=0,rollbacks=0;
 const connection={async beginTransaction(){},async commit(){commits++;},async rollback(){rollbacks++;lineCount=2;orderCount=1;},release(){},async query(sql:string):Promise<[unknown,unknown]>{calls.push(sql);
  if(sql.includes('FROM v2_access_users'))return [[{id:'7',role:actor.role,is_active:1,can_manage_own_orders:1,can_manage_products:1}],[]] as [unknown,unknown];
  if(sql.includes('FROM v2_access_sessions'))return [[{id:'11'}],[]] as [unknown,unknown];
  if(sql.startsWith('SELECT id,created_by_user_id,order_no FROM orders'))return [[{id:'5',order_no:'XS5',created_by_user_id:owner}],[]] as [unknown,unknown];
  if(sql.startsWith('DELETE FROM order_items')){lineCount=0;return [{affectedRows:2},[]] as [unknown,unknown];}
  if(sql.startsWith('DELETE FROM orders')){if(fail)throw Error('simulated failure');orderCount=0;return [{affectedRows:1},[]] as [unknown,unknown];}
  if(sql.startsWith('INSERT INTO business_delete_events'))return [{affectedRows:1},[]];
  throw Error('Unexpected SQL');
 }};
 return {pool:{async getConnection(){return connection;}},calls,state:()=>({lineCount,orderCount,commits,rollbacks})};
}
test('confirmed delete atomically removes own document and detail rows without touching catalog or media',async()=>{
 const f=fixture('7');await deleteV2Document(f.pool,actor,'5');assert.deepEqual(f.state(),{lineCount:0,orderCount:0,commits:1,rollbacks:0});assert(!f.calls.some(s=>/^(UPDATE|INSERT INTO|DELETE FROM) (v2_products|products|image_assets)\b/.test(s)));
});
test('sales cannot delete another owner or unknown historical owner',async()=>{
 for(const owner of ['9',null]){const f=fixture(owner);await assert.rejects(deleteV2Document(f.pool,actor,'5'),(e:any)=>e.status===404);assert(!f.calls.some(s=>s.startsWith('DELETE')));}
});
test('failure after removing details rolls the entire deletion back',async()=>{
 const f=fixture('7',true);await assert.rejects(deleteV2Document(f.pool,actor,'5'));assert.deepEqual(f.state(),{lineCount:2,orderCount:1,commits:0,rollbacks:1});
});
test('invalid IDs never acquire storage or delete anything',async()=>{
 const f=fixture('7');await assert.rejects(deleteV2Document(f.pool,actor,'../5'));assert.equal(f.calls.length,0);
});
