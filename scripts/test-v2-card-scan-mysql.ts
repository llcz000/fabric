/**
 * B2-3 single-master real MySQL 8 isolated scan transaction test (not executed in this delivery). NEVER production.
 * Execute only with FABRIC_V2_ISOLATED_TEST=I_ACKNOWLEDGE_SANDBOX.
 * Database is a FIXED new sandbox, not inferred from .env or a CLI argument.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createConnection,createPool,type Pool} from 'mysql2/promise';
import {initializeV2ProductMasterSchema,getV2ProductMasterCreateStatements} from '../server/product-master/schema';
import {initializeAccessSchema} from '../server/access/schema';
import {initializeSampleSchema,getSampleSchemaStatements,requireIsolatedSampleSchemaTarget} from '../server/customer-samples/schema';
import {createSampleCard} from '../server/customer-samples/cardLibrary';
import {persistSampleCardScan,SampleScanError,type SamplePool,type SampleTx} from '../server/customer-samples/scanRepository';
import type {AppPrincipal} from '../server/access/types';
const DB='fabric_v2_test_20261012_b2samples';
const ACK=process.env.FABRIC_V2_ISOLATED_TEST??'';
requireIsolatedSampleSchemaTarget(DB,ACK);
const sock='/var/run/mysqld/mysqld.sock';
const safeTables=new Set(['image_assets','v2_access_users','v2_access_sessions',
 ...getV2ProductMasterCreateStatements().map(x=>x.name),...getSampleSchemaStatements().map(x=>x.name)]);
type Row=Record<string,unknown>;
const rows=(data:unknown):Row[]=>{if(!Array.isArray(data))throw Error('Unexpected rowset');return data as Row[];};
const inserted=(data:unknown)=>String((data as {insertId:unknown}).insertId);
async function add(db:Pool,sql:string,params:unknown[]=[]):Promise<string>{
 const [result]=await db.query(sql,params);return inserted(result);
}
const principal=(userId:string,sessionId:string,role:'admin'|'sales'='sales'):AppPrincipal=>({
 userId,username:'test-user',displayName:'Synthetic user',role,canManageOwnOrders:false,
 canManageProducts:false,sessionId
});
async function count(db:Pool,table:string,condition='1=1',params:unknown[]=[]):Promise<number>{
 if(!safeTables.has(table))throw Error('Unknown count table');
 const [r]=await db.query('SELECT COUNT(*) AS total FROM '+table+' WHERE '+condition,params);
 return Number(rows(r)[0]?.total);
}
async function cleanFixtures(db:Pool):Promise<void>{
 const list=['customer_sample_item_sources','customer_sample_items','customer_sample_scan_events',
  'customer_sample_selected_cards','customer_sample_session_access','customer_sample_sessions',
  'sample_card_tokens','sample_cards','v2_products',
  'pattern_colorways','pattern_masters','v2_fabrics','v2_access_sessions','v2_access_users'];
 for(const table of list){
  if(!safeTables.has(table))throw Error('Unexpected cleanup table');
  await db.query('DELETE FROM '+table);
 }
}
async function main(){
 const root=await createConnection({user:'root',socketPath:sock});
 let db:Pool|undefined;let owned=false;
 try{
  const [prior]=await root.query('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=?',[DB]);
  const existing=rows(prior).map(x=>String(x.TABLE_NAME));
  if(existing.includes('sample_card_pattern_scopes')||
   existing.some(t=>getSampleSchemaStatements().some(definition=>definition.name===t)))
   throw Error('Existing sample schema requires an explicit drift/migration gate; refuse to modify');
  if(existing.some(t=>!safeTables.has(t)))throw Error('Sandbox contains foreign tables; refuse to modify');
  await root.query('CREATE DATABASE IF NOT EXISTS '+DB+' CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
  db=createPool({user:'root',socketPath:sock,database:DB,connectionLimit:8});
  // Schema bootstrap only if no existing data in any of the known tables.
  for(const table of existing)assert.equal(await count(db,table),0,'Sandbox not empty: '+table);
  await db.query("CREATE TABLE IF NOT EXISTS image_assets(id VARCHAR(36) PRIMARY KEY,ref_count INT UNSIGNED NOT NULL DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  await initializeV2ProductMasterSchema(db);
  await initializeAccessSchema(db);
  await initializeSampleSchema(db,DB,ACK);
  for(const table of safeTables)assert.equal(await count(db,table),0,'Sandbox table not empty: '+table);
  owned=true;
  const sales=await add(db,"INSERT INTO v2_access_users(username,username_normalized,display_name,password_hash,role) VALUES ('b2sales','b2sales','B2 Sales','TEST ONLY','sales')");
  const otherSales=await add(db,"INSERT INTO v2_access_users(username,username_normalized,display_name,password_hash,role) VALUES ('b2other','b2other','B2 Other','TEST ONLY','sales')");
  const admin=await add(db,"INSERT INTO v2_access_users(username,username_normalized,display_name,password_hash,role) VALUES ('b2admin','b2admin','B2 Admin','TEST ONLY','admin')");
  async function login(userId:string):Promise<string>{
   const hash=createHash('sha256').update('B2 SYNTHETIC LOGIN '+userId).digest('hex');
   return add(db!,'INSERT INTO v2_access_sessions(user_id,token_hash,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',
    [userId,hash]);
  }
  const salesLogin=await login(sales),otherLogin=await login(otherSales),adminLogin=await login(admin);
  const master=await add(db,"INSERT INTO pattern_masters(master_no) VALUES ('B2A')");
  const otherMaster=await add(db,"INSERT INTO pattern_masters(master_no) VALUES ('B2B')");
  const f=await add(db,"INSERT INTO v2_fabrics(fabric_no,fabric_name,composition,weight_value,weight_unit,width_value) VALUES ('BF23','Silk','100% Silk',16,'mm',140)");
  const otherFabric=await add(db,"INSERT INTO v2_fabrics(fabric_no,fabric_name) VALUES ('BF35','Cotton')");
  async function product(m:string,fabric:string,no:number):Promise<string>{
   const color=await add(db!,'INSERT INTO pattern_colorways(master_id,colorway_no) VALUES (?,?)',[m,no]);
   return add(db!,'INSERT INTO v2_products(pattern_colorway_id,fabric_id,product_no) VALUES (?,?,?)',
    [color,fabric,'B2'+m+'C'+no+'F'+fabric]);
  }
  const a=await product(master,f,1),b=await product(master,f,2);
  const excludedFabric=await product(master,otherFabric,3);
  const excludedMaster=await product(otherMaster,f,1);
  const actor=principal(sales,salesLogin);
  const managementPolicy=(user:AppPrincipal)=>user.role==='admin'||user.role==='sales';
  const createdCards=await Promise.all([
   createSampleCard(db as unknown as SamplePool,actor,{masterId:master,fabricId:f},managementPolicy),
   createSampleCard(db as unknown as SamplePool,actor,{masterId:master,fabricId:f},managementPolicy)
  ]);
  assert.deepEqual(createdCards.map(result=>result.created).sort(),[false,true]);
  assert.equal(createdCards[0].card.id,createdCards[1].card.id);
  assert.equal(createdCards[0].card.qrPayload,createdCards[1].card.qrPayload);
  assert.equal(createdCards[0].card.cardNo,'B2A-BF23');
  assert.equal(await count(db,'sample_cards'),1);
  assert.equal(await count(db,'sample_card_tokens'),1);
  const card=createdCards[0].card.id,token=createdCards[0].card.qrPayload;
  const [storedToken]=await db.query('SELECT token_hash FROM sample_card_tokens WHERE card_id=?',[card]);
  assert.equal(rows(storedToken)[0]?.token_hash,createHash('sha256').update(token).digest('hex'));
  console.log('PASS B2-3 MySQL concurrent combination creates one card with stable scan-compatible payload');
  const session=await add(db,"INSERT INTO customer_sample_sessions(customer_reference,created_by_user_id) VALUES ('TEST CUSTOMER',?)",[sales]);
  await db.query('INSERT INTO customer_sample_session_access(session_id,user_id,can_manage) VALUES (?,?,1)',[session,sales]);
  const request={cardToken:token,sessionId:session};
  const first=await persistSampleCardScan(db as unknown as SamplePool,actor,request);
  assert.deepEqual(first.resolvedProductIds,[a,b]);
  assert.deepEqual(first.addedProductIds,[a,b]);
  assert.equal(first.selectedCardCount,1);
  assert(!first.resolvedProductIds.includes(excludedFabric));
  assert(!first.resolvedProductIds.includes(excludedMaster));
  assert.equal(await count(db,'customer_sample_items'),2);
  assert.equal(await count(db,'customer_sample_scan_events'),1);
  console.log('PASS B2-2 MySQL 8 same-fabric scope, two colorways, excluded other fabric/master');
  const [beforeRaw]=await db.query('SELECT product_id FROM customer_sample_items WHERE session_id=? AND product_id=?',[session,a]);
  assert.equal(String(rows(beforeRaw)[0]?.product_id),a);
  await db.query("UPDATE v2_fabrics SET composition='NEW MASTER VALUE' WHERE id=?",[f]);
  const repeat=await persistSampleCardScan(db as unknown as SamplePool,actor,request);
  assert.deepEqual(repeat.addedProductIds,[]);
  const c=await product(master,f,4);
  const third=await persistSampleCardScan(db as unknown as SamplePool,actor,request);
  assert.deepEqual(third.addedProductIds,[c]);
  assert.equal(third.selectedCardCount,1);
  const [afterRaw]=await db.query('SELECT product_id FROM customer_sample_items WHERE session_id=? AND product_id=?',[session,a]);
  assert.equal(String(rows(afterRaw)[0]?.product_id),a);
  assert.equal(await count(db,'customer_sample_scan_events'),3);
  console.log('PASS B2-2 MySQL rescan with new colorway, no duplicated card or selected identity');
  await assert.rejects(persistSampleCardScan(db as unknown as SamplePool,principal(admin,adminLogin,'admin'),request),SampleScanError);
  await assert.rejects(persistSampleCardScan(db as unknown as SamplePool,principal(otherSales,otherLogin),request),SampleScanError);
  await db.query('UPDATE customer_sample_session_access SET can_manage=0 WHERE session_id=? AND user_id=?',[session,sales]);
  await assert.rejects(persistSampleCardScan(db as unknown as SamplePool,actor,request),SampleScanError);
  assert.equal(await count(db,'customer_sample_scan_events'),3);
  await db.query('UPDATE customer_sample_session_access SET can_manage=1 WHERE session_id=? AND user_id=?',[session,sales]);
  console.log('PASS B2-2 MySQL explicit grant revocation, cross-user and admin denied');
  async function rejectStalePrincipal(staleActor=actor):Promise<void>{
   const tables=['customer_sample_items','customer_sample_selected_cards',
    'customer_sample_scan_events','customer_sample_item_sources'];
   const before=await Promise.all(tables.map(t=>count(db!,t)));
   await assert.rejects(persistSampleCardScan(db as unknown as SamplePool,staleActor,request),
    (error:unknown)=>error instanceof SampleScanError&&error.status===403);
   assert.deepEqual(await Promise.all(tables.map(t=>count(db!,t))),before,
    'Stale login must not produce any sample records');
   const [selectedRaw]=await db!.query('SELECT product_id FROM customer_sample_items WHERE session_id=? AND product_id=?',[session,a]);
   assert.equal(String(rows(selectedRaw)[0]?.product_id),a);
  }
  // Reuse a previously authorized principal to exercise revocation races:
  // the transaction must re-read real login/account state, not its HTTP copy.
  await db.query('UPDATE v2_access_sessions SET revoked_at=UTC_TIMESTAMP() WHERE id=?',[salesLogin]);
  await rejectStalePrincipal();
  await db.query('UPDATE v2_access_sessions SET revoked_at=NULL,expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE id=?',[salesLogin]);
  await rejectStalePrincipal();
  await db.query('UPDATE v2_access_sessions SET expires_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR),user_id=? WHERE id=?',[otherSales,salesLogin]);
  await rejectStalePrincipal();
  await db.query('UPDATE v2_access_sessions SET user_id=? WHERE id=?',[sales,salesLogin]);
  await rejectStalePrincipal({...actor,sessionId:'18446744073709551615'});
  await db.query('UPDATE v2_access_users SET is_active=0 WHERE id=?',[sales]);
  await rejectStalePrincipal();
  await db.query("UPDATE v2_access_users SET is_active=1,role='admin' WHERE id=?",[sales]);
  await rejectStalePrincipal();
  await db.query("UPDATE v2_access_users SET role='sales' WHERE id=?",[sales]);
  console.log('PASS B2-2 MySQL stale principal rejects revoked/expired/foreign/missing login and disabled/changed account');
  // Parallel same-card scans for a new colorway must serialize on the session lock.
  const d=await product(master,f,5);
  const concurrent=await Promise.all([
   persistSampleCardScan(db as unknown as SamplePool,actor,request),
   persistSampleCardScan(db as unknown as SamplePool,actor,request)
  ]);
  assert.deepEqual(concurrent.map(x=>x.addedProductIds.length).sort(),[0,1]);
  assert.equal(concurrent.filter(x=>x.addedProductIds.includes(d)).length,1);
  assert.equal(await count(db,'customer_sample_items','session_id=? AND product_id=?',[session,d]),1);
  assert.equal(await count(db,'customer_sample_scan_events'),5);
  console.log('PASS B2-2 MySQL parallel scans serialized with unique product and audit events');
  // SQL UNIQUE/FK protect data even from a buggy concurrent writer.
  await assert.rejects(db.query('INSERT INTO customer_sample_items(session_id,product_id,selected_by_user_id) VALUES (?,?,?)',
   [session,d,sales]),/duplicate|ER_DUP_ENTRY/i);
  await assert.rejects(db.query('INSERT INTO customer_sample_items(session_id,product_id,selected_by_user_id) VALUES (?,?,?)',
   [session,'999999999',sales]),/foreign key|ER_NO_REFERENCED_ROW/i);
  console.log('PASS B2-2 DB unique index and product FK fail closed');
  const otherSession=await add(db,"INSERT INTO customer_sample_sessions(customer_reference,created_by_user_id) VALUES ('TEST ROLLBACK',?)",[sales]);
  await db.query('INSERT INTO customer_sample_session_access(session_id,user_id,can_manage) VALUES (?,?,1)',[otherSession,sales]);
  const failingId=b;
  const injectedPool:SamplePool={getConnection:async()=>{
   const underlying=await db!.getConnection();
   return {
    beginTransaction:()=>underlying.beginTransaction(),commit:()=>underlying.commit(),
    rollback:()=>underlying.rollback(),release:()=>underlying.release(),
    async query(sql:string,params?:unknown[]){
     if(sql.startsWith('INSERT INTO customer_sample_items')&&String(params?.[1])===failingId)
      throw Error('TEST ONLY mid-transaction failure');
     return underlying.query(sql,params);
    }
   } as SampleTx;
  }};
  await assert.rejects(persistSampleCardScan(injectedPool,actor,{...request,sessionId:otherSession}),
   /TEST ONLY mid-transaction failure/);
  assert.equal(await count(db,'customer_sample_scan_events','session_id=?',[otherSession]),0);
  assert.equal(await count(db,'customer_sample_selected_cards','session_id=?',[otherSession]),0);
  assert.equal(await count(db,'customer_sample_items','session_id=?',[otherSession]),0);
  console.log('PASS B2-2 MySQL rollback after mid-write failure leaves zero event/cards/items');
  // Inactive matching product: do not silently discard it until disposition policy is approved.
  await db.query('UPDATE v2_products SET is_active=0 WHERE id=?',[d]);
  await assert.rejects(persistSampleCardScan(db as unknown as SamplePool,actor,request),SampleScanError);
  assert.equal(await count(db,'customer_sample_scan_events'),5);
  console.log('PASS B2-2 inactive product explicit conflict; no partial scan commit');
  // Two workload connections exercise candidate availability locks. Gates
  // pause the real scan at its SQL boundary; no sleep or application retry.
  await db.query('UPDATE v2_products SET is_active=1 WHERE id=?',[d]);
  const lockSession=await add(db,"INSERT INTO customer_sample_sessions(customer_reference,created_by_user_id) VALUES ('TEST AVAILABILITY LOCKS',?)",[sales]);
  await db.query('INSERT INTO customer_sample_session_access(session_id,user_id,can_manage) VALUES (?,?,1)',[lockSession,sales]);
  const lockRequest={...request,sessionId:lockSession};
  const [colorRaw]=await db.query('SELECT pattern_colorway_id FROM v2_products WHERE id=?',[d]);
  const colorId=String(rows(colorRaw)[0]?.pattern_colorway_id);
  function gate(){
   let open!:()=>void;
   const promise=new Promise<void>(resolve=>{open=resolve;});
   return {promise,open};
  }
  function pausedScanPool(phase:'before'|'after',arrived:()=>void,resume:Promise<void>):SamplePool{
   return {getConnection:async()=>{
    const connection=await db!.getConnection();
    try{await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');}
    catch(error){connection.release();throw error;}
    return {
     beginTransaction:()=>connection.beginTransaction(),commit:()=>connection.commit(),
     rollback:()=>connection.rollback(),release:()=>connection.release(),
     async query(sql:string,params?:unknown[]){
      const candidate=sql.includes('FROM v2_products p');
      if(candidate&&phase==='before'){arrived();await resume;}
      const result=await connection.query(sql,params);
      if(candidate&&phase==='after'){arrived();await resume;}
      return result;
     }
    } as SampleTx;
   }};
  }
  const updateConnection=await db.getConnection();
  try{
   await updateConnection.query('SET SESSION innodb_lock_wait_timeout=1');
   const read=gate(),resume=gate();
   const scan=persistSampleCardScan(pausedScanPool('after',read.open,resume.promise),actor,lockRequest);
   try{
    await Promise.race([read.promise,scan.then(()=>{throw Error('Scan committed before lock boundary');})]);
    await updateConnection.beginTransaction();
    for(const [table,id] of [['v2_products',d],['pattern_colorways',colorId],
     ['pattern_masters',master],['v2_fabrics',f]]){
     assert(safeTables.has(table));
     await assert.rejects(updateConnection.query('SELECT id FROM '+table+' WHERE id=? FOR UPDATE NOWAIT',[id]),
      (error:unknown)=>Boolean(error&&typeof error==='object'&&'code' in error&&error.code==='ER_LOCK_NOWAIT'));
    }
    await assert.rejects(updateConnection.query('UPDATE v2_products SET is_active=0 WHERE id=?',[d]),
     (error:unknown)=>Boolean(error&&typeof error==='object'&&'code' in error&&error.code==='ER_LOCK_WAIT_TIMEOUT'));
    await updateConnection.rollback();
    resume.open();
    assert((await scan).addedProductIds.includes(d));
    // Once the scan commits, the previously blocked disable may commit.
    await updateConnection.beginTransaction();
    await updateConnection.query('UPDATE v2_products SET is_active=0 WHERE id=?',[d]);
    await updateConnection.commit();
    assert.equal(await count(db,'customer_sample_items','session_id=? AND product_id=?',[lockSession,d]),1);
    await assert.rejects(persistSampleCardScan(db as unknown as SamplePool,actor,lockRequest),
     (error:unknown)=>error instanceof SampleScanError&&error.status===409);
    assert.equal(await count(db,'customer_sample_scan_events','session_id=?',[lockSession]),1);
   }finally{
    resume.open();await updateConnection.rollback();await Promise.allSettled([scan]);
   }
   console.log('PASS B2-2 MySQL four-level shared locks block disable through scan commit');
   await db.query('UPDATE v2_products SET is_active=1 WHERE id=?',[d]);
   const rejectSession=await add(db,"INSERT INTO customer_sample_sessions(customer_reference,created_by_user_id) VALUES ('TEST CURRENT AVAILABILITY',?)",[sales]);
   await db.query('INSERT INTO customer_sample_session_access(session_id,user_id,can_manage) VALUES (?,?,1)',[rejectSession,sales]);
   const beforeCandidates=gate(),resumeCandidates=gate();
   const rejectedScan=persistSampleCardScan(pausedScanPool('before',beforeCandidates.open,resumeCandidates.promise),
    actor,{...request,sessionId:rejectSession});
   try{
    // A concurrent committed disable before the candidate locking read
    // must be seen by FOR SHARE; no retired multi-master scope is consulted.
    await Promise.race([beforeCandidates.promise,rejectedScan.then(()=>{throw Error('Scan committed before candidate boundary');})]);
    await updateConnection.beginTransaction();
    await updateConnection.query('UPDATE v2_products SET is_active=0 WHERE id=?',[d]);
    await updateConnection.commit();
    resumeCandidates.open();
    await assert.rejects(rejectedScan,(error:unknown)=>error instanceof SampleScanError&&error.status===409);
    for(const table of ['customer_sample_items','customer_sample_selected_cards',
     'customer_sample_scan_events','customer_sample_item_sources'])
     assert.equal(await count(db,table,'session_id=?',[rejectSession]),0);
   }finally{
    resumeCandidates.open();await updateConnection.rollback();await Promise.allSettled([rejectedScan]);
   }
   console.log('PASS B2-2 MySQL current locking read rejects concurrent committed disable despite earlier snapshot');
  }finally{updateConnection.release();}
  console.log('B2_SAMPLE_MYSQL_ISOLATED_PASS');
 }finally{
  if(db){
   if(owned)await cleanFixtures(db);
   await db.end();
  }
  await root.end();
 }
}
main().catch(e=>{console.error('B2 isolated failure',e instanceof Error?e.message:String(e));process.exitCode=1;});
