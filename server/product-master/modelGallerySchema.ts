import {createHash} from 'node:crypto';
import type {V2ProductionTarget} from './v2ProductionTarget';
type Db={query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>};
const SQL=`CREATE TABLE v2_model_assets (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 asset_id CHAR(36) NOT NULL,
 category VARCHAR(16) NOT NULL,
 angle VARCHAR(16) NOT NULL DEFAULT 'front',
 note VARCHAR(400) NOT NULL DEFAULT '',
 reference_cm DECIMAL(7,2) NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 deleted_at DATETIME NULL,
 UNIQUE KEY uq_model_asset (asset_id),
 KEY idx_models_live (deleted_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
export const MODEL_GALLERY_PLAN_SHA256=createHash('sha256').update(SQL).digest('hex');
const rows=(value:unknown):Record<string,unknown>[]=>{
 if(!Array.isArray(value))throw Error('Model gallery schema metadata unavailable');
 return value as Record<string,unknown>[];
};
async function metadata(db:Db){
 const [raw]=await db.query("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='v2_model_assets'");
 return rows(raw);
}
/** Strict read-only startup check: no CREATE/ALTER is allowed during app startup. */
export async function verifyModelGallerySchema(db:Db){
 const columns=await metadata(db);
 const expected:Record<string,string>={
  id:'bigint unsigned',asset_id:'char(36)',category:'varchar(16)',angle:'varchar(16)',
  note:'varchar(400)',reference_cm:'decimal(7,2)',created_at:'datetime',deleted_at:'datetime'
 };
 if(columns.length!==Object.keys(expected).length||Object.entries(expected).some(([name,type])=>
  !columns.some(row=>row.COLUMN_NAME===name&&row.COLUMN_TYPE===type&&
   (name==='reference_cm'||name==='deleted_at'?row.IS_NULLABLE==='YES':row.IS_NULLABLE==='NO'))))
  throw Error('Model gallery schema drift');
 const [idx]=await db.query("SELECT INDEX_NAME,COLUMN_NAME,NON_UNIQUE,SEQ_IN_INDEX FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='v2_model_assets'");
 const indexes=rows(idx);
 if(!indexes.some(row=>row.INDEX_NAME==='uq_model_asset'&&row.COLUMN_NAME==='asset_id'&&Number(row.NON_UNIQUE)===0)||
   !indexes.some(row=>row.INDEX_NAME==='idx_models_live'&&row.COLUMN_NAME==='deleted_at'&&Number(row.SEQ_IN_INDEX)===1)||
   !indexes.some(row=>row.INDEX_NAME==='idx_models_live'&&row.COLUMN_NAME==='id'&&Number(row.SEQ_IN_INDEX)===2))
  throw Error('Model gallery indexes drift');
}
export async function migrateModelGallery(db:Db&{getConnection?():Promise<Db&{release():void}>},
 target:V2ProductionTarget,backupSha256:string):Promise<{alreadyApplied:boolean;planSha256:string}>{
 if(db.getConnection){const conn=await db.getConnection();try{return await migrateModelGallery(conn,target,backupSha256);}finally{conn.release();}}
 if(!/^[a-f0-9]{64}$/.test(backupSha256))throw Error('Verified backup required for model gallery');
 const [raw]=await db.query('SELECT DATABASE() AS database_name,@@server_uuid AS server_uuid');
 const identity=rows(raw);
 if(identity.length!==1||identity[0].database_name!==target.database||identity[0].server_uuid!==target.serverUuid)
  throw Error('Model gallery migration target mismatch');
 const lock='fabric-v2:'+target.database,[held]=await db.query('SELECT GET_LOCK(?,0) AS acquired',[lock]);
 if(Number(rows(held)[0]?.acquired)!==1)throw Error('Model gallery migration lock unavailable');
 try{
  const migration='20261030-model-gallery';
  const [ledger]=await db.query('SELECT plan_sha256,applied_at FROM fabric_v2_migration_ledger WHERE migration_id=?',[migration]);
  const prior=rows(ledger);
  if(prior.length&&prior[0].plan_sha256!==MODEL_GALLERY_PLAN_SHA256)throw Error('Model gallery migration plan drift');
  if(prior[0]?.applied_at){await verifyModelGallerySchema(db);return {alreadyApplied:true,planSha256:MODEL_GALLERY_PLAN_SHA256};}
  const existing=await metadata(db);
  if(existing.length)throw Error('Unregistered existing model gallery table; manual reconciliation required');
  await db.query('INSERT IGNORE INTO fabric_v2_migration_ledger(migration_id,plan_sha256,backup_sha256) VALUES(?,?,?)',
   [migration,MODEL_GALLERY_PLAN_SHA256,backupSha256]);
  await db.query(SQL);
  await verifyModelGallerySchema(db);
  await db.query('UPDATE fabric_v2_migration_ledger SET applied_at=UTC_TIMESTAMP() WHERE migration_id=?',[migration]);
  return {alreadyApplied:false,planSha256:MODEL_GALLERY_PLAN_SHA256};
 }finally{await db.query('SELECT RELEASE_LOCK(?)',[lock]);}
}
