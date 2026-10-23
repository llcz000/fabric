import {createHash} from 'node:crypto';
import {PRODUCT_SHARE_SQL} from './productSharing';
import {verifyProductLinkRuntimeSchema} from './productLinkSchemaContract';
interface ProductShareMigrationPool{getConnection():Promise<{query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>;release():void;destroy():void}>}
const sql=PRODUCT_SHARE_SQL.replace('CREATE TABLE ','CREATE TABLE IF NOT EXISTS ');
export const PRODUCT_SHARE_PLAN_SHA256=createHash('sha256').update(sql).digest('hex');
const rows=(value:unknown):Record<string,unknown>[]=>{if(!Array.isArray(value))throw Error('B1 migration metadata unavailable');return value;};
/** Operator only: never imported or executed from runtime startup. Existing rows are never repaired/revoked. */
export async function migrateProductShareLinks(pool:ProductShareMigrationPool,target:{database:string;serverUuid:string},backupSha256:string,confirmation:string){
 if(confirmation!=='APPLY_PRODUCT_SHARE'||!(/^[a-f0-9]{64}$/).test(backupSha256)||!target||!(/^[A-Za-z0-9_]{1,64}$/).test(target.database)||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(target.serverUuid)||typeof pool?.getConnection!=='function')throw Error('Product share verified backup, physical connection and separate confirmation required');
 const db=await pool.getConnection(),lock='fabric-v2:'+target.database;
 let lockState:'none'|'uncertain'|'held'='none';
 try{
  if(typeof db.destroy!=='function')throw Error('Product migration requires a disposable physical connection');
  const [identity]=await db.query('SELECT DATABASE() AS database_name, @@server_uuid AS server_uuid');
  if(rows(identity).length!==1||rows(identity)[0].database_name!==target.database||rows(identity)[0].server_uuid!==target.serverUuid)throw Error('Product share migration target mismatch');
  lockState='uncertain';const [got]=await db.query('SELECT GET_LOCK(?,0) AS acquired',[lock]);
  if(Number(rows(got)[0]?.acquired)!==1){lockState='none';throw Error('Product share migration lock unavailable');}lockState='held';
  const migrationId='20261019-product-share';
  const [found]=await db.query('SELECT plan_sha256,applied_at FROM fabric_v2_migration_ledger WHERE migration_id=?',[migrationId]);
  const existing=rows(found);if(existing.length>1||existing[0]&&existing[0].plan_sha256!==PRODUCT_SHARE_PLAN_SHA256)throw Error('B1 migration plan drift');
  const inspect=()=>verifyProductLinkRuntimeSchema({async getConnection(){return {query:db.query.bind(db),release(){}};}},target);
  if(existing[0]?.applied_at){await inspect();return {alreadyApplied:true,planSha256:PRODUCT_SHARE_PLAN_SHA256};}
  await db.query('INSERT IGNORE INTO fabric_v2_migration_ledger(migration_id,plan_sha256,backup_sha256) VALUES (?,?,?)',[migrationId,PRODUCT_SHARE_PLAN_SHA256,backupSha256]);
  await db.query(sql);await inspect();
  await db.query('UPDATE fabric_v2_migration_ledger SET applied_at=UTC_TIMESTAMP() WHERE migration_id=?',[migrationId]);
  return {alreadyApplied:false,planSha256:PRODUCT_SHARE_PLAN_SHA256};
 }finally{
  if(lockState==='held'){
   lockState='uncertain';
   try{const [released]=await db.query('SELECT RELEASE_LOCK(?) AS released',[lock]);if(Number(rows(released)[0]?.released)!==1)throw Error();lockState='none';}
   catch{db.destroy();throw Error('Product share migration lock release unverified; connection discarded');}
  }
  if(lockState==='uncertain')db.destroy();else db.release();
 }
}
