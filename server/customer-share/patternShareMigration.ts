import {createHash} from 'node:crypto';
import {getPatternLinkSchemaStatements} from './patternLinkSchema';
import {verifyPatternLinkRuntimeSchema} from './patternLinkSchemaContract';
interface Db{query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>}
const sql=getPatternLinkSchemaStatements()[0].sql.replace('CREATE TABLE ','CREATE TABLE IF NOT EXISTS ');
export const PATTERN_SHARE_PLAN_SHA256=createHash('sha256').update(sql).digest('hex');
const rows=(value:unknown):Record<string,unknown>[]=>{if(!Array.isArray(value))throw Error('B1 migration metadata unavailable');return value;};
/** Operator only: never imported or executed from runtime startup. Existing rows are never repaired/revoked. */
export async function migratePatternShareLinks(db:Db,target:{database:string;serverUuid:string},backupSha256:string,confirmation:string){
 if(confirmation!=='APPLY_B1_SHARE'||!(/^[a-f0-9]{64}$/).test(backupSha256)||!target||!(/^[A-Za-z0-9_]{1,64}$/).test(target.database))throw Error('B1 verified backup and separate confirmation required');
 const [identity]=await db.query('SELECT DATABASE() AS database_name, @@server_uuid AS server_uuid');
 if(rows(identity).length!==1||rows(identity)[0].database_name!==target.database||rows(identity)[0].server_uuid!==target.serverUuid)throw Error('B1 migration target mismatch');
 const lock='fabric-v2:'+target.database,[got]=await db.query('SELECT GET_LOCK(?,0) AS acquired',[lock]);
 if(Number(rows(got)[0]?.acquired)!==1)throw Error('B1 migration lock unavailable');
 try{
  const migrationId='20261017-b1-share';
  const [found]=await db.query('SELECT plan_sha256,applied_at FROM fabric_v2_migration_ledger WHERE migration_id=?',[migrationId]);
  const existing=rows(found);if(existing.length>1||existing[0]&&existing[0].plan_sha256!==PATTERN_SHARE_PLAN_SHA256)throw Error('B1 migration plan drift');
  const inspect=()=>verifyPatternLinkRuntimeSchema({async getConnection(){return {query:db.query.bind(db),release(){}};}},target);
  if(existing[0]?.applied_at){await inspect();return {alreadyApplied:true,planSha256:PATTERN_SHARE_PLAN_SHA256};}
  await db.query('INSERT IGNORE INTO fabric_v2_migration_ledger(migration_id,plan_sha256,backup_sha256) VALUES (?,?,?)',[migrationId,PATTERN_SHARE_PLAN_SHA256,backupSha256]);
  await db.query(sql);await inspect();
  await db.query('UPDATE fabric_v2_migration_ledger SET applied_at=UTC_TIMESTAMP() WHERE migration_id=?',[migrationId]);
  return {alreadyApplied:false,planSha256:PATTERN_SHARE_PLAN_SHA256};
 }finally{await db.query('SELECT RELEASE_LOCK(?)',[lock]);}
}
