import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {createPublicPatternRouter} from './publicPatternRoutes';
import {hashPatternLinkToken} from './patternLinkToken';
import type {PatternCandidate} from './publicPatternProjection';
const token='AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const approved={isPublicApproved:true,isActive:true};
const input=():PatternCandidate=>({...approved,patternNo:'0012',price:'PRIVATE_PRICE',
 colorways:[{...approved,colorwayNumber:1,designImages:[],products:[
  {...approved,fabric:{...approved,fabricNo:'F018',fabricName:'丝绸',composition:'100% silk',weightValue:16,weightUnit:'mm',widthCm:140,privateNote:'PRIVATE_NOTE'},images:[]}
 ]}]});
async function http(run:(base:string,ctx:{ok:boolean;candidate:PatternCandidate;calls:string[];linkActive:boolean;withdrawOnLoad:boolean})=>Promise<void>){
 const ctx={ok:true,candidate:input(),calls:[] as string[],linkActive:true,withdrawOnLoad:false};
 const pool={async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  ctx.calls.push('SQL');assert(!sql.includes(token));assert.deepEqual(params,[hashPatternLinkToken(token)]);
  return [[{token_hash:hashPatternLinkToken(token),pattern_master_id:'42',link_status:ctx.linkActive?'active':'inactive',revoked_at:null,parent_is_active:1}],[]];
 }};
 const app=express();app.use('/public/patterns',createPublicPatternRouter({
  pool,
  verifyServerDecision:async()=>{ctx.calls.push('verify');return {authorizationVerified:ctx.ok,publicationVerified:ctx.ok};},
  loadCandidate:async(id)=>{ctx.calls.push('load:'+id);if(ctx.withdrawOnLoad)ctx.linkActive=false;return ctx.candidate;}
 }));
 const server=await new Promise<ReturnType<typeof app.listen>>(resolve=>{const x=app.listen(0,'127.0.0.1',()=>resolve(x));});
 try{const addr=server.address();assert(addr&&typeof addr!=='string');await run('http://127.0.0.1:'+addr.port+'/public/patterns/'+token,ctx);}
 finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}
test('B1 isolated public GET checks live token, server publication and whitelists all customer content',async()=>{
 await http(async(url,ctx)=>{
  const response=await fetch(url);assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  const json=await response.json();
  assert.deepEqual(json,{available:true,pattern:{patternNo:'0012',colorways:[{colorwayNumber:1,designImages:[],fabrics:[
   {fabricNo:'F018',fabricName:'丝绸',composition:'100% silk',weightValue:16,weightUnit:'mm',widthCm:140,
    displayImages:[],detailImages:[],effectImages:[]}
  ]}]}});
  assert(!JSON.stringify(json).includes('PRIVATE_'));
  assert.deepEqual(ctx.calls,['SQL','verify','load:42','SQL','verify']);
 });
});
test('B1 server rechecks each request and a withdrawn publication never exposes previous content',async()=>{
 await http(async(url,ctx)=>{
  assert.equal((await fetch(url)).status,200);
  ctx.ok=false;ctx.calls=[];
  const res=await fetch(url);assert.equal(res.status,404);
  assert(!((await res.text()).includes('0012')));
  assert(!ctx.calls.some(x=>x.startsWith('load:')));
 });
});
test('B1 link status withdrawn during candidate load returns 404, never stale public data',async()=>{
 await http(async(url,ctx)=>{
  ctx.withdrawOnLoad=true;
  const res=await fetch(url);
  assert.equal(res.status,404);
  assert(!((await res.text()).includes('0012')));
  assert.deepEqual(ctx.calls,['SQL','verify','load:42','SQL']);
 });
});
test('B1 disabled colorway shows temporarily unavailable, while an invalid link and malformed query return safe 404',async()=>{
 await http(async(url,ctx)=>{
  ctx.candidate.colorways[0].isActive=false;
  const unavailable=await fetch(url);assert.equal(unavailable.status,200);
  assert.deepEqual(await unavailable.json(),{available:false,message:'暂不可用'});
  assert.equal((await fetch(url+'?ownerId=42')).status,404);
  assert.equal((await fetch(url+'99')).status,404);
  assert.equal((await fetch(url.replace(token,'sample-card'))).status,404);
  assert.equal((await fetch(url,{method:'POST'})).status,404);
 });
});
