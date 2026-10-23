import {createHash} from 'node:crypto';
import type {V2ProductionTarget} from './v2ProductionTarget';
interface Db{query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>}
const SQL="ALTER TABLE pattern_masters ADD COLUMN active_master_no VARCHAR(64) GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN master_no ELSE NULL END) STORED, DROP INDEX uq_v2_master_no, ADD UNIQUE KEY uq_v2_master_no (active_master_no)";
const PLAN=createHash('sha256').update(SQL).digest('hex');
export const PATTERN_NUMBER_REUSE_PLAN_SHA256=PLAN;
const rows=(raw:unknown):Record<string,unknown>[]=>{if(!Array.isArray(raw))throw Error('Pattern number reuse metadata unavailable');return raw;};
async function column(db:Db){
 const [raw]=await db.query("SELECT COLUMN_TYPE,IS_NULLABLE,EXTRA,GENERATION_EXPRESSION FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pattern_masters' AND COLUMN_NAME='active_master_no'");
 return rows(raw);
}
export async function verifyPatternNumberReuseSchema(db:Db,allowLegacy=false){
 const found=await column(db),c=found[0];
 // First deploy this compatible reader, then migrate; its binary is the rollback baseline.
 if(!found.length&&allowLegacy)return;
 const expression=String(c?.GENERATION_EXPRESSION??'').toLowerCase().replace(/[\s\x60()]/g,'');
 if(found.length!==1||c.COLUMN_TYPE!=='varchar(64)'||c.IS_NULLABLE!=='YES'||c.EXTRA!=='STORED GENERATED'||
  expression!=='casewhendeleted_atisnullthenmaster_noelsenullend')throw Error('Pattern number reuse column drift');
 const [raw]=await db.query("SELECT COLUMN_NAME,NON_UNIQUE,SEQ_IN_INDEX FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pattern_masters' AND INDEX_NAME='uq_v2_master_no'");
 const index=rows(raw);
 if(index.length!==1||index[0].COLUMN_NAME!=='active_master_no'||Number(index[0].NON_UNIQUE)!==0||Number(index[0].SEQ_IN_INDEX)!==1)throw Error('Pattern number reuse uniqueness drift');
}
/** Isolated schema initializer or explicitly backed-up operator migration only. */
export async function initializePatternNumberReuseSchema(db:Db){
 if(!(await column(db)).length)await db.query(SQL);
 await verifyPatternNumberReuseSchema(db);
}
export async function migratePatternNumberReuse(db:Db&{getConnection?():Promise<Db&{release():void}>},target:V2ProductionTarget,backupSha256:string):Promise<{alreadyApplied:boolean;planSha256:string}>{
 if(db.getConnection){
  const connection=await db.getConnection();
  try{return await migratePatternNumberReuse(connection,target,backupSha256);}finally{connection.release();}
 }
 if(!/^[a-f0-9]{64}$/.test(backupSha256))throw Error('Verified backup required');
 const [raw]=await db.query('SELECT DATABASE() AS database_name,@@server_uuid AS server_uuid');
 const identity=rows(raw);
 if(identity.length!==1||identity[0].database_name!==target.database||identity[0].server_uuid!==target.serverUuid)throw Error('Pattern number reuse target mismatch');
 const lock='fabric-v2:'+target.database,[held]=await db.query('SELECT GET_LOCK(?,0) AS acquired',[lock]);
 if(Number(rows(held)[0]?.acquired)!==1)throw Error('Pattern number reuse migration lock unavailable');
 try{
  const id='20261022-pattern-number-reuse',[rawLedger]=await db.query('SELECT plan_sha256,applied_at FROM fabric_v2_migration_ledger WHERE migration_id=?',[id]);
  const ledger=rows(rawLedger);
  if(ledger.length&&ledger[0].plan_sha256!==PLAN)throw Error('Pattern number reuse migration plan drift');
  if(ledger[0]?.applied_at){await verifyPatternNumberReuseSchema(db);return {alreadyApplied:true,planSha256:PLAN};}
  await db.query('INSERT IGNORE INTO fabric_v2_migration_ledger(migration_id,plan_sha256,backup_sha256) VALUES(?,?,?)',[id,PLAN,backupSha256]);
  await initializePatternNumberReuseSchema(db);
  await db.query('UPDATE fabric_v2_migration_ledger SET applied_at=UTC_TIMESTAMP() WHERE migration_id=?',[id]);
  return {alreadyApplied:false,planSha256:PLAN};
 }finally{await db.query('SELECT RELEASE_LOCK(?)',[lock]);}
}
