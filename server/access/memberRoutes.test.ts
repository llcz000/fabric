import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {hashPassword,hashSessionToken,verifyPassword} from './password';
import {createV2MemberRouter} from './memberRoutes';

type Row={id:string;username:string;role:'admin'|'sales';active:boolean;own:boolean;products:boolean;password:string};
class Db {
 users=new Map<string,Row>();
 sessions=new Map<string,{userId:string;revoked:boolean}>();
 commands:string[]=[];
 constructor(private readonly initialHash:string){}
 static async make(){
  const hash=await hashPassword('member-admin-test-password');
  const db=new Db(hash);
  db.users.set('1',{id:'1',username:'admin',role:'admin',active:true,own:true,products:true,password:hash});
  db.users.set('2',{id:'2',username:'sales',role:'sales',active:true,own:true,products:true,password:hash});
  db.sessions.set(hashSessionToken('a'.repeat(64)),{userId:'1',revoked:false});
  db.sessions.set(hashSessionToken('b'.repeat(64)),{userId:'2',revoked:false});
  return db;
 }
 async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]> {
  this.commands.push(sql);
  if(sql.includes('JOIN v2_access_users')){
   const s=this.sessions.get(String(params[0])),u=this.users.get(s?.userId??'');
   if(!s||s.revoked||!u||!u.active)return [[],[]];
   return [[{user_id:u.id,username:u.username,display_name:u.username,role:u.role,
     can_manage_own_orders:u.own?1:0,can_manage_products:u.products?1:0,session_id:4}],[]];
  }
  if(sql.includes('FROM v2_access_users')&&sql.includes('ORDER BY username_normalized')){
   return [[...this.users.values()].map(u=>({id:u.id,username:u.username,display_name:u.username,role:u.role,is_active:u.active?1:0,
    can_manage_own_orders:u.own?1:0,can_manage_products:u.products?1:0})) ,[]];
  }
  throw Error('Unexpected HTTP SQL '+sql);
 }
 async getConnection(){
  const self=this;
  return {beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{},
   async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
    self.commands.push(sql);
    if(sql.includes("role='admin' AND is_active=1")&&sql.includes('FOR UPDATE')){
     return [[...self.users.values()].filter(u=>u.role==='admin'&&u.active).map(u=>({id:u.id})),[]];
    }
    if(sql.includes('FROM v2_access_users WHERE id=?')&&sql.includes('FOR UPDATE')){
     const u=self.users.get(String(params[0]));
     return [u?[{id:u.id,role:u.role,is_active:u.active?1:0}]:[],[]];
    }
    if(sql.includes('INSERT INTO v2_access_users')){
     const id=String(self.users.size+1);
     if([...self.users.values()].some(u=>u.username===params[1]))throw Object.assign(Error('dup'),{code:'ER_DUP_ENTRY'});
     self.users.set(id,{id,username:String(params[1]),role:params[4] as 'admin'|'sales',active:true,own:params[5]===1,products:params[6]===1,password:String(params[3])});
     return [{insertId:Number(id)},[]];
    }
    if(sql.includes('UPDATE v2_access_users SET')){
     const u=self.users.get(String(params.at(-1)));
     if(!u)throw Error('Missing fixture user');
     if(sql.includes('is_active=?'))u.active=params[0]===1;
     if(sql.includes('role=?'))u.role=params[0] as 'admin'|'sales';
     if(sql.includes('can_manage_own_orders=?'))u.own=params[0]===1;
     if(sql.includes('can_manage_products=?'))u.products=params[0]===1;
     if(sql.includes('password_hash=?'))u.password=String(params[0]);
     return [{affectedRows:1},[]];
    }
    if(sql.includes('UPDATE v2_access_sessions SET revoked_at=')){
     for(const session of self.sessions.values())if(session.userId===String(params[0]))session.revoked=true;
     return [{affectedRows:1},[]];
    }
    throw Error('Unexpected tx query '+sql);
   }
  };
 }
}
async function withApp(fn:(root:string,db:Db)=>Promise<void>){
 const db=await Db.make();
 const app=express();
 app.use('/member-api',createV2MemberRouter(db,db));
 const server=await new Promise<ReturnType<typeof app.listen>>(resolve=>{const srv=app.listen(0,'127.0.0.1',()=>resolve(srv));});
 try{
  const addr=server.address();assert(addr&&typeof addr!=='string');
  await fn('http://127.0.0.1:'+addr.port,db);
 }finally{await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
}
async function req(root:string,method:string,path:string,token?:string,body?:unknown){
 const r=await fetch(root+'/member-api'+path,{method,headers:{
  ...(token?{authorization:'Bearer '+token}:{}),...(body!==undefined?{'content-type':'application/json'}:{})
 },...(body!==undefined?{body:JSON.stringify(body)}:{})});
 return {status:r.status,body:await r.json() as Record<string,unknown>};
}
const admin='a'.repeat(64),sales='b'.repeat(64);
test('AUTH simplified HTTP member DTO exposes only role and status and rejects retired grants',async()=>{
 await withApp(async(root,db)=>{
  const list=await req(root,'GET','/members',admin);
  assert.equal(list.status,200);
  assert.equal(JSON.stringify(list).includes('can_manage_'),false);
  const created=await req(root,'POST','/members',admin,{username:'new_member',displayName:'New Staff',password:'secure-test-password',role:'sales'});
  assert.equal(created.status,201,JSON.stringify(created));
  assert.equal(db.users.get('3')?.own,true);
  assert.equal(db.users.get('3')?.products,true);
  assert.equal((await req(root,'POST','/members',admin,{username:'legacy_user',displayName:'Legacy',password:'secure-test-password',role:'sales',canManageProducts:false})).status,400);
  assert.equal((await req(root,'PATCH','/members/2',admin,{canManageOwnOrders:false})).status,400);
 });
});
test('P2-3 HTTP member listing, creating, changing role, reset and deactivation',async()=>{
 await withApp(async(root,db)=>{
  assert.equal((await req(root,'GET','/members')).status,401);
  assert.equal((await req(root,'GET','/members',sales)).status,403);
  assert.equal((await req(root,'POST','/members',sales,{username:'NEW',displayName:'New',password:'secure-test-password',role:'admin'})).status,403);
  const listed=await req(root,'GET','/members',admin);
  assert.equal(listed.status,200);
  assert(!JSON.stringify(listed).includes(db.users.get('1')!.password));
  const created=await req(root,'POST','/members',admin,{username:'New_Staff',displayName:'New Staff',password:'secure-test-password',role:'sales'});
  assert.equal(created.status,201,JSON.stringify(created));
  assert.equal(created.body.username,'new_staff');
  assert.equal(await verifyPassword('secure-test-password',db.users.get('3')!.password),true);
  const roleChange=await req(root,'PATCH','/members/3',admin,{role:'admin'});
  assert.equal(roleChange.status,200);
  assert.equal(db.users.get('3')!.role,'admin');
  const reset=await req(root,'POST','/members/3/reset-password',admin,{password:'new-secure-password'});
  assert.equal(reset.status,200);
  assert.equal(await verifyPassword('new-secure-password',db.users.get('3')!.password),true);
  const disable=await req(root,'PATCH','/members/3',admin,{isActive:false});
  assert.equal(disable.status,200);
  assert.equal(db.users.get('3')!.active,false);
 });
});
test('P2-3 HTTP last active admin guard and invalid updates',async()=>{
 await withApp(async(root,db)=>{
  assert.equal((await req(root,'PATCH','/members/1',admin,{isActive:false})).status,409);
  assert.equal((await req(root,'PATCH','/members/1',admin,{role:'sales'})).status,409);
  assert.equal((await req(root,'PATCH','/members/2',admin,{canManageProducts:'true'})).status,400);
  assert.equal((await req(root,'PATCH','/members/2',admin,{role:'superadmin'})).status,400);
  assert.equal((await req(root,'POST','/members/2/reset-password',sales,{password:'secure12345'})).status,403);
  assert.equal(db.users.get('1')?.role,'admin');
 });
});
