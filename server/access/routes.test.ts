import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type {Server} from 'node:http';
import {hashPassword,hashSessionToken} from './password';
import {createV2AccessRouter} from './routes';
import {requireV2Principal,requireV2Action,requireV2OrderAccess} from './middleware';

interface UserFixture {
 id:string; username:string; hash:string; active:boolean; role:'admin'|'sales';
 canManageOwnOrders:boolean; canManageProducts:boolean;
}
class FakeDb {
 queries:{sql:string;params:unknown[]}[]=[];
 accounts:UserFixture[]=[];
 sessions=new Map<string,{userId:string;revoked:boolean;expires:boolean}>();
 orderOwners=new Map<string,string|null>([['1','2'],['2','3'],['3',null]]);
 async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]> {
  this.queries.push({sql,params});
  if(sql.includes('FROM v2_access_users WHERE username_normalized')) {
    const record=this.accounts.find(a=>a.username===params[0]);
    return [record?[{id:record.id,password_hash:record.hash,is_active:record.active?1:0}]:[],[]];
  }
  if(sql.includes('INSERT INTO v2_access_sessions')) {
    this.sessions.set(String(params[1]),{userId:String(params[0]),revoked:false,expires:false});
    return [{insertId:12},[]];
  }
  if(sql.includes('JOIN v2_access_users') && sql.includes('s.token_hash')) {
    const session=this.sessions.get(String(params[0]));
    const user=this.accounts.find(a=>a.id===session?.userId);
    if(!session || session.revoked || session.expires || !user?.active)return [[],[]];
    return [[{user_id:user.id, username:user.username,display_name:user.username,role:user.role,
      can_manage_own_orders:user.canManageOwnOrders?1:0,can_manage_products:user.canManageProducts?1:0,session_id:77}],[]];
  }
  if(sql.includes('UPDATE v2_access_sessions SET revoked_at')) {
    const session=this.sessions.get(String(params[0]));
    if(session)session.revoked=true;
    return [{affectedRows:session?1:0},[]];
  }
  if(sql.includes('FROM orders') && sql.includes('created_by_user_id')) {
    const id=String(params[0]);
    return [this.orderOwners.has(id)?[{id,created_by_user_id:this.orderOwners.get(id)}]:[],[]];
  }
  throw Error('Unexpected SQL '+sql.slice(0,150));
 }
}
async function withServer<T>(db:FakeDb,cb:(origin:string)=>Promise<T>):Promise<T>{
 const app=express();
 app.use('/access',createV2AccessRouter(db));
 app.get('/private',requireV2Principal(db),(req,res)=>res.json({userId:res.locals.principal?.userId}));
 app.post('/products/write',requireV2Principal(db),requireV2Action('products.manage'),(req,res)=>res.json({ok:true}));
 app.get('/orders/:id',requireV2Principal(db),requireV2OrderAccess(db,'read'),(req,res)=>res.json({owner:res.locals.orderOwner}));
 app.patch('/orders/:id',requireV2Principal(db),requireV2OrderAccess(db,'manage'),(req,res)=>res.json({ok:true}));
 const server:Server=await new Promise(resolve=>{const srv=app.listen(0,'127.0.0.1',()=>resolve(srv));});
 try{
  const address=server.address();
  assert(address && typeof address!=='string');
  return await cb('http://127.0.0.1:'+address.port);
 }finally {await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}
async function send(origin:string,route:string,body?:unknown,token?:string,method='GET'){
 return await fetch(origin+route,{method,headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
}
async function setup(){
 const db=new FakeDb();
 db.accounts.push({id:'1',username:'admin',hash:await hashPassword('test-only-admin-pass'),active:true,role:'admin',canManageOwnOrders:false,canManageProducts:false});
 db.accounts.push({id:'2',username:'sales',hash:await hashPassword('test-only-sales-pass'),active:true,role:'sales',canManageOwnOrders:false,canManageProducts:false});
 db.accounts.push({id:'3',username:'other',hash:await hashPassword('test-only-other-pass'),active:true,role:'sales',canManageOwnOrders:true,canManageProducts:true});
 return db;
}
async function login(origin:string,username:string,password:string):Promise<{token:string;expiresIn:number}>{
 const result=await send(origin,'/access/login',{username,password},undefined,'POST');
 assert.equal(result.status,200);
 const data=await result.json() as {token:string;expiresIn:number};
 assert.match(data.token,/^[0-9a-f]{64}$/);
 return data;
}

test('P2 standalone auth rejects malformed JSON with safe JSON body (never HTML stack)',async()=>{
 const db=await setup();
 await withServer(db,async base=>{
  const r=await fetch(base+'/access/login',{method:'POST',headers:{'content-type':'application/json'},body:'{"username":'});
  assert.equal(r.status,400);
  assert((r.headers.get('content-type')??'').startsWith('application/json'));
  const data=await r.json() as {error?:unknown};
  assert.equal(typeof data.error,'string');
  assert(!JSON.stringify(data).includes('SyntaxError'));
 });
});
test('P2-2 HTTP login/me/logout use hashed persisted session, revoked token 401 and never echo secrets',async()=>{
 const db=await setup();
 await withServer(db,async origin=>{
  const none=await send(origin,'/access/me');
  assert.equal(none.status,401);
  const issued=await login(origin,'admin','test-only-admin-pass');
  assert.equal(issued.expiresIn,43200);
  assert(!JSON.stringify(db.queries).includes(issued.token),'SQL params must never contain raw bearer');
  const me=await send(origin,'/access/me',undefined,issued.token);
  assert.equal(me.status,200);
  const principal=await me.json() as Record<string,unknown>;
  assert.equal(principal.role,'admin');
  assert.equal('canManageOwnOrders' in principal,false);
  assert.equal('canManageProducts' in principal,false);
  assert(!('passwordHash' in principal));
  assert(!('sessionId' in principal));
  const logout=await send(origin,'/access/logout',undefined,issued.token,'POST');
  assert.equal(logout.status,200);
  assert.equal((await send(origin,'/access/me',undefined,issued.token)).status,401);
 });
});
test('P2-2 bad credentials, inactive user, request role spoofing and malformed bearer rejected',async()=>{
 const db=await setup();
 await withServer(db,async origin=>{
  for(const body of [{username:'unknown',password:'test-only-bad-pass'},
    {username:'sales',password:'wrong-password'},
    {username:'',password:'test-only-sales-pass'},
    {username:'sales',password:123}]) {
    const response=await send(origin,'/access/login',body,undefined,'POST');
    assert([400,401].includes(response.status));
    const data=await response.json() as {error:string};
    assert(!/user exists|no user|disabled/i.test(data.error));
  }
  db.accounts[1].active=false;
  const blocked=await send(origin,'/access/login',{username:'sales',password:'test-only-sales-pass',role:'admin'},undefined,'POST');
  assert.equal(blocked.status,401);
  assert.equal((await send(origin,'/private',undefined,'bad')).status,401);
 });
});
test('P2-2 live role confers shared product and own-order rights; account revocation takes immediate effect',async()=>{
 const db=await setup();
 await withServer(db,async origin=>{
  const {token}=await login(origin,'sales','test-only-sales-pass');
  assert.equal((await send(origin,'/products/write',{},token,'POST')).status,200);
  assert.equal((await send(origin,'/orders/1',undefined,token)).status,200);
  assert.equal((await send(origin,'/orders/1',{},token,'PATCH')).status,200);
  db.accounts[1].canManageProducts=true;
  db.accounts[1].canManageOwnOrders=true;
  assert.equal((await send(origin,'/products/write',{},token,'POST')).status,200);
  assert.equal((await send(origin,'/orders/1',{},token,'PATCH')).status,200);
  db.accounts[1].active=false;
  assert.equal((await send(origin,'/orders/1',undefined,token)).status,401);
  assert.equal((await send(origin,'/products/write',{},token,'POST')).status,401);
 });
});
test('P2-2 identity database failure and missing legacy owner column fail closed; never fallback to all orders',async()=>{
 const db=await setup();
 await withServer(db,async origin=>{
  const {token}=await login(origin,'sales','test-only-sales-pass');
  const original=db.query.bind(db);
  db.query=async(sql:string,params:unknown[]=[])=>{
   if(sql.includes('JOIN v2_access_users')||sql.includes('FROM orders'))throw Error('schema unavailable');
   return await original(sql,params);
  };
  const me=await send(origin,'/access/me',undefined,token);
  assert.equal(me.status,503);
  // Isolate second behavior with real principal query restored but missing owner column.
  db.query=async(sql:string,params:unknown[]=[])=>{
   if(sql.includes('FROM orders'))throw Error('Unknown column created_by_user_id');
   return await original(sql,params);
  };
  const order=await send(origin,'/orders/1',undefined,token);
  assert.equal(order.status,503);
 });
});
test('P2-2 cannot elevate by setting role/owner/permissions in JSON or headers',async()=>{
 const db=await setup();
 await withServer(db,async origin=>{
  const issued=await login(origin,'sales','test-only-sales-pass');
  const malicious=await fetch(origin+'/products/write',{method:'POST',headers:{
    'authorization':'Bearer '+issued.token,'content-type':'application/json','x-role':'admin',
    'x-user-id':'1'
  },body:JSON.stringify({role:'admin',canManageProducts:true,createdByUserId:'2'})});
  assert.equal(malicious.status,200,'allowed sales product action never implies promoted admin role');
  assert.equal((await send(origin,'/orders/2',undefined,issued.token)).status,404);
  assert.equal((await send(origin,'/orders/2',undefined,issued.token)).status,404);
  assert.equal((await send(origin,'/orders/2',{createdByUserId:'2'},issued.token,'PATCH')).status,404);
 });
});
test('P2-2 guessed other order ids and ownerless old orders are 404 even if salesperson has both grants',async()=>{
 const db=await setup();
 db.accounts[1].canManageOwnOrders=true;
 db.accounts[1].canManageProducts=true;
 await withServer(db,async origin=>{
  const salesToken=(await login(origin,'sales','test-only-sales-pass')).token;
  for(const path of ['/orders/2','/orders/3','/orders/999']){
    assert.equal((await send(origin,path,undefined,salesToken)).status,404);
    assert.equal((await send(origin,path,{},salesToken,'PATCH')).status,404);
  }
  assert.equal((await send(origin,'/orders/1',undefined,salesToken)).status,200);
  const adminToken=(await login(origin,'admin','test-only-admin-pass')).token;
  assert.equal((await send(origin,'/orders/2',undefined,adminToken)).status,200);
  assert.equal((await send(origin,'/orders/3',undefined,adminToken)).status,200);
  assert.equal((await send(origin,'/orders/-1',undefined,salesToken)).status,404);
 });
});

test('login remains available after more than ten consecutive failed attempts without a cooldown',async()=>{
 const db=await setup();
 await withServer(db,async origin=>{
  for(let i=0;i<12;i++){
   const response=await send(origin,'/access/login',{username:'sales',password:'incorrect-password'},undefined,'POST');
   assert.equal(response.status,401,'attempt '+(i+1)+' must validate credentials without throttling');
   assert.equal(response.headers.get('retry-after'),null);
  }
  const issued=await login(origin,'sales','test-only-sales-pass');
  assert.equal(issued.expiresIn,12*3600);
 });
});
