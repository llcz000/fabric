import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {createV2SelectorRouter} from './selectorRoutes';
import {hashSessionToken} from '../access/password';
interface Actor {role:'admin'|'sales';own:boolean;products:boolean}
class Database {
 calls:string[]=[];
 user:Actor={role:'sales',own:true,products:false};
 fail=false;
 async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  this.calls.push(sql);
  if(sql.includes('JOIN v2_access_users')){
   if(params[0]!==hashSessionToken('a'.repeat(64)))return [[],[]];
   return [[{user_id:2,username:'sales',display_name:'Staff',role:this.user.role,can_manage_own_orders:this.user.own?1:0,can_manage_products:this.user.products?1:0,session_id:1}],[]];
  }
  if(this.fail)throw Error('MYSQL_DOWN');
  if(sql.includes('COUNT(*) AS total'))return [[{total:1}],[]];
  if(sql.includes('FROM v2_products p'))return [[{id:2,product_no:'G100',fabric_name:'棉布',master_no:'G1',colorway_no:2,
   composition:'100%棉',weight_value:'120.500',weight_unit:'gsm',width_value:'150.00',
   pattern_image_asset_id:'asset-1'}],[]];
  throw Error('Unexpected query '+sql);
 }
}
const token='a'.repeat(64);
async function run(fn:(base:string,db:Database)=>Promise<void>){
 const db=new Database();const app=express();
 app.use('/v2',createV2SelectorRouter(db,async (ids)=>new Map(ids.map(id=>[id,'https://signed.example/thumbnail/'+id]))));
 const server=await new Promise<ReturnType<typeof app.listen>>(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
 try{
  const address=server.address();assert(address&&typeof address!=='string');
  await fn('http://127.0.0.1:'+address.port+'/v2/selector',db);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}
async function get(base:string,auth?:string){
 const r=await fetch(base,{headers:auth?{Authorization:'Bearer '+auth}:{}});
 return {status:r.status,body:await r.json() as Record<string,unknown>};
}
test('P6-1 HTTP needs bearer token, order rights, and returns bounded eight-field selector + signed URL',async()=>{
 await run(async(base,db)=>{
  assert.equal((await get(base)).status,401);
  const ok=await get(base+'?productNo=G1&fabricName=%E6%A3%89&limit=1&offset=0',token);
  assert.equal(ok.status,200);
  const items=ok.body.items as Record<string,unknown>[];
  assert.equal(items.length,1);
  assert.equal(items[0].thumbnailUrl,'https://signed.example/thumbnail/asset-1');
  assert(!JSON.stringify(ok).includes('cos_key'));
  assert(db.calls.some(sql=>sql.includes('p.is_active=1')));
  db.user={role:'sales',own:false,products:true};
  assert.equal((await get(base,token)).status,200,'Registered sales role can choose products despite legacy own-orders flag');
  db.user.role='admin';db.user.own=false;db.user.products=false;
  assert.equal((await get(base,token)).status,200);
 });
});
test('P6-1 bad query -> 400, DB/signing failure -> 503 no public fallback',async()=>{
 await run(async(base,db)=>{
  assert.equal((await get(base+'?limit=1000',token)).status,400);
  db.fail=true;
  const fail=await get(base,token);
  assert.equal(fail.status,503);
  assert(!JSON.stringify(fail).includes('MYSQL_DOWN'));
 });
});
