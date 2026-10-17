import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes} from 'node:crypto';
import express from 'express';
import {createV2SelectionFetch,createSampleSelectionClient,SelectionHttpError} from './sampleSelectionClient';
import {searchManualCards} from './manualSelectionModel';
import {createSampleSessionReadRouter} from '../../../server/customer-samples/sessionReadRoutes';
import {createSampleSessionManualRouter} from '../../../server/customer-samples/sessionManualRoutes';
import {requireV2Principal} from '../../../server/access/middleware';
import {hashSessionToken} from '../../../server/access/password';

test('manual UI adapters use real private HTTP authentication and session-scoped card routes',async()=>{
 // SQL is an in-memory read fixture. No MySQL connection, schema or write is permitted.
 const token=randomBytes(32).toString('hex');let sessionLive=true,granted=true,requests=0;
 const db={async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  if(!sql.startsWith('SELECT'))throw Error('Unexpected write in read-only HTTP fixture');
  if(sql.includes('s.token_hash'))return [sessionLive&&params[0]===hashSessionToken(token)?[
   {user_id:'6',session_id:'9',username:'sales',display_name:'演示销售',role:'sales',can_manage_own_orders:0,can_manage_products:0}]:[],[]];
  if(sql.includes('FROM v2_access_users'))return [[{id:'6',role:'sales',is_active:1}],[]];
  if(sql.includes('FROM v2_access_sessions'))return [[{id:'9'}],[]];
  if(sql.includes('FROM customer_sample_session_access'))return [granted?[{can_manage:1}]:[],[]];
  if(sql.includes('customer_reference'))return [[{customer_reference:'演示客户',total:0,selected_card_count:0}],[]];
  if(sql.includes('FROM customer_sample_sessions'))return [[{id:'51',status:'closed'}],[]];
  if(sql.includes('FROM customer_sample_items'))return [[],[]];
  if(sql.includes('COUNT(*) AS total')&&sql.includes('FROM sample_cards'))return [[{total:0}],[]];
  if(sql.includes('c.card_no')&&sql.includes('FROM sample_cards'))return [[],[]];
  throw Error('Unexpected read in HTTP fixture');
 }};
 const pool={async getConnection(){return {query:db.query,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{}};}};
 const app=express();app.use((_req,_res,next)=>{requests++;next();});
 app.use('/api/v2/customer-samples',createSampleSessionReadRouter(db,pool));
 app.use('/api/v2/customer-samples',createSampleSessionManualRouter(requireV2Principal(db),pool));
 const server=app.listen(0,'127.0.0.1');
 await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 const address=server.address();assert(address&&typeof address!=='string');
 const origin='http://127.0.0.1:'+address.port;
 const transport:typeof fetch=(input,init)=>fetch(origin+String(input),init);
 try{
  assert.equal((await transport('/api/v2/customer-samples/sessions/51/cards')).status,401);
  const authenticated=createV2SelectionFetch(transport,()=>token),selection=createSampleSelectionClient(authenticated);
  const cards=await searchManualCards(authenticated,{sessionId:'51',query:'0012',offset:0});
  assert.equal(cards.total,0);assert.deepEqual(cards.items,[]);
  const page=await selection.load('51',20,0);assert.equal(page.session.status,'closed');assert.equal(page.session.customerReference,'演示客户');
  await assert.rejects(selection.addManual('51','44'),(e:unknown)=>e instanceof SelectionHttpError&&e.status===409);
  granted=false;await assert.rejects(selection.load('51',20,0),(e:unknown)=>e instanceof SelectionHttpError&&e.status===404);
  granted=true;sessionLive=false;
  await assert.rejects(selection.load('51',20,0),(e:unknown)=>e instanceof SelectionHttpError&&e.status===401);
  const before=requests;
  await assert.rejects(searchManualCards(createV2SelectionFetch(transport,()=>null),{sessionId:'51',query:'',offset:0}),SelectionHttpError);
  assert.equal(requests,before,'missing V2 session is rejected before HTTP dispatch');
 }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
