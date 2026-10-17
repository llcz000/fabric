import assert from 'node:assert/strict';
import test from 'node:test';
import {createSandboxSession} from './sandboxSession';

const TOKEN='ab'.repeat(32);
const principal={id:'23',username:'sales_a',displayName:'Sales A',role:'sales'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,
 headers:{'content-type':'application/json'}});
const setup=(handler:(url:string,init:RequestInit)=>Promise<Response>)=>{
 const calls:{url:string;init:RequestInit}[]=[];
 const session=createSandboxSession('http://127.0.0.1:4455',(async(input,init)=>{
  const url=String(input);calls.push({url,init:init??{}});
  return handler(url,init??{});
 }) as typeof fetch);
 return {session,calls};
};

test('only a strictly loopback HTTP origin and api/v2 paths can reach a network',async()=>{
 for(const host of ['http://localhost:4455','http://127.0.0.2:4455',
  'http://127.0.0.1.evil.example:4455','https://127.0.0.1:4455',
  'http://127.0.0.1:4455@evil.example','http://127.0.0.1:4455/x',
  'http://127.0.0.1','file:///tmp/foo','http://[::1]:4455']) {
  assert.throws(()=>createSandboxSession(host,fetch),/sandbox/i,host);
 }
 const {session,calls}=setup(async()=>reply({}));
 await assert.rejects(()=>session.request('/api/products'),/sandbox/i);
 await assert.rejects(()=>session.request('//evil.example/api/v2/products'),/sandbox/i);
 await assert.rejects(()=>session.request('https://evil.example/api/v2/products'),/sandbox/i);
 await assert.rejects(()=>session.request('/api/v2/access/login'),/sandbox/i);
 await assert.rejects(()=>session.request('/api/v2/products'),/Unauthorized/i);
 assert.equal(calls.length,0);
});

test('login requires V2 server verified principal and keeps token only in memory',async()=>{
 const {session,calls}=setup(async(url,init)=>{
  if(url.endsWith('/access/login')){
   assert.equal(init.method,'POST');
   assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');
   assert(!new Headers(init.headers).has('Authorization'));
   return reply({token:TOKEN,expiresIn:3600});
  }
  assert.equal(new Headers(init.headers).get('Authorization'),'Bearer '+TOKEN);
  if(url.endsWith('/api/v2/access/me'))return reply(principal);
  if(url.endsWith('/api/v2/products?limit=5'))return reply({items:[],total:0,limit:5,offset:0});
  throw Error('Unexpected route '+url);
 });
 assert.deepEqual(await session.login('sales_a','p4ssword!'),principal);
 assert.deepEqual(session.currentPrincipal(),principal);
 assert.equal(session.canManageCatalog(),true);
 const response=await session.request('/api/v2/products?limit=5');
 assert.equal(response.status,200);
 assert.equal(new Headers(calls[2].init.headers).get('Authorization'),'Bearer '+TOKEN);
 for(const call of calls)assert.equal(call.init.credentials,'omit');
 assert.equal(session.currentPrincipal()?.username,'sales_a');
});

test('malformed token, role, unauthenticated me and external redirects fail closed',async()=>{
 for(const loginBody of [{token:'not-a-bearer',expiresIn:3600},{token:TOKEN,expiresIn:0},
  {token:TOKEN,expiresIn:3600,role:'admin'},{}]){
  const {session}=setup(async()=>reply(loginBody));
  await assert.rejects(()=>session.login('sales_a','p4ssword!'));
  assert.equal(session.currentPrincipal(),null);
 }
 const {session}=setup(async(url)=>url.endsWith('/login')?reply({token:TOKEN,expiresIn:3600}):reply({
  id:'2',role:'administrator',username:'a',displayName:'A'
 }));
 await assert.rejects(()=>session.login('sales_a','p4ssword!'));
 assert.equal(session.currentPrincipal(),null);
});

test('request blocks caller auth/cookie overrides, logout clears session even on network error',async()=>{
 let calls=0;
 const {session}=setup(async(url)=>{
  calls++;
  if(url.endsWith('/login'))return reply({token:TOKEN,expiresIn:3600});
  if(url.endsWith('/me'))return reply(principal);
  throw Error('offline');
 });
 await session.login('sales_a','p4ssword!');
 for(const init of [{headers:{authorization:'Bearer x'}},{headers:{cookie:'x=y'}},
  {credentials:'include' as RequestCredentials},{redirect:'follow' as RequestRedirect},
  {method:'POST',body:'{}'}, {method:'DELETE'},{method:'PATCH'},{body:'{}'}]){
  await assert.rejects(()=>session.request('/api/v2/products',init));
 }
 assert.equal(calls,2);
 await session.logout();
 assert.equal(session.currentPrincipal(),null);
 await assert.rejects(()=>session.request('/api/v2/products'),/Unauthorized/i);
});

test('401 revokes in-memory privilege and notifies UI; failed login never retains stale token',async()=>{
 let unauthorized=0;
 const {session}=setup(async(url)=>{
  if(url.endsWith('/login'))return reply({token:TOKEN,expiresIn:3600});
  if(url.endsWith('/me'))return reply(principal);
  return reply({error:'expired'},401);
 });
 session.onUnauthenticated(()=>{unauthorized++});
 await session.login('sales_a','p4ssword!');
 const result=await session.request('/api/v2/products');
 assert.equal(result.status,401);
 assert.equal(session.currentPrincipal(),null);
 assert.equal(unauthorized,1);
 await assert.rejects(()=>session.request('/api/v2/products'),/Unauthorized/i);
});

test('concurrent login response cannot resurrect a session after explicit logout',async()=>{
 let resume:((response:Response)=>void)|undefined;
 const {session}=setup(async(url)=>url.endsWith('/login')?
  await new Promise<Response>(resolve=>{resume=resolve}):reply(principal));
 const pending=session.login('sales_a','p4ssword!');
 await session.logout();
 assert(resume);
 resume(reply({token:TOKEN,expiresIn:3600}));
 await assert.rejects(pending);
 assert.equal(session.currentPrincipal(),null);
});
