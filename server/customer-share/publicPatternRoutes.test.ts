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
async function http(run:(base:string,ctx:{ok:boolean;candidate:PatternCandidate;calls:string[];linkActive:boolean;withdrawOnLoad:boolean;masterActive:boolean;disableOnLoad:boolean;withdrawOnSecondRead:boolean})=>Promise<void>){
 const ctx={ok:true,candidate:input(),calls:[] as string[],linkActive:true,withdrawOnLoad:false,masterActive:true,disableOnLoad:false,withdrawOnSecondRead:false};
 const pool={async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  ctx.calls.push('SQL');assert(!sql.includes(token));assert.deepEqual(params,[hashPatternLinkToken(token)]);if(ctx.withdrawOnSecondRead&&ctx.calls.filter(x=>x==='SQL').length===2)ctx.linkActive=false;
  return [[{token_hash:hashPatternLinkToken(token),pattern_master_id:'42',link_status:ctx.linkActive?'active':'inactive',revoked_at:null,parent_is_active:ctx.masterActive?1:0}],[]];
 }};
 const app=express();app.use('/public/patterns',createPublicPatternRouter({
  pool,
  verifyServerDecision:async()=>{ctx.calls.push('verify');return {authorizationVerified:ctx.ok,publicationVerified:ctx.ok&&ctx.masterActive,unavailableVerified:ctx.ok&&!ctx.masterActive};},
  loadCandidate:async(id)=>{ctx.calls.push('load:'+id);if(ctx.withdrawOnLoad)ctx.linkActive=false;if(ctx.disableOnLoad)ctx.masterActive=false;return ctx.candidate;}
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

test('B1 master disabled shows temporarily unavailable instead of 404; same old link works after enable',async()=>{
 await http(async(url,ctx)=>{
  ctx.masterActive=false;
  ctx.calls=[];
  const disabled=await fetch(url);
  assert.equal(disabled.status,200);
  assert.deepEqual(await disabled.json(),{available:false,message:'暂不可用'});
  assert.deepEqual(ctx.calls,['SQL','verify','SQL','verify']);
  ctx.masterActive=true;
  ctx.calls=[];
  const live=await fetch(url);
  assert.equal(live.status,200);
  assert.equal((await live.json()).available,true);
  assert.deepEqual(ctx.calls,['SQL','verify','load:42','SQL','verify']);
 });
});
test('B1 disable after catalog load must suppress all previously approved content',async()=>{
 await http(async(url,ctx)=>{
  ctx.disableOnLoad=true;
  const result=await fetch(url);
  assert.equal(result.status,200);
  assert.deepEqual(await result.json(),{available:false,message:'暂不可用'});
  assert.deepEqual(ctx.calls,['SQL','verify','load:42','SQL','verify']);
 });
});
test('B1 inactive master link revoked between checks must never expose unavailable state',async()=>{
 await http(async(url,ctx)=>{
  ctx.masterActive=false;ctx.withdrawOnSecondRead=true;
  const result=await fetch(url);
  assert.equal(result.status,404);
  assert.deepEqual(await result.json(),{error:'Pattern unavailable'});
  assert.deepEqual(ctx.calls,['SQL','verify','SQL']);
 });
});
test('B1 denied server authorization stays 404 even when master disabled',async()=>{
 await http(async(url,ctx)=>{
  ctx.ok=false;ctx.masterActive=false;
  const result=await fetch(url);
  assert.equal(result.status,404);
  assert.deepEqual(await result.json(),{error:'Pattern unavailable'});
  assert.deepEqual(ctx.calls,['SQL','verify']);
 });
});
