/** P5 XLSX import real MySQL 8 isolated sandbox acceptance ONLY.
 * To execute: remote host with explicit FABRIC_V2_ISOLATED_TEST acknowledgement.
 * Never touches production fabric_db, does not mount the running server.
 */
import assert from 'node:assert/strict';
import express from 'express';
import ExcelJS from 'exceljs';
import {createConnection,createPool,type Pool} from 'mysql2/promise';
import {getV2ProductMasterCreateStatements,initializeV2ProductMasterSchema} from '../server/product-master/schema';
import {initializeAccessSchema} from '../server/access/schema';
import {hashPassword} from '../server/access/password';
import {createAuthenticatedSession,resolvePrincipalFromToken} from '../server/access/sessions';
import {createFabricImportService,FabricImportError} from '../server/product-master/fabricExcelImport';
import {createFabricRouter} from '../server/product-master/fabricsRoutes';

const DB='fabric_v2_test_20261013_p5import';
const ACK='I_ACKNOWLEDGE_SANDBOX';
const socketPath='/var/run/mysqld/mysqld.sock';
if(process.env.FABRIC_V2_ISOLATED_TEST!==ACK)throw Error('P5 sandbox explicit acknowledgment required');
if(!/^fabric_v2_test_[a-z0-9_]+$/.test(DB))throw Error('Refused unsafe sandbox identity');
const permittedTables=new Set(['image_assets','v2_access_users','v2_access_sessions',
 ...getV2ProductMasterCreateStatements().map(x=>x.name)]);
type Row=Record<string,unknown>;
const rows=(x:unknown):Row[]=>{if(!Array.isArray(x))throw Error('Invalid MySQL rows');return x as Row[];};
async function active(db:{query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>}){
 const [result]=await db.query('SELECT DATABASE() AS db');
 assert.equal(String(rows(result)[0]?.db),DB,'Wrong active database');
}
const count=async(db:{query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>},t:string)=>{
 if(!permittedTables.has(t))throw Error('Non-allowlisted table '+t);
 const [result]=await db.query('SELECT COUNT(*) AS n FROM '+t);
 return Number(rows(result)[0]?.n);
};
const insertId=(r:unknown)=>{
 const id=String((r as {insertId?:string|number}).insertId);
 assert(/^[1-9]\d*$/.test(id));return id;
};
async function workbook(data:(string|number|null)[][]){
 const b=new ExcelJS.Workbook(),s=b.addWorksheet('面料资料');
 s.addRow(['品号','品名','成分','克重','克重单位','门幅(cm)','备注']);
 for(const row of data)s.addRow(row);
 return Buffer.from(await b.xlsx.writeBuffer());
}
function status(n:number){return (e:unknown)=>e instanceof FabricImportError&&e.status===n;}
async function main(){
 const root=await createConnection({user:'root',socketPath});
 let pool:Pool|undefined,seeded=false,server:ReturnType<ReturnType<typeof express>['listen']>|undefined;
 try{
  const [known]=await root.query('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=?',[DB]);
  for(const record of rows(known)){
   const table=String(record.TABLE_NAME);
   if(!permittedTables.has(table))throw Error('Unknown table in isolated database');
   const [data]=await root.query('SELECT COUNT(*) AS n FROM '+DB+'.'+table);
   assert.equal(Number(rows(data)[0]?.n),0,'Occupied sandbox table '+table);
  }
  await root.query('CREATE DATABASE IF NOT EXISTS '+DB+' CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
  pool=createPool({user:'root',socketPath,database:DB,connectionLimit:12,
   supportBigNumbers:true,bigNumberStrings:true,waitForConnections:true});
  await active(pool);
  await pool.query("CREATE TABLE IF NOT EXISTS image_assets(id VARCHAR(36) PRIMARY KEY,ref_count INT UNSIGNED NOT NULL DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  await initializeV2ProductMasterSchema(pool);
  await initializeAccessSchema(pool);
  for(const t of permittedTables)assert.equal(await count(pool,t),0,'Nonempty after schema init: '+t);
  const checked={async getConnection(){
   const db=await pool!.getConnection();
   try{await active(db);return db;}catch(e){db.release();throw e;}
  }};
  seeded=true;
  const hash=await hashPassword('P5-real-sandbox-only-pass');
  async function user(name:string,role:'admin'|'sales'){
   const [created]=await pool!.query(
    'INSERT INTO v2_access_users(username,username_normalized,display_name,password_hash,role,can_manage_products) VALUES (?,?,?,?,?,1)',
    [name,name,'Sandbox '+role,hash,role]);
   const session=await createAuthenticatedSession(pool!,insertId(created),3600);
   const principal=await resolvePrincipalFromToken(pool!,session.token);
   assert(principal&&principal.role===role);
   return {principal,token:session.token};
  }
  const admin=await user('p5admin','admin'),sales=await user('p5sales','sales');
  await pool.query("INSERT INTO v2_fabrics(fabric_no,fabric_name,composition,weight_value,weight_unit,width_value,remark) VALUES ('F018','旧丝绸','棉',98.000,'gsm',150.00,'原备注')");
  const service=createFabricImportService(pool,checked);
  const sample=await workbook([
   ['F018',null,'真丝',null,null,null,null],
   ['F019','轻柔雪纺','100%真丝',16.5,'mm',145,'新款'],
   [' D020 ','重复甲',null,null,null,null,null],
   ['D020','重复乙',null,null,null,null,null],
   ['F090','错误规格',null,76,null,148,null]
  ]);
  const preview=await service.preview(admin.principal,sample,{filename:'p5-fixture.xlsx'});
  assert.deepEqual(preview.rows.map(r=>r.action),['skip','create','skip','skip','error']);
  assert.deepEqual(preview.counts,{create:1,skip:3,error:1});
  assert.equal(preview.rows[0].fabric?.fabricName,'旧丝绸');
  const [unchanged]=await pool.query("SELECT composition FROM v2_fabrics WHERE fabric_no='F018'");
  assert.equal(rows(unchanged)[0]?.composition,'棉','Preview must be read-only');
  const commit=await service.commit(admin.principal,{token:preview.token,confirm:true,updateRows:[2]});
  assert.deepEqual(commit.counts,{created:1,updated:1,skipped:2,failed:1});
  const [after]=await pool.query("SELECT fabric_no,fabric_name,composition,weight_value,weight_unit,width_value,remark FROM v2_fabrics ORDER BY fabric_no");
  assert.equal(rows(after).length,2);
  const old=rows(after)[0],newOne=rows(after)[1];
  assert.equal(old.fabric_no,'F018');assert.equal(old.fabric_name,'旧丝绸');
  assert.equal(old.composition,'真丝');assert.equal(Number(old.weight_value),98);
  assert.equal(Number(old.width_value),150);assert.equal(old.remark,'原备注');
  assert.equal(newOne.fabric_no,'F019');assert.equal(newOne.weight_unit,'mm');
  await assert.rejects(service.commit(admin.principal,{token:preview.token,confirm:true,updateRows:[2]}),status(409));
  console.log('P5_REAL_MYSQL_ADMIN_CREATE_UPDATE_DUPLICATES_ERRORS_REPLAY_PASS');

  const salePreview=await service.preview(sales.principal,await workbook([
   ['F018','恶意覆盖',null,null,null,null,null],['F020','销售新增',null,null,null,null,null]
  ]),{filename:'sales.xlsx'});
  await assert.rejects(service.commit(sales.principal,{
   token:salePreview.token,confirm:true,updateRows:[2]}),status(403));
  const saleCommit=await service.commit(sales.principal,{
   token:salePreview.token,confirm:true,updateRows:[]});
  assert.deepEqual(saleCommit.counts,{created:1,updated:0,skipped:1,failed:0});
  const [safe]=await pool.query("SELECT fabric_name FROM v2_fabrics WHERE fabric_no='F018'");
  assert.equal(rows(safe)[0]?.fabric_name,'旧丝绸');
  console.log('P5_REAL_MYSQL_SALES_NO_OVERWRITE_PASS');

  const stale=await service.preview(admin.principal,await workbook([
   ['F018','待覆盖',null,null,null,null,null]
  ]),{filename:'stale.xlsx'});
  await pool.query("UPDATE v2_fabrics SET remark='其他管理员修改' WHERE fabric_no='F018'");
  const staleOut=await service.commit(admin.principal,{token:stale.token,confirm:true,updateRows:[2]});
  assert.equal(staleOut.counts.failed,1);
  const [notLost]=await pool.query("SELECT fabric_name,remark FROM v2_fabrics WHERE fabric_no='F018'");
  assert.equal(rows(notLost)[0]?.fabric_name,'旧丝绸');
  assert.equal(rows(notLost)[0]?.remark,'其他管理员修改');
  const conflict=await service.preview(admin.principal,await workbook([
   ['F021','新面料',null,null,null,null,null]
  ]),{filename:'conflict.xlsx'});
  await pool.query("INSERT INTO v2_fabrics(fabric_no,fabric_name) VALUES ('F021','并发创建')");
  const conflicting=await service.commit(admin.principal,{token:conflict.token,confirm:true,updateRows:[]});
  assert.equal(conflicting.counts.skipped,1);
  console.log('P5_REAL_MYSQL_SNAPSHOT_STALE_AND_NEW_CONFLICT_PASS');

  const app=express();
  app.use('/api/v2',createFabricRouter(pool,checked));
  server=await new Promise(resolve=>{const http=app.listen(0,'127.0.0.1',()=>resolve(http));});
  const address=server.address();assert(address&&typeof address!=='string');
  const url='http://127.0.0.1:'+address.port+'/api/v2/fabrics/import/';
  const httpPayload=JSON.stringify({fileBase64:(await workbook([
   ['F030','真实HTTP新增',null,18,'mm',144,null]
  ])).toString('base64'),options:{filename:'http.xlsx'}});
  const noAuth=await fetch(url+'preview',{method:'POST',headers:{'content-type':'application/json'},body:httpPayload});
  assert.equal(noAuth.status,401);
  const normalHeaders={authorization:'Bearer '+admin.token,'content-type':'application/json'};
  const httpPreview=await fetch(url+'preview',{method:'POST',headers:normalHeaders,body:httpPayload});
  assert.equal(httpPreview.status,200);
  const hp=await httpPreview.json() as {token:string;counts:{create:number}};
  assert.equal(hp.counts.create,1);
  const noConfirmation=await fetch(url+'commit',{method:'POST',headers:normalHeaders,body:JSON.stringify({
   token:hp.token,confirm:false,updateRows:[]})});
  assert.equal(noConfirmation.status,400);
  const httpCommit=await fetch(url+'commit',{method:'POST',headers:normalHeaders,body:JSON.stringify({
   token:hp.token,confirm:true,updateRows:[]})});
  assert.equal(httpCommit.status,200);
  const hd=await httpCommit.json() as {counts:{created:number}};
  assert.equal(hd.counts.created,1);
  const replay=await fetch(url+'commit',{method:'POST',headers:normalHeaders,body:JSON.stringify({
   token:hp.token,confirm:true,updateRows:[]})});
  assert.equal(replay.status,409);
  console.log('P5_REAL_MYSQL_EXPRESS_BEARER_PREVIEW_COMMIT_REPLAY_PASS');
  console.log('P5_REAL_MYSQL_ISOLATED_PASS database='+DB);
 }finally{
  if(server)await new Promise<void>((resolve,reject)=>server!.close(e=>e?reject(e):resolve()));
  if(pool){
   if(seeded){
    await active(pool);
    const deletion=['v2_access_sessions','v2_product_image_assets','v2_products',
     'pattern_master_tag_links','pattern_colorway_tag_links','pattern_colorways','pattern_masters',
     'v2_fabrics','shared_tags','image_assets','v2_access_users'];
    for(const t of deletion){if(!permittedTables.has(t))throw Error('Cleanup table not allowed');await pool.query('DELETE FROM '+t);}
    for(const t of permittedTables)assert.equal(await count(pool,t),0,'P5 cleanup failed for '+t);
    console.log('P5_REAL_MYSQL_SANDBOX_CLEAN_ZERO');
   }
   await pool.end();
  }
  await root.end();
 }
}
void main().catch(e=>{
 console.error('P5 real MySQL isolated gate failed: ',e instanceof Error?e.message:'unknown');
 process.exitCode=1;
});