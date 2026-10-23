import assert from 'node:assert/strict';
import test from 'node:test';
import {getP1D2LineMigrationSql,inspectP1D2Lines} from './lineSchema';
import {reconcileOrderLines,OrderLineError} from './lines';
import type {AppPrincipal} from '../access/types';
const admin:AppPrincipal={userId:'1',username:'admin',role:'admin',displayName:'A',sessionId:'s',canManageOwnOrders:true,canManageProducts:true};
const sales:AppPrincipal={...admin,userId:'2',role:'sales'};
type R=Record<string,unknown>;
class DB {
 calls:{sql:string;p:unknown[]}[]=[];commits=0;rolls=0;owner:string|null='2'; enabled=true;
 data:R[]=[{id:41,order_id:11,v2_product_id:null,v2_source_kind:null,product_no:'OLD',product_name:'历史'},
 {id:42,order_id:11,v2_product_id:8,v2_source_kind:'catalog',product_no:'P42',product_name:'布'}];
 async getConnection(){const d=this;return {async beginTransaction(){},async commit(){d.commits++},async rollback(){d.rolls++},release(){},async query(sql:string,p:unknown[]=[]):Promise<[unknown,unknown]>{
  d.calls.push({sql,p});
  if(sql.startsWith('SELECT id,created_by_user_id FROM orders'))return [[{id:11,created_by_user_id:d.owner}],[]];
  if(sql.startsWith('SELECT id,order_id,v2_product_id'))return [d.data,[]];
  if(sql.includes('FROM v2_products p'))return [[{id:7,product_no:'G011FAB01',product_active:d.enabled?1:0,fabric_no:'FAB01',fabric_name:'布名',composition:'棉',weight_value:'100.50',weight_unit:'gsm',width_value:'150.00',fabric_active:1,colorway_no:2,colorway_active:1,master_no:'G011',master_active:1}],[]];
  if(/^(UPDATE order_items|DELETE FROM order_items|INSERT INTO order_items)/.test(sql))return [{affectedRows:1,insertId:99},[]];
  throw Error('Unexpected SQL '+sql);
 }};}
}
const base=[{id:'41',fields:{meters:6}},{id:'42',fields:{meters:3}}];
test('P1-D2 additive nullable source/product reference and frozen snapshot',()=>{
 const ddl=getP1D2LineMigrationSql().join(' ');
 for(const term of ['v2_product_id BIGINT UNSIGNED NULL',"v2_source_kind ENUM('catalog','manual') NULL",'v2_product_snapshot JSON NULL','REFERENCES v2_products(id) ON DELETE RESTRICT'])
  assert(ddl.includes(term),term);
 assert.match(ddl,/CHECK/);
 assert.doesNotMatch(ddl,/UPDATE order_items|DELETE FROM order_items|DROP TABLE/i);
});
test('P1-D2 preserve old line ID, product no/name; selected catalog product is resolved from DB',async()=>{
 const d=new DB();
 await reconcileOrderLines(d,sales,'11',{items:[{id:'41',fields:{meters:6,unitPrice:12,remark:'更新'}},{id:'42',fields:{meters:3},selection:{productId:'7'}}],removeIds:[]});
 assert.equal(d.commits,1);assert.equal(d.rolls,0);
 const updates=d.calls.filter(x=>x.sql.startsWith('UPDATE order_items'));
 assert.equal(updates.length,2);
 assert.doesNotMatch(updates[0].sql,/product_no|product_name|v2_/);
 assert.match(updates[1].sql,/v2_product_id/);
 assert(JSON.stringify(updates[1].p).includes('G011FAB01'));
 assert(!d.calls.some(x=>x.sql.startsWith('DELETE')));
});
test('P1-D2 salesperson cannot create manual or forge legacy even with products grant',async()=>{
 const d=new DB();
 for(const item of [{fields:{meters:1},manual:{productNo:'FAKE',productName:'假'}},{id:'42',fields:{meters:1},manual:{productNo:'F',productName:'F'}}]){
  await assert.rejects(reconcileOrderLines(d,sales,'11',{items:[{id:'41',fields:{meters:1}},item as never],removeIds:item.id?[]:['42']}),OrderLineError);
 }
 assert.equal(d.commits,0);
});
test('P1-D2 admin explicit manual new line and salesperson catalog new line',async()=>{
 const a=new DB();a.owner=null;
 await reconcileOrderLines(a,admin,'11',{items:[...base,{fields:{meters:2},manual:{productNo:'MAN1',productName:'手工布'}}],removeIds:[]});
 assert(a.calls.some(x=>x.sql.startsWith('INSERT INTO order_items')&&x.p.includes('manual')));
 const b=new DB();
 await reconcileOrderLines(b,sales,'11',{items:[...base,{fields:{meters:2},selection:{productId:'7'}}],removeIds:[]});
 assert(b.calls.some(x=>x.sql.startsWith('INSERT INTO order_items')&&x.p.includes('catalog')));
});
test('P1-D2 reject cross-owner, missing owner, implicit deletion, forged lines and invalid payload',async()=>{
 for(const owner of ['3',null]){
  const d=new DB();d.owner=owner;
  await assert.rejects(reconcileOrderLines(d,sales,'11',{items:base,removeIds:[]}),OrderLineError);
 }
 for(const input of [
  {items:[base[0]],removeIds:[]},
  {items:[base[0],{id:'999',fields:{meters:3}}],removeIds:[]},
  {items:[base[0],{...base[1],legacy:true}],removeIds:[]},
  {items:[{id:'41',fields:{meters:5,productNo:'INJECT'}},base[1]],removeIds:[]},
  {items:[base[0],base[0]],removeIds:['42']}
 ]){
  const d=new DB();await assert.rejects(reconcileOrderLines(d,sales,'11',input as never));assert.equal(d.commits,0);
 }
});
test('P1-D2 explicit remove scoped by order, inactive product fails closed',async()=>{
 const d=new DB();
 await reconcileOrderLines(d,sales,'11',{items:[base[0]],removeIds:['42']});
 assert(d.calls.some(x=>x.sql.startsWith('DELETE FROM order_items WHERE id=? AND order_id=?')));
 const disabled=new DB();disabled.enabled=false;
 await assert.rejects(reconcileOrderLines(disabled,sales,'11',{items:[base[0],{id:'42',fields:{meters:2},selection:{productId:'7'}}],removeIds:[]}),OrderLineError);
 assert.equal(disabled.commits,0);
 assert.equal(disabled.rolls,1);
 // An earlier UPDATE may execute, but the shared transaction must roll back.
});
