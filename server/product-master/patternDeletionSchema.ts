import {createHash} from 'node:crypto';
import type {V2ProductionTarget} from './v2ProductionTarget';
interface Db{query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>}
const SQL='ALTER TABLE pattern_masters ADD COLUMN deleted_at DATETIME NULL';
const PLAN=createHash('sha256').update(SQL).digest('hex');
export const PATTERN_DELETION_PLAN_SHA256=PLAN;
const rows=(raw:unknown):Record<string,unknown>[]=>{if(!Array.isArray(raw))throw Error('Pattern deletion metadata unavailable');return raw;};
async function column(db:Db){
 const [raw]=await db.query("SELECT COLUMN_TYPE,IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pattern_masters' AND COLUMN_NAME='deleted_at'");
 return rows(raw);
}
export async function verifyPatternDeletionSchema(db:Db){
 const found=await column(db);
 if(found.length!==1||found[0].COLUMN_TYPE!=='datetime'||found[0].IS_NULLABLE!=='YES')throw Error('Pattern deletion schema incomplete');
}
/** Isolated schema initializer or explicitly backed-up operator migration only. */
export async function initializePatternDeletionSchema(db:Db){
 if(!(await column(db)).length)await db.query(SQL);
 await verifyPatternDeletionSchema(db);
}
export async function migratePatternDeletion(db:Db&{getConnection?():Promise<Db&{release():void}>},target:V2ProductionTarget,backupSha256:string):Promise<{alreadyApplied:boolean;planSha256:string}>{
 if(db.getConnection){
  const connection=await db.getConnection();
  try{return await migratePatternDeletion(connection,target,backupSha256);}finally{connection.release();}
 }
 if(!/^[a-f0-9]{64}$/.test(backupSha256))throw Error('Verified backup required');
 const [raw]=await db.query('SELECT DATABASE() AS database_name,@@server_uuid AS server_uuid');
 const identity=rows(raw);
 if(identity.length!==1||identity[0].database_name!==target.database||identity[0].server_uuid!==target.serverUuid)throw Error('Pattern deletion target mismatch');
 const lock='fabric-v2:'+target.database,[held]=await db.query('SELECT GET_LOCK(?,0) AS acquired',[lock]);
 if(Number(rows(held)[0]?.acquired)!==1)throw Error('Pattern deletion migration lock unavailable');
 try{
  const id='20261022-pattern-deletion',[rawLedger]=await db.query('SELECT plan_sha256,applied_at FROM fabric_v2_migration_ledger WHERE migration_id=?',[id]);
  const ledger=rows(rawLedger);
  if(ledger.length&&ledger[0].plan_sha256!==PLAN)throw Error('Pattern deletion migration plan drift');
  if(ledger[0]?.applied_at){await verifyPatternDeletionSchema(db);return {alreadyApplied:true,planSha256:PLAN};}
  await db.query('INSERT IGNORE INTO fabric_v2_migration_ledger(migration_id,plan_sha256,backup_sha256) VALUES(?,?,?)',[id,PLAN,backupSha256]);
  await initializePatternDeletionSchema(db);
  await db.query('UPDATE fabric_v2_migration_ledger SET applied_at=UTC_TIMESTAMP() WHERE migration_id=?',[id]);
  return {alreadyApplied:false,planSha256:PLAN};
 }finally{await db.query('SELECT RELEASE_LOCK(?)',[lock]);}
}
