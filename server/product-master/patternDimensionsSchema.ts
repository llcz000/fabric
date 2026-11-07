import {createHash} from 'node:crypto';
import type {V2ProductionTarget} from './v2ProductionTarget';
interface Db{query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>}
const SQL='ALTER TABLE pattern_masters ADD COLUMN width_cm DECIMAL(12,4) NULL, ADD COLUMN height_cm DECIMAL(12,4) NULL';
export const PATTERN_DIMENSIONS_PLAN_SHA256=createHash('sha256').update(SQL).digest('hex');
async function columns(db:Db){
 const [raw]=await db.query("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pattern_masters' AND COLUMN_NAME IN ('width_cm','height_cm')");
 if(!Array.isArray(raw))throw Error('Pattern dimensions metadata unavailable');return raw as Record<string,unknown>[];
}
export async function verifyPatternDimensionsSchema(db:Db){
 const found=await columns(db);
 if(found.length!==2||!['width_cm','height_cm'].every(name=>found.some(c=>c.COLUMN_NAME===name&&c.COLUMN_TYPE==='decimal(12,4)'&&c.IS_NULLABLE==='YES')))throw Error('Pattern dimensions schema drift');
}
/** Test/rehearsal initializer; production goes through pinned migration and a verified backup. */
export async function initializePatternDimensionsSchema(db:Db){
 const found=await columns(db);
 if(found.length===1)throw Error('Pattern dimensions partial schema; manual reconciliation required');
 if(!found.length)await db.query(SQL);
 await verifyPatternDimensionsSchema(db);
}
export async function migratePatternDimensions(db:Db&{getConnection?():Promise<Db&{release():void}>},target:V2ProductionTarget,backupSha256:string):Promise<{alreadyApplied:boolean;planSha256:string}>{
 if(db.getConnection){const conn=await db.getConnection();try{return await migratePatternDimensions(conn,target,backupSha256);}finally{conn.release();}}
 if(!/^[a-f0-9]{64}$/.test(backupSha256))throw Error('Verified backup required');
 const [raw]=await db.query('SELECT DATABASE() AS database_name,@@server_uuid AS server_uuid');
 const identity=raw as Record<string,unknown>[];
 if(identity.length!==1||identity[0].database_name!==target.database||identity[0].server_uuid!==target.serverUuid)throw Error('Pattern dimensions target mismatch');
 const lock='fabric-v2:'+target.database,[held]=await db.query('SELECT GET_LOCK(?,0) AS acquired',[lock]);
 if(Number((held as any[])[0]?.acquired)!==1)throw Error('Pattern dimensions migration lock unavailable');
 try{
  const migration='20261030-pattern-dimensions',[ledger]=await db.query('SELECT plan_sha256,applied_at FROM fabric_v2_migration_ledger WHERE migration_id=?',[migration]);
  const rows=ledger as Record<string,unknown>[];
  if(rows.length&&rows[0].plan_sha256!==PATTERN_DIMENSIONS_PLAN_SHA256)throw Error('Pattern dimensions migration plan drift');
  if(rows[0]?.applied_at){await verifyPatternDimensionsSchema(db);return {alreadyApplied:true,planSha256:PATTERN_DIMENSIONS_PLAN_SHA256};}
  await db.query('INSERT IGNORE INTO fabric_v2_migration_ledger(migration_id,plan_sha256,backup_sha256) VALUES(?,?,?)',[migration,PATTERN_DIMENSIONS_PLAN_SHA256,backupSha256]);
  await initializePatternDimensionsSchema(db);
  await db.query('UPDATE fabric_v2_migration_ledger SET applied_at=UTC_TIMESTAMP() WHERE migration_id=?',[migration]);
  return {alreadyApplied:false,planSha256:PATTERN_DIMENSIONS_PLAN_SHA256};
 }finally{await db.query('SELECT RELEASE_LOCK(?)',[lock]);}
}
