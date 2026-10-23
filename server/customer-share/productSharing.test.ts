import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {deriveProductShareToken,resolveProductShare,createPublicProductRouter,createProductShareIssueRouter,PRODUCT_SHARE_SQL} from './productSharing';
import {hashPatternLinkToken} from './patternLinkToken';
import {deriveStablePatternLinkToken} from './patternLinkIssuer';
import type {PatternCandidate} from './publicPatternProjection';
const secret=Buffer.alloc(32,7),token=()=>deriveProductShareToken('18',secret);
const yes={isActive:true,isPublicApproved:true};
const candidate:PatternCandidate={...yes,patternNo:'G001',colorways:[{...yes,colorwayNumber:1,designImages:[],products:[{...yes,fabric:{...yes,fabricNo:'F018',fabricName:'真丝',composition:'100% 真丝',weightValue:16,weightUnit:'mm',widthCm:145},images:[]}]}]};
function fixture(){
 const state={active:1,master:'4',product:'18',related:true,withdraw:false,reads:0};
 const db={async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
  assert.match(sql,/product_share_links/);assert.deepEqual(args,[hashPatternLinkToken(token())]);
  return [[{token_hash:hashPatternLinkToken(token()),product_id:state.product,master_id:state.master,product_no:'G001-1-F018',link_status:'active',revoked_at:null,product_active:state.active,colorway_active:1,master_active:1,fabric_active:1}],[]];
 }};return {state,db};
}
test('product tokens are stable, canonical, distinct from master tokens and do not contain IDs',()=>{
 assert.equal(token(),deriveProductShareToken('18',secret));assert.match(token(),/^[A-Za-z0-9_-]{43}$/);
 assert.notEqual(token(),deriveStablePatternLinkToken('18',secret));assert.notEqual(token(),deriveProductShareToken('19',secret));
 for(const id of ['0','01','-1','18446744073709551616'])assert.throws(()=>deriveProductShareToken(id,secret));
 assert.match(PRODUCT_SHARE_SQL,/UNIQUE KEY uq_product_share_product \(product_id\)/);
 assert.match(PRODUCT_SHARE_SQL,/REFERENCES v2_products\(id\) ON DELETE CASCADE/);
});
test('product resolution requires one valid server publication row and current activity, rejects unknown states',async()=>{
 const {state,db}=fixture();assert.equal((await resolveProductShare(db,token()))?.productId,'18');
 state.active=0;assert.equal((await resolveProductShare(db,token()))?.available,false);
 state.active=2;assert.equal(await resolveProductShare(db,token()),null);
 assert.equal(await resolveProductShare(db,token()+'x'),null);
 const denied={query:async():Promise<[unknown,unknown]>=>[[],[]]};assert.equal(await resolveProductShare(denied,token()),null);
 // Duplicate lookup rows cannot select an arbitrary publication.
 assert.equal(await resolveProductShare({query:async()=>[[{},{}],[]]},token()),null);
});
test('public product JSON and images enforce the same selected product and recheck after reads',async()=>{
 const {state,db}=fixture(),ref='display:'+'x'.repeat(43);
 const app=express();app.use('/api/public/products',createPublicProductRouter({db,
  load:async(master,product)=>{assert.equal(master,'4');assert.equal(product,'18');return {candidate,previews:new Map(state.related?[[ref,'asset']]:[])};},
  readDisplay:async()=>{state.reads++;if(state.withdraw)state.related=false;return {body:Buffer.from('derived'),byteSize:7,mime:'image/webp',etag:'x'};}
 }));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const a=server.address();assert(a&&typeof a!=='string');const url='http://127.0.0.1:'+a.port+'/api/public/products/'+token();
 try{
  const ok=await fetch(url),body=await ok.json();assert.equal(ok.status,200);assert.equal(body.productNo,'G001-1-F018');assert.equal(body.pattern.colorways[0].fabrics[0].composition,'100% 真丝');assert.equal(ok.headers.get('cache-control'),'no-store');
  const img=url+'/images/'+ref.slice(8);assert.equal((await fetch(img)).status,200);
  state.active=0;assert.deepEqual(await (await fetch(url)).json(),{available:false,message:'暂不可用'});assert.equal((await fetch(img)).status,404);
  state.active=1;assert.equal((await fetch(url)).status,200);
  state.withdraw=true;assert.equal((await fetch(img)).status,404);
  assert.equal((await fetch(url+'?productId=19')).status,404);assert.equal((await fetch(url+'x')).status,404);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
test('private product issuance authenticates before writes, rejects forged input and reuses stable mapping',async()=>{
 const events:string[]=[],links:Record<string,unknown>[]=[],auth={enabled:true};
 const tx={beginTransaction:async()=>{events.push('begin');},commit:async()=>{events.push('commit');},rollback:async()=>{events.push('rollback');},release(){events.push('release');},
  async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
   if(sql.includes('FROM v2_access_users'))return [[{id:'9',role:'sales',is_active:1}],[]];
   if(sql.includes('FROM v2_access_sessions'))return [[{id:'12',user_id:'9'}],[]];
   if(sql.includes('FROM v2_products'))return [[{id:'18'}],[]];
   if(sql.includes('SELECT')&&sql.includes('product_share_links'))return [links,[]];
   if(sql.startsWith('INSERT INTO product_share_links')){links.push({product_id:'18',token_hash:args[0],status:'active',revoked_at:null});return [{affectedRows:1},[]];}
   throw Error('Unexpected SQL');
  }};
 const authDb={query:async():Promise<[unknown,unknown]>=>[auth.enabled?[{user_id:'9',username:'sales',display_name:'Sales',role:'sales',can_manage_own_orders:1,can_manage_products:1,session_id:'12'}]:[],[]]};
 const app=express();app.use('/api/v2',createProductShareIssueRouter({authDb,pool:{getConnection:async()=>tx},secret,publicBase:'https://share.example.test'}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const a=server.address();assert(a&&typeof a!=='string');const url='http://127.0.0.1:'+a.port+'/api/v2/products/18/share';
 const issue=(body='{}',authenticated=true)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(authenticated?{Authorization:'Bearer '+'a'.repeat(64)}:{})},body});
 try{
  assert.equal((await issue('{}',false)).status,401);assert.equal(events.length,0);
  assert.equal((await issue('{"productId":"19"}')).status,400);assert.equal(events.length,0);
  const first=await issue();assert.equal(first.status,201);const result=await first.json();assert.equal(result.url,'https://share.example.test/s/'+token());
  assert.equal((await issue()).status,200);assert.equal(links.length,1);assert.equal(links[0].token_hash,hashPatternLinkToken(token()));
  auth.enabled=false;assert.equal((await issue()).status,401);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
