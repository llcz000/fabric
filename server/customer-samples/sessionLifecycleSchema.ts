import {createHash} from 'node:crypto';
import type {V2ProductionTarget} from '../product-master/v2ProductionTarget';
interface Db{query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>}
const SQL=[
 'ALTER TABLE customer_sample_sessions ADD COLUMN deleted_at DATETIME NULL',
 'ALTER TABLE customer_sample_sessions ADD COLUMN deleted_by_user_id BIGINT UNSIGNED NULL',
 'ALTER TABLE customer_sample_sessions ADD CONSTRAINT ck_sample_session_deletion CHECK ((deleted_at IS NULL) = (deleted_by_user_id IS NULL))',
 'ALTER TABLE customer_sample_sessions ADD CONSTRAINT fk_sample_session_deleted_actor FOREIGN KEY(deleted_by_user_id) REFERENCES v2_access_users(id) ON DELETE RESTRICT'
] as const;
const PLAN=createHash('sha256').update(JSON.stringify(SQL)).digest('hex');
const rows=(raw:unknown):Record<string,any>[]=>{if(!Array.isArray(raw))throw Error('Session lifecycle metadata unavailable');return raw;};
async function metadata(db:Db){
 const [c]=await db.query("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customer_sample_sessions'");
 const [k]=await db.query("SELECT CONSTRAINT_NAME,ENFORCED FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customer_sample_sessions'");return {columns:rows(c),keys:rows(k)};
}
export async function verifySessionLifecycleSchema(db:Db){
 const {columns,keys}=await metadata(db);
 for(const [name,type] of [['deleted_at','datetime'],['deleted_by_user_id','bigint unsigned']])if(!columns.some(c=>c.COLUMN_NAME===name&&String(c.COLUMN_TYPE).toLowerCase()===type&&c.IS_NULLABLE==='YES'))throw Error('Session lifecycle schema incomplete');
 if(!keys.some(k=>k.CONSTRAINT_NAME==='ck_sample_session_deletion'&&k.ENFORCED==='YES'))throw Error('Session deletion check missing');
 const [checks]=await db.query("SELECT CHECK_CLAUSE FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='ck_sample_session_deletion'");
 const expression=rows(checks);if(expression.length!==1||typeof expression[0].CHECK_CLAUSE!=='string'||expression[0].CHECK_CLAUSE.toLowerCase().replace(/[`()\s]/g,'')!=='deleted_atisnull=deleted_by_user_idisnull')throw Error('Session deletion check expression mismatch');
 const [f]=await db.query("SELECT k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME='customer_sample_sessions' AND k.CONSTRAINT_NAME='fk_sample_session_deleted_actor'");
 if(rows(f).length!==1||rows(f)[0].COLUMN_NAME!=='deleted_by_user_id'||rows(f)[0].REFERENCED_TABLE_NAME!=='v2_access_users'||rows(f)[0].REFERENCED_COLUMN_NAME!=='id'||rows(f)[0].DELETE_RULE!=='RESTRICT')throw Error('Session deletion actor FK missing');
}
/** Explicit additive migration only; immutable 20261017 core ledger remains untouched. */
export async function migrateSessionLifecycle(db:Db,target:V2ProductionTarget,backupSha256:string){
 if(!/^[a-f0-9]{64}$/.test(backupSha256))throw Error('Verified backup required');
 const [identity]=await db.query('SELECT DATABASE() AS database_name,@@server_uuid AS server_uuid');
 if(rows(identity).length!==1||rows(identity)[0].database_name!==target.database||rows(identity)[0].server_uuid!==target.serverUuid)throw Error('Session lifecycle target mismatch');
 const lock='fabric-v2:'+target.database,[held]=await db.query('SELECT GET_LOCK(?,0) AS acquired',[lock]);if(Number(rows(held)[0]?.acquired)!==1)throw Error('Session lifecycle migration lock unavailable');
 try{
  const id='20261018-sample-session-lifecycle',[ledger]=await db.query('SELECT plan_sha256,applied_at FROM fabric_v2_migration_ledger WHERE migration_id=?',[id]);
  if(rows(ledger).length&&rows(ledger)[0].plan_sha256!==PLAN)throw Error('Session lifecycle migration plan drift');
  if(rows(ledger)[0]?.applied_at){await verifySessionLifecycleSchema(db);return {alreadyApplied:true,planSha256:PLAN};}
  await db.query('INSERT IGNORE INTO fabric_v2_migration_ledger(migration_id,plan_sha256,backup_sha256) VALUES(?,?,?)',[id,PLAN,backupSha256]);
  const {columns,keys}=await metadata(db);
  for(let i=0;i<SQL.length;i++){
   const exists=i<2?columns.some(c=>c.COLUMN_NAME===(i===0?'deleted_at':'deleted_by_user_id')):keys.some(k=>k.CONSTRAINT_NAME===(i===2?'ck_sample_session_deletion':'fk_sample_session_deleted_actor'));
   if(!exists)await db.query(SQL[i]);
  }
  await verifySessionLifecycleSchema(db);await db.query('UPDATE fabric_v2_migration_ledger SET applied_at=UTC_TIMESTAMP() WHERE migration_id=?',[id]);return {alreadyApplied:false,planSha256:PLAN};
 }finally{await db.query('SELECT RELEASE_LOCK(?)',[lock]);}
}
