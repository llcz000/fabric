/** P3-2a future real-MySQL acceptance. This script is NOT run automatically.
 * Fixed disposable database, empty/foreign-table guards, actual connection
 * target checks. Never targets fabric_db. No migrations or production cutover.
 */
import assert from 'node:assert/strict';
import {createConnection,createPool,type Pool} from 'mysql2/promise';
import {getV2ProductMasterCreateStatements,initializeV2ProductMasterSchema} from '../server/product-master/schema';
import {initializeAccessSchema} from '../server/access/schema';
import {hashPassword} from '../server/access/password';
import {createAuthenticatedSession,resolvePrincipalFromToken} from '../server/access/sessions';
import {createColorway,listColorways,updateColorway,deleteColorway,ColorwayIdentityError} from '../server/product-master/colorwayIdentity';

const DB='fabric_v2_test_20261013_p3identity';
if(process.env.FABRIC_V2_ISOLATED_TEST!=='I_ACKNOWLEDGE_SANDBOX')throw Error('P3 identity sandbox acknowledgment required');
const allowed=new Set(['image_assets','v2_access_users','v2_access_sessions',...getV2ProductMasterCreateStatements().map(t=>t.name)]);
const rowSet=(raw:unknown):Record<string,unknown>[]=>{if(!Array.isArray(raw))throw Error('Invalid SQL rows');return raw as Record<string,unknown>[];};
const socketPath='/var/run/mysqld/mysqld.sock';
async function main(){
 const root=await createConnection({user:'root',socketPath});let pool:Pool|undefined,seeded=false;
 try{
  const [previous]=await root.query('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=?',[DB]);
  if(rowSet(previous).some(row=>!allowed.has(String(row.TABLE_NAME))))throw Error('Foreign sandbox tables detected');
  // Read-only preflight precedes ALL DDL: never initialize an occupied sandbox.
  // Identifiers come exclusively from the fixed allowed-table manifest above.
  for(const row of rowSet(previous)){
   const table=String(row.TABLE_NAME);
   const [raw]=await root.query('SELECT COUNT(*) AS n FROM '+DB+'.'+table);
   assert.equal(Number(rowSet(raw)[0].n),0,'Nonempty sandbox before DDL: '+table);
  }
  await root.query('CREATE DATABASE IF NOT EXISTS '+DB+' CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
  pool=createPool({user:'root',socketPath,database:DB,connectionLimit:12,supportBigNumbers:true,bigNumberStrings:true});
  const [target]=await pool.query('SELECT DATABASE() AS current_database');
  assert.equal(rowSet(target)[0]?.current_database,DB,'Actual pool database mismatch');
  await pool.query('CREATE TABLE IF NOT EXISTS image_assets(id VARCHAR(36) PRIMARY KEY,ref_count INT UNSIGNED NOT NULL DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
  await initializeV2ProductMasterSchema(pool);await initializeAccessSchema(pool);
  for(const table of allowed){const [raw]=await pool.query('SELECT COUNT(*) AS n FROM '+table);assert.equal(Number(rowSet(raw)[0].n),0,'Nonempty sandbox: '+table);}
  seeded=true;
  const hash=await hashPassword('test-only-p3-identity-password');
  const [account]=await pool.query("INSERT INTO v2_access_users(username,username_normalized,display_name,password_hash,role,can_manage_products) VALUES ('identity_admin','identity_admin','Test',?,'admin',0)",[hash]);
  const userId=String((account as {insertId:unknown}).insertId);
  const issued=await createAuthenticatedSession(pool,userId,3600);
  const actor=await resolvePrincipalFromToken(pool,issued.token);assert(actor);
  // Every mutation obtains a checked actual connection, including concurrent calls.
  const checkedPool={async getConnection(){
   const connection=await pool!.getConnection();
   try{const [raw]=await connection.query('SELECT DATABASE() AS current_database');assert.equal(rowSet(raw)[0]?.current_database,DB);return connection;}
   catch(error){connection.release();throw error;}
  }};
  const [master]=await pool.query("INSERT INTO pattern_masters(master_no) VALUES ('1234')");
  const masterId=String((master as {insertId:unknown}).insertId);
  const first=await createColorway(checkedPool,actor,masterId,{});assert.equal(first.colorwayNo,1);
  // Genuine SQL duplicate forces failure AFTER counter update. The transaction
  // must roll back both changes; a fixture repair then resumes approved sequence.
  await pool.query('UPDATE pattern_masters SET next_colorway_no=1 WHERE id=?',[masterId]);
  await assert.rejects(createColorway(checkedPool,actor,masterId,{}));
  assert.equal((await listColorways(pool,masterId)).nextColorwayNo,1);
  assert.equal((await listColorways(pool,masterId)).items.length,1);
  await pool.query('UPDATE pattern_masters SET next_colorway_no=2 WHERE id=?',[masterId]);
  const second=await createColorway(checkedPool,actor,masterId,{});
  const third=await createColorway(checkedPool,actor,masterId,{});
  assert.equal(second.colorwayNo,2);assert.equal(third.colorwayNo,3);
  await deleteColorway(checkedPool,actor,second.id);
  await updateColorway(checkedPool,actor,first.id,{isActive:false,remark:'retained identity'});
  assert.equal((await createColorway(checkedPool,actor,masterId,{})).colorwayNo,4);
  const simultaneous=await Promise.all(Array.from({length:12},()=>createColorway(checkedPool,actor,masterId,{})));
  assert.deepEqual(simultaneous.map(item=>item.colorwayNo).sort((a,b)=>a-b),[5,6,7,8,9,10,11,12,13,14,15,16]);
  const current=await listColorways(pool,masterId);assert.equal(current.nextColorwayNo,17);
  assert.equal(new Set(current.items.map(item=>item.colorwayNo)).size,15);
  await assert.rejects(updateColorway(checkedPool,actor,third.id,{colorwayNo:88}),e=>e instanceof ColorwayIdentityError&&e.status===400);
  const [fabric]=await pool.query("INSERT INTO v2_fabrics(fabric_no,fabric_name) VALUES ('S23','Synthetic fabric')");
  await pool.query('INSERT INTO v2_products(pattern_colorway_id,fabric_id,product_no) VALUES (?,?,?)',[third.id,(fabric as {insertId:unknown}).insertId,'1234-3-S23']);
  await assert.rejects(deleteColorway(checkedPool,actor,third.id),e=>e instanceof ColorwayIdentityError&&e.status===409);
  const assetId='11111111-1111-4111-8111-111111111111';
  await pool.query('INSERT INTO image_assets(id,ref_count) VALUES (?,1)',[assetId]);
  await pool.query('UPDATE pattern_colorways SET pattern_image_asset_id=? WHERE id=?',[assetId,first.id]);
  await assert.rejects(deleteColorway(checkedPool,actor,first.id),e=>e instanceof ColorwayIdentityError&&e.status===409);
  await pool.query('UPDATE v2_access_users SET is_active=0 WHERE id=?',[userId]);
  await assert.rejects(createColorway(checkedPool,actor,masterId,{}),e=>e instanceof ColorwayIdentityError&&e.status===401);
  assert.equal((await listColorways(pool,masterId)).nextColorwayNo,17);
  console.log('P3_IDENTITY_REAL_MYSQL_ISOLATED_PASS database='+DB+' concurrent=12');
 }finally{
  if(pool){
   if(seeded){
    const [target]=await pool.query('SELECT DATABASE() AS current_database');assert.equal(rowSet(target)[0]?.current_database,DB,'Cleanup target mismatch');
    for(const table of ['v2_access_sessions','v2_access_users','v2_product_image_assets','v2_products','pattern_master_tag_links','pattern_colorway_tag_links','pattern_colorways','pattern_masters','v2_fabrics','shared_tags','image_assets'])await pool.query('DELETE FROM '+table);
    for(const table of allowed){const [raw]=await pool.query('SELECT COUNT(*) AS n FROM '+table);assert.equal(Number(rowSet(raw)[0].n),0,'Incomplete sandbox cleanup: '+table);}
    console.log('P3_IDENTITY_SANDBOX_CLEAN_ZERO');
   }
   await pool.end();
  }
  await root.end();
 }
}
void main().catch(error=>{console.error('P3 identity isolated failure',error instanceof Error?error.message:'unknown');process.exitCode=1;});
