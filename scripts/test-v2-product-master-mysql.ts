/**
 * P3-6 real MySQL8 / real Express HTTP isolated acceptance runner.
 * Intended ONLY on the already-authorized remote Ubuntu test host via SSH.
 * No production schema/data, no application restart or deployment.
 * Safe rerun requires every allowlisted table to be empty before ANY DDL/DML.
 */
import assert from 'node:assert/strict';
import express from 'express';
import {createConnection,createPool,type Pool} from 'mysql2/promise';
import {getV2ProductMasterCreateStatements,initializeV2ProductMasterSchema} from '../server/product-master/schema';
import {getAccessSchemaCreateStatements,initializeAccessSchema} from '../server/access/schema';
import {hashPassword} from '../server/access/password';
import {createAuthenticatedSession,resolvePrincipalFromToken} from '../server/access/sessions';
import {createV2AccessRouter} from '../server/access/routes';
import {createPatternMaster,updatePatternMaster,PatternMasterError} from '../server/product-master/patternMasters';
import {createColorway,listColorways,ColorwayIdentityError} from '../server/product-master/colorwayIdentity';
import {createFabric,updateFabric,FabricError} from '../server/product-master/fabrics';
import {createSharedTag,replaceEntityTags,readEntityTags,archiveSharedTag,previewTagImpact,mergeSharedTags,TagError} from '../server/product-master/sharedTags';
import {createV2Product,updateV2Product,deleteV2Product,V2ProductError} from '../server/product-master/productsV2';
import {createV2ProductsRouter} from '../server/product-master/productsV2Routes';
import {parseProductSearchQuery,searchProductCatalog} from '../server/product-master/productSearch';

const DB='fabric_v2_test_20261013_p3integration';
const ACK='I_ACKNOWLEDGE_SANDBOX';
const socketPath='/var/run/mysqld/mysqld.sock';
if(process.env.FABRIC_V2_ISOLATED_TEST!==ACK)
 throw Error('Explicit P3-6 sandbox acknowledgment required');
if(!/^fabric_v2_test_[a-z0-9_]+$/.test(DB)||String(DB)==='fabric_db')
 throw Error('Unsafe isolated database name');
const allowed=new Set([
 'image_assets','order_items','v2_access_users','v2_access_sessions',
 ...getV2ProductMasterCreateStatements().map(x=>x.name)
]);
type Row=Record<string,unknown>;
const rows=(data:unknown):Row[]=>{if(!Array.isArray(data))throw Error('Invalid MySQL rowset');return data as Row[]};
const no=(insert:unknown):string=>{
 const id=(insert as {insertId?:number|string|bigint}).insertId;
 if(id===undefined)throw Error('Missing MySQL insert identity');
 const s=String(id);if(!/^[1-9]\d*$/.test(s))throw Error('Invalid insert identity');return s;
};
const count=async(db:{query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>},table:string):Promise<number>=>{
 if(!allowed.has(table))throw Error('Disallowed sandbox table count');
 const [raw]=await db.query('SELECT COUNT(*) AS n FROM '+table);
 return Number(rows(raw)[0]?.n);
};
const checkTarget=async(db:{query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>}):Promise<void>=>{
 const [raw]=await db.query('SELECT DATABASE() AS db');
 assert.equal(String(rows(raw)[0]?.db),DB,'Refused wrong active database');
};
function expectStatus(status:number){
 return (e:unknown):boolean=>
  (e instanceof V2ProductError||e instanceof PatternMasterError||
   e instanceof FabricError||e instanceof ColorwayIdentityError||e instanceof TagError)&&
   e.status===status;
}
const ASSET='a1111111-1111-4111-8111-111111111111';
async function main():Promise<void>{
 // Root is used ONLY to inspect/create this fixed schema, never for cross-schema DML.
 const root=await createConnection({user:'root',socketPath});
 let pool:Pool|undefined;
 let server:ReturnType<ReturnType<typeof express>['listen']>|undefined;
 let seeded=false;
 try{
  const [known]=await root.query('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=?',[DB]);
  for(const x of rows(known)){
   const table=String(x.TABLE_NAME);
   if(!allowed.has(table))throw Error('Foreign table found in isolated schema');
   const [raw]=await root.query('SELECT COUNT(*) AS n FROM '+DB+'.'+table);
   assert.equal(Number(rows(raw)[0]?.n),0,'Occupied isolated schema: '+table);
  }
  await root.query('CREATE DATABASE IF NOT EXISTS '+DB+' CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
  pool=createPool({user:'root',socketPath,database:DB,connectionLimit:16,
   supportBigNumbers:true,bigNumberStrings:true,waitForConnections:true});
  await checkTarget(pool);
  await pool.query("CREATE TABLE IF NOT EXISTS image_assets("+
   "id VARCHAR(36) PRIMARY KEY,ref_count INT UNSIGNED NOT NULL DEFAULT 0,"+
   "status VARCHAR(16) NOT NULL DEFAULT 'ready',recycled_at DATETIME NULL,"+
   "purge_after DATETIME NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  await initializeV2ProductMasterSchema(pool);
  await initializeAccessSchema(pool);
  await pool.query('CREATE TABLE IF NOT EXISTS order_items ('+
   'id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,'+
   'v2_product_id BIGINT UNSIGNED NOT NULL,'+
   'CONSTRAINT fk_test_order_product FOREIGN KEY (v2_product_id) '+
   'REFERENCES v2_products(id) ON DELETE RESTRICT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
  for(const t of allowed)assert.equal(await count(pool,t),0,'Nonempty isolated table: '+t);
  // Checked connection wrapper: mutations must prove their *actual* transaction connection.
  const checked={
   async getConnection(){
    const conn=await pool!.getConnection();
    try{await checkTarget(conn);return conn;}
    catch(e){conn.release();throw e;}
   }
  };
  seeded=true;
  const hash=await hashPassword('P3-6-test-only-not-a-production-password');
  const [inserted]=await pool.query(
   "INSERT INTO v2_access_users(username,username_normalized,display_name,password_hash,role,can_manage_products)"+
   " VALUES ('p3audit','p3audit','P3-only',?,'admin',1)",[hash]);
  const actorId=no(inserted);
  const session=await createAuthenticatedSession(pool,actorId,3600);
  const actor=await resolvePrincipalFromToken(pool,session.token);
  assert(actor&&actor.role==='admin');
  const master=await createPatternMaster(checked,actor,{masterNo:' g017 '});
  assert.equal(master.masterNo,'G017');
  await assert.rejects(createPatternMaster(checked,actor,{masterNo:'G017'}),expectStatus(409));
  const c1=await createColorway(checked,actor,master.id,{});
  const c2=await createColorway(checked,actor,master.id,{});
  assert.equal(c1.colorwayNo,1);assert.equal(c2.colorwayNo,2);
  const many=await Promise.all(Array.from({length:9},()=>createColorway(checked,actor,master.id,{})));
  assert.deepEqual(many.map(x=>x.colorwayNo).sort((a,b)=>a-b),[3,4,5,6,7,8,9,10,11]);
  assert.equal((await listColorways(pool,master.id)).nextColorwayNo,12);
  const fabric=await createFabric(checked,actor,{fabricNo:' f018 ',fabricName:'轻柔雪纺',
   composition:'100%真丝',weightValue:16.5,weightUnit:'mm',widthValue:145.5});
  const backup=await createFabric(checked,actor,{fabricNo:' f019 ',fabricName:'轻柔雪纺'});
  assert.equal(fabric.fabricNo,'F018');
  await assert.rejects(createFabric(checked,actor,{fabricNo:'F018',fabricName:'重复'}),expectStatus(409));
  const topic=await createSharedTag(checked,actor,'topic','花卉');
  const color=await createSharedTag(checked,actor,'color','蓝色');
  const sibling=await createSharedTag(checked,actor,'color','绿色');
  await replaceEntityTags(checked,actor,'master',master.id,[topic.id]);
  await replaceEntityTags(checked,actor,'colorway',c1.id,[color.id]);
  await replaceEntityTags(checked,actor,'colorway',c2.id,[sibling.id]);
  assert.equal((await readEntityTags(pool,'colorway',c1.id))[0]?.id,color.id);
  await pool.query('INSERT INTO image_assets(id,ref_count,status) VALUES (?,0,\'ready\')',[ASSET]);
  const first=await createV2Product(checked,actor,{patternColorwayId:c1.id,fabricId:fabric.id,
   images:{fabricDisplay:[ASSET],detail:[],aiEffect:[]},remark:'原版'});
  assert.equal(first.productNo,'G017-1-F018');assert.equal(first.images.fabricDisplay.length,1);
  const second=await createV2Product(checked,actor,{patternColorwayId:c2.id,fabricId:fabric.id,
   images:{fabricDisplay:[],detail:[ASSET],aiEffect:[]}});
  assert.equal(await count(pool,'v2_products'),2);
  const [assetState]=await pool.query('SELECT ref_count FROM image_assets WHERE id=?',[ASSET]);
  assert.equal(Number(rows(assetState)[0]?.ref_count),2);
  await assert.rejects(updatePatternMaster(checked,actor,master.id,{masterNo:'OTHER'}),expectStatus(409));
  await assert.rejects(updateFabric(checked,actor,fabric.id,{fabricNo:'OTHER'}),expectStatus(409));
  const best=await searchProductCatalog(pool,parseProductSearchQuery({
   productNo:'g017',fabricName:'雪纺',topicTagIds:topic.id,colorTagIds:color.id,
   status:'all',limit:'10',offset:'0'}));
  assert.equal(best.total,1,'Topic AND color matched only first colorway');
  assert.equal(best.items[0]?.productNo,first.productNo);
  assert.equal(best.items[0]?.totalImages,1);
  const green=await searchProductCatalog(pool,parseProductSearchQuery({colorTagIds:sibling.id,status:'all'}));
  assert.equal(green.total,1,'Other colorway tag must not leak to first');
  await archiveSharedTag(checked,actor,color.id);
  const archived=await searchProductCatalog(pool,parseProductSearchQuery({colorTagIds:color.id,status:'all'}));
  assert.equal(archived.total,1);assert.equal(archived.items[0]?.colorTags[0]?.isArchived,true);
  const mergedTag=await createSharedTag(checked,actor,'topic','几何');
  assert.equal((await previewTagImpact(pool,topic.id)).affectedCount,1);
  const merged=await mergeSharedTags(checked,actor,topic.id,mergedTag.id,1);
  assert.equal(merged.affectedCount,1);
  assert.deepEqual((await readEntityTags(pool,'master',master.id)).map(x=>x.id),[mergedTag.id]);
  assert.equal((await previewTagImpact(pool,topic.id)).affectedCount,0);
  await assert.rejects(replaceEntityTags(checked,actor,'master',master.id,[topic.id]),expectStatus(409));
  const beforeFail=await count(pool,'v2_products');
  await assert.rejects(createV2Product(checked,actor,{
   patternColorwayId:c1.id,fabricId:backup.id,
   images:{fabricDisplay:['a9999999-9999-4999-8999-999999999999'],detail:[],aiEffect:[]}
  }),expectStatus(409));
  assert.equal(await count(pool,'v2_products'),beforeFail,'Failed asset attachment must rollback newly inserted product');
  const duplicate=await Promise.allSettled(Array.from({length:8},()=>createV2Product(checked,actor,
   {patternColorwayId:c1.id,fabricId:backup.id})));
  assert.equal(duplicate.filter(x=>x.status==='fulfilled').length,1,'Concurrent duplicate product protection');
  for(const d of duplicate)if(d.status==='rejected')assert(expectStatus(409)(d.reason));
  const changed=await updateV2Product(checked,actor,first.id,{expectedRowVersion:'1',remark:'最新'});
  assert.equal(changed.rowVersion,'2');
  await assert.rejects(updateV2Product(checked,actor,first.id,{expectedRowVersion:'1',remark:'旧编辑'}),expectStatus(409));
  await pool.query('INSERT INTO order_items(v2_product_id) VALUES (?)',[first.id]);
  await assert.rejects(updateV2Product(checked,actor,first.id,{expectedRowVersion:'2',fabricId:backup.id}),expectStatus(409));
  await assert.rejects(deleteV2Product(checked,actor,first.id),expectStatus(409));
  await pool.query('DELETE FROM order_items WHERE v2_product_id=?',[first.id]);
  const oldImage=await updateV2Product(checked,actor,first.id,{
   expectedRowVersion:'2',images:{fabricDisplay:[],detail:[],aiEffect:[]}});
  assert.equal(oldImage.images.fabricDisplay.length,0);
  assert.equal(Number(rows((await pool.query('SELECT ref_count FROM image_assets WHERE id=?',[ASSET]))[0])[0]?.ref_count),1);
  await deleteV2Product(checked,actor,second.id);
  const [lastAsset]=await pool.query('SELECT ref_count,status FROM image_assets WHERE id=?',[ASSET]);
  assert.equal(Number(rows(lastAsset)[0]?.ref_count),0);
  assert.equal(String(rows(lastAsset)[0]?.status),'recycled');
  console.log('P3_REAL_IDENTITY_TAG_FABRIC_PRODUCT_MEDIA_FK_PASS concurrency=9+8');

  // Database-side 2,100-record fixture: 100 masters × 3 colorways × 7 fabrics.
  // Raw inserts are only into verified empty fixed sandbox; product numbers are unique.
  const masterValues=Array.from({length:100},(_,i)=>['B'+String(i+1).padStart(3,'0')]);
  await pool.query('INSERT INTO pattern_masters(master_no) VALUES '+masterValues.map(()=>'(?)').join(','),
   masterValues.flat());
  const [mr]=await pool.query("SELECT id,master_no FROM pattern_masters WHERE master_no LIKE 'B%'");
  const bulkMasters=rows(mr);assert.equal(bulkMasters.length,100);
  const colors=bulkMasters.flatMap(m=>[1,2,3].map(n=>[String(m.id),n]));
  await pool.query('INSERT INTO pattern_colorways(master_id,colorway_no) VALUES '+
   colors.map(()=>'(?,?)').join(','),colors.flat());
  const [cs]=await pool.query("SELECT c.id,c.master_id,c.colorway_no,m.master_no FROM pattern_colorways c "+
   "JOIN pattern_masters m ON m.id=c.master_id WHERE m.master_no LIKE 'B%'");
  const bulkColors=rows(cs);assert.equal(bulkColors.length,300);
  const fabrics=Array.from({length:7},(_,i)=>['V'+String(i+1).padStart(3,'0'),i%2?'纯棉样布':'真丝样布']);
  await pool.query('INSERT INTO v2_fabrics(fabric_no,fabric_name) VALUES '+
   fabrics.map(()=>'(?,?)').join(','),fabrics.flat());
  const [fs]=await pool.query("SELECT id,fabric_no FROM v2_fabrics WHERE fabric_no LIKE 'V%'");
  assert.equal(rows(fs).length,7);
  const allProducts=bulkColors.flatMap(c=>rows(fs).map(f=>[
   String(c.id),String(f.id),String(c.master_no)+'-'+String(c.colorway_no)+'-'+String(f.fabric_no)
  ]));
  assert.equal(allProducts.length,2100);
  for(let i=0;i<allProducts.length;i+=175){
   const batch=allProducts.slice(i,i+175);
   await pool.query('INSERT INTO v2_products(pattern_colorway_id,fabric_id,product_no) VALUES '+
    batch.map(()=>'(?,?,?)').join(','),batch.flat());
  }
  const page=await searchProductCatalog(pool,parseProductSearchQuery({
   productNo:'b',fabricName:'样布',status:'all',limit:'50',offset:'200'}));
  assert.equal(page.total,2100,'Real database all-record filtering before pagination');
  assert.equal(page.items.length,50);
  assert.equal(new Set(page.items.map(item=>item.id)).size,50);
  const complex=await searchProductCatalog(pool,parseProductSearchQuery({
   productNo:'b',fabricName:'纯棉',topicTagIds:topic.id,status:'all'}));
  assert.equal(complex.total,0,'Do not leak another master topic tag');
  const elapsed:number[]=[];
  for(let i=0;i<30;i++){
   const start=performance.now();
   const testPage=await searchProductCatalog(pool,parseProductSearchQuery({
    productNo:'B',fabricName:'样布',status:'all',limit:'50',offset:String((i%10)*50)}));
   assert.equal(testPage.items.length,50);
   elapsed.push(performance.now()-start);
  }
  elapsed.sort((a,b)=>a-b);
  const p95=elapsed[Math.ceil(elapsed.length*0.95)-1];
  console.log('P3_SQL_2100_RECORDS_PASS p95_server_ms='+p95.toFixed(1)+' samples=30 local_socket_only_NOT_END_TO_END');
  const app=express();
  app.use('/auth',createV2AccessRouter(pool));
  app.use('/api/v2',createV2ProductsRouter(pool,checked));
  server=await new Promise(resolve=>{const x=app.listen(0,'127.0.0.1',()=>resolve(x));});
  const addr=server.address();assert(addr&&typeof addr!=='string');
  const base='http://127.0.0.1:'+addr.port;
  const noAuth=await fetch(base+'/api/v2/products');
  assert.equal(noAuth.status,401);
  const login=await fetch(base+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({username:'p3audit',password:'P3-6-test-only-not-a-production-password'})});
  assert.equal(login.status,200,'MySQL-backed real HTTP login');
  const loginData=await login.json() as {token:string};
  const http=await fetch(base+'/api/v2/products?productNo=B&fabricName='+encodeURIComponent('纯棉')+
   '&status=all&limit=20&offset=0',{headers:{authorization:'Bearer '+loginData.token}});
  assert.equal(http.status,200);
  const payload=await http.json() as {total:number;items:unknown[]};
  assert.equal(payload.total,900,'2100 products split by cotton/silk names');
  assert.equal(payload.items.length,20);
  const bad=await fetch(base+'/api/v2/products?weightMin=80',{headers:{authorization:'Bearer '+loginData.token}});
  assert.equal(bad.status,400);
  console.log('P3_EXPRESS_REAL_MYSQL_HTTP_PASS 401/200/400');
  console.log('P3_V2_REAL_MYSQL_ISOLATED_PASS database='+DB);
 }finally{
  if(server)await new Promise<void>((resolve,reject)=>server!.close(e=>e?reject(e):resolve()));
  if(pool){
   if(seeded){
    await checkTarget(pool);
    // Only explicitly allowlisted tables in this originally empty isolated schema.
    const deletion=['order_items','v2_access_sessions','v2_product_image_assets','v2_products',
     'pattern_master_tag_links','pattern_colorway_tag_links','pattern_colorways','pattern_masters',
     'v2_fabrics','shared_tags','image_assets','v2_access_users'];
    for(const t of deletion){
     if(!allowed.has(t))throw Error('Unsafe cleanup table');
     await pool.query('DELETE FROM '+t);
    }
    for(const t of allowed)assert.equal(await count(pool,t),0,'Incomplete cleanup '+t);
    console.log('P3_V2_ISOLATED_SANDBOX_CLEAN_ZERO');
   }
   await pool.end();
  }
  await root.end();
 }
}
void main().catch(e=>{
 // Do not log SQL statements, credentials, remote addresses or customer data.
 console.error('P3 isolated MySQL gate failed',e instanceof Error?e.message:'unknown');
 process.exitCode=1;
});
