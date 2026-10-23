/**
 * P1-D-2 ONLY, fixed empty remote MySQL sandbox.
 * Run as FABRIC_V2_ISOLATED_TEST=I_ACKNOWLEDGE_SANDBOX node - via SSH.
 * No production DB/table references; do not invoke from server.ts.
 */
import assert from 'node:assert/strict';
import {createConnection,createPool,type Pool} from 'mysql2/promise';
import {initializeAccessSchema} from '../server/access/schema';
import {initializeV2ProductMasterSchema,getV2ProductMasterCreateStatements} from '../server/product-master/schema';
import {getP1DAdditiveMigrationSql,inspectP1DCompatibility} from '../server/order-v2/schema';
import {getP1D2LineMigrationSql,inspectP1D2Lines} from '../server/order-v2/lineSchema';
import {reconcileOrderLines,OrderLineError} from '../server/order-v2/lines';
import type {AppPrincipal} from '../server/access/types';

const DB='fabric_v2_test_20261012_p1d2';
if(process.env.FABRIC_V2_ISOLATED_TEST!=='I_ACKNOWLEDGE_SANDBOX')throw Error('P1-D-2 explicit isolated confirmation required');
const sock='/var/run/mysqld/mysqld.sock';
type Row=Record<string,unknown>;
const rows=(x:unknown):Row[]=>{if(!Array.isArray(x))throw Error('Invalid SQL rows');return x as Row[];};
const names=new Set([
 'image_assets','v2_access_users','v2_access_sessions','orders','order_items',
 ...getV2ProductMasterCreateStatements().map(x=>x.name)
]);
const principal=(id:string,role:'admin'|'sales'):AppPrincipal=>({userId:id,username:'fixture',role,displayName:'Test',sessionId:'fake',canManageOwnOrders:true,canManageProducts:true});
async function main(){
 const boot=await createConnection({user:'root',socketPath:sock});
 let pool:Pool|undefined, seeded=false;
 try{
  const [existing]=await boot.query('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=?',[DB]);
  if(rows(existing).some(r=>!names.has(String(r.TABLE_NAME))))throw Error('Unexpected table; no sandbox writes');
  await boot.query('CREATE DATABASE IF NOT EXISTS '+DB+' CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
  pool=createPool({user:'root',socketPath:sock,database:DB,connectionLimit:5});
  await pool.query(`CREATE TABLE IF NOT EXISTS image_assets (
   id VARCHAR(36) NOT NULL PRIMARY KEY,ref_count INT UNSIGNED NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await initializeV2ProductMasterSchema(pool);
  await initializeAccessSchema(pool);
  await pool.query(`CREATE TABLE IF NOT EXISTS orders (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,order_no VARCHAR(50),
    order_date DATE NOT NULL,receiving_unit VARCHAR(100) NOT NULL,
    template_type VARCHAR(20) DEFAULT 'sample'
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS order_items (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,product_no VARCHAR(50) DEFAULT '',
    product_name VARCHAR(100) DEFAULT '',composition VARCHAR(50) DEFAULT '',
    weight DECIMAL(10,2) DEFAULT 0,width DECIMAL(10,2) DEFAULT 0,
    meters DECIMAL(10,2) DEFAULT 0,unit_price DECIMAL(10,2) DEFAULT 0,
    amount DECIMAL(10,2) DEFAULT 0,remark TEXT,color_no VARCHAR(100),
    piece_meters JSON NULL,deduction_meters DECIMAL(12,2) DEFAULT 0,
    KEY idx_order_id(order_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  const state1=await inspectP1DCompatibility(pool);
  if(state1.state==='legacy')for(const sql of getP1DAdditiveMigrationSql())await pool.query(sql);
  assert.equal((await inspectP1DCompatibility(pool)).state,'expanded');
  const state2=await inspectP1D2Lines(pool);
  if(state2==='legacy')for(const sql of getP1D2LineMigrationSql())await pool.query(sql);
  assert.equal(await inspectP1D2Lines(pool),'expanded');
  // Every business table must be empty before fixtures. Otherwise fail closed.
  for(const name of names){
   const [raw]=await pool.query('SELECT COUNT(*) AS n FROM '+name);
   assert.equal(Number(rows(raw)[0]?.n),0,'Nonempty sandbox '+name);
  }
  seeded=true;
  await pool.query("INSERT INTO orders(id,order_no,order_date,receiving_unit,template_type) VALUES (11,'TEST-SAMPLE','2026-10-12','TEST','sample'),(12,'TEST-DEPOSIT','2026-10-12','TEST','deposit'),(13,'TEST-BULK','2026-10-12','TEST','bulk')");
  await pool.query("INSERT INTO order_items(id,order_id,product_no,product_name,meters,unit_price,amount) VALUES (51,11,'OLD1','Original item 1',5,12,60),(52,12,'OLD2','Original item 2',6,14,84),(53,13,'OLD3','Original item 3',7,16,112)");
  const [historyBefore]=await pool.query("SELECT id,order_id,product_no,product_name,meters,unit_price,amount FROM order_items WHERE id IN (51,52,53) ORDER BY id");
  const before=JSON.stringify(historyBefore);
  const [oldSource]=await pool.query('SELECT COUNT(*) AS n FROM order_items WHERE v2_source_kind IS NOT NULL OR v2_product_id IS NOT NULL OR v2_product_snapshot IS NOT NULL');
  assert.equal(Number(rows(oldSource)[0].n),0);
  const [ownerNull]=await pool.query('SELECT COUNT(*) AS n FROM orders WHERE created_by_user_id IS NOT NULL');
  assert.equal(Number(rows(ownerNull)[0].n),0);
  console.log('PASS P1D2 initial historical 3 templates stable ID, owner NULL, source NULL');

  const [master]=await pool.query("INSERT INTO pattern_masters(master_no) VALUES ('G011')");
  const [color]=await pool.query('INSERT INTO pattern_colorways(master_id,colorway_no) VALUES (?,2)',[(master as {insertId:number}).insertId]);
  const [fabric]=await pool.query("INSERT INTO v2_fabrics(fabric_no,fabric_name,composition,weight_value,weight_unit,width_value) VALUES ('FAB01','棉布','100% Cotton',125.00,'gsm',150.00)");
  const [prod]=await pool.query("INSERT INTO v2_products(pattern_colorway_id,fabric_id,product_no) VALUES (?,?,'G011FAB01')",[(color as {insertId:number}).insertId,(fabric as {insertId:number}).insertId]);
  const productId=String((prod as {insertId:number}).insertId);
  // The physical MySQL CHECK and FK must reject malformed provenance, not only TS.
  await assert.rejects(pool.query(
   "INSERT INTO order_items(order_id,product_no,product_name,v2_source_kind,v2_product_snapshot) VALUES (11,'BAD','BAD','catalog',JSON_OBJECT('version',1))"
  ),/check constraint|constraint.*violated|ER_CHECK_CONSTRAINT_VIOLATED/i);
  await assert.rejects(pool.query(
   "INSERT INTO order_items(order_id,product_no,product_name,v2_source_kind,v2_product_id,v2_product_snapshot) VALUES (11,'BAD','BAD','catalog',999999,JSON_OBJECT('version',1))"
  ),/foreign key constraint|ER_NO_REFERENCED_ROW/i);
  console.log('PASS P1D2 database-enforced provenance CHECK and V2 product FK');
  const [u]=await pool.query("INSERT INTO v2_access_users(username,username_normalized,display_name,password_hash,role,can_manage_own_orders) VALUES ('p1d2','p1d2','Test','TEST ONLY','sales',1)");
  const actorId=String((u as {insertId:number}).insertId);
  await pool.query("INSERT INTO orders(id,order_no,order_date,receiving_unit,template_type,created_by_user_id) VALUES (21,'NEW-OWNED','2026-10-12','TEST','sample',?)",[actorId]);
  await pool.query("INSERT INTO order_items(id,order_id,product_no,product_name,meters,unit_price) VALUES (71,21,'OLD-LINE','Old line',1,10)");
  const sales=principal(actorId,'sales');
  const result=await reconcileOrderLines(pool,sales,'21',{items:[
   {id:'71',fields:{meters:2,unitPrice:11,remark:'edited in place'}},
   {fields:{meters:3,unitPrice:15,remark:'new catalog'},selection:{productId}}
  ],removeIds:[]});
  assert.equal(result.insertedIds.length,1);
  const id=result.insertedIds[0];
  const [oldLine]=await pool.query('SELECT id,product_no,product_name,v2_source_kind FROM order_items WHERE id=71');
  assert.equal(Number(rows(oldLine)[0].id),71);
  assert.equal(rows(oldLine)[0].product_no,'OLD-LINE');
  assert.equal(rows(oldLine)[0].v2_source_kind,null);
  const [newLine]=await pool.query('SELECT v2_product_id,v2_source_kind,product_no,color_no,composition,v2_product_snapshot FROM order_items WHERE id=?',[id]);
  assert.equal(rows(newLine)[0].v2_source_kind,'catalog');
  assert.equal(String(rows(newLine)[0].v2_product_id),productId);
  const snapshot=typeof rows(newLine)[0].v2_product_snapshot==='string'?JSON.parse(String(rows(newLine)[0].v2_product_snapshot)):rows(newLine)[0].v2_product_snapshot as Record<string,unknown>;
  assert.equal(snapshot.productNo,'G011FAB01');
  assert.equal(snapshot.weightUnit,'gsm');
  assert.equal(snapshot.colorwayNo,'2');
  const [snapshotBefore]=await pool.query('SELECT v2_product_snapshot FROM order_items WHERE id=?',[id]);
  await pool.query("UPDATE v2_fabrics SET composition='CHANGED MASTER COMPOSITION' WHERE id=?",[(fabric as {insertId:number}).insertId]);
  const [snapshotAfter]=await pool.query('SELECT v2_product_snapshot FROM order_items WHERE id=?',[id]);
  assert.equal(JSON.stringify(snapshotAfter),JSON.stringify(snapshotBefore),'Frozen line snapshot must survive master edits');
  console.log('PASS P1D2 MySQL DB-derived product metadata, snapshot frozen, stable existing ID');

  // Businessperson cannot change a historical unowned record or create manual.
  await assert.rejects(reconcileOrderLines(pool,sales,'11',{items:[{id:'51',fields:{meters:9}}],removeIds:[]}),OrderLineError);
  await assert.rejects(reconcileOrderLines(pool,sales,'21',{items:[
   {id:'71',fields:{}},{id,fields:{}},
   {fields:{meters:2},manual:{productNo:'FREE',productName:'manual'}}
  ],removeIds:[]}),OrderLineError);
  await pool.query("UPDATE v2_products SET is_active=0 WHERE id=?",[productId]);
  await assert.rejects(reconcileOrderLines(pool,sales,'21',{items:[
   {id:'71',fields:{meters:8}},{id,fields:{}},{fields:{meters:2},selection:{productId}}
  ],removeIds:[]}),OrderLineError);
  await pool.query("UPDATE v2_products SET is_active=1 WHERE id=?",[productId]);
  const [noPartial]=await pool.query('SELECT meters FROM order_items WHERE id=71');
  assert.equal(Number(rows(noPartial)[0].meters),2,'Rejected transaction must roll back earlier line update');
  // Admin can explicitly insert new manual line into old unowned sample.
  const manual=await reconcileOrderLines(pool,principal(actorId,'admin'),'11',{items:[
   {id:'51',fields:{}},
   {fields:{meters:1,unitPrice:4},manual:{productNo:'M001',productName:'管理员手工'}}
  ],removeIds:[]});
  assert.equal(manual.insertedIds.length,1);
  const [manualRow]=await pool.query('SELECT v2_product_id,v2_source_kind FROM order_items WHERE id=?',[manual.insertedIds[0]]);
  assert.equal(rows(manualRow)[0].v2_product_id,null);
  assert.equal(rows(manualRow)[0].v2_source_kind,'manual');
  // Remove only the explicitly listed selected line, never wipe/recreate all.
  await reconcileOrderLines(pool,sales,'21',{items:[{id:'71',fields:{}}],removeIds:[id]});
  const [remain]=await pool.query('SELECT id FROM order_items WHERE order_id=21');
  assert.deepEqual(rows(remain).map(x=>Number(x.id)),[71]);
  const [historyAfter]=await pool.query('SELECT id,order_id,product_no,product_name,meters,unit_price,amount FROM order_items WHERE id IN (51,52,53) ORDER BY id');
  assert.equal(JSON.stringify(historyAfter),before,'Historical three template IDs/content unchanged');
  console.log('PASS P1D2 manual admin only, inactive catalog rejected, explicit deletes, legacy history unchanged');
  assert.equal(await inspectP1D2Lines(pool),'expanded');
  console.log('P1D2_LINES_REAL_MYSQL_ISOLATED_PASS database='+DB);
 }finally{
  if(pool){
   if(seeded){
    await pool.query('DELETE FROM order_items');
    await pool.query('DELETE FROM orders');
    await pool.query('DELETE FROM v2_access_sessions');
    await pool.query('DELETE FROM v2_access_users');
    await pool.query('DELETE FROM v2_product_image_assets');
    await pool.query('DELETE FROM v2_products');
    await pool.query('DELETE FROM pattern_master_tag_links');
    await pool.query('DELETE FROM pattern_colorway_tag_links');
    await pool.query('DELETE FROM pattern_colorways');
    await pool.query('DELETE FROM pattern_masters');
    await pool.query('DELETE FROM v2_fabrics');
    await pool.query('DELETE FROM shared_tags');
    for(const table of names){
     const [r]=await pool.query('SELECT COUNT(*) AS n FROM '+table);
     assert.equal(Number(rows(r)[0].n),0,'Test data left: '+table);
    }
    console.log('PASS P1D2 isolated all business tables 0 rows');
   }
   await pool.end();
  }
  await boot.end();
 }
}
void main().catch(error=>{console.error('P1-D-2 isolated error',error instanceof Error?error.message:'unknown');process.exitCode=1;});
