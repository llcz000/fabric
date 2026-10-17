import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type {AppPrincipal} from '../access/types';
import {addManualSampleItem,SampleSessionManualError} from './sessionManual';
import {createSampleSessionManualRouter} from './sessionManualRoutes';
import {CardSelectionFixture} from './sessionCardSelection.testFixture';
const sales:AppPrincipal={userId:'6',sessionId:'1',role:'sales',username:'sales',displayName:'销售',canManageProducts:false,canManageOwnOrders:false};
test('manual card selection accepts both registered roles with an explicit grant and rechecks stale roles',async()=>{
 for(const role of ['sales','admin'] as const){
  const db=new CardSelectionFixture();db.role=role;
  const result=await addManualSampleItem(db,{...sales,role},{sessionId:'11',cardId:'44',productIds:['8']});assert.equal(result.items[0].action,'added');
 }
 const db=new CardSelectionFixture();db.role='admin';
 await assert.rejects(addManualSampleItem(db,sales,{sessionId:'11',cardId:'44'}),(e:unknown)=>e instanceof SampleSessionManualError&&e.status===403);
 assert(!db.calls.some(x=>x.sql.includes('FROM sample_cards')));
});
test('B3 card POST rejects legacy product-only selection and spoofed fields, protects internal errors',async()=>{
 const db=new CardSelectionFixture();let actor:AppPrincipal|undefined=sales;
 const app=express();app.use('/api/v2/customer-samples',createSampleSessionManualRouter((_req,res,next)=>{
  if(!actor){res.status(401).json({error:'Unauthorized'});return;}res.locals.principal=actor;next();
 },db));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const address=server.address();assert(address&&typeof address!=='string');
 const url=`http://127.0.0.1:${address.port}/api/v2/customer-samples/sessions/11/items/manual`;
 const post=(body:unknown)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  actor=undefined;assert.equal((await post({cardId:'44'})).status,401);actor=sales;
  for(const body of [{productId:'8'},{cardId:'44',userId:'7'},{cardId:44},{cardId:'0'},{cardId:'44',productIds:[]},{cardId:'44',productIds:['8','8']},[],null,{}])assert.equal((await post(body)).status,400);
  assert.equal(db.calls.length,0);
  let response=await post({cardId:'44',productIds:['8']});assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal((await response.json()).items[0].action,'added');
  response=await post({cardId:'44',productIds:['99']});assert.equal(response.status,409);
  db.failure='audit';response=await post({cardId:'44'});assert.equal(response.status,503);assert(!(await response.text()).includes('PRIVATE'));
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
