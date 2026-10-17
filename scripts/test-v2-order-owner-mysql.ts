import assert from 'node:assert/strict';
import {createConnection,createPool,type Pool} from 'mysql2/promise';
import {initializeAccessSchema} from '../server/access/schema';
import {getP1DAdditiveMigrationSql,inspectP1DCompatibility,buildP1DOrderListScope} from '../server/order-v2/schema';
import {updateExistingOrderItemBusinessFields,P1DOrderAccessError} from '../server/order-v2/repository';
import type {AppPrincipal} from '../server/access/types';

const DB='fabric_v2_test_20261012_p1d';
if(process.env.FABRIC_V2_ISOLATED_TEST!=='I_ACKNOWLEDGE_SANDBOX')throw Error('Explicit isolated P1-D test acknowledgement required');
const socketPath='/var/run/mysqld/mysqld.sock';
const names=new Set(['orders','order_items','v2_access_users','v2_access_sessions','v2_order_schema_migrations']);
const admin=(id:string,role:'admin'|'sales'):AppPrincipal=>({
 userId:id,role,username:'fixture_'+role,displayName:'Test',sessionId:'test',
 canManageOwnOrders:true,canManageProducts:true
});
const rows=(data:unknown):Record<string,unknown>[]=>{
 if(!Array.isArray(data))throw Error('Bad SQL rows');
 return data as Record<string,unknown>[];
};
async function main(){
 const boot=await createConnection({user:'root',socketPath});
 let pool:Pool|undefined,seeded=false;
 try {
  const [existing]=await boot.query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=?",[DB]);
  if(rows(existing).some(row=>!names.has(String(row.TABLE_NAME))))throw Error('Unexpected sandbox table; refusing any write');
  await boot.query('CREATE DATABASE IF NOT EXISTS '+DB+' CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
  pool=createPool({user:'root',socketPath,database:DB,connectionLimit:4,waitForConnections:true});
  await initializeAccessSchema(pool);
  await pool.query(`CREATE TABLE IF NOT EXISTS orders (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    order_no VARCHAR(50),order_date DATE NOT NULL,style_no VARCHAR(50),
    receiving_unit VARCHAR(100) NOT NULL,
    total_meters DECIMAL(10,2) DEFAULT 0,total_pieces INT DEFAULT 0,
    total_amount DECIMAL(10,2) DEFAULT 0,
    sign_person VARCHAR(50),receiver VARCHAR(50),receiver_phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    template_type VARCHAR(20) DEFAULT 'sample',
    deposit DECIMAL(12,2) DEFAULT 0,company_name VARCHAR(255),
    company_address VARCHAR(500),company_phone VARCHAR(100),
    terms TEXT,receiver_address VARCHAR(500),deduction_meters DECIMAL(12,2) DEFAULT 0,
    settled TINYINT(1) DEFAULT 0
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS order_items (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_no VARCHAR(50) DEFAULT '',product_name VARCHAR(100) DEFAULT '',
    composition VARCHAR(50) DEFAULT '',weight DECIMAL(10,2) DEFAULT 0,
    width DECIMAL(10,2) DEFAULT 0,meters DECIMAL(10,2) DEFAULT 0,
    unit_price DECIMAL(10,2) DEFAULT 0,amount DECIMAL(10,2) DEFAULT 0,
    remark TEXT,color_no VARCHAR(100),piece_meters JSON NULL,
    deduction_meters DECIMAL(12,2) DEFAULT 0,
    KEY idx_order_id(order_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS v2_order_schema_migrations (
     migration_id VARCHAR(64) NOT NULL PRIMARY KEY,
     schema_version INT UNSIGNED NOT NULL,
     applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  // Fixed sandbox only and never overwrite or delete unknown records.
  for(const table of [...names].filter(x=>x!=='v2_order_schema_migrations')){
   const [count]=await pool.query('SELECT COUNT(*) AS total FROM '+table);
   if(Number(rows(count)[0]?.total)!==0)throw Error('Sandbox nonempty: '+table);
  }
  seeded=true;
  const fixtures=[
   [11,'O-LEGACY-SAMPLE','sample'],[12,'O-LEGACY-DEPOSIT','deposit'],[13,'O-LEGACY-BULK','bulk']
  ];
  for(const [id,orderNo,type] of fixtures)await pool.query(
   'INSERT INTO orders(id,order_no,order_date,receiving_unit,template_type,total_pieces) VALUES (?,?,"2026-10-12","TEST-ONLY",?,1)',[id,orderNo,type]);
  for(const [id,orderId,name] of [[51,11,'PATTERN-A'],[52,12,'PATTERN-B'],[53,13,'PATTERN-C']])await pool.query(
   'INSERT INTO order_items(id,order_id,product_no,product_name,composition,meters,unit_price,amount,remark) VALUES (?,? ,?,"TEST FABRIC","TEST-FIBER",5.00,2.00,10.00,"unchanged")',[id,orderId,name]);
  const [ordersBefore]=await pool.query('SELECT id,order_no,order_date,template_type,receiving_unit,total_pieces FROM orders ORDER BY id');
  const [itemsBefore]=await pool.query('SELECT * FROM order_items ORDER BY id');
  const beforeOrders=JSON.stringify(ordersBefore),beforeItems=JSON.stringify(itemsBefore);
  let schema=await inspectP1DCompatibility(pool);
  if(schema.state==='legacy'){
   const [count]=await pool.query("SELECT COUNT(*) AS n FROM v2_order_schema_migrations");
   assert.equal(Number(rows(count)[0].n),0);
   for(const sql of getP1DAdditiveMigrationSql())await pool.query(sql);
   await pool.query("INSERT INTO v2_order_schema_migrations(migration_id,schema_version) VALUES ('add_owner_nullable_v1',1)");
  }
  schema=await inspectP1DCompatibility(pool);
  assert.equal(schema.state,'expanded');
  const [ordersAfter]=await pool.query('SELECT id,order_no,order_date,template_type,receiving_unit,total_pieces FROM orders ORDER BY id');
  const [itemsAfter]=await pool.query('SELECT * FROM order_items ORDER BY id');
  assert.equal(JSON.stringify(ordersAfter),beforeOrders,'Old orders must not change');
  assert.equal(JSON.stringify(itemsAfter),beforeItems,'Old items IDs/snapshots must not change');
  const [historicalOwners]=await pool.query('SELECT COUNT(*) AS n FROM orders WHERE id IN (11,12,13) AND created_by_user_id IS NOT NULL');
  assert.equal(Number(rows(historicalOwners)[0].n),0,'Old owners MUST remain null');
  const [fkInfo]=await pool.query("SELECT REFERENCED_TABLE_NAME,DELETE_RULE FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND CONSTRAINT_NAME='fk_v2_orders_actor'");
  assert.equal(rows(fkInfo)[0]?.REFERENCED_TABLE_NAME,'v2_access_users');
  assert.equal(rows(fkInfo)[0]?.DELETE_RULE,'RESTRICT');
  const [idx]=await pool.query("SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND INDEX_NAME='idx_v2_orders_owner'");
  assert.equal(rows(idx).length,1);
  console.log('PASS P1-D historical 3 order types + existing line IDs and snapshots unchanged; old owner NULL, FK+INDEX');

  const [u]=await pool.query("INSERT INTO v2_access_users(username,username_normalized,display_name,password_hash,role) VALUES ('p1d_fixture','p1d_fixture','Synthetic user','TEST-ONLY','sales')");
  const salesId=String((u as {insertId:number}).insertId);
  await pool.query('INSERT INTO orders(id,order_no,order_date,receiving_unit,template_type,total_pieces,created_by_user_id) VALUES (21,"O-NEW","2026-10-12","TEST-ONLY","sample",1,?)',[salesId]);
  await pool.query('INSERT INTO order_items(id,order_id,product_no,product_name,meters,unit_price,amount,remark) VALUES (71,21,"TEST-NEW","Test",1,10,10,"initial")');
  const seller=admin(salesId,'sales');
  const scope=buildP1DOrderListScope(seller);
  const [visible]=await pool.query('SELECT o.id FROM orders o WHERE '+scope.where,scope.params);
  assert.deepEqual(rows(visible).map(row=>Number(row.id)),[21]);
  const [adminVisible]=await pool.query('SELECT o.id FROM orders o WHERE '+buildP1DOrderListScope(admin(salesId,'admin')).where);
  assert.equal(rows(adminVisible).length,4);
  await assert.rejects(updateExistingOrderItemBusinessFields(pool,seller,'11','51',{meters:9}),P1DOrderAccessError);
  const [itemOld]=await pool.query('SELECT id,meters FROM order_items WHERE id=51');
  assert.equal(Number(rows(itemOld)[0].meters),5);
  await updateExistingOrderItemBusinessFields(pool,seller,'21','71',{meters:7,unitPrice:15,remark:'approved'});
  const [itemNew]=await pool.query('SELECT id,order_id,product_no,product_name,meters,unit_price,remark FROM order_items WHERE id=71');
  assert.equal(Number(rows(itemNew)[0].id),71);
  assert.equal(Number(rows(itemNew)[0].order_id),21);
  assert.equal(String(rows(itemNew)[0].product_no),'TEST-NEW');
  assert.equal(Number(rows(itemNew)[0].meters),7);
  assert.equal(Number(rows(itemNew)[0].unit_price),15);
  const [historyAgain]=await pool.query('SELECT * FROM order_items WHERE id IN (51,52,53) ORDER BY id');
  assert.equal(JSON.stringify(historyAgain),beforeItems,'Historic snapshots and stable IDs must remain identical');
  const [failedAuth]=await pool.query('SELECT COUNT(*) AS n FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.id=51 AND o.created_by_user_id=?',[salesId]);
  assert.equal(Number(rows(failedAuth)[0].n),0);
  console.log('PASS P1-D SQL-side scoped list/exports, unauthorized write rejected, owned write preserves stable item ID+source');

  // Repeat migration is a strict no-op; no duplicate ALTER.
  assert.equal((await inspectP1DCompatibility(pool)).state,'expanded');
  const [ledger]=await pool.query('SELECT MAX(schema_version) AS version FROM v2_order_schema_migrations');
  assert.equal(Number(rows(ledger)[0].version),1);
  console.log('P1D_OWNER_ISOLATED_PASS database='+DB);
 }finally{
  if(pool){
   if(seeded){
    // Only the fixed originally-empty isolated DB can be cleaned.
    await pool.query('DELETE FROM order_items');
    await pool.query('DELETE FROM orders');
    await pool.query('DELETE FROM v2_access_sessions');
    await pool.query('DELETE FROM v2_access_users');
    for(const table of [...names].filter(x=>x!=='v2_order_schema_migrations')){
     const [count]=await pool.query('SELECT COUNT(*) AS n FROM '+table);
     assert.equal(Number(rows(count)[0].n),0,'Sandbox must be empty after test: '+table);
    }
    console.log('PASS P1-D isolated database clean (0 orders/items/users/sessions)');
   }
   await pool.end();
  }
  await boot.end();
 }
}
void main().catch(e=>{console.error('P1-D test error:',e instanceof Error?e.message:'unknown');process.exitCode=1;});
