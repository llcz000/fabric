import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';
import {createSampleSessionDirectoryRouter} from './sessionDirectoryRoutes';
test('directory HTTP authenticates, rejects spoofed/unknown payloads and preserves safe errors without writes',async()=>{
 let writes=0;const queries:string[]=[];
 const pool={async getConnection(){return {beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{},query:async(sql:string):Promise<[unknown,unknown]>=>{
  queries.push(sql);if(sql.includes('FROM v2_access_users'))return [[{role:'admin',is_active:1}],[]];if(sql.includes('FROM v2_access_sessions'))return [[{id:'9'}],[]];
  if(sql.startsWith('INSERT')){writes++;return [{affectedRows:1,insertId:'41'},[]];}
  if(sql.includes('COUNT(*) AS total'))return [[{total:'1'}],[]];
  if(sql.includes('JOIN customer_sample_session_access'))return [[{id:'41',customer_reference:'客户甲',status:'open'}],[]];
  throw Error('PRIVATE SQL credentials');
 }};}};
 const app=express();app.use('/api/v2/customer-samples',createSampleSessionDirectoryRouter((req,res,next)=>{if(req.headers.authorization!=='Bearer test'){res.status(401).end();return;}res.locals.principal={userId:'6',sessionId:'9',role:'admin'};next();},pool));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();assert(address&&typeof address!=='string');const url='http://127.0.0.1:'+address.port+'/api/v2/customer-samples/sessions';
 const headers={authorization:'Bearer test','Content-Type':'application/json'};
 try{
  assert.equal((await fetch(url)).status,401);assert.equal(queries.length,0);
  for(const body of [{customerReference:'客户',ownerId:'7'},{customerReference:''}])assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(body)})).status,400);
  assert.equal(writes,0);
  const created=await fetch(url,{method:'POST',headers,body:JSON.stringify({customerReference:'客户甲'})});assert.equal(created.status,201);assert.equal(created.headers.get('cache-control'),'no-store');assert.equal((await created.json()).id,'41');assert.equal(writes,2);
  assert.equal((await fetch(url+'?ownerId=7',{headers})).status,400);assert.equal((await fetch(url+'?limit=-1',{headers})).status,400);
  assert.equal((await fetch(url,{headers})).status,200);
  const broken=await fetch(url+'/41/progress',{headers});assert.equal(broken.status,503);assert(!(await broken.text()).includes('PRIVATE'));
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
