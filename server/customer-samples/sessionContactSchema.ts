import {createHash} from 'node:crypto';
import type {V2ProductionTarget} from '../product-master/v2ProductionTarget';
interface Db{query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>}
const SQL='ALTER TABLE customer_sample_sessions ADD COLUMN contact_name VARCHAR(110) NULL';
export const SAMPLE_CONTACT_PLAN_SHA256=createHash('sha256').update(SQL).digest('hex');
export async function verifySampleContactSchema(db:Db){
 const [raw]=await db.query("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customer_sample_sessions' AND COLUMN_NAME='contact_name'");
 if(!Array.isArray(raw)||raw.length!==1||raw[0].COLUMN_TYPE!=='varchar(110)'||raw[0].IS_NULLABLE!=='YES')throw Error('Sample contact schema drift');
}
export async function migrateSampleContact(db:Db&{getConnection?():Promise<Db&{release():void}>},target:V2ProductionTarget,backupSha256:string):Promise<{alreadyApplied:boolean;planSha256:string}>{
 if(db.getConnection){const c=await db.getConnection();try{return await migrateSampleContact(c,target,backupSha256);}finally{c.release();}}
 if(!/^[a-f0-9]{64}$/.test(backupSha256))throw Error('Verified backup required');
 const [identity]:any=await db.query('SELECT DATABASE() AS database_name,@@server_uuid AS server_uuid');
 if(!Array.isArray(identity)||identity.length!==1||identity[0].database_name!==target.database||identity[0].server_uuid!==target.serverUuid)throw Error('Sample contact target mismatch');
 const lock='fabric-v2:'+target.database,[held]:any=await db.query('SELECT GET_LOCK(?,0) AS acquired',[lock]);if(Number(held[0]?.acquired)!==1)throw Error('Sample contact migration lock unavailable');
 try{
  const id='20261106-sample-contact',[ledger]:any=await db.query('SELECT plan_sha256,applied_at FROM fabric_v2_migration_ledger WHERE migration_id=?',[id]);
  if(ledger.length&&ledger[0].plan_sha256!==SAMPLE_CONTACT_PLAN_SHA256)throw Error('Sample contact plan drift');
  if(ledger[0]?.applied_at){await verifySampleContactSchema(db);return {alreadyApplied:true,planSha256:SAMPLE_CONTACT_PLAN_SHA256};}
  await db.query('INSERT IGNORE INTO fabric_v2_migration_ledger(migration_id,plan_sha256,backup_sha256) VALUES(?,?,?)',[id,SAMPLE_CONTACT_PLAN_SHA256,backupSha256]);
  const [found]:any=await db.query("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customer_sample_sessions' AND COLUMN_NAME='contact_name'");
  if(!found.length)await db.query(SQL);await verifySampleContactSchema(db);
  await db.query('UPDATE fabric_v2_migration_ledger SET applied_at=UTC_TIMESTAMP() WHERE migration_id=?',[id]);return {alreadyApplied:false,planSha256:SAMPLE_CONTACT_PLAN_SHA256};
 }finally{await db.query('SELECT RELEASE_LOCK(?)',[lock]);}
}
