/**
 * P2-3 isolated real MySQL 8.0 + Express HTTP/transaction/concurrency test.
 * This script MUST ONLY run on the authorized SSH host with an explicit
 * fixed, separate database name and acknowledgement.
 * Absolutely no production tables/accounts are referenced or modified.
 */
import assert from 'node:assert/strict';
import {createPool,createConnection,type Pool} from 'mysql2/promise';
import express from 'express';
import {hashPassword} from '../server/access/password';
import {initializeAccessSchema} from '../server/access/schema';
import {createV2AccessRouter} from '../server/access/routes';
import {createV2MemberRouter} from '../server/access/memberRoutes';
import {changeMember,createMember} from '../server/access/members';
import type {AppPrincipal} from '../server/access/types';

const DB='fabric_v2_test_20261012_p2members';
if(process.env.FABRIC_V2_ISOLATED_TEST!=='I_ACKNOWLEDGE_SANDBOX'){
 throw Error('Explicit P2 members sandbox confirmation required');
}
const socketPath='/var/run/mysqld/mysqld.sock';
const principal=(id:string):AppPrincipal=>({
 userId:id,role:'admin',username:'isolated_admin',displayName:'Isolated Admin',
 canManageOwnOrders:true,canManageProducts:true,sessionId:'sandbox'
});
const nonce='p2fixture';
function value(rows:unknown):Record<string,unknown>[] {
 if(!Array.isArray(rows))throw Error('Expected rows');
 return rows as Record<string,unknown>[];
}
async function main(){
 const bootstrap=await createConnection({user:'root',socketPath});
 let pool:Pool|undefined;
 let server:ReturnType<ReturnType<typeof express>['listen']>|undefined;
 let seeded=false;
 try{
  const [preRaw]=await bootstrap.query(
   'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?',[DB]);
  const pre=value(preRaw).map(x=>String(x.TABLE_NAME));
  if(pre.some(x=>!['v2_access_users','v2_access_sessions'].includes(x)))
   throw Error('P2 sandbox has unexpected tables; refuse any writes');
  if(pre.length!==0 && pre.length!==2)throw Error('Incomplete unknown P2 sandbox; refuse');
  await bootstrap.query('CREATE DATABASE IF NOT EXISTS '+DB+' CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
  pool=createPool({user:'root',socketPath,database:DB,connectionLimit:5,waitForConnections:true});
  await initializeAccessSchema(pool);
  await initializeAccessSchema(pool);
  const [existingUsers]=await pool.query('SELECT COUNT(*) AS n FROM v2_access_users');
  const [existingSessions]=await pool.query('SELECT COUNT(*) AS n FROM v2_access_sessions');
  if(Number(value(existingUsers)[0]?.n)!==0||Number(value(existingSessions)[0]?.n)!==0)
   throw Error('P2 sandbox not empty; refuse to mutate existing rows');
  seeded=true;
  const hash=await hashPassword('test-fixture-admin-password');
  const [result]=await pool.query(
    'INSERT INTO v2_access_users (username,username_normalized,display_name,password_hash,role) VALUES (?,?,?,?,?)',
    [nonce+'admin',nonce+'admin','P2 fixture admin',hash,'admin']
  );
  const adminId=String((result as {insertId:number}).insertId);
  const app=express();
  app.use('/access',createV2AccessRouter(pool));
  app.use('/members',createV2MemberRouter(pool,pool));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const addr=server.address();
  assert(addr&&typeof addr!=='string');
  const base='http://127.0.0.1:'+addr.port;
  async function request(route:string,method:string,token?:string,body?:unknown){
   const response=await fetch(base+route,{method,headers:{
    ...(token?{authorization:'Bearer '+token}:{}),
    ...(body!==undefined?{'content-type':'application/json'}:{})
   },...(body!==undefined?{body:JSON.stringify(body)}:{})});
   return {status:response.status,body:await response.json() as Record<string,unknown>};
  }
  const login=await request('/access/login','POST',undefined,{username:nonce+'admin',password:'test-fixture-admin-password'});
  assert.equal(login.status,200,'Actual database login failed');
  const token=String(login.body.token??'');
  assert.match(token,/^[a-f0-9]{64}$/);
  assert.equal((await request('/members/members','GET',token)).status,200);
  const add=await request('/members/members','POST',token,{
   username:nonce+'sales',displayName:'P2 test salesperson',password:'test-fixture-sales-password',
   role:'sales'
  });
  assert.equal(add.status,201,'Actual MySQL insert via HTTP failed');
  const salesId=String(add.body.id);
  const salesLogin=await request('/access/login','POST',undefined,{username:nonce+'sales',password:'test-fixture-sales-password'});
  assert.equal(salesLogin.status,200);
  const salesToken=String(salesLogin.body.token);
  assert.equal((await request('/members/members','GET',salesToken)).status,403);
  const flag=await request('/members/members/'+salesId,'PATCH',token,{canManageOwnOrders:false,canManageProducts:true});
  assert.equal(flag.status,400,'Retired grant switches must be rejected');
  const salesMe=await request('/access/me','GET',salesToken);
  assert.equal(salesMe.body.role,'sales');
  assert.equal('canManageOwnOrders' in salesMe.body,false);
  assert.equal('canManageProducts' in salesMe.body,false);
  const reset=await request('/members/members/'+salesId+'/reset-password','POST',token,{password:'replacement-test-password'});
  assert.equal(reset.status,200);
  assert.equal((await request('/access/me','GET',salesToken)).status,401,'Old session must be revoked');
  const salesNew=await request('/access/login','POST',undefined,{username:nonce+'sales',password:'replacement-test-password'});
  assert.equal(salesNew.status,200);
  const deactivate=await request('/members/members/'+salesId,'PATCH',token,{isActive:false});
  assert.equal(deactivate.status,200);
  assert.equal((await request('/access/me','GET',String(salesNew.body.token))).status,401);
  assert.equal((await request('/members/members/'+adminId,'PATCH',token,{isActive:false})).status,409);
  assert.equal((await request('/members/members/'+adminId,'PATCH',token,{role:'sales'})).status,409);
  console.log('PASS P2 real MySQL Express HTTP login/retired-grant rejection/reset/revoke/disable/last-admin guard');
  const admin2=await createMember(pool,principal(adminId),{
   username:nonce+'admin2',displayName:'Second fixture admin',password:'admin2-test-password',
   role:'admin'
  });
  const outcomes=await Promise.allSettled([
   changeMember(pool,principal(adminId),admin2.id,{isActive:false}),
   changeMember(pool,principal(admin2.id),adminId,{isActive:false})
  ]);
  const [admins]=await pool.query("SELECT id,is_active FROM v2_access_users WHERE role='admin' AND is_active=1");
  assert(value(admins).length>=1,'Concurrent changes left zero active admins');
  assert(outcomes.some(x=>x.status==='rejected'),'One concurrent admin deactivation must be denied');
  console.log('PASS P2 concurrent last-admin safety activeAdmins='+value(admins).length+
   ' results='+outcomes.map(x=>x.status).join(','));
  const [rows]=await pool.query('SELECT COUNT(*) AS n FROM v2_access_users');
  assert(Number(value(rows)[0].n)>=3);
 } finally {
  if(server)await new Promise<void>((resolve,reject)=>server!.close(e=>e?reject(e):resolve()));
  if(pool){
   // Cleanup is strictly scoped to our separate, initially empty test database.
   // On any test assertion failure still leave zero fixture business rows.
   if(seeded){
    await pool.query('DELETE FROM v2_access_sessions');
    await pool.query('DELETE FROM v2_access_users');
    const [u]=await pool.query('SELECT COUNT(*) AS n FROM v2_access_users');
    const [s]=await pool.query('SELECT COUNT(*) AS n FROM v2_access_sessions');
    assert.equal(Number(value(u)[0].n),0);
    assert.equal(Number(value(s)[0].n),0);
    console.log('PASS P2 isolated database cleaned: 0 user rows / 0 session rows');
   }
   await pool.end();
  }
  await bootstrap.end();
 }
 console.log('P2_MEMBERS_REAL_MYSQL_ISOLATED_PASS database='+DB);
}
void main().catch(error=>{console.error('P2 sandbox test error:',error instanceof Error?error.message:'unknown');process.exitCode=1;});
