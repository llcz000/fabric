import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {hashSessionToken} from '../access/password';
import {createSampleCardScanRouter} from './cardScanRoutes';
import {SampleScanError} from './scanRepository';
import type {AppPrincipal} from '../access/types';

const token='a'.repeat(64);
class AuthDb {
 role:'sales'|'admin'='sales';
 active=true;
 async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  if(sql.includes('JOIN v2_access_users')&&params[0]===hashSessionToken(token)&&this.active){
   return [[{user_id:2,username:'sales',display_name:'业务员',role:this.role,
    can_manage_own_orders:1,can_manage_products:0,session_id:1}],[]];
  }
  if(sql.includes('JOIN v2_access_users')) return [[],[]];
  throw Error('Unexpected access query');
 }
}
async function exercise(run:(base:string,db:AuthDb,state:{granted:boolean;calls:number;failure:Error|null})=>Promise<void>){
 const db=new AuthDb(),state={granted:false,calls:0,failure:null as Error|null};
 const app=express();app.use(express.json({limit:'8kb'}));
 app.use('/api/v2/sample-cards',createSampleCardScanRouter(db,{
  authorize:async (principal:AppPrincipal,sessionId:string)=>state.granted&&principal.userId==='2'&&sessionId==='51',
  scan:async (input,principal)=>{state.calls++;assert.equal(principal.role,'sales');
   if(state.failure)throw state.failure;
   return {cardId:'12',resolvedProductIds:['8','9'],addedProductIds:['9'],alreadySelectedProductIds:['8'],selectedCardCount:1};
  }
 }));
 const server=await new Promise<ReturnType<typeof app.listen>>(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
 try{const a=server.address();assert(a&&typeof a!=='string');await run('http://127.0.0.1:'+a.port+'/api/v2/sample-cards/scan',db,state);}
 finally {await new Promise<void>((res,rej)=>server.close(e=>e?rej(e):res()));}
}
async function post(url:string,body:unknown,auth?:string){
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+auth}:{})},body:JSON.stringify(body)});
 return {status:r.status,data:await r.json() as Record<string,unknown>,cache:r.headers.get('cache-control')};
}
test('AC-97 B2-5 zero eligible products sends safe actionable 409 without leaking private SQL',async()=>{
 await exercise(async(url,_db,state)=>{
  state.granted=true;state.failure=new SampleScanError(409,'PRIVATE QUERY','NO_AVAILABLE_PRODUCTS');
  const res=await post(url,{cardToken:'valid_card_token_from_printed_qr',sessionId:'51'},token);
  assert.equal(res.status,409);assert.equal(res.data.error,'当前没有可选产品');
  assert(!JSON.stringify(res.data).includes('PRIVATE'));
 });
});
test('AC-86 client/public scanning denied; real session and server-side grant required',async()=>{
 await exercise(async(url,db,state)=>{
  const input={cardToken:'valid_card_token_from_printed_qr',sessionId:'51'};
  assert.equal((await post(url,input)).status,401);
  assert.equal((await post(url,input,'b'.repeat(64))).status,401);
  assert.equal((await post(url,input,token)).status,403);
  assert.equal(state.calls,0);
  state.granted=true;
  const ok=await post(url,input,token);
  assert.equal(ok.status,200);assert.equal(ok.cache,'no-store');
  assert.deepEqual(ok.data.addedProductIds,['9']);
  assert.equal(state.calls,1);
  db.role='admin';
  assert.equal((await post(url,input,token)).status,403,'admin not implicitly allowed as salesperson');
  db.role='sales';db.active=false;
  assert.equal((await post(url,input,token)).status,401,'revoked/disabled actor denied');
  assert.equal(state.calls,1);
 });
});
test('QR-05 no actor-supplied role, owner or permission may be trusted',async()=>{
 await exercise(async(url,db,state)=>{
  state.granted=true;
  const bad=[
   {cardToken:'valid_card_token_from_printed_qr',sessionId:'51',role:'sales'},
   {cardToken:'valid_card_token_from_printed_qr',sessionId:'51',userId:'2'},
   {cardToken:'short',sessionId:'51'},
   {cardToken:'valid_card_token_from_printed_qr',sessionId:'0'},
   {cardToken:'valid_card_token_from_printed_qr'},
  ];
  for(const payload of bad)assert.equal((await post(url,payload,token)).status,400);
  assert.equal((await post(url,{cardToken:'valid_card_token_from_printed_qr',sessionId:'999'},token)).status,403);
  assert.equal(state.calls,0);
 });
});
test('AC-86 scan URL has no public GET image/details fallback and backend errors fail closed',async()=>{
 await exercise(async(url,db,state)=>{
  const response=await fetch(url);
  assert.equal(response.status,404);
  state.granted=true;
  assert.equal((await post(url,{cardToken:'valid_card_token_from_printed_qr',sessionId:'51'},token)).status,200);
  assert.equal(state.calls,1);
 });
});
test('B2-2 invalid card, unsupported product status and temporary outage produce distinct safe statuses',async()=>{
 await exercise(async(url,_db,state)=>{
  state.granted=true;
  const body={cardToken:'valid_card_token_from_printed_qr',sessionId:'51'};
  for(const [failure,status] of [
   [new SampleScanError(404,'Invalid card details secret'),404],
   [new SampleScanError(409,'Unavailable product raw data secret'),409],
   [new SampleScanError(403,'Revoked session details secret'),403],
   [new Error('SQL failed: secret connection string'),503],
  ] as const){
   state.failure=failure;
   const response=await post(url,body,token);
   assert.equal(response.status,status);
   assert.equal(response.cache,'no-store');
   assert(!JSON.stringify(response.data).includes('secret'),'never echo private exception text');
  }
  assert.equal(state.calls,4);
 });
});
