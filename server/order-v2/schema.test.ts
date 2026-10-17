import assert from 'node:assert/strict';
import test from 'node:test';
import {getP1DAdditiveMigrationSql, inspectP1DCompatibility, buildP1DOrderListScope} from './schema';
import type {AppPrincipal} from '../access/types';

class Metadata {
 statements:{sql:string;params:unknown[]}[]=[];
 ordersColumns=['id','order_no','order_date'];
 itemsColumns=['id','order_id','product_no','product_name'];
 primary=['id'];
 ownerType:string|null=null;
 ownerNullable='YES';
 indexPresent=true;
 fkPresent=true;
 async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]> {
  this.statements.push({sql,params});
  if(sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
   const t=String(params[0]); const names=t==='orders'?this.ordersColumns:this.itemsColumns;
   return [names.map(COLUMN_NAME=>({COLUMN_NAME,
    COLUMN_TYPE:COLUMN_NAME==='created_by_user_id'?this.ownerType??'bigint unsigned':'int',
    IS_NULLABLE:COLUMN_NAME==='created_by_user_id'?this.ownerNullable:'NO'})),[]];
  }
  if(sql.includes('INFORMATION_SCHEMA.STATISTICS')){
   if(sql.includes('idx_v2_orders_owner'))return [this.indexPresent?[{INDEX_NAME:'idx_v2_orders_owner',COLUMN_NAME:'created_by_user_id',NON_UNIQUE:1}]:[],[]];
   return [this.primary.map(COLUMN_NAME=>({INDEX_NAME:'PRIMARY',COLUMN_NAME,NON_UNIQUE:0})),[]];
  }
  if(sql.includes('INFORMATION_SCHEMA.KEY_COLUMN_USAGE'))return [this.fkPresent?[{CONSTRAINT_NAME:'fk_v2_orders_actor',COLUMN_NAME:'created_by_user_id',REFERENCED_TABLE_NAME:'v2_access_users',REFERENCED_COLUMN_NAME:'id',DELETE_RULE:'RESTRICT'}]:[],[]];
  throw Error('Unsupported metadata lookup');
 }
}
const admin:AppPrincipal={userId:'1',username:'admin',displayName:'a',role:'admin',canManageOwnOrders:true,canManageProducts:true,sessionId:'s'};
const sales:AppPrincipal={...admin,userId:'2',role:'sales'};
test('P1-D additive owner migration never updates historical orders/items and uses FK',()=>{
 const plan=getP1DAdditiveMigrationSql();
 assert.equal(plan.length,1);
 assert.match(plan[0],/ALTER TABLE orders\s+ADD COLUMN created_by_user_id BIGINT UNSIGNED NULL/i);
 assert.match(plan[0],/FOREIGN KEY \(created_by_user_id\)\s+REFERENCES v2_access_users\(id\) ON DELETE RESTRICT/i);
 assert.match(plan[0],/ADD INDEX idx_v2_orders_owner/i);
 assert.doesNotMatch(plan.join(';'),/^\s*(?:UPDATE|DELETE|DROP|TRUNCATE|REPLACE)\s/im);
 assert.doesNotMatch(plan.join(';'),/order_items|DEFAULT\s+\d+|SET\s+created_by_user_id/i);
});
test('P1-D metadata requires stable existing primary keys and rejects unknown owner types',async()=>{
 const db=new Metadata();
 assert.equal((await inspectP1DCompatibility(db)).state,'legacy');
 assert(db.statements.every(x=>x.sql.trim().startsWith('SELECT')));
 db.ordersColumns.push('created_by_user_id');db.ownerType='bigint unsigned';
 assert.equal((await inspectP1DCompatibility(db)).state,'expanded');
 db.ownerType='int';
 await assert.rejects(inspectP1DCompatibility(db),/created_by_user_id.*type/i);
 db.ownerType='bigint unsigned';db.itemsColumns=['order_id','product_no'];
 await assert.rejects(inspectP1DCompatibility(db),/order_items.*id/i);
});
test('P1-D rejects partially expanded owner schema without nullable FK and index',async()=>{
 const db=new Metadata();db.ordersColumns.push('created_by_user_id');db.ownerType='bigint unsigned';
 db.indexPresent=false;
 await assert.rejects(inspectP1DCompatibility(db),/idx_v2_orders_owner/);
 db.indexPresent=true;db.fkPresent=false;
 await assert.rejects(inspectP1DCompatibility(db),/fk_v2_orders_actor/);
 db.fkPresent=true;db.ownerNullable='NO';
 await assert.rejects(inspectP1DCompatibility(db),/nullable/);
});
test('P1-D SQL list/read and export scopes never broaden sales visibility or guess old owner',()=>{
 assert.deepEqual(buildP1DOrderListScope(admin),{where:'1=1',params:[]});
 assert.deepEqual(buildP1DOrderListScope(sales),{where:'o.created_by_user_id = ?',params:['2']});
 assert.throws(()=>buildP1DOrderListScope(null),/Unauthenticated/);
});
