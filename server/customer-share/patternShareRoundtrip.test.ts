import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {createPatternShareIssueRouter} from './patternLinkIssueRoutes';
import {createPublicPatternRouter} from './publicPatternRoutes';

const SECRET=Uint8Array.from(Array.from({length:32},(_,i)=>i+1));
const AUTH='Bearer '+'c'.repeat(64);
const approved={isPublicApproved:true,isActive:true};
test('B1 synthetic HTTP issuer → public read → temporarily disabled → restored same link; never leaks private data',async()=>{
 const state={active:true,approved:true,revoked:false,links:[] as Record<string,unknown>[],issued:0,loaded:0};
 const tx={
  async beginTransaction(){},
  async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
   if(sql.includes('FROM v2_access_users'))return [[{id:'9',role:'sales',is_active:1}],[]];
   if(sql.includes('FROM v2_access_sessions'))return [[{id:'12',user_id:'9'}],[]];
   if(sql.includes('FROM pattern_masters'))return [[{id:'42',is_active:state.active?1:0}],[]];
   if(sql.includes('FROM pattern_share_links'))return [state.links,[]];
   if(sql.startsWith('INSERT INTO pattern_share_links')){
    state.issued++;
    state.links.push({master_id:params[1],token_hash:params[0],status:'active',revoked_at:null});
    return [{affectedRows:1},[]];
   }
   throw Error('Unexpected SQL');
  },
  async commit(){},async rollback(){},release(){}
 };
 const pool={
  async getConnection(){return tx;},
  async query(_sql:string,params:unknown[]):Promise<[unknown,unknown]>{
   const item=state.links[0];
   return [item&&item.token_hash===params[0]?[{
    token_hash:item.token_hash,pattern_master_id:item.master_id,
    link_status:state.revoked?'inactive':'active',
    revoked_at:state.revoked?'2026-10-17':null,parent_is_active:state.active?1:0
   }]:[],[]];
  }
 };
 const app=express();
 app.use('/api/v2',createPatternShareIssueRouter({
  authDb:{query:async()=>[[{user_id:'9',username:'sales',display_name:'Sales',role:'sales',
   can_manage_own_orders:1,can_manage_products:1,session_id:'12'}],[]]},
  pool,secret:SECRET,publicBase:'https://share.example.test'
 }));
 app.use('/public/patterns',createPublicPatternRouter({
  pool,verifyServerDecision:async()=>({
   authorizationVerified:state.approved,publicationVerified:state.approved&&state.active,
   unavailableVerified:state.approved&&!state.active
  }),
  loadCandidate:async(id)=>{
   assert.equal(id,'42');state.loaded++;
   return {...approved,patternNo:'M001',price:'PRIVATE_PRICE',colorways:[
    {...approved,colorwayNumber:1,products:[],privateCost:'PRIVATE_COST'}
   ]};
  }
 }));
 const server=await new Promise<ReturnType<typeof app.listen>>(resolve=>{
  const inst=app.listen(0,'127.0.0.1',()=>resolve(inst));
 });
 try{
  const addr=server.address();assert(addr&&typeof addr!=='string');
  const base='http://127.0.0.1:'+addr.port;
  const issue=()=>fetch(base+'/api/v2/patterns/42/share',{method:'POST',headers:{
   Authorization:AUTH,'Content-Type':'application/json'
  },body:'{}'});
  const first=await issue();assert.equal(first.status,201);
  const generated=await first.json();
  assert.match(generated.url,/^https:\/\/share\.example\.test\/p\/[A-Za-z0-9_-]{43}$/);
  const token=generated.url.split('/').at(-1);
  const publicUrl=base+'/public/patterns/'+token;
  const show=await fetch(publicUrl);
  assert.equal(show.status,200);assert.equal((await show.json()).pattern.patternNo,'M001');
  assert.equal(state.loaded,1);
  state.active=false;
  const inactive=await fetch(publicUrl);
  assert.equal(inactive.status,200);
  assert.deepEqual(await inactive.json(),{available:false,message:'暂不可用'});
  assert.equal(state.loaded,1); // Do not even attempt to read private content.
  const reissued=await issue();
  assert.equal(reissued.status,200);
  assert.deepEqual(await reissued.json(),{url:generated.url,created:false});
  state.active=true;
  const restored=await fetch(publicUrl);
  assert.equal(restored.status,200);
  const body=await restored.json();
  assert.equal(body.available,true);
  assert.deepEqual(body.pattern,{patternNo:'M001',colorways:[{colorwayNumber:1,designImages:[],fabrics:[]}]});
  assert(!JSON.stringify(body).includes('PRIVATE_'));
  assert.equal(state.issued,1);
  state.revoked=true;
  // Simulate a previously withdrawn row; no business revocation UI exists.
  state.links[0].status='revoked';
  const denied=await fetch(publicUrl);
  assert.equal(denied.status,404);
  assert.equal((await issue()).status,503);
  assert.equal(state.issued,1);
 }finally{
  await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
 }
});
