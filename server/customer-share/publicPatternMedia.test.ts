import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';
import {createPublicPatternMediaRouter} from './publicPatternMedia';import {deriveStablePatternLinkToken} from './patternLinkIssuer';import {hashPatternLinkToken} from './patternLinkToken';
const token=deriveStablePatternLinkToken('4',Buffer.alloc(32,7)),preview='x'.repeat(43);
test('public media requires published active link AND current scoped relation, serves only bounded derived image and rechecks after read',async()=>{
 let active=true,related=true,change=false,reads=0;
 const pool={async query():Promise<[unknown,unknown]>{return [[{token_hash:hashPatternLinkToken(token),pattern_master_id:'4',link_status:'active',revoked_at:null,parent_is_active:active?1:0}],[]];}};
 const app=express();app.use('/api/public/patterns',createPublicPatternMediaRouter({pool,verifyServerDecision:async()=>({authorizationVerified:true,publicationVerified:active}),loadPreviews:async()=>new Map(related?[[`display:${preview}`,'asset']]:[]),readDisplay:async()=>{reads++;if(change)related=false;return {body:Buffer.from('derived'),mime:'image/webp',byteSize:7,etag:'"derived"'};}}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const a=server.address();assert(a&&typeof a!=='string');const base='http://127.0.0.1:'+a.port+'/api/public/patterns/'+token+'/images/';
 try{
  const ok=await fetch(base+preview);assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'no-store');assert.equal(ok.headers.get('content-type'),'image/webp');assert.equal(await ok.text(),'derived');
  assert.equal((await fetch(base+'asset')).status,404);assert.equal(reads,1);
  active=false;assert.equal((await fetch(base+preview)).status,404);assert.equal(reads,1);
  active=true;change=true;assert.equal((await fetch(base+preview)).status,404);assert.equal(reads,2);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
