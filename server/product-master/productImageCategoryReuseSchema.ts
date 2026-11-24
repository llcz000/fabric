import {createHash} from 'node:crypto';
import type {V2ProductionTarget} from './v2ProductionTarget';

interface Db {query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>}
type Row=Record<string,unknown>;
const MIGRATION_ID='20261124-product-image-category-reuse';
const INDEX_NAME='uq_v2_product_active_asset';
const OLD_COLUMNS=['product_id','active_asset_id'];
const NEW_COLUMNS=['product_id','role','active_asset_id'];
const ALTER_SQL='ALTER TABLE v2_product_image_assets DROP INDEX uq_v2_product_active_asset, ADD UNIQUE KEY uq_v2_product_active_asset (product_id, role, active_asset_id)';
const RESTORE_SQL='ALTER TABLE v2_product_image_assets DROP INDEX uq_v2_product_active_asset, ADD UNIQUE KEY uq_v2_product_active_asset (product_id, active_asset_id)';
export const PRODUCT_IMAGE_CATEGORY_REUSE_PLAN_SHA256=createHash('sha256').update(ALTER_SQL+'\n'+RESTORE_SQL).digest('hex');

function rows(value:unknown):Row[]{
 if(!Array.isArray(value))throw Error('Product image category reuse metadata unavailable');
 return value as Row[];
}
async function indexRows(db:Db):Promise<Row[]>{
 const [raw]=await db.query(
  "SELECT INDEX_NAME,COLUMN_NAME,NON_UNIQUE,SEQ_IN_INDEX FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='v2_product_image_assets' AND INDEX_NAME=? ORDER BY SEQ_IN_INDEX",
  [INDEX_NAME]);
 return rows(raw);
}
function matchesIndex(found:Row[],expected:string[]):boolean{
 return found.length===expected.length&&found.every((row,index)=>
  row.INDEX_NAME===INDEX_NAME&&Number(row.NON_UNIQUE)===0&&
  Number(row.SEQ_IN_INDEX)===index+1&&row.COLUMN_NAME===expected[index]);
}
/** Read-only attestation used after migration and during explicit release rehearsal. */
export async function verifyProductImageCategoryReuseSchema(db:Db):Promise<void>{
 if(!matchesIndex(await indexRows(db),NEW_COLUMNS))throw Error('Product image category reuse schema drift');
}
/** Production DDL is explicit, backed up, target-pinned and ledgered; application startup never repairs this index. */
export async function migrateProductImageCategoryReuse(
 db:Db&{getConnection?():Promise<Db&{release():void}>},
 target:V2ProductionTarget,backupSha256:string,direction:'apply'|'restore'='apply'
):Promise<{alreadyApplied:boolean;planSha256:string}>{
 if(db.getConnection){const conn=await db.getConnection();try{return await migrateProductImageCategoryReuse(conn,target,backupSha256,direction);}finally{conn.release();}}
 if(!/^[a-f0-9]{64}$/.test(backupSha256))throw Error('Verified backup required for product image category reuse');
 const [identity]=await db.query('SELECT DATABASE() AS database_name,@@server_uuid AS server_uuid');
 const actual=rows(identity);
 if(actual.length!==1||actual[0].database_name!==target.database||actual[0].server_uuid!==target.serverUuid)
  throw Error('Product image category reuse migration target mismatch');
 const lock='fabric-v2:'+target.database;
 const [held]=await db.query('SELECT GET_LOCK(?,0) AS acquired',[lock]);
 if(Number(rows(held)[0]?.acquired)!==1)throw Error('Product image category reuse migration lock unavailable');
 try{
  const [ledger]=await db.query('SELECT plan_sha256,applied_at FROM fabric_v2_migration_ledger WHERE migration_id=?',[MIGRATION_ID]);
  const prior=rows(ledger);
  if(prior.length&&prior[0].plan_sha256!==PRODUCT_IMAGE_CATEGORY_REUSE_PLAN_SHA256)
   throw Error('Product image category reuse migration plan drift');
  const current=await indexRows(db);
  if(direction==='restore'){
   const restored=matchesIndex(current,OLD_COLUMNS);
   if(!restored){
    if(!prior.length||!matchesIndex(current,NEW_COLUMNS))throw Error('Cannot restore an unregistered product image index');
    // Atomic DDL refuses the old index if any active cross-category references exist.
    await db.query(RESTORE_SQL).catch(error=>{
     if(error?.code==='ER_DUP_ENTRY')throw Error('Cannot restore the old product image index while cross-category references exist');
     throw error;
    });
   }
   if(prior[0]?.applied_at)await db.query('UPDATE fabric_v2_migration_ledger SET applied_at=NULL WHERE migration_id=?',[MIGRATION_ID]);
   return {alreadyApplied:restored,planSha256:PRODUCT_IMAGE_CATEGORY_REUSE_PLAN_SHA256};
  }
  if(prior[0]?.applied_at){
   if(!matchesIndex(current,NEW_COLUMNS))throw Error('Product image category reuse schema drift');
   return {alreadyApplied:true,planSha256:PRODUCT_IMAGE_CATEGORY_REUSE_PLAN_SHA256};
  }
  if(matchesIndex(current,NEW_COLUMNS)){
   if(!prior.length)throw Error('Unregistered product image category reuse schema; manual reconciliation required');
   await db.query('UPDATE fabric_v2_migration_ledger SET applied_at=UTC_TIMESTAMP() WHERE migration_id=?',[MIGRATION_ID]);
   return {alreadyApplied:true,planSha256:PRODUCT_IMAGE_CATEGORY_REUSE_PLAN_SHA256};
  }
  if(!matchesIndex(current,OLD_COLUMNS))throw Error('Existing product image uniqueness index drift; manual reconciliation required');
  await db.query('INSERT IGNORE INTO fabric_v2_migration_ledger(migration_id,plan_sha256,backup_sha256) VALUES(?,?,?)',
   [MIGRATION_ID,PRODUCT_IMAGE_CATEGORY_REUSE_PLAN_SHA256,backupSha256]);
  await db.query(ALTER_SQL);
  await verifyProductImageCategoryReuseSchema(db);
  await db.query('UPDATE fabric_v2_migration_ledger SET applied_at=UTC_TIMESTAMP() WHERE migration_id=?',[MIGRATION_ID]);
  return {alreadyApplied:false,planSha256:PRODUCT_IMAGE_CATEGORY_REUSE_PLAN_SHA256};
 }finally{await db.query('SELECT RELEASE_LOCK(?)',[lock]);}
}
