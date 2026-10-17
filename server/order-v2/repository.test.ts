import assert from 'node:assert/strict';
import test from 'node:test';
import {updateExistingOrderItemBusinessFields,P1DOrderAccessError} from './repository';
import type {AppPrincipal} from '../access/types';

const admin:AppPrincipal={userId:'1',role:'admin',username:'admin',displayName:'a',sessionId:'1',canManageOwnOrders:true,canManageProducts:true};
const sales:AppPrincipal={...admin,role:'sales',userId:'2'};
class Db {
 sql:string[]=[];params:unknown[][]=[];began=0;committed=0;rolledBack=0;
 owner:string|null='2'; itemOrderId='14'; itemId='50';
 async getConnection(){
  const self=this;
  return {
   async beginTransaction(){self.began++},
   async commit(){self.committed++},
   async rollback(){self.rolledBack++},
   release(){},
   async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
    self.sql.push(sql);self.params.push(params);
    if(sql.startsWith('SELECT id,created_by_user_id FROM orders')){
     return [params[0]==='14'?[{id:14,created_by_user_id:self.owner}]:[],[]];
    }
    if(sql.startsWith('SELECT id FROM order_items')){
     return [params[0]===self.itemId&&params[1]===self.itemOrderId?[{id:50}]:[],[]];
    }
    if(sql.startsWith('UPDATE order_items')){
     return [{affectedRows:1},[]];
    }
    throw Error('Unexpected SQL '+sql);
   }
  };
 }
}
const fields={meters:5,unitPrice:12,remark:'客户确认'};
test('P1-D existing item update retains id/order_id and original product number/name/snapshot',async()=>{
 const db=new Db();
 await updateExistingOrderItemBusinessFields(db,sales,'14','50',fields);
 assert.equal(db.began,1);
 assert.equal(db.committed,1);
 assert.equal(db.rolledBack,0);
 assert(db.sql.some(x=>x.includes('FOR UPDATE')));
 const statement=db.sql.at(-1)!;
 assert.match(statement,/UPDATE order_items SET meters=\?,unit_price=\?,remark=\? WHERE id=\? AND order_id=\?/i);
 assert.doesNotMatch(statement,/DELETE|INSERT|product_no|product_name|composition|weight|width|product_id/i);
 assert.deepEqual(db.params.at(-1),[5,12,'客户确认','50','14']);
});
test('P1-D other or ownerless order may not be edited by salesperson and never touches items',async()=>{
 for(const owner of ['3',null]){
  const db=new Db();db.owner=owner;
  await assert.rejects(updateExistingOrderItemBusinessFields(db,sales,'14','50',fields),P1DOrderAccessError);
  assert.equal(db.committed,0);
  assert.equal(db.rolledBack,1);
  assert(!db.sql.some(x=>x.startsWith('UPDATE')));
 }
 const db=new Db();db.owner=null;
 await updateExistingOrderItemBusinessFields(db,admin,'14','50',fields);
 assert.equal(db.committed,1);
});
test('P1-D missing item, spoofed item id or prohibited source fields are rejected',async()=>{
 const db=new Db();
 await assert.rejects(updateExistingOrderItemBusinessFields(db,sales,'14','999',fields),P1DOrderAccessError);
 assert.equal(db.committed,0);
 assert(!db.sql.some(x=>x.startsWith('UPDATE')));
 const dirty=new Db();
 await assert.rejects(updateExistingOrderItemBusinessFields(dirty,sales,'14','50',{meters:5,productNo:'BAD'} as never),/Invalid.*fields/i);
 assert.equal(dirty.began,0);
});
