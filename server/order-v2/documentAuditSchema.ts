import {createHash} from 'node:crypto';
import type {V2ProductionTarget} from '../product-master/v2ProductionTarget';
interface Db{query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>}
const SQL=`CREATE TABLE IF NOT EXISTS v2_document_audit_events (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 subject_order_id INT NOT NULL,original_owner_user_id BIGINT UNSIGNED NULL,
 actor_user_id BIGINT UNSIGNED NOT NULL,actor_session_id BIGINT UNSIGNED NOT NULL,
 action ENUM('edit','delete') NOT NULL,document_no VARCHAR(100) NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY ix_v2_doc_audit_subject(subject_order_id,id),
 CONSTRAINT fk_v2_doc_audit_actor FOREIGN KEY(actor_user_id) REFERENCES v2_access_users(id) ON DELETE RESTRICT,
 CONSTRAINT fk_v2_doc_audit_owner FOREIGN KEY(original_owner_user_id) REFERENCES v2_access_users(id) ON DELETE RESTRICT
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
const PLAN=createHash('sha256').update(SQL).digest('hex');
const rows=(value:unknown):Record<string,any>[]=>{if(!Array.isArray(value))throw Error('Document audit metadata unavailable');return value;};
export async function verifyV2DocumentAuditSchema(db:Db){
 const [raw]=await db.query("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='v2_document_audit_events'");const columns=rows(raw);
 for(const [name,type,nullable] of [['id','bigint unsigned','NO'],['subject_order_id','int','NO'],['original_owner_user_id','bigint unsigned','YES'],['actor_user_id','bigint unsigned','NO'],['actor_session_id','bigint unsigned','NO'],['action',"enum('edit','delete')",'NO'],['document_no','varchar(100)','NO'],['created_at','datetime','NO']])if(!columns.some(c=>c.COLUMN_NAME===name&&String(c.COLUMN_TYPE).toLowerCase()===type&&c.IS_NULLABLE===nullable))throw Error('Document audit schema incomplete');
 const [engines]=await db.query("SELECT ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='v2_document_audit_events'");if(rows(engines)[0]?.ENGINE!=='InnoDB')throw Error('Document audit requires transactional storage');
 const [keys]=await db.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='v2_document_audit_events' AND INDEX_NAME='PRIMARY' ORDER BY SEQ_IN_INDEX");if(JSON.stringify(rows(keys).map(r=>r.COLUMN_NAME))!==JSON.stringify(['id']))throw Error('Document audit primary key missing');
}
export async function migrateV2DocumentAudit(db:Db,target:V2ProductionTarget,backupSha256:string){
 if(!/^[a-f0-9]{64}$/.test(backupSha256))throw Error('Verified backup required');const [identity]=await db.query('SELECT DATABASE() AS database_name,@@server_uuid AS server_uuid');if(rows(identity).length!==1||rows(identity)[0].database_name!==target.database||rows(identity)[0].server_uuid!==target.serverUuid)throw Error('Document audit target mismatch');
 const lock='fabric-v2:'+target.database,[held]=await db.query('SELECT GET_LOCK(?,0) AS acquired',[lock]);if(Number(rows(held)[0]?.acquired)!==1)throw Error('Document audit migration lock unavailable');
 try{const id='20261017-v2-document-audit',[ledger]=await db.query('SELECT plan_sha256,applied_at FROM fabric_v2_migration_ledger WHERE migration_id=?',[id]);if(rows(ledger).length&&rows(ledger)[0].plan_sha256!==PLAN)throw Error('Document audit migration plan drift');if(rows(ledger)[0]?.applied_at){await verifyV2DocumentAuditSchema(db);return {alreadyApplied:true,planSha256:PLAN};}
  await db.query('INSERT IGNORE INTO fabric_v2_migration_ledger(migration_id,plan_sha256,backup_sha256) VALUES(?,?,?)',[id,PLAN,backupSha256]);await db.query(SQL);await verifyV2DocumentAuditSchema(db);await db.query('UPDATE fabric_v2_migration_ledger SET applied_at=UTC_TIMESTAMP() WHERE migration_id=?',[id]);return {alreadyApplied:false,planSha256:PLAN};
 }finally{await db.query('SELECT RELEASE_LOCK(?)',[lock]);}
}
