import {createHash} from 'node:crypto';
import type {V2ProductionTarget} from '../product-master/v2ProductionTarget';
interface Db{query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>}
const DDL=`CREATE TABLE IF NOT EXISTS business_delete_events (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 entity_type VARCHAR(20) NOT NULL,entity_id VARCHAR(20) NOT NULL,entity_label VARCHAR(255) NOT NULL,
 actor_user_id BIGINT UNSIGNED NOT NULL,deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY ix_business_delete_identity(entity_type,entity_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
// Catalog flags remain for storage compatibility. Deleted objects and revoked credentials are excluded.
export const BUSINESS_SIMPLIFICATION_SQL=Object.freeze([DDL,
 'UPDATE pattern_masters SET is_active=1 WHERE deleted_at IS NULL AND is_active<>1',
 'UPDATE pattern_colorways c JOIN pattern_masters m ON m.id=c.master_id SET c.is_active=1 WHERE m.deleted_at IS NULL AND c.is_active<>1',
 'UPDATE v2_fabrics SET is_active=1 WHERE deleted_at IS NULL AND is_active<>1',
 'UPDATE v2_products p JOIN pattern_colorways c ON c.id=p.pattern_colorway_id JOIN pattern_masters m ON m.id=c.master_id JOIN v2_fabrics f ON f.id=p.fabric_id SET p.is_active=1,p.is_available_for_sampling=1,p.row_version=p.row_version+1 WHERE m.deleted_at IS NULL AND f.deleted_at IS NULL AND (p.is_active<>1 OR p.is_available_for_sampling<>1)',
 'UPDATE sample_cards c JOIN pattern_masters m ON m.id=c.master_id JOIN v2_fabrics f ON f.id=c.fabric_id SET c.is_active=1 WHERE c.deleted_at IS NULL AND m.deleted_at IS NULL AND f.deleted_at IS NULL AND c.is_active<>1'
]);
export const BUSINESS_SIMPLIFICATION_PLAN_SHA256=createHash('sha256').update(BUSINESS_SIMPLIFICATION_SQL.join('\n')).digest('hex');
const rows=(raw:unknown):Record<string,any>[]=>{if(!Array.isArray(raw))throw Error('Deletion audit schema metadata unavailable');return raw;};
export async function verifyDeletionAuditSchema(db:Db){
 const [raw]=await db.query("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,EXTRA,COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='business_delete_events'");const columns=rows(raw);
 const expected=[['id','bigint unsigned'],['entity_type','varchar(20)'],['entity_id','varchar(20)'],['entity_label','varchar(255)'],['actor_user_id','bigint unsigned'],['deleted_at','datetime']];
 if(columns.length!==expected.length||expected.some(([name,type])=>!columns.some(c=>c.COLUMN_NAME===name&&String(c.COLUMN_TYPE).toLowerCase()===type&&c.IS_NULLABLE==='NO'))||!columns.some(c=>c.COLUMN_NAME==='id'&&c.EXTRA==='auto_increment')||!columns.some(c=>c.COLUMN_NAME==='deleted_at'&&String(c.COLUMN_DEFAULT).toLowerCase().replace('()','')==='current_timestamp'))throw Error('Deletion audit schema incomplete');
 const [engines]=await db.query("SELECT ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='business_delete_events'");if(rows(engines)[0]?.ENGINE!=='InnoDB')throw Error('Deletion audit schema requires InnoDB');
 const [keys]=await db.query("SELECT INDEX_NAME,COLUMN_NAME,SEQ_IN_INDEX,NON_UNIQUE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='business_delete_events' ORDER BY INDEX_NAME,SEQ_IN_INDEX");const indexes=rows(keys);
 for(const [name,fields,unique] of [['PRIMARY',['id'],0],['ix_business_delete_identity',['entity_type','entity_id','id'],1]] as const){const index=indexes.filter(x=>x.INDEX_NAME===name);if(JSON.stringify(index.map(x=>x.COLUMN_NAME))!==JSON.stringify(fields)||index.some(x=>Number(x.NON_UNIQUE)!==unique))throw Error('Deletion audit schema index drift');}
}
export async function migrateBusinessSimplification(db:Db&{getConnection?():Promise<Db&{release():void}>},target:V2ProductionTarget,backupSha256:string):Promise<{alreadyApplied:boolean;planSha256:string;inventory?:Record<string,number>}>{
 if(!/^[a-f0-9]{64}$/.test(backupSha256))throw Error('Verified backup required');
 if(db.getConnection){const tx=await db.getConnection();try{return await migrateBusinessSimplification(tx,target,backupSha256);}finally{tx.release();}}
 const [raw]=await db.query('SELECT DATABASE() AS database_name,@@server_uuid AS server_uuid');const identity=rows(raw);if(identity.length!==1||identity[0].database_name!==target.database||identity[0].server_uuid!==target.serverUuid)throw Error('Business simplification target mismatch');
 const lock='fabric-v2:'+target.database,[held]=await db.query('SELECT GET_LOCK(?,0) AS acquired',[lock]);if(Number(rows(held)[0]?.acquired)!==1)throw Error('Business simplification migration lock unavailable');
 const planSha256=BUSINESS_SIMPLIFICATION_PLAN_SHA256,id='20261023-business-simplification';let began=false;
 try{const [rawLedger]=await db.query('SELECT plan_sha256,applied_at FROM fabric_v2_migration_ledger WHERE migration_id=?',[id]);const ledger=rows(rawLedger);if(ledger.length&&ledger[0].plan_sha256!==planSha256)throw Error('Business simplification migration plan drift');if(ledger[0]?.applied_at){await verifyDeletionAuditSchema(db);return {alreadyApplied:true,planSha256};}
  await db.query('INSERT IGNORE INTO fabric_v2_migration_ledger(migration_id,plan_sha256,backup_sha256) VALUES(?,?,?)',[id,planSha256,backupSha256]);
  await db.query(DDL);await verifyDeletionAuditSchema(db);
  await db.query('START TRANSACTION');began=true;const inventory:Record<string,number>={};
  for(const [name,sql] of [['patterns',BUSINESS_SIMPLIFICATION_SQL[1]],['colorways',BUSINESS_SIMPLIFICATION_SQL[2]],['fabrics',BUSINESS_SIMPLIFICATION_SQL[3]],['products',BUSINESS_SIMPLIFICATION_SQL[4]],['cards',BUSINESS_SIMPLIFICATION_SQL[5]]]){const [result]=await db.query(sql);const count=(result as {affectedRows?:unknown})?.affectedRows;if(!Number.isSafeInteger(count)||Number(count)<0)throw Error('Business simplification migration count unavailable');inventory[name]=Number(count);}
  await db.query('UPDATE fabric_v2_migration_ledger SET applied_at=UTC_TIMESTAMP() WHERE migration_id=?',[id]);await db.query('COMMIT');began=false;return {alreadyApplied:false,planSha256,inventory};
 }catch(error){if(began)await db.query('ROLLBACK');throw error;}finally{await db.query('SELECT RELEASE_LOCK(?)',[lock]);}
}
