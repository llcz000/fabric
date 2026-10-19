/**
 * Fixed isolated MySQL 8 test for P6-1 picker: real 8 V2 tables, real bearer
 * login HTTP and category filtering/paging. Never touches production fabric_db.
 */
import assert from 'node:assert/strict';
import express from 'express';
import {createConnection,createPool,type Pool} from 'mysql2/promise';
import {initializeV2ProductMasterSchema,getV2ProductMasterCreateStatements} from '../server/product-master/schema';
import {initializeAccessSchema} from '../server/access/schema';
import {createV2AccessRouter} from '../server/access/routes';
import {createV2SelectorRouter} from '../server/product-master/selectorRoutes';
import {searchSelectableProducts} from '../server/product-master/selector';
import {hashPassword} from '../server/access/password';

const DB='fabric_v2_test_20261012_p6selector';
if(process.env.FABRIC_V2_ISOLATED_TEST!=='I_ACKNOWLEDGE_SANDBOX')throw Error('P6 selector sandbox acknowledgment required');
const allowed=new Set(['image_assets','v2_access_users','v2_access_sessions',...getV2ProductMasterCreateStatements().map(t=>t.name)]);
const socketPath='/var/run/mysqld/mysqld.sock';
type Row=Record<string,unknown>;
function rows(value:unknown):Row[]{if(!Array.isArray(value))throw Error('Invalid SQL rows');return value as Row[]}
async function main(){
 const root=await createConnection({user:'root',socketPath});
 let pool:Pool|undefined,seeded=false,server:ReturnType<ReturnType<typeof express>['listen']>|undefined;
 try{
  const [previous]=await root.query('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=?',[DB]);
  if(rows(previous).some(t=>!allowed.has(String(t.TABLE_NAME))))throw Error('Foreign sandbox tables detected');
  await root.query('CREATE DATABASE IF NOT EXISTS '+DB+' CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
  pool=createPool({user:'root',socketPath,database:DB,connectionLimit:6});
  await pool.query("CREATE TABLE IF NOT EXISTS image_assets(id VARCHAR(36) PRIMARY KEY,ref_count INT UNSIGNED NOT NULL DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  await initializeV2ProductMasterSchema(pool);
  await initializeAccessSchema(pool);
  for(const table of allowed){
   const [data]=await pool.query('SELECT COUNT(*) AS n FROM '+table);
   assert.equal(Number(rows(data)[0].n),0,'Non-empty sandbox: '+table);
  }
  seeded=true;
  const [master]=await pool.query("INSERT INTO pattern_masters(master_no) VALUES ('G011')");
  const m=Number((master as {insertId:number}).insertId);
  const [validC]=await pool.query('INSERT INTO pattern_colorways(master_id,colorway_no) VALUES (?,2)',[m]);
  const c=Number((validC as {insertId:number}).insertId);
  const [inactiveC]=await pool.query('INSERT INTO pattern_colorways(master_id,colorway_no,is_active) VALUES (?,3,0)',[m]);
  const badColor=Number((inactiveC as {insertId:number}).insertId);
  const [inactiveM]=await pool.query("INSERT INTO pattern_masters(master_no,is_active) VALUES ('G022',0)");
  const [colorBadMaster]=await pool.query('INSERT INTO pattern_colorways(master_id,colorway_no) VALUES (?,1)',[(inactiveM as {insertId:number}).insertId]);
  const badMasterColor=Number((colorBadMaster as {insertId:number}).insertId);
  for(let i=1;i<=44;i++){
   const no=String(i).padStart(3,'0'),name=i%2===0?'舒适棉':'柔滑丝麻';
   const [f]=await pool.query(
    'INSERT INTO v2_fabrics(fabric_no,fabric_name,composition,weight_value,weight_unit,width_value,is_active) VALUES (?,?,?,?,?,?,?)',
    ['FAB'+no,name,i===2?null:'棉麻',i===2?null:'120.500',i===2?null:'gsm',i===2?null:'150.00',i===44?0:1]
   );
   let chosen=c;
   if(i===41)chosen=badColor;
   if(i===42)chosen=badMasterColor;
   await pool.query('INSERT INTO v2_products(pattern_colorway_id,fabric_id,product_no,is_active) VALUES (?,?,?,?)',
    [chosen,(f as {insertId:number}).insertId,'G011'+no,i===43?0:1]);
  }
  const whole=await searchSelectableProducts(pool,{productNo:'',fabricName:'',limit:50,offset:0});
  assert.equal(whole.total,40,'Only 4-level-active items should remain (44 minus 4)');
  assert(whole.items.some(x=>x.fabricName==='舒适棉'));
  const names=await searchSelectableProducts(pool,{productNo:'G011',fabricName:'舒适棉',limit:10,offset:0});
  assert.equal(names.total,20,'AND filter returns only active cotton products');
  assert.equal(names.items.length,10);
  const next=await searchSelectableProducts(pool,{productNo:'G011',fabricName:'舒适棉',limit:10,offset:10});
  assert.equal(next.items.length,10);
  assert.equal(new Set([...names.items,...next.items].map(x=>x.id)).size,20,'No duplicate or missing on two pages');
  const emptySpec=whole.items.find(x=>x.productNo==='G011002');
  assert(emptySpec);assert.equal(emptySpec.weight,null);assert.equal(emptySpec.composition,null);
  assert.equal((await searchSelectableProducts(pool,{productNo:'G011%',fabricName:'',limit:10,offset:0})).total,0,'LIKE metachar must be literal');
  console.log('PASS P6 selector real MySQL AND, literal LIKE, 4-level active, two pages, nullable specs');

  const hash=await hashPassword('p6-selector-test-password');
  await pool.query("INSERT INTO v2_access_users(username,username_normalized,display_name,password_hash,role,can_manage_own_orders,can_manage_products) VALUES ('p6sales','p6sales','p6','?','sales',1,0)".replace("'?'","?"),[hash]);
  await pool.query("INSERT INTO v2_access_users(username,username_normalized,display_name,password_hash,role,can_manage_own_orders,can_manage_products) VALUES ('p6product','p6product','p6',?,'sales',0,1)",[hash]);
  const app=express();
  app.use('/auth',createV2AccessRouter(pool));
  app.use('/v2',createV2SelectorRouter(pool,async(ids)=>new Map(ids.map(id=>[id,'https://signed.example/'+id]))));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const addr=server.address();assert(addr&&typeof addr!=='string');
  const base='http://127.0.0.1:'+addr.port;
  async function request(path:string,token?:string,body?:unknown){
   const res=await fetch(base+path,{method:body?'POST':'GET',headers:{
    ...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})
   },...(body?{body:JSON.stringify(body)}:{})});
   return {code:res.status,body:await res.json() as Record<string,unknown>};
  }
  assert.equal((await request('/v2/selector')).code,401);
  const login=await request('/auth/login',undefined,{username:'p6sales',password:'p6-selector-test-password'});
  assert.equal(login.code,200);
  const result=await request('/v2/selector?productNo=G011&fabricName='+encodeURIComponent('舒适棉')+'&limit=10&offset=10',String(login.body.token));
  assert.equal(result.code,200);
  assert.equal(result.body.total,20);
  assert.equal((result.body.items as unknown[]).length,10);
  const restricted=await request('/auth/login',undefined,{username:'p6product',password:'p6-selector-test-password'});
  assert.equal(restricted.code,200);
  assert.equal((await request('/v2/selector',String(restricted.body.token))).code,403);
  assert.equal((await request('/v2/selector?limit=1000',String(login.body.token))).code,400);
  console.log('PASS P6 selector real HTTP+MySQL login, grants, AND pagination, forbidden and malformed request');
  console.log('P6_SELECTOR_REAL_MYSQL_ISOLATED_PASS database='+DB);
 }finally{
  if(server)await new Promise<void>((resolve,reject)=>server!.close(err=>err?reject(err):resolve()));
  if(pool){
   if(seeded){
    for(const table of ['v2_access_sessions','v2_access_users','v2_product_image_assets','v2_products',
      'pattern_master_tag_links','pattern_colorway_tag_links','pattern_colorways','pattern_masters',
      'v2_fabrics','shared_tags','image_assets']){
      await pool.query('DELETE FROM '+table);
    }
    for(const table of allowed){
     const [rr]=await pool.query('SELECT COUNT(*) AS n FROM '+table);
     assert.equal(Number(rows(rr)[0].n),0,'Sandbox cleanup incomplete: '+table);
    }
    console.log('PASS P6 selector separate sandbox cleaned all business rows to 0');
   }
   await pool.end();
  }
  await root.end();
 }
}
void main().catch(e=>{console.error('P6 selector isolated error',e instanceof Error?e.message:'unknown');process.exitCode=1;});
