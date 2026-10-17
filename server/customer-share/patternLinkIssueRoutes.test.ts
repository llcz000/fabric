import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {createPatternShareIssueRouter} from './patternLinkIssueRoutes';
import {hashPatternLinkToken} from './patternLinkToken';
const SECRET=Uint8Array.from(Array.from({length:32},(_,i)=>i+1));
const BEARER='a'.repeat(64);
async function http(run:(ctx:{
 base:string;events:string[];links:{token_hash:string;master_id:string;status:string;revoked_at:null}[];
 active:boolean;authenticated:boolean;failInsert:boolean;
})=>Promise<void>){
 const events:string[]=[];
 const links: {token_hash:string;master_id:string;status:string;revoked_at:null}[]=[];
 const ctx={base:'',events,links,active:true,authenticated:true,failInsert:false};
 const tx={
  async beginTransaction(){events.push('BEGIN');},
  async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
   events.push(sql.includes('FROM v2_access_users')?'USER':
    sql.includes('FROM v2_access_sessions')?'SESSION':
    sql.includes('FROM pattern_masters')?'MASTER':
    sql.includes('FROM pattern_share_links')?'SHARE':
    sql.startsWith('INSERT INTO pattern_share_links')?'INSERT':'UNKNOWN');
   if(sql.includes('FROM v2_access_users'))return [[{id:'9',role:'sales',is_active:1}],[]];
   if(sql.includes('FROM v2_access_sessions'))return [[{id:'12',user_id:'9'}],[]];
   if(sql.includes('FROM pattern_masters'))return [[{id:'42',is_active:ctx.active?1:0}],[]];
   if(sql.includes('FROM pattern_share_links'))return [links,[]];
   if(sql.startsWith('INSERT INTO pattern_share_links')){
    assert.equal(params.length,2);
    assert.match(String(params[0]),/^[a-f0-9]{64}$/);
    assert.equal(params[1],'42');
    if(ctx.failInsert)throw Error('PRIVATE_SQL_FAILURE');
    links.push({token_hash:String(params[0]),master_id:'42',status:'active',revoked_at:null});
    return [{affectedRows:1},[]];
   }
   throw Error('Unexpected SQL');
  },
  async commit(){events.push('COMMIT');},
  async rollback(){events.push('ROLLBACK');},
  release(){events.push('RELEASE');}
 };
 const authDb={async query(sql:string,params:unknown[]):Promise<[unknown,unknown]>{
  events.push('AUTH');
  assert.match(sql,/v2_access_sessions/);
  assert.equal(params.length,1);
  return [ctx.authenticated?[{user_id:'9',username:'sales',display_name:'Sales',role:'sales',
   can_manage_own_orders:1,can_manage_products:1,session_id:'12'}]:[],[]];
 }};
 const pool={async getConnection(){events.push('TX');return tx;}};
 const app=express();
 app.use('/api/v2',createPatternShareIssueRouter({
  authDb,pool,secret:SECRET,publicBase:'https://share.example.test'
 }));
 const server=await new Promise<ReturnType<typeof app.listen>>(resolve=>{
  const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));
 });
 try{
  const address=server.address();assert(address&&typeof address!=='string');
  ctx.base='http://127.0.0.1:'+address.port+'/api/v2/patterns/42/share';
  await run(ctx);
 }finally{await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
}
const issue=(url:string,token?:string,body='{}')=>fetch(url,{method:'POST',headers:{
 'Content-Type':'application/json',...(token?{'Authorization':token}:{})
},body});
test('B1 authenticated issued HTTPS link is stable under disabled / reenabled master',async()=>{
 await http(async ctx=>{
  const first=await issue(ctx.base,'Bearer '+BEARER);
  assert.equal(first.status,201);
  assert.equal(first.headers.get('cache-control'),'no-store');
  assert.equal(first.headers.get('referrer-policy'),'no-referrer');
  const created=await first.json();
  assert.equal(created.created,true);
  assert.match(created.url,/^https:\/\/share\.example\.test\/p\/[A-Za-z0-9_-]{43}$/);
  assert.equal(ctx.links.length,1);
  assert.equal(ctx.links[0].token_hash,hashPatternLinkToken(created.url.split('/').at(-1)));
  ctx.active=false;
  const second=await issue(ctx.base,'Bearer '+BEARER);
  assert.equal(second.status,200);
  assert.deepEqual(await second.json(),{url:created.url,created:false});
  ctx.active=true;
  const restored=await issue(ctx.base,'Bearer '+BEARER);
  assert.equal(restored.status,200);
  assert.deepEqual(await restored.json(),{url:created.url,created:false});
  assert.equal(ctx.events.filter(x=>x==='INSERT').length,1);
  assert.equal(ctx.events.filter(x=>x==='COMMIT').length,3);
 });
});
test('B1 anonymous, invalid auth, forged input, query or wrong method cannot issue or use transaction',async()=>{
 await http(async ctx=>{
  for(const t of [undefined,'Bearer '+BEARER.slice(1),'Basic '+BEARER]){
   const reply=await issue(ctx.base,t);assert.equal(reply.status,401);
  }
  assert.deepEqual(ctx.events,[]);
  for(const path of [ctx.base+'?userId=9',ctx.base.replace('/42/','/bad/'),
   ctx.base.replace('/42/','/0/'),ctx.base.replace('/42/','/42%2F99/')]){
   const reply=await issue(path,'Bearer '+BEARER);
   assert.equal(reply.status,400);
  }
  for(const body of ['{"userId":"9"}','{"secret":"attacker"}','{"admin":true}','null']){
   const reply=await issue(ctx.base,'Bearer '+BEARER,body);
   assert.equal(reply.status,400);
  }
  assert.equal((await fetch(ctx.base,{headers:{Authorization:'Bearer '+BEARER}})).status,404);
  assert.equal(ctx.events.filter(x=>x==='TX').length,0);
  assert.equal(ctx.links.length,0);
 });
});
test('B1 revoked account or SQL insert failure always fail closed, never disclose token or driver details',async()=>{
 await http(async ctx=>{
  ctx.authenticated=false;
  const denied=await issue(ctx.base,'Bearer '+BEARER);
  assert.equal(denied.status,401);
  assert.equal(ctx.events.filter(x=>x==='TX').length,0);
  ctx.authenticated=true;ctx.failInsert=true;
  const failed=await issue(ctx.base,'Bearer '+BEARER);
  assert.equal(failed.status,503);
  const text=await failed.text();
  assert(!text.includes('PRIVATE_SQL_FAILURE')&&!text.includes('https://share.'));
  assert(ctx.events.includes('ROLLBACK'));
  assert.equal(ctx.links.length,0);
 });
});
test('router cannot be assembled with omitted or weak signing key or unsafe public origin',()=>{
 const authDb={query:async()=>[[],[]] as [unknown,unknown]};
 const pool={getConnection:async()=>({}) as never};
 for(const secret of [undefined,new Uint8Array(32),new Uint8Array(31)]){
  assert.throws(()=>createPatternShareIssueRouter({
   authDb,pool,secret:secret as Uint8Array,publicBase:'https://share.example.test'
  }),/Pattern link/);
 }
 for(const publicBase of ['http://share.example.test','https://share.example.test/p']){
  assert.throws(()=>createPatternShareIssueRouter({
   authDb,pool,secret:SECRET,publicBase
  }),/Pattern link/);
 }
});
