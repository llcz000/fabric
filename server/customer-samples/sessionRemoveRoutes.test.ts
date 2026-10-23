import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type {AppPrincipal} from '../access/types';
import {createSampleSessionRemoveRouter} from './sessionRemoveRoutes';
import {SampleSessionRemoveError} from './sessionRemove';

async function http(run:(url:string,state:{actor:AppPrincipal|undefined;failure:Error|null;calls:number})=>Promise<void>){
 const state={actor:undefined as AppPrincipal|undefined,failure:null as Error|null,calls:0};
 const app=express();app.use(express.json({strict:false}));
 app.use('/api/v2/customer-samples',createSampleSessionRemoveRouter((_req,res,next)=>{
  if(!state.actor){res.status(401).json({error:'Unauthorized'});return;}
  res.locals.principal=state.actor;next();
 },{async getConnection(){state.calls++;throw state.failure??new SampleSessionRemoveError(404);}}));
 const server=await new Promise<ReturnType<typeof app.listen>>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try{const addr=server.address();assert(addr&&typeof addr!=='string');await run('http://127.0.0.1:'+addr.port+'/api/v2/customer-samples/sessions/11/items/81',state);}
 finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}
const sales:AppPrincipal={userId:'6',sessionId:'1',username:'sales',displayName:'Sales',role:'sales',canManageProducts:false,canManageOwnOrders:false};
test('B3 isolated DELETE route requires authentication, admin or sales and strict server-owned target',async()=>{
 await http(async(url,state)=>{
  assert.equal((await fetch(url,{method:'DELETE'})).status,401);assert.equal(state.calls,0);
  state.actor={...sales,role:'admin'};assert.equal((await fetch(url,{method:'DELETE'})).status,404);
  assert.equal(state.calls,1,'granted role reaches transaction; a missing item remains hidden');
  state.actor=sales;state.calls=0;
  for(const body of [{userId:'9'},{productId:'9'},{role:'sales'},[],null]){
   const r=await fetch(url,{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
   assert.equal(r.status,400);assert.equal(state.calls,0);
  }
  assert.equal((await fetch(url+'?userId=9',{method:'DELETE'})).status,400);
  assert.equal((await fetch(url.replace('/81','/0'),{method:'DELETE'})).status,400);assert.equal(state.calls,0);
  assert.equal((await fetch(url,{method:'GET'})).status,404);assert.equal(state.calls,0);
  const absent=await fetch(url,{method:'DELETE'});assert.equal(absent.status,404);assert.equal(absent.headers.get('cache-control'),'no-store');assert.equal(state.calls,1);
  const zeroLength=await fetch(url,{method:'DELETE',headers:{'content-length':'0'}});
  assert.equal(zeroLength.status,404,'explicitly empty body must not be rejected as malformed');
  assert.equal(state.calls,2);
 });
});
test('B3 isolated DELETE route emits safe errors for missing targets, revoked grants, closed sessions and DB failure',async()=>{
 await http(async(url,state)=>{
  state.actor=sales;
  for(const n of [400,403,404,409] as const){
   state.failure=new SampleSessionRemoveError(n);
   const r=await fetch(url,{method:'DELETE'});assert.equal(r.status,n);assert(!((await r.text()).includes('productId')));
  }
  state.failure=Error('PRIVATE SQL PASSWORD');const unavailable=await fetch(url,{method:'DELETE'});
  assert.equal(unavailable.status,503);assert(!((await unavailable.text()).includes('PRIVATE')));
 });
});