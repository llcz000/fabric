import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type {Server} from 'node:http';
import {hashSessionToken} from '../access/password';
import {createV2CatalogAssembly} from './v2CatalogAssembly';

/** P7-5: one in-memory SQL transaction ledger, genuine local Express/Router
 * and unchanged production business services. No MySQL/COS/net access. */
type Row=Record<string,unknown>;
const SALES='a'.repeat(64),ADMIN='b'.repeat(64);
const target='fabric_v2_test_20261014_p7_lifecycle';
const display={companyName:'本机演练公司',companyAddress:'上海',companyPhone:'000',terms:'冻结条款'};
class LifecycleDb{
 orders:Row[]=[];lines:Row[]=[];identityName='G808';composition='棉/麻';
 nextOrder=100;nextLine=200;deleted=0;commits=0;rollbacks=0;begins=0;releases=0;
 trace:{sql:string;params:unknown[]}[]=[];failInsert=false;
 async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  this.trace.push({sql,params});
  const row=(records:unknown):[unknown,unknown]=>[records,[]];
  if(sql==='SELECT DATABASE() AS database_name, @@server_uuid AS server_uuid')
   return row([{database_name:target,server_uuid:'local-fixture-uuid'}]);
  if(sql.includes('JOIN v2_access_users')&&sql.includes('s.token_hash')){
   const user=params[0]===hashSessionToken(SALES)?'2':params[0]===hashSessionToken(ADMIN)?'1':null;
   return row(user?[{user_id:user,username:user==='1'?'admin':'sales',
    display_name:'tester',role:user==='1'?'admin':'sales',
    can_manage_own_orders:1,can_manage_products:1,session_id:'9'}]:[]);
  }
  if(sql.startsWith('SELECT id,role,is_active')&&sql.includes('FROM v2_access_users'))
   return row([{id:params[0],role:String(params[0])==='1'?'admin':'sales',is_active:1,
    can_manage_own_orders:1,can_manage_products:1}]);
  if(sql.startsWith('SELECT id FROM v2_access_sessions WHERE id=?'))
   return row([{id:9}]);
  if(sql.startsWith('INSERT INTO orders')){
   const id=String(this.nextOrder++);
   this.orders.push({id,order_no:params[0],order_date:params[1],receiving_unit:params[2],
    template_type:params[3],deposit:params[4],created_by_user_id:params[5],style_no:params[6],
    sign_person:params[7],receiver:params[8],receiver_phone:params[9],receiver_address:params[10],
    settled:params[11],v2_display_snapshot:params[12],total_meters:0,total_pieces:0,
    total_amount:0,deduction_meters:0});
   return row({insertId:id});
  }
  if(sql.startsWith('SELECT id,created_by_user_id FROM orders WHERE id=?'))
   return row(this.orders.filter(o=>String(o.id)===String(params[0]))
    .map(o=>({id:o.id,created_by_user_id:o.created_by_user_id})));
  if(sql.startsWith('SELECT id,order_id,v2_product_id,v2_source_kind'))
   return row(this.lines.filter(i=>String(i.order_id)===String(params[0])));
  if(sql.includes('FROM v2_products p')&&sql.includes('FOR SHARE')){
   return row(String(params[0])==='7'?[{id:'7',product_no:'G808-1-F016',product_active:1,
    fabric_no:'F016',fabric_name:'透明丝',composition:this.composition,
    weight_value:'16.000',weight_unit:'mm',width_value:'140.00',
    fabric_active:1,colorway_no:1,colorway_active:1,master_no:this.identityName,master_active:1}]:[]);
  }
  if(sql.startsWith('INSERT INTO order_items')){
   if(this.failInsert)throw new Error('PRIVATE_ORDER_SQL_ERROR');
   const id=String(this.nextLine++);
   const item:Row={id,order_id:String(params[0]),meters:params[1],
    unit_price:params[2],remark:params[3],piece_meters:params[4],deduction_meters:params[5],
    v2_product_id:params[6],v2_source_kind:params[7],v2_product_snapshot:params[8],
    product_no:params[9],product_name:params[10],color_no:params[11],
    composition:params[12],weight:params[13],width:params[14],amount:0};
   this.lines.push(item);return row({insertId:id});
  }
  if(sql.startsWith('SELECT template_type,deposit FROM orders WHERE id=?'))
   return row(this.orders.filter(o=>String(o.id)===String(params[0])));
  if(sql.startsWith('SELECT id,meters,unit_price,amount,piece_meters,deduction_meters FROM order_items'))
   return row(this.lines.filter(i=>String(i.order_id)===String(params[0])));
  if(sql.startsWith('UPDATE order_items SET ')&&!sql.startsWith('UPDATE order_items SET amount=')){
   const found=/^UPDATE order_items SET (.+) WHERE id=\? AND order_id=\?$/.exec(sql);
   if(!found)throw Error('Unsafe simulated item update');
   const line=this.lines.find(i=>String(i.id)===String(params[params.length-2])&&
    String(i.order_id)===String(params[params.length-1]));
   const fields=found[1].split(',');
   if(fields.length!==params.length-2||fields.some((col,i)=>!['meters=?','unit_price=?'].includes(col)))
    throw Error('Unexpected simulated item changes');
   if(line)fields.forEach((col,i)=>{line[col.slice(0,-2)]=params[i];});
   return row({affectedRows:line?1:0});
  }
  if(sql.startsWith('UPDATE order_items SET amount=')){
   const line=this.lines.find(i=>String(i.id)===String(params[1]));
   if(line)line.amount=params[0];return row({affectedRows:line?1:0});
  }
  if(sql.startsWith('UPDATE orders SET total_meters=')){
   const order=this.orders.find(o=>String(o.id)===String(params[4]));
   if(order)Object.assign(order,{total_meters:params[0],total_pieces:params[1],
    total_amount:params[2],deduction_meters:params[3]});
   return row({affectedRows:order?1:0});
  }
  if(sql.startsWith('SELECT o.id,')&&sql.includes('FROM orders o WHERE o.id=?'))
   return row(this.orders.filter(o=>String(o.id)===String(params[0])));
  if(sql.startsWith('SELECT i.id,i.order_id,')&&sql.includes('FROM order_items i WHERE i.order_id=?'))
   return row(this.lines.filter(i=>String(i.order_id)===String(params[0])));
  if(sql.startsWith('SELECT id,')&&sql.includes('FROM v2_products WHERE id=? FOR UPDATE'))
   return row([{id:'7',is_active:1}]);
  if(sql.includes('FROM order_items')&&sql.includes('v2_product_id=?')){
   const n=this.lines.filter(i=>String(i.v2_product_id)===String(params[0])).length;
   return row([{total:n}]);
  }
  if(sql.startsWith('DELETE FROM v2_products')){this.deleted++;return row({affectedRows:1});}
  throw Error('P7-5 unexpected SQL '+sql.slice(0,90));
 }
 async getConnection(){
  const self=this;let backup:{orders:Row[];lines:Row[]}|null=null;
  return {
   query:this.query.bind(this),
   async beginTransaction(){self.begins++;backup={orders:structuredClone(self.orders),lines:structuredClone(self.lines)};},
   async commit(){self.commits++;backup=null;},
   async rollback(){self.rollbacks++;if(backup){self.orders=backup.orders;self.lines=backup.lines;}},
   release(){self.releases++;}
  };
 }
}
async function server(db:LifecycleDb,run:(base:string)=>Promise<void>){
 const app=express();
 app.use('/api/v2',await createV2CatalogAssembly(db,db,{database:target,confirmation:'I_ACKNOWLEDGE_SANDBOX'}));
 const started:Server=await new Promise((resolve,reject)=>{
  const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject);
 });
 try{
  const addr=started.address();assert(addr&&typeof addr!=='string');
  await run('http://127.0.0.1:'+addr.port+'/api/v2');
 }finally{await new Promise<void>((resolve,reject)=>started.close(e=>e?reject(e):resolve()));}
}
async function call(base:string,path:string,method='GET',data?:unknown,token=SALES){
 const res=await fetch(base+path,{method,headers:{
  authorization:'Bearer '+token,...(data===undefined?{}:{'content-type':'application/json'})
 },...(data===undefined?{}:{body:JSON.stringify(data)})});
 return {status:res.status,body:await res.json() as Row};
}
function newOrder(type:'sample'|'deposit'|'sales',no:string){
 return {orderNo:no,date:'2026-10-14',receivingUnit:'验收客户',type,
  deposit:type==='deposit'?25:type==='sample'?0:20,displaySnapshot:display,
  items:[{selection:{productId:'7'},fields:{
   meters:type==='sales'?7:3,unitPrice:12.5,
   ...(type==='sales'?{pieceMeters:[3.5,3.5],deductionMeters:0.5}:{})
  }}]};
}
test('P7-5 one V2 HTTP catalog/order lifecycle freezes all three documents and blocks referenced product delete',async()=>{
 const db=new LifecycleDb();
 await server(db,async base=>{
  for(const t of ['sample','deposit','sales'] as const){
   const created=await call(base,'/documents','POST',newOrder(t,'P7-5-'+t));
   assert.equal(created.status,201,'Save '+t+' '+JSON.stringify(created.body));
   const orderId=String(created.body.id);
   const item=(created.body.items as Row[])[0];
   assert.equal(item.source,'catalog');
   assert.equal(item.productId,'7');
   assert.equal((item.snapshot as Row).weightUnit,'mm');
   assert.equal((item.snapshot as Row).composition,'棉/麻');
   db.composition='新资料';db.identityName='新编号';
   const read=await call(base,'/documents/'+orderId);
   assert.equal(read.status,200);
   assert.deepEqual((read.body.items as Row[])[0].snapshot,item.snapshot);
   db.composition='棉/麻';db.identityName='G808';
  }
  const blocked=await call(base,'/products/7','DELETE',undefined,ADMIN);
  assert.equal(blocked.status,409,'A saved catalog line blocks all hard deletion');
  assert.equal(db.deleted,0);
  assert(!db.trace.some(x=>x.sql.startsWith('DELETE FROM v2_product_image_assets')||x.sql.startsWith('UPDATE image_assets')));
 });
 assert.equal(db.orders.length,3);
 assert.equal(db.lines.length,3);
 assert.equal(db.commits,3);
 assert.equal(db.rollbacks,1);
 assert.equal(db.begins,4);
 assert(db.releases>=db.begins,'all opened connections released');
});
test('P7-5 editing an existing linked line only changes business amounts, never replaces frozen catalog identity',async()=>{
 const db=new LifecycleDb();
 await server(db,async base=>{
  const saved=await call(base,'/documents','POST',newOrder('sample','P7-5-update'));
  assert.equal(saved.status,201);
  const orderId=String(saved.body.id);
  const item=(saved.body.items as Row[])[0],id=String(item.id),frozen=item.snapshot;
  db.composition='之后新增标签/成分';
  db.identityName='变更后的母版';
  const modified=await call(base,'/documents/'+orderId,'PATCH',{
   items:[{id,fields:{meters:5,unitPrice:10}}],removeIds:[]
  });
  assert.equal(modified.status,200,JSON.stringify(modified.body));
  assert.equal((modified.body.items as Row[])[0].id,id);
  assert.deepEqual((modified.body.items as Row[])[0].snapshot,frozen);
  assert.equal((modified.body.items as Row[])[0].meters,5);
  assert.equal((modified.body.items as Row[])[0].unitPrice,10);
  const after=await call(base,'/documents/'+orderId);
  assert.equal(after.status,200);
  assert.deepEqual((after.body.items as Row[])[0].snapshot,frozen);
  assert.equal(db.lines[0].product_no,'G808-1-F016');
 });
 assert.equal(db.commits,2);
 assert.equal(db.rollbacks,0);
 assert.equal(db.lines.length,1);
});
test('P7-5 independent owner checks: admin saved order is invisible to unrelated salesperson',async()=>{
 const db=new LifecycleDb();
 await server(db,async base=>{
  const owner=await call(base,'/documents','POST',newOrder('sample','P7-5-admin-only'),ADMIN);
  assert.equal(owner.status,201);
  const id=String(owner.body.id);
  assert.equal((await call(base,'/documents/'+id,'GET',undefined,SALES)).status,404);
  assert.equal((await call(base,'/documents/'+id,'PATCH',{items:[],removeIds:[]},SALES)).status,404);
  assert.equal((await call(base,'/documents/'+id,'GET',undefined,ADMIN)).status,200);
 });
 assert.equal(db.orders.length,1);
 assert.equal(db.lines.length,1);
});
test('P7-5 V2 real Express rolls back header when a linked line write fails',async()=>{
 const db=new LifecycleDb();
 db.failInsert=true;
 await server(db,async base=>{
  const saved=await call(base,'/documents','POST',newOrder('sample','P7-5-rollback'));
  assert.equal(saved.status,503);
  assert(!JSON.stringify(saved.body).includes('PRIVATE_ORDER_SQL_ERROR'));
 });
 assert.equal(db.orders.length,0);
 assert.equal(db.lines.length,0);
 assert.equal(db.commits,0);
 assert.equal(db.rollbacks,1);
});
