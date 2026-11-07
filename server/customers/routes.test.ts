import {createV2ProductionHttpApp} from '../product-master/v2ProductionHttp';
import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';
import {createCustomerRouter} from './routes';import {fixture,sales,admin,key} from './service.testFixture';import {profile} from './customer.testFixture';
import {createV2BusinessRoutes} from '../product-master/v2CatalogAssembly';
test('customer HTTP parses strict inputs, creates reusable identity/selection and gates missing schema without writes',async()=>{
 const f=fixture(),app=express();app.use('/api/v2',createCustomerRouter((_req,res,next)=>{res.locals.principal=sales;next();},f.pool,true));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base='http://127.0.0.1:'+(server.address() as any).port+'/api/v2';
 try{assert.deepEqual(await (await fetch(base+'/customers/capability')).json(),{enabled:true});const response=await fetch(base+'/customers/with-sample-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:key(1),profile:profile()})});assert.equal(response.status,201);const made=await response.json() as any;assert.equal(made.customer.profile.displayName,'海风服饰');assert.equal(made.session.customerReference,'海风服饰');assert.equal((await fetch(base+'/customers?limit=2&limit=3')).status,400);assert.equal((await fetch(base+'/customers?scope=all')).status,400);assert.equal((await fetch(base+'/customers/1?scope=all')).status,400);
 }finally{await new Promise<void>(r=>server.close(()=>r()));f.db.close();}
 const app2=express(),disabled=fixture();app2.use('/api/v2',createCustomerRouter((_req,res,next)=>{res.locals.principal=sales;next();},disabled.pool,false));const s2=app2.listen(0,'127.0.0.1');await new Promise<void>(r=>s2.once('listening',r));const b2='http://127.0.0.1:'+(s2.address() as any).port+'/api/v2';try{assert.deepEqual(await(await fetch(b2+'/customers/capability')).json(),{enabled:false});assert.equal((await fetch(b2+'/customers')).status,503);assert.equal(disabled.calls.length,0);}finally{await new Promise<void>(r=>s2.close(()=>r()));disabled.db.close();}
});
test('link HTTP reads the current version, checks both targets and preserves the legacy customer label',async()=>{
 const f=fixture();f.db.prepare("INSERT INTO customer_sample_sessions(id,customer_reference,created_by_user_id) VALUES(90,'原始客户',2)").run();f.db.prepare('INSERT INTO customer_sample_session_access(session_id,user_id,can_manage) VALUES(90,2,1)').run();const customer=await f.service.create(sales,{requestId:key(3),profile:profile()});const app=express();app.use(createCustomerRouter((_req,res,next)=>{res.locals.principal=sales;next();},f.pool,true));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base='http://127.0.0.1:'+(server.address() as any).port+'/customer-samples/sessions/90/link-customer';
 try{const info=await(await fetch(base)).json() as any;assert.equal(info.customerId,null);assert.equal(info.linkVersion,'0');const r=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customerId:customer.id,expectedCustomerId:null,expectedLinkVersion:info.linkVersion,expectedCustomerReference:info.customerReference})});assert.equal(r.status,200);const after=await(await fetch(base)).json() as any;assert.equal(after.customerId,customer.id);assert.equal(after.customerReference,'原始客户');assert.equal(after.linkVersion,'1');}finally{await new Promise<void>(r=>server.close(()=>r()));f.db.close();}
});
test('customer rename HTTP reports a duplicate name without exposing the other customer',async()=>{
 const f=fixture();
 const target=await f.service.create(sales,{requestId:key(71),profile:{displayName:'原客户名称'}});
 await f.service.create(admin,{requestId:key(72),profile:{displayName:'已用客户名称'}});
 const app=express();
 app.use(createCustomerRouter((_req,res,next)=>{res.locals.principal=sales;next();},f.pool,true));
 const server=app.listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));
 try{
  const response=await fetch('http://127.0.0.1:'+(server.address() as {port:number}).port+'/customers/'+target.id,{
   method:'PATCH',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({expectedRowVersion:target.rowVersion,profile:{...target.profile,displayName:'已用客户名称'}}),
  });
  assert.equal(response.status,409);
  assert.deepEqual(await response.json(),{code:'customer_name_taken',error:'该客户名称已存在，请修改后再保存。'});
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));f.db.close();}
});
test('actual V2 assembly mounts authenticated customer capability and atomic customer/session routes',async()=>{
 const f=fixture(),db={query:async(sql:string):Promise<[unknown,unknown]>=>{if(sql.includes('JOIN v2_access_users')&&sql.includes('s.token_hash'))return [[{user_id:'2',username:'sales',display_name:'业务员',role:'sales',can_manage_own_orders:1,can_manage_products:1,session_id:'12'}],[]];throw Error('unexpected query');}};
 const app=express();app.use('/api/v2',createV2BusinessRoutes(db,f.pool));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base='http://127.0.0.1:'+(server.address() as any).port+'/api/v2',headers={Authorization:'Bearer '+'a'.repeat(64),'Content-Type':'application/json'};try{assert.equal((await fetch(base+'/customers')).status,401);assert.deepEqual(await(await fetch(base+'/customers/capability',{headers})).json(),{enabled:true});const response=await fetch(base+'/customers/with-sample-session',{method:'POST',headers,body:JSON.stringify({requestId:key(10),profile:profile()})});assert.equal(response.status,201);const made=await response.json() as any;assert(made.session.id);assert.equal((await(await fetch(base+'/customers?limit=20&offset=0',{headers})).json() as any).total,1);
 const url=base+'/customer-samples/sessions/'+made.session.id+'/contact';
 assert.equal((await fetch(url)).status,401);
 const options=await(await fetch(url,{headers})).json() as any;
 assert.equal(options.choices[0].name,made.customer.profile.contacts[0].name);
 assert.equal((await fetch(url,{method:'PATCH',headers,body:JSON.stringify({expectedLinkVersion:options.linkVersion,contactChoice:null,customerId:'1'})})).status,400);
 const saved=await fetch(url,{method:'PATCH',headers,body:JSON.stringify({expectedLinkVersion:options.linkVersion,contactChoice:null})});
 assert.equal(saved.status,200);assert.equal((await saved.json() as any).contactName,null);
}finally{await new Promise<void>(r=>server.close(()=>r()));f.db.close();}
});

test('V1.2 HTTP deletion is admin only, retired writes are unavailable, snapshots survive and candidates disappear',async()=>{
 const f=fixture();let actor:typeof sales|typeof admin=sales;const c=await f.service.withSampleSession(sales,{requestId:key(301),profile:{displayName:'历史客户'}});const app=express();app.use(createCustomerRouter((_req,res,next)=>{res.locals.principal=actor;next();},f.pool,true));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base='http://127.0.0.1:'+(server.address() as any).port;const write=(path:string,method:string,body:unknown)=>fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{assert.equal((await write('/customers/'+c.customer.id,'DELETE',{expectedRowVersion:'1',confirm:true})).status,403);assert.equal((await fetch(base+'/customers/'+c.customer.id+'/deletion-info')).status,403);for(const path of ['/customers/1/archive','/customers/1/transfer-owner','/customers/1/followups'])assert.equal((await write(path,'POST',{})).status,404);assert.equal((await fetch(base+'/customer-tasks')).status,404);actor=admin;assert.equal((await(await fetch(base+'/customers/1/deletion-info')).json()).sessions,1);assert.equal((await write('/customers/1','DELETE',{expectedRowVersion:'0',confirm:true})).status,400);assert.equal((await write('/customers/1','DELETE',{expectedRowVersion:'1',confirm:true})).status,409);f.db.prepare("UPDATE customer_sample_sessions SET deleted_at='2026-10-28' WHERE id=?").run(c.session.id);assert.equal((await write('/customers/1','DELETE',{expectedRowVersion:'1',confirm:true})).status,200);assert.equal((await(await fetch(base+'/customers')).json()).total,0);assert.equal(f.db.prepare('SELECT customer_reference FROM customer_sample_sessions').get()!.customer_reference,'历史客户');}finally{await new Promise<void>(r=>server.close(()=>r()));f.db.close();}
});

test('production composition returns 410 Gone for retired customer tasks instead of standalone Express 404',async()=>{
 const f=fixture();const app=createV2ProductionHttpApp(createCustomerRouter((_req,res,next)=>{res.locals.principal=sales;next();},f.pool,true),async()=>true);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base='http://127.0.0.1:'+(server.address() as any).port;
 try{const response=await fetch(base+'/api/v2/customer-tasks?limit=1&offset=0');assert.equal(response.status,410);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(f.calls.length,0);assert.equal((await response.json()).error,'Legacy endpoint disabled during V2 cutover');}finally{await new Promise<void>(r=>server.close(()=>r()));f.db.close();}
});


test('customer deletion HTTP reports remaining selections and never deletes the parent on conflict',async()=>{
 const f=fixture();const made=await f.service.withSampleSession(sales,{requestId:key(950),profile:{displayName:'删除需先清选样'}});
 const app=express();app.use('/api/v2',createCustomerRouter((_req,res,next)=>{res.locals.principal=admin;next();},f.pool,true));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const url='http://127.0.0.1:'+(server.address() as any).port+'/api/v2/customers/'+made.customer.id;
 try{
  const r=await fetch(url,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRowVersion:'1',confirm:true})});
  assert.equal(r.status,409);assert.deepEqual(await r.json(),{error:'该客户还有 1 张选样单，请先删除选样单，再删除客户档案。',code:'customer_has_selections',selectionCount:1});
  assert.equal((await f.service.get(admin,made.customer.id)).deleted,false);
 }finally{await new Promise<void>(r=>server.close(()=>r()));f.db.close();}
});
