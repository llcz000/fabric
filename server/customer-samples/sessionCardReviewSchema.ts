import {createHash} from 'node:crypto';
import type {V2ProductionTarget} from '../product-master/v2ProductionTarget';
interface Db{query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>}
const SQL='ALTER TABLE customer_sample_sessions ADD COLUMN card_review JSON NULL';
export const SAMPLE_CARD_REVIEW_PLAN_SHA256=createHash('sha256').update(SQL).digest('hex');
export async function verifySampleCardReviewSchema(db:Db){
 const [raw]=await db.query("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customer_sample_sessions' AND COLUMN_NAME='card_review'");
 if(!Array.isArray(raw)||raw.length!==1||raw[0].COLUMN_TYPE!=='json'||raw[0].IS_NULLABLE!=='YES')throw Error('Sample card review schema drift');
}
export async function migrateSampleCardReview(db:Db&{getConnection?():Promise<Db&{release():void}>},target:V2ProductionTarget,backupSha256:string):Promise<{alreadyApplied:boolean;planSha256:string}>{
 if(db.getConnection){const c=await db.getConnection();try{return await migrateSampleCardReview(c,target,backupSha256);}finally{c.release();}}
 if(!/^[a-f0-9]{64}$/.test(backupSha256))throw Error('Verified backup required');
 const [identity]:any=await db.query('SELECT DATABASE() AS database_name,@@server_uuid AS server_uuid');
 if(!Array.isArray(identity)||identity.length!==1||identity[0].database_name!==target.database||identity[0].server_uuid!==target.serverUuid)throw Error('Sample card review target mismatch');
 const lock='fabric-v2:'+target.database,[held]:any=await db.query('SELECT GET_LOCK(?,0) AS acquired',[lock]);if(Number(held[0]?.acquired)!==1)throw Error('Sample card review migration lock unavailable');
 try{
  const id='20261105-sample-card-review',[ledger]:any=await db.query('SELECT plan_sha256,applied_at FROM fabric_v2_migration_ledger WHERE migration_id=?',[id]);
  if(ledger.length&&ledger[0].plan_sha256!==SAMPLE_CARD_REVIEW_PLAN_SHA256)throw Error('Sample card review plan drift');
  if(ledger[0]?.applied_at){await verifySampleCardReviewSchema(db);return {alreadyApplied:true,planSha256:SAMPLE_CARD_REVIEW_PLAN_SHA256};}
  await db.query('INSERT IGNORE INTO fabric_v2_migration_ledger(migration_id,plan_sha256,backup_sha256) VALUES(?,?,?)',[id,SAMPLE_CARD_REVIEW_PLAN_SHA256,backupSha256]);
  const [found]:any=await db.query("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customer_sample_sessions' AND COLUMN_NAME='card_review'");
  if(!found.length)await db.query(SQL);await verifySampleCardReviewSchema(db);
  await db.query('UPDATE fabric_v2_migration_ledger SET applied_at=UTC_TIMESTAMP() WHERE migration_id=?',[id]);return {alreadyApplied:false,planSha256:SAMPLE_CARD_REVIEW_PLAN_SHA256};
 }finally{await db.query('SELECT RELEASE_LOCK(?)',[lock]);}
}
