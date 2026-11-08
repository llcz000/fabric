// AC-146 / CUSTOMER-08
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {fixture,admin,sales,key} from './service.testFixture';
import {createCustomerRouter} from './routes';
import {createCustomerClient} from '../../src/components/customers/customerModel';

test('each saved document type blocks customer deletion until the last associated document is deleted',async()=>{
 for(const [index,type] of ['sample','bulk','deposit'].entries()){
  const f=fixture();try{
   const customer=await f.service.create(sales,{requestId:key(970+index),profile:{displayName:'有单据的客户'}});
   assert.deepEqual(await f.service.deletionInfo(admin,customer.id),{sessions:0,sample:0,bulk:0,deposit:0});
   f.db.prepare('INSERT INTO orders VALUES(900,?,?,?, ?,100,2)').run(type,'2026-11-08','DOC-900','原名称');
   f.db.prepare('INSERT INTO customer_order_links(order_id,customer_id,linked_by_user_id) VALUES(900,?,1)').run(customer.id);
   const before=f.db.prepare('SELECT profile_json,row_version FROM customers WHERE id=?').get(customer.id);
   await assert.rejects(f.service.delete(admin,customer.id,{expectedRowVersion:'1',confirm:true}),{status:409,code:'customer_has_documents',documentCount:1});
   assert.deepEqual(f.db.prepare('SELECT profile_json,row_version FROM customers WHERE id=?').get(customer.id),before);
   assert.equal(f.db.prepare("SELECT COUNT(*) n FROM business_delete_events WHERE entity_type='customer'").get()!.n,0);
   await assert.rejects(f.service.delete(sales,customer.id,{expectedRowVersion:'1',confirm:true}),{status:403});
   f.db.exec('DELETE FROM customer_order_links WHERE order_id=900;DELETE FROM orders WHERE id=900;');
   await f.service.delete(admin,customer.id,{expectedRowVersion:'1',confirm:true});
   assert.equal((await f.service.get(admin,customer.id)).deleted,true);
  }finally{f.db.close();}
 }
});

test('customer HTTP and client report a document created after deletion preview and keep the profile intact',async()=>{
 const f=fixture(),customer=await f.service.create(admin,{requestId:key(979),profile:{displayName:'删除前有新增单据'}});
 const app=express();app.use('/api/v2',createCustomerRouter((_req,res,next)=>{res.locals.principal=admin;next();},f.pool,true));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const address=server.address();assert(address&&typeof address!=='string');const origin='http://127.0.0.1:'+address.port;
 try{
  const client=createCustomerClient((input,init)=>fetch(origin+input,init));
  assert.equal((await client.deletionInfo(customer.id)).bulk,0);
  f.db.prepare("INSERT INTO orders VALUES(901,'bulk','2026-11-08','XS-901','旧名',100,1)").run();
  f.db.prepare('INSERT INTO customer_order_links(order_id,customer_id,linked_by_user_id) VALUES(901,?,1)').run(customer.id);
  const current=await client.detail(customer.id);
  await assert.rejects(client.remove(current),error=>error instanceof Error&&/还有 1 张单据.*先删除.*单据/.test(error.message));
  assert.equal((await f.service.get(admin,customer.id)).deleted,false);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));f.db.close();}
});
