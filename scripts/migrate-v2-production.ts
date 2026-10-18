/** Operator-only additive migration. Never imported by server startup. */
import mysql from 'mysql2/promise';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolveV2ProductionTarget} from '../server/product-master/v2ProductionTarget';
import {migrateV2Production} from '../server/product-master/v2ProductionMigration';
import {migrateV2DocumentSupport} from '../server/order-v2/documentSupportSchema';
import {migrateV2DocumentAudit} from '../server/order-v2/documentAuditSchema';
import {migrateSessionLifecycle} from '../server/customer-samples/sessionLifecycleSchema';
import {migratePatternShareLinks} from '../server/customer-share/patternShareMigration';
async function main(){
 const target=resolveV2ProductionTarget(process.env);
 const backup=process.env.FABRIC_V2_BACKUP_FILE;
 if(!target||process.env.FABRIC_V2_MIGRATION_ACK!=='APPLY_ADDITIVE_V2'||
  !backup||!/^\/var\/backups\/fabric\/v2-release-[A-Za-z0-9]+\/fabric_db\.sql\.gz$/.test(backup))throw Error('Explicit migration settings and verified backup required');
 const sha=createHash('sha256').update(await readFile(backup)).digest('hex');
 if(sha!==process.env.FABRIC_V2_BACKUP_SHA256)throw Error('Backup digest mismatch');
 const connection=await mysql.createConnection({socketPath:'/var/run/mysqld/mysqld.sock',user:'root',database:target.database,dateStrings:true,supportBigNumbers:true,bigNumberStrings:true});
 try{const core=await migrateV2Production(connection,target,{backupSha256:sha,confirmation:process.env.FABRIC_V2_MIGRATION_ACK});const documentSupport=await migrateV2DocumentSupport(connection,target,sha);const documentAudit=await migrateV2DocumentAudit(connection,target,sha);const patternShare=process.env.FABRIC_V2_MIGRATE_PATTERN_SHARE==='APPLY_B1_SHARE'?await migratePatternShareLinks(connection,target,sha,'APPLY_B1_SHARE'):null;const sessionLifecycle=process.env.FABRIC_V2_MIGRATE_SESSION_LIFECYCLE==='APPLY_SAMPLE_LIFECYCLE'?await migrateSessionLifecycle(connection,target,sha):null;console.log(JSON.stringify({target:target.database,...core,documentSupport,documentAudit,patternShare,sessionLifecycle}));}
 finally{await connection.end();}
}
main().catch(error=>{console.error(error instanceof Error&&/^(Migration|V2|Verified|Explicit|Backup|Protected|Legacy|B2|P1)/.test(error.message)?error.message:'V2 migration failed; inspect target safely');process.exitCode=1;});
