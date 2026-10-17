import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type {AppPrincipal} from '../access/types';
import {createSampleFulfillmentRouter} from './fulfillmentRoutes';

const actor:AppPrincipal={userId:'6',sessionId:'9',username:'sales',displayName:'Sales',role:'sales',
 canManageProducts:false,canManageOwnOrders:false};
const shipment={sessionId:'41',shippedAt:'2026-10-17T09:15:00.000Z',items:[{productId:'18',quantity:2}]};
const followup={sessionId:'41',contactedOn:'2026-10-17',outcome:'客户满意',productIds:['18']};
async function http(run:(url:string,state:{actor:AppPrincipal|undefined;granted:boolean;calls:{sql:string;args:unknown[]}[];commits:number})=>Promise<void>){
 const state={actor:undefined as AppPrincipal|undefined,granted:true,calls:[] as {sql:string;args:unknown[]}[],commits:0};
 const db={async getConnection(){return {async beginTransaction(){},async commit(){state.commits++;},async rollback(){},release(){},
  async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
   state.calls.push({sql,args});
   if(sql.includes('FROM v2_access_users'))return [[{role:state.actor?.role,is_active:1}],[]];
   if(sql.includes('FROM v2_access_sessions'))return [[{id:'9'}],[]];
   if(sql.includes('FROM customer_sample_sessions'))return [[{id:'41',status:'open'}],[]];
   if(sql.includes('FROM customer_sample_session_access'))return [state.granted?[{can_manage:1}]:[],[]];
   if(sql.includes('FROM customer_sample_items'))return [[{id:'81',product_id:'18',removed_at:null}],[]];
   if(sql.startsWith('INSERT INTO sample_shipments'))return [{affectedRows:1,insertId:'101'},[]];
   if(sql.startsWith('INSERT INTO sample_shipment_items'))return [{affectedRows:1},[]];
   if(sql.startsWith('INSERT INTO sample_followups'))return [{affectedRows:1,insertId:'102'},[]];
   if(sql.startsWith('INSERT INTO sample_followup_products'))return [{affectedRows:1},[]];
   throw Error('unknown SQL');
  }};}};
 const app=express();app.use('/api/v2/customer-samples',createSampleFulfillmentRouter((_req,res,next)=>{
  if(!state.actor){res.status(401).json({error:'Unauthorized'});return;}
  res.locals.principal=state.actor;next();
 },db));
 const server=await new Promise<ReturnType<typeof app.listen>>(resolve=>{const x=app.listen(0,'127.0.0.1',()=>resolve(x));});
 try{const addr=server.address();assert(addr&&typeof addr!=='string');await run('http://127.0.0.1:'+addr.port+'/api/v2/customer-samples/sessions/41',state);}
 finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}
const post=(url:string,data:unknown)=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
test('B3 real loopback HTTP only authenticates internal roles and creates shipment + followup records with no-store',async()=>{
 await http(async(url,s)=>{
  assert.equal((await post(url+'/shipments',shipment)).status,401);
  assert.equal(s.calls.length,0);
  s.actor=actor;
  const shipmentResponse=await post(url+'/shipments',shipment);
  assert.equal(shipmentResponse.status,201);assert.equal(shipmentResponse.headers.get('cache-control'),'no-store');
  assert.deepEqual(await shipmentResponse.json(),{id:'101',sessionId:'41',itemCount:1});
  const followResponse=await post(url+'/followups',followup);
  assert.equal(followResponse.status,201);assert.deepEqual(await followResponse.json(),{id:'102',sessionId:'41',linkedProductCount:1});
  assert.equal(s.commits,2);
  assert(s.calls.every(c=>!c.sql.includes('orders')));
 });
});
test('B3 HTTP refuses grant loss and cross-session/owner spoofing without SQL insert',async()=>{
 await http(async(url,s)=>{
  s.actor={...actor,role:'admin'};s.granted=false;
  const denied=await post(url+'/shipments',shipment);assert.equal(denied.status,404);
  assert(!s.calls.some(c=>c.sql.startsWith('INSERT')));
  s.granted=true;s.calls=[];
  assert.equal((await post(url+'/followups',{...followup,sessionId:'42'})).status,400);
  assert.equal((await post(url+'/followups',{...followup,actorUserId:'99'})).status,400);
  assert(!s.calls.some(c=>c.sql.startsWith('INSERT')));
 });
});
test('B3 history routes enforce authentication, query shape and grant before any private data',async()=>{
 await http(async(url,s)=>{
  assert.equal((await fetch(url+'/shipments')).status,401);
  assert.equal(s.calls.length,0);
  s.actor=actor;
  assert.equal((await fetch(url+'/followups?ownerId=9')).status,400);
  assert.equal((await fetch(url+'/shipments?offset=-1')).status,400);
  assert(!s.calls.some(c=>c.sql.includes('sample_shipments')));
  s.granted=false;
  assert.equal((await fetch(url+'/shipments')).status,404);
  assert(!s.calls.some(c=>c.sql.includes('sample_shipments')));
 });
});
test('B3 HTTP rejects malformed JSON, arrays, unknown fields and leaking diagnostics',async()=>{
 await http(async(url,s)=>{
  s.actor=actor;
  for(const payload of ['{','[]','null','{"hello":true}']){
   const res=await fetch(url+'/shipments',{method:'POST',headers:{'content-type':'application/json'},body:payload});
   assert.equal(res.status,400);assert(!(await res.text()).includes('SyntaxError'));
  }
  assert.equal((await post(url+'/shipments?actorId=1',shipment)).status,400);
 });
});
