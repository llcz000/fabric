import {createHash} from 'node:crypto';
import type {V2ProductionTarget} from '../product-master/v2ProductionTarget';

interface Db{query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>}
const id='20261124-active-sample-product-reference';
const add='ALTER TABLE customer_sample_items ADD COLUMN session_deleted TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN active_product_id BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN removed_at IS NULL AND session_deleted=0 THEN product_id ELSE NULL END) STORED, ADD CONSTRAINT fk_sample_item_active_product FOREIGN KEY(active_product_id) REFERENCES v2_products(id) ON DELETE RESTRICT';
const trigger='CREATE TRIGGER sample_session_release_products AFTER UPDATE ON customer_sample_sessions FOR EACH ROW UPDATE customer_sample_items SET session_deleted=1 WHERE session_id=NEW.id AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL';
const backfill='UPDATE customer_sample_items i JOIN customer_sample_sessions s ON s.id=i.session_id SET i.session_deleted=1 WHERE s.deleted_at IS NOT NULL AND i.session_deleted=0';
const dropOld='ALTER TABLE customer_sample_items DROP FOREIGN KEY fk_sample_item_product';
const restoreOld='ALTER TABLE customer_sample_items ADD CONSTRAINT fk_sample_item_product FOREIGN KEY(product_id) REFERENCES v2_products(id) ON DELETE RESTRICT';
export const ACTIVE_SAMPLE_PRODUCT_PLAN_SHA256=createHash('sha256').update([add,trigger,backfill,dropOld,restoreOld].join('\n')).digest('hex');

const rows=(raw:unknown):Record<string,unknown>[]=>{
 if(!Array.isArray(raw))throw Error('Sample product reference metadata unavailable');
 return raw;
};
const normalized=(value:unknown)=>String(value??'').toLowerCase().replace(/[`\s()]/g,'');
export function verifyActiveSampleProductColumn(row:Record<string,unknown>|undefined){
 if(!row||row.COLUMN_TYPE!=='bigint unsigned'||row.IS_NULLABLE!=='YES'||
  normalized(row.EXTRA)!=='storedgenerated'||
  normalized(row.GENERATION_EXPRESSION)!=='casewhenremoved_atisnullandsession_deleted=0thenproduct_idelsenullend')
  throw Error('Active sample product reference column drift');
}
async function metadata(db:Db){
 const [fk]=await db.query("SELECT k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME='customer_sample_items' AND k.CONSTRAINT_NAME IN ('fk_sample_item_product','fk_sample_item_active_product')");
 function has(name:string,column:string){
  const found=rows(fk).filter(row=>row.CONSTRAINT_NAME===name);
  if(!found.length)return false;
  if(found.length!==1||found[0].COLUMN_NAME!==column||found[0].REFERENCED_TABLE_NAME!=='v2_products'||
   found[0].REFERENCED_COLUMN_NAME!=='id'||found[0].DELETE_RULE!=='RESTRICT')throw Error('Sample product reference FK drift: '+name);
  return true;
 }
 return {old:has('fk_sample_item_product','product_id'),active:has('fk_sample_item_active_product','active_product_id')};
}
async function verifyActiveSchema(db:Db){
 const [column]=await db.query("SELECT COLUMN_TYPE,IS_NULLABLE,EXTRA,GENERATION_EXPRESSION FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customer_sample_items' AND COLUMN_NAME='active_product_id'");
 verifyActiveSampleProductColumn(rows(column)[0]);
 const [triggers]=await db.query("SELECT ACTION_STATEMENT FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME='sample_session_release_products' AND ACTION_TIMING='AFTER' AND EVENT_MANIPULATION='UPDATE' AND EVENT_OBJECT_TABLE='customer_sample_sessions'");
 if(normalized(rows(triggers)[0]?.ACTION_STATEMENT)!==normalized(trigger.slice(trigger.indexOf('UPDATE customer_sample_items'))))throw Error('Sample session deletion trigger drift');
}
export async function migrateActiveSampleProductReference(pool:{getConnection():Promise<Db&{release():void}>},target:V2ProductionTarget,backup:string,restore=false){
 if(!/^[a-f0-9]{64}$/.test(backup))throw Error('Verified backup required for active sample product reference');
 const db=await pool.getConnection();
 try{
  const [raw]=await db.query('SELECT DATABASE() AS database_name,@@server_uuid AS server_uuid');
  const actual=rows(raw)[0];
  if(actual?.database_name!==target.database||actual?.server_uuid!==target.serverUuid)throw Error('Active sample product reference target mismatch');
  const lock='fabric-v2:'+target.database,[held]=await db.query('SELECT GET_LOCK(?,0) AS acquired',[lock]);
  if(Number(rows(held)[0]?.acquired)!==1)throw Error('Active sample product reference migration lock unavailable');
  try{
   const [ledger]=await db.query('SELECT plan_sha256,applied_at FROM fabric_v2_migration_ledger WHERE migration_id=?',[id]);
   const prior=rows(ledger)[0],current=await metadata(db);
   if(prior&&prior.plan_sha256!==ACTIVE_SAMPLE_PRODUCT_PLAN_SHA256)throw Error('Active sample product reference plan drift');
   if(restore){
    if(!current.old){
     if(!prior||!current.active)throw Error('Unregistered active sample product reference');
     // The old FK rejects restoration once retained history references a deleted product.
     await db.query(restoreOld);
    }
    if(prior?.applied_at)await db.query('UPDATE fabric_v2_migration_ledger SET applied_at=NULL WHERE migration_id=?',[id]);
    return {alreadyApplied:current.old,planSha256:ACTIVE_SAMPLE_PRODUCT_PLAN_SHA256};
   }
   if(!current.old&&!current.active||current.active&&!prior||prior?.applied_at&&(!current.active||current.old))throw Error('Active sample product reference schema drift');
   if(!prior)await db.query('INSERT INTO fabric_v2_migration_ledger(migration_id,plan_sha256,backup_sha256) VALUES(?,?,?)',[id,ACTIVE_SAMPLE_PRODUCT_PLAN_SHA256,backup]);
   if(!current.active)await db.query(add);
   const [found]=await db.query("SELECT TRIGGER_NAME FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME='sample_session_release_products'");
   if(!rows(found).length&&!prior?.applied_at)await db.query(trigger);
   await verifyActiveSchema(db);
   if(!prior?.applied_at){
    await db.query(backfill);
    if(current.old)await db.query(dropOld);
    await db.query('UPDATE fabric_v2_migration_ledger SET applied_at=UTC_TIMESTAMP() WHERE migration_id=?',[id]);
   }
   return {alreadyApplied:Boolean(prior?.applied_at),planSha256:ACTIVE_SAMPLE_PRODUCT_PLAN_SHA256};
  }finally{await db.query('SELECT RELEASE_LOCK(?)',[lock]);}
 }finally{db.release();}
}
