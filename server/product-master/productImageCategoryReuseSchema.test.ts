import assert from 'node:assert/strict';
import test from 'node:test';
import {
 migrateProductImageCategoryReuse,verifyProductImageCategoryReuseSchema,
 PRODUCT_IMAGE_CATEGORY_REUSE_PLAN_SHA256
} from './productImageCategoryReuseSchema';

const target={database:'fabric_db',serverUuid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
const oldIndex=()=>[
 {INDEX_NAME:'uq_v2_product_active_asset',COLUMN_NAME:'product_id',NON_UNIQUE:0,SEQ_IN_INDEX:1},
 {INDEX_NAME:'uq_v2_product_active_asset',COLUMN_NAME:'active_asset_id',NON_UNIQUE:0,SEQ_IN_INDEX:2}
];
const newIndex=()=>[
 {INDEX_NAME:'uq_v2_product_active_asset',COLUMN_NAME:'product_id',NON_UNIQUE:0,SEQ_IN_INDEX:1},
 {INDEX_NAME:'uq_v2_product_active_asset',COLUMN_NAME:'role',NON_UNIQUE:0,SEQ_IN_INDEX:2},
 {INDEX_NAME:'uq_v2_product_active_asset',COLUMN_NAME:'active_asset_id',NON_UNIQUE:0,SEQ_IN_INDEX:3}
];
function fixture({interruptAfterAlter=false}={}){
 let current=oldIndex(),ledger:Record<string,unknown>|null=null,alterCount=0;
 const calls:string[]=[];
 const db={calls,async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  calls.push(sql);
  if(sql.includes('SELECT DATABASE()'))return [[{database_name:'fabric_db',server_uuid:target.serverUuid}],[]];
  if(sql.includes('GET_LOCK'))return [[{acquired:1}],[]];
  if(sql.includes('SELECT plan_sha256,applied_at'))return [ledger?[ledger]:[],[]];
  if(sql.includes('INFORMATION_SCHEMA.STATISTICS'))return [current,[]];
  if(sql.startsWith('INSERT IGNORE INTO fabric_v2_migration_ledger')){
   ledger={migration_id:params[0],plan_sha256:params[1],backup_sha256:params[2],applied_at:null};return [{affectedRows:1},[]];
  }
  if(sql.startsWith('ALTER TABLE v2_product_image_assets')){
   current=sql.includes('(product_id, role, active_asset_id)')?newIndex():oldIndex();alterCount++;
   if(interruptAfterAlter)throw Error('Connection lost after ALTER');
   return [{affectedRows:0},[]];
  }
  if(sql.startsWith('UPDATE fabric_v2_migration_ledger SET applied_at=')){if(ledger)ledger.applied_at=sql.includes('=NULL')?null:'now';return [{affectedRows:1},[]];}
  if(sql.includes('RELEASE_LOCK'))return [[{released:1}],[]];
  throw Error('Unexpected migration SQL');
 }};
 return {db,get state(){return {current,ledger,alterCount};}};
}
test('product image category migration is target-pinned, backed up, verified and repeatable',async()=>{
 const f=fixture();
 await assert.rejects(migrateProductImageCategoryReuse(f.db,target,'wrong'),/backup/i);
 const result=await migrateProductImageCategoryReuse(f.db,target,'a'.repeat(64));
 assert.equal(result.alreadyApplied,false);
 assert.equal(result.planSha256,PRODUCT_IMAGE_CATEGORY_REUSE_PLAN_SHA256);
 await verifyProductImageCategoryReuseSchema(f.db);
 const repeated=await migrateProductImageCategoryReuse(f.db,target,'a'.repeat(64));
 assert.equal(repeated.alreadyApplied,true);
 assert.equal(f.state.alterCount,1);
 assert(f.state.ledger?.applied_at);
});
test('product image category migration rejects target and unregistered schema drift',async()=>{
 const wrong=fixture();
 await assert.rejects(migrateProductImageCategoryReuse(wrong.db,{...target,serverUuid:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},'a'.repeat(64)),/target mismatch/i);
 const drift=fixture();
 drift.state.current.splice(1,1);
 await assert.rejects(migrateProductImageCategoryReuse(drift.db,target,'a'.repeat(64)),/schema drift|reconciliation/i);
});
test('product image category migration resumes after ALTER without rewriting the index',async()=>{
 const f=fixture({interruptAfterAlter:true}),backup='a'.repeat(64);
 await assert.rejects(migrateProductImageCategoryReuse(f.db,target,backup),/Connection lost after ALTER/);
 assert.equal(f.state.ledger?.applied_at,null);
 await verifyProductImageCategoryReuseSchema(f.db);
 assert.equal((await migrateProductImageCategoryReuse(f.db,target,backup)).alreadyApplied,true);
 assert.equal(f.state.alterCount,1);
 assert(f.state.ledger?.applied_at);
});
test('product image category rollback restores the old index and permits a new apply',async()=>{
 const f=fixture(),backup='a'.repeat(64);
 await migrateProductImageCategoryReuse(f.db,target,backup);
 assert.equal((await migrateProductImageCategoryReuse(f.db,target,backup,'restore')).alreadyApplied,false);
 assert.deepEqual(f.state.current,oldIndex());
 assert.equal(f.state.ledger?.applied_at,null);
 assert.equal((await migrateProductImageCategoryReuse(f.db,target,backup,'restore')).alreadyApplied,true);
 assert.equal((await migrateProductImageCategoryReuse(f.db,target,backup)).alreadyApplied,false);
});
test('product image category schema verifier requires the role-scoped unique index',async()=>{
 const f=fixture();
 await assert.rejects(verifyProductImageCategoryReuseSchema(f.db),/schema drift/i);
});
