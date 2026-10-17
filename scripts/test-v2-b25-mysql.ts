/**
 * B2-5f REAL MySQL 8 acceptance harness — NEVER run against customer data.
 * Requires fresh FIXED DB and explicit environmental acknowledgment.
 * The only allowed CREATE DATABASE target is guarded below; existing DB = STOP,
 * including databases with zero rows. It intentionally does not DROP/DELETE
 * anything, even after a failed test. Run only on authorized isolated MySQL.
 *
 * On the local Windows workstation run only TS lint/static/unit checks. This
 * harness needs a remote Linux MySQL socket and explicit isolated-write approval.
 */
import assert from 'node:assert/strict';
import {createConnection,createPool,type Pool} from 'mysql2/promise';
import type {AppPrincipal} from '../server/access/types';
import {hashSessionToken} from '../server/access/password';
import {initializeV2ProductMasterSchema} from '../server/product-master/schema';
import {verifyV2SchemaContract} from '../server/product-master/schemaContract';
import {initializeAccessSchema} from '../server/access/schema';
import {getSampleSchemaStatements} from '../server/customer-samples/schema';
import {verifyB25SampleSchemaContract} from '../server/customer-samples/schemaContract';
import {createSampleCard,retireSampleCard,confirmSampleCardReprinted,
 listSampleCards,SampleCardError} from '../server/customer-samples/cardLibrary';
import {persistSampleCardScan,SampleScanError,type SamplePool} from '../server/customer-samples/scanRepository';
import {updateFabric} from '../server/product-master/fabrics';
import {createV2Product,updateV2Product,V2ProductError} from '../server/product-master/productsV2';
import {assertFreshB25SandboxTarget,assertB25ConnectedSandbox,requireB25ExpectedServerUuid,B25_SANDBOX_NAME} from './b25SandboxGuard';

const ACK='I_ACKNOWLEDGE_B25_DISPOSABLE_TEST';
const socket='/var/run/mysqld/mysqld.sock';
type DbRows=Record<string,unknown>[];
const lines=(r:unknown):DbRows=>{assert(Array.isArray(r));return r as DbRows;};
const actor=(userId:string,sessionId:string,role:'admin'|'sales'):AppPrincipal=>({
 userId,sessionId,role,username:'b25-test',displayName:'Synthetic',
 canManageOwnOrders:false,canManageProducts:true
});
const allowCard=(a:AppPrincipal)=>a.role==='admin'||a.role==='sales';
async function insert(pool:Pool,sql:string,values:unknown[]=[]):Promise<string>{
 const [response]=await pool.query(sql,values);
 return String((response as {insertId:number}).insertId);
}
async function total(pool:Pool,table:string):Promise<number>{
 const allowed=new Set(['sample_cards','sample_card_tokens','customer_sample_items',
  'customer_sample_scan_events','customer_sample_selected_cards','customer_sample_item_sources']);
 if(!allowed.has(table))throw Error('B2-5 count target not allowed');
 const [r]=await pool.query('SELECT COUNT(*) AS n FROM '+table);
 return Number(lines(r)[0].n);
}
async function cardRevision(pool:Pool,id:string):Promise<{current:string;printed:string;deleted:boolean}>{
 const [r]=await pool.query('SELECT reprint_revision,printed_revision,deleted_at FROM sample_cards WHERE id=?',[id]);
 const x=lines(r)[0];assert(x);
 return {current:String(x.reprint_revision),printed:String(x.printed_revision),deleted:x.deleted_at!=null};
}
async function main():Promise<void>{
 // No getConnection/DDL until this env gate passes.
 if(process.env.FABRIC_V2_B25_LIVE_TEST!==ACK)
  throw Error('Explicit B2-5 disposable isolated write-test acknowledgment required');
 // Require the independently pinned MySQL server UUID BEFORE connecting.
 const expectedUuid=requireB25ExpectedServerUuid(process.env.FABRIC_V2_B25_EXPECTED_SERVER_UUID);
 const root=await createConnection({user:'root',socketPath:socket,multipleStatements:false});
 let pool:Pool|undefined;
 try{
  const target=await assertFreshB25SandboxTarget(root,process.env.FABRIC_V2_B25_LIVE_TEST,expectedUuid);
  assert.equal(target,B25_SANDBOX_NAME);
  // Non-idempotent by design: even an existing EMPTY sandbox refuses to be overwritten.
  await root.query('CREATE DATABASE `'+target+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
  pool=createPool({user:'root',socketPath:socket,database:target,connectionLimit:8,
   supportBigNumbers:true,bigNumberStrings:true,multipleStatements:false});
  // Validate pooled connection server identity and schema before DDL.
  await assertB25ConnectedSandbox(pool,expectedUuid);
  await pool.query(`CREATE TABLE image_assets (
   id VARCHAR(36) NOT NULL PRIMARY KEY,
   ref_count INT UNSIGNED NOT NULL DEFAULT 0,
   status ENUM('ready','recycled') NOT NULL DEFAULT 'ready',
   recycled_at DATETIME NULL,purge_after DATETIME NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await initializeV2ProductMasterSchema(pool);
  await initializeAccessSchema(pool);
  // The original B2-3 schema initializer is deliberately locked to a
  // different historical test DB. Never broaden that gate; initialize only
  // this newly created, attested disposable DB on ONE physical connection.
  const bootstrap=await pool.getConnection();
  try{
   await assertB25ConnectedSandbox(bootstrap,expectedUuid);
   for(const {sql} of getSampleSchemaStatements())await bootstrap.query(sql);
  }finally{bootstrap.release();}
  await verifyV2SchemaContract(pool);
  await verifyB25SampleSchemaContract(pool);
  // No synthetic insert may happen until actual MySQL metadata passes.
  const adminId=await insert(pool,`INSERT INTO v2_access_users
   (username,username_normalized,display_name,password_hash,role,can_manage_products)
   VALUES ('b25admin','b25admin','B25 synthetic admin','TEST ONLY','admin',1)`);
  const salesId=await insert(pool,`INSERT INTO v2_access_users
   (username,username_normalized,display_name,password_hash,role,can_manage_products)
   VALUES ('b25sales','b25sales','B25 synthetic sales','TEST ONLY','sales',1)`);
  const login=async(id:string)=>insert(pool!,`INSERT INTO v2_access_sessions
   (user_id,token_hash,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 2 HOUR))`,
   [id,hashSessionToken('B25_Synthetic_session_'+id)]);
  const admin=actor(adminId,await login(adminId),'admin'),sales=actor(salesId,await login(salesId),'sales');
  const master1=await insert(pool,"INSERT INTO pattern_masters(master_no) VALUES ('B25A')");
  const master2=await insert(pool,"INSERT INTO pattern_masters(master_no) VALUES ('B25B')");
  const fabric=await insert(pool,`INSERT INTO v2_fabrics
   (fabric_no,fabric_name,composition,weight_value,weight_unit,width_value)
   VALUES ('B25F','Silk','100% silk',16,'mm',140)`);
  const c1=await insert(pool,'INSERT INTO pattern_colorways(master_id,colorway_no) VALUES (?,1)',[master1]);
  const c2=await insert(pool,'INSERT INTO pattern_colorways(master_id,colorway_no) VALUES (?,2)',[master1]);
  const c3=await insert(pool,'INSERT INTO pattern_colorways(master_id,colorway_no) VALUES (?,1)',[master2]);
  const p1=await createV2Product(pool,admin,{patternColorwayId:c1,fabricId:fabric});
  const p2=await createV2Product(pool,admin,{patternColorwayId:c2,fabricId:fabric,isAvailableForSampling:false});
  await createV2Product(pool,admin,{patternColorwayId:c3,fabricId:fabric});
  const {card:first}=await createSampleCard(pool as SamplePool,sales,{masterId:master1,fabricId:fabric},allowCard);
  const {card:other}=await createSampleCard(pool as SamplePool,sales,{masterId:master2,fabricId:fabric},allowCard);
  assert.equal((await createSampleCard(pool as SamplePool,sales,{masterId:master1,fabricId:fabric},allowCard)).created,false);
  const sampleSession=await insert(pool,`INSERT INTO customer_sample_sessions
   (customer_reference,created_by_user_id) VALUES ('B25 SYNTHETIC CUSTOMER',?)`,[salesId]);
  await pool.query('INSERT INTO customer_sample_session_access(session_id,user_id,can_manage) VALUES (?,?,1)',[sampleSession,salesId]);
  const input={cardToken:first.qrPayload,sessionId:sampleSession};
  const firstScan=await persistSampleCardScan(pool as SamplePool,sales,input);
  assert.deepEqual(firstScan.resolvedProductIds,[p1.id]);
  const selected=await pool.query('SELECT product_id FROM customer_sample_items WHERE session_id=? AND product_id=?',[sampleSession,p1.id]);
  assert.equal(String(lines(selected[0])[0]?.product_id),p1.id);
  const changed=await updateV2Product(pool,admin,p2.id,{expectedRowVersion:p2.rowVersion,isAvailableForSampling:true});
  assert.equal(changed.isAvailableForSampling,true);
  const again=await persistSampleCardScan(pool as SamplePool,sales,input);
  assert.deepEqual(again.addedProductIds,[p2.id]);
  await assert.rejects(updateV2Product(pool,admin,p2.id,{expectedRowVersion:p2.rowVersion,isAvailableForSampling:false}),
   (e:unknown)=>e instanceof V2ProductError&&e.status===409);
  await updateV2Product(pool,admin,p1.id,{expectedRowVersion:p1.rowVersion,isAvailableForSampling:false});
  await updateV2Product(pool,admin,p2.id,{expectedRowVersion:changed.rowVersion,isAvailableForSampling:false});
  const events=await total(pool,'customer_sample_scan_events');
  await assert.rejects(persistSampleCardScan(pool as SamplePool,sales,input),
   (e:unknown)=>e instanceof SampleScanError&&e.code==='NO_AVAILABLE_PRODUCTS');
  assert.equal(await total(pool,'customer_sample_scan_events'),events);
  assert.equal(await total(pool,'customer_sample_items'),2);
  const selectedAgain=await pool.query('SELECT product_id FROM customer_sample_items WHERE session_id=? AND product_id=?',[sampleSession,p1.id]);
  assert.equal(String(lines(selectedAgain[0])[0]?.product_id),p1.id);
  console.log('B2-5 MySQL AC-97 current-only sampling, row version, and historic selection PASS');

  await updateFabric(pool,admin,fabric,{composition:'90% silk 10% cotton'});
  for(const id of [first.id,other.id])assert.deepEqual(await cardRevision(pool,id),{current:'1',printed:'0',deleted:false});
  await updateFabric(pool,admin,fabric,{remark:'internal note only'});
  assert.equal((await cardRevision(pool,first.id)).current,'1','remark does not trigger reprint');
  await assert.rejects(confirmSampleCardReprinted(pool as SamplePool,sales,first.id,'0',allowCard),
   (e:unknown)=>e instanceof SampleCardError&&e.status===409);
  await confirmSampleCardReprinted(pool as SamplePool,sales,first.id,'1',allowCard);
  assert.equal((await cardRevision(pool,first.id)).printed,'1');
  await updateFabric(pool,admin,fabric,{fabricName:'New silk'});
  await assert.rejects(confirmSampleCardReprinted(pool as SamplePool,sales,first.id,'1',allowCard),
   (e:unknown)=>e instanceof SampleCardError&&e.status===409);
  assert.equal((await cardRevision(pool,first.id)).current,'2');
  assert.equal((await cardRevision(pool,first.id)).printed,'1');
  assert.equal((await listSampleCards(pool,{needsReprint:true})).total,2);
  console.log('B2-5 MySQL AC-98/99 multi-card reprint, no-op, CAS rejection PASS');

  await retireSampleCard(pool as SamplePool,sales,first.id,allowCard);
  const [staleRows]=await pool.query('SELECT revoked_at FROM sample_card_tokens WHERE card_id=?',[first.id]);
  assert(lines(staleRows)[0]?.revoked_at);
  await assert.rejects(persistSampleCardScan(pool as SamplePool,sales,input),
   (e:unknown)=>e instanceof SampleScanError&&e.status===404);
  const replacement=await createSampleCard(pool as SamplePool,sales,{masterId:master1,fabricId:fabric},allowCard);
  assert.equal(replacement.created,true);
  assert.notEqual(replacement.card.id,first.id);
  assert.notEqual(replacement.card.qrPayload,first.qrPayload);
  assert.equal(replacement.card.cardNo,first.cardNo);
  assert.equal(await total(pool,'customer_sample_items'),2);
  assert.equal(await total(pool,'customer_sample_selected_cards'),1);
  assert.equal((await listSampleCards(pool)).total,2);
  await assert.rejects(pool.query('DELETE FROM sample_cards WHERE id=?',[first.id]),/foreign key|referenced/i);
  console.log('B2-5 MySQL AC-96 old QR invalid, new QR unique, historical FK RESTRICT PASS');
  console.log('B25_REAL_MYSQL_DISPOSABLE_PASS');
 }finally{
  await pool?.end();
  await root.end();
  // No DROP, TRUNCATE, DELETE, deploy, migration or cleanup: disposable
  // schema remains evidence for an explicitly authorized later cleanup.
 }
}
main().catch(error=>{
 console.error('B25 real sandbox acceptance BLOCKED/FAILED (never auto-cleanup): '+
  (error instanceof Error?error.message:'unknown'));
 process.exitCode=1;
});
