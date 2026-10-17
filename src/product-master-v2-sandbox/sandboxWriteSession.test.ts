import assert from 'node:assert/strict';
import test from 'node:test';
import {createSandboxSession} from './sandboxSession';

const origin='http://127.0.0.1:4466';
test('separate write workbench uses in-memory V2 bearer and cannot weaken existing readonly client',async()=>{
 const calls:{url:string;method:string;auth:string|null}[]=[];
 const transport=(async(input:string|URL|Request,init?:RequestInit)=>{
  const url=String(input);
  const headers=new Headers(init?.headers);
  calls.push({url,method:init?.method??'GET',auth:headers.get('Authorization')});
  if(url.endsWith('/access/login'))return Response.json({token:'e'.repeat(64),expiresIn:3600});
  if(url.endsWith('/access/me'))return Response.json({id:'2',username:'sales',displayName:'Sales',role:'sales'});
  return Response.json({ok:true});
 }) as typeof fetch;
 const session=createSandboxSession(origin,transport);
 await session.login('sales','strongpassword');
 assert.equal(session.currentPrincipal()?.role,'sales');
 await assert.rejects(session.request('/api/v2/products',{method:'POST'}));
 await assert.rejects(session.requestWrite('/api/legacy/orders',{method:'DELETE'}));
 await assert.rejects(session.requestWrite('/api/v2/access/users',{method:'POST',body:'{}'}));
 await assert.rejects(session.requestWrite('/api/v2/products',{method:'POST',headers:{Authorization:'bad'},body:'{}'}));
 await assert.rejects(session.requestWrite('/api/v2/products',{method:'POST',body:'{}'}));
 const reply=await session.requestWrite('/api/v2/products',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({test:true})});
 assert.equal(reply.status,200);
 assert.equal(calls.at(-1)?.auth,'Bearer '+'e'.repeat(64));
 assert.equal(calls.at(-1)?.url,origin+'/api/v2/products');
 await session.logout();
 await assert.rejects(session.requestWrite('/api/v2/products',{method:'PATCH',body:'{}'}));
});
test('write workbench still refuses external URLs, credential forwarding and forbidden methods',async()=>{
 const session=createSandboxSession(origin,(async()=>Response.json({})) as typeof fetch);
 for(const url of ['http://localhost:4466/api/v2/products','//evil.test/api/v2/products',
  '/api/v2/../../api/orders','/api/orders']){
  await assert.rejects(session.requestWrite(url,{method:'PATCH',body:'{}'}));
 }
});
