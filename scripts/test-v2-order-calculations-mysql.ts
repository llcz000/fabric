/**
 * P6-1 isolated MySQL8 historical-compatible arithmetic+same-transaction test.
 * Strictly named separate database; must never operate on fabric_db.
 * Run with FABRIC_V2_ISOLATED_TEST=I_ACKNOWLEDGE_SANDBOX over SSH.
 */
import assert from 'node:assert/strict';
import {createConnection,createPool,type Pool} from 'mysql2/promise';
import {reconcileOrderLinesAndTotals} from '../server/order-v2/calculatedSave';
import {OrderLineError} from '../server/order-v2/lines';
import type {AppPrincipal} from '../server/access/types';
const DB='fabric_v2_test_20261012_p6calc';
if(process.env.FABRIC_V2_ISOLATED_TEST!=='I_ACKNOWLEDGE_SANDBOX')
 throw Error('P6-1 explicit sandbox confirmation required');
const sock='/var/run/mysqld/mysqld.sock';
type R=Record<string,unknown>;
const rows=(r:unknown):R[]=>{if(!Array.isArray(r))throw Error('Invalid DB rows');return r as R[]};
const principal=(id:string,role:'admin'|'sales'):AppPrincipal=>({
 userId:id,role,username:'p6-fixture',displayName:'Fixture',
 canManageOwnOrders:true,canManageProducts:true,sessionId:'fake'
});
async function main(){
 const boot=await createConnection({user:'root',socketPath:sock});
 let pool:Pool|undefined,seeded=false;
 try{
  const [previous]=await boot.query('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=?',[DB]);
  if(rows(previous).some(r=>!['orders','order_items'].includes(String(r.TABLE_NAME))))
   throw Error('Unexpected P6 sandbox table; refuse write');
  await boot.query('CREATE DATABASE IF NOT EXISTS '+DB+' CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
  pool=createPool({user:'root',socketPath:sock,database:DB,connectionLimit:4,waitForConnections:true});
  await pool.query(`CREATE TABLE IF NOT EXISTS orders (
   id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,order_no VARCHAR(50),
   order_date DATE NOT NULL,receiving_unit VARCHAR(100) NOT NULL,
   template_type ENUM('sample','deposit','bulk') NOT NULL,
   deposit DECIMAL(12,2) DEFAULT 0,
   created_by_user_id BIGINT UNSIGNED NULL,
   total_meters DECIMAL(12,2) DEFAULT 0,total_pieces INT DEFAULT 0,
   total_amount DECIMAL(12,2) DEFAULT 0,deduction_meters DECIMAL(12,2) DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS order_items (
   id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,order_id INT NOT NULL,
   product_no VARCHAR(50) DEFAULT '',product_name VARCHAR(100) DEFAULT '',
   color_no VARCHAR(100) DEFAULT '',composition VARCHAR(50) DEFAULT '',
   weight DECIMAL(10,2) DEFAULT 0,width DECIMAL(10,2) DEFAULT 0,
   meters DECIMAL(10,2) DEFAULT 0,unit_price DECIMAL(10,2) DEFAULT 0,
   amount DECIMAL(10,2) DEFAULT 0,
   piece_meters JSON NULL,deduction_meters DECIMAL(12,2) DEFAULT 0,
   remark TEXT,
   v2_product_id BIGINT UNSIGNED NULL,
   v2_source_kind ENUM('catalog','manual') NULL,
   v2_product_snapshot JSON NULL,
   KEY idx_order_id(order_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  for(const table of ['orders','order_items']){
   const [rr]=await pool.query('SELECT COUNT(*) AS n FROM '+table);
   assert.equal(Number(rows(rr)[0].n),0,'P6 isolated nonempty '+table);
  }
  seeded=true;
  await pool.query(`INSERT INTO orders(id,order_no,order_date,receiving_unit,template_type,deposit,created_by_user_id)
   VALUES (11,'P6-SAMPLE','2026-10-12','TEST','sample',2,2),
   (12,'P6-DEPOSIT','2026-10-12','TEST','deposit',25,2),
   (13,'P6-BULK','2026-10-12','TEST','bulk',20,2),
   (14,'P6-HISTORY','2026-10-12','TEST','sample',0,NULL)`);
  await pool.query(`INSERT INTO order_items(id,order_id,product_no,product_name,meters,unit_price,amount)
   VALUES(41,11,'LEG-41','Old sample',2,10,20),
   (42,12,'LEG-42','Old deposit',10,30,300),
   (43,13,'LEG-43','Old bulk',7,12.5,87.5),
   (44,14,'LEG-44','Historical unowned',1,11,11)`);
  const [historyBefore]=await pool.query('SELECT * FROM order_items WHERE id=44');
  const actor=principal('2','sales');
  await reconcileOrderLinesAndTotals(pool,actor,'11',{items:[
   {id:'41',fields:{meters:2.5,unitPrice:10.25}}
  ],removeIds:[]});
  const [sample]=await pool.query('SELECT total_meters,total_pieces,total_amount,deduction_meters,deposit FROM orders WHERE id=11');
  assert.equal(Number(rows(sample)[0].total_meters),2.5);
  assert.equal(Number(rows(sample)[0].total_amount),25.63);
  assert.equal(Number(rows(sample)[0].total_pieces),1);
  assert.equal(Number(rows(sample)[0].deposit),2);
  const [sampleLine]=await pool.query('SELECT id,amount,product_no FROM order_items WHERE id=41');
  assert.equal(Number(rows(sampleLine)[0].id),41);
  assert.equal(Number(rows(sampleLine)[0].amount),25.63);
  await reconcileOrderLinesAndTotals(pool,actor,'12',{items:[
   {id:'42',fields:{meters:10,unitPrice:30}}
  ],removeIds:[]});
  const [dep]=await pool.query('SELECT total_meters,total_pieces,total_amount,deposit FROM orders WHERE id=12');
  assert.equal(Number(rows(dep)[0].total_amount),300);
  assert.equal(Number(rows(dep)[0].total_pieces),1);
  assert.equal(Number(rows(dep)[0].deposit),25);
  await reconcileOrderLinesAndTotals(pool,actor,'13',{items:[
   {id:'43',fields:{meters:7,unitPrice:12.5,deductionMeters:0.5,pieceMeters:[3.5,3.5]}}
  ],removeIds:[]});
  const [bulk]=await pool.query('SELECT total_meters,total_pieces,total_amount,deduction_meters,deposit FROM orders WHERE id=13');
  assert.equal(Number(rows(bulk)[0].total_meters),7);
  assert.equal(Number(rows(bulk)[0].total_pieces),2);
  assert.equal(Number(rows(bulk)[0].total_amount),81.25);
  assert.equal(Number(rows(bulk)[0].deduction_meters),0.5);
  const [bulkLine]=await pool.query('SELECT id,amount,piece_meters,deduction_meters FROM order_items WHERE id=43');
  assert.equal(Number(rows(bulkLine)[0].id),43);
  assert.equal(Number(rows(bulkLine)[0].amount),81.25);
  assert.equal(Number(rows(bulkLine)[0].deduction_meters),0.5);
  console.log('PASS P6-1 real MySQL sample/deposit/bulk arithmetic and stable existing line IDs');

  // Repeat unchanged save; MySQL may report affectedRows=0 but it is safe.
  await reconcileOrderLinesAndTotals(pool,actor,'13',{items:[
   {id:'43',fields:{meters:7,unitPrice:12.5,deductionMeters:0.5,pieceMeters:[3.5,3.5]}}
  ],removeIds:[]});
  const before=JSON.stringify(bulkLine);
  await assert.rejects(reconcileOrderLinesAndTotals(pool,actor,'13',{items:[
   {id:'43',fields:{meters:8,unitPrice:15,deductionMeters:0.5,pieceMeters:[3.5,3.5]}}
  ],removeIds:[]}));
  const [after]=await pool.query('SELECT id,amount,piece_meters,deduction_meters FROM order_items WHERE id=43');
  assert.equal(JSON.stringify(after),before,'Invalid roll lengths must roll back whole write');
  const [recheck]=await pool.query('SELECT total_amount FROM orders WHERE id=13');
  assert.equal(Number(rows(recheck)[0].total_amount),81.25);
  await assert.rejects(reconcileOrderLinesAndTotals(pool,actor,'14',{items:[
   {id:'44',fields:{meters:9,unitPrice:10}}
  ],removeIds:[]}),OrderLineError);
  const [historyAfter]=await pool.query('SELECT * FROM order_items WHERE id=44');
  assert.equal(JSON.stringify(historyAfter),JSON.stringify(historyBefore));
  console.log('PASS P6-1 idempotent save, invalid-roll rollback, ownerless historical isolation');

  // Admin explicit new manual + new calculated amount + header in same txn.
  const inserted=await reconcileOrderLinesAndTotals(pool,principal('2','admin'),'11',{items:[
   {id:'41',fields:{}},{fields:{meters:3,unitPrice:2},manual:{productNo:'MAN',productName:'Manual'}}
  ],removeIds:[]});
  assert.equal(inserted.insertedIds.length,1);
  const [sampleExpanded]=await pool.query('SELECT total_meters,total_pieces,total_amount FROM orders WHERE id=11');
  assert.equal(Number(rows(sampleExpanded)[0].total_meters),5.5);
  assert.equal(Number(rows(sampleExpanded)[0].total_pieces),2);
  assert.equal(Number(rows(sampleExpanded)[0].total_amount),31.63);
  const [manualLine]=await pool.query('SELECT id,amount,v2_source_kind FROM order_items WHERE id=?',[inserted.insertedIds[0]]);
  assert.equal(Number(rows(manualLine)[0].amount),6);
  assert.equal(rows(manualLine)[0].v2_source_kind,'manual');
  console.log('PASS P6-1 new manual line total recomputed transactionally, historical source untouched');
  console.log('P6_CALCULATIONS_REAL_MYSQL_ISOLATED_PASS database='+DB);
 }finally{
  if(pool){
   if(seeded){
    await pool.query('DELETE FROM order_items');
    await pool.query('DELETE FROM orders');
    for(const table of ['orders','order_items']){
     const [rr]=await pool.query('SELECT COUNT(*) AS n FROM '+table);
     assert.equal(Number(rows(rr)[0].n),0,'Sandbox cleanup incomplete '+table);
    }
    console.log('PASS P6-1 isolated DB 0 orders/0 items');
   }
   await pool.end();
  }
  await boot.end();
 }
}
void main().catch(e=>{console.error('P6-1 sandbox:',e instanceof Error?e.message:'unknown');process.exitCode=1;});
