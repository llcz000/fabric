import {createHash} from 'node:crypto';
import {getV2ProductMasterCreateStatements} from './schema';
import {verifyV2SchemaContract} from './schemaContract';
import {getAccessSchemaCreateStatements} from '../access/schema';
import {getP1DAdditiveMigrationSql,inspectP1DCompatibility} from '../order-v2/schema';
import {getP1D2LineMigrationSql,inspectP1D2Lines} from '../order-v2/lineSchema';
import {getV2DocumentDisplaySchemaSql,inspectV2DocumentDisplaySchema} from '../order-v2/displaySchema';
import {getSampleSchemaStatements} from '../customer-samples/schema';
import {getFulfillmentSchemaStatements} from '../customer-samples/fulfillmentSchema';
import {verifyB25SampleSchemaContract} from '../customer-samples/schemaContract';
import {verifyFulfillmentSchemaContract} from '../customer-samples/fulfillmentSchemaContract';
import type {V2ProductionTarget} from './v2ProductionTarget';
interface Db{query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>}
const rows=(value:unknown):Record<string,any>[]=>{if(!Array.isArray(value))throw Error('Migration metadata unavailable');return value;};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const creates=[...getAccessSchemaCreateStatements(),...getV2ProductMasterCreateStatements().map(s=>s.sql),
 ...getSampleSchemaStatements().map(s=>s.sql.replace(/^CREATE TABLE /,'CREATE TABLE IF NOT EXISTS ')),
 ...getFulfillmentSchemaStatements().map(s=>s.sql.replace(/^CREATE TABLE /,'CREATE TABLE IF NOT EXISTS '))];
const alterations=[...getP1DAdditiveMigrationSql(),...getP1D2LineMigrationSql(),...getV2DocumentDisplaySchemaSql()];
const PLAN_HASH=hash([...creates,...alterations]);
/** Read only; no schema repair during server startup. */
export async function verifyV2ProductionSchema(db:Db,database:string):Promise<void>{
 await verifyV2SchemaContract(db);
 if((await inspectP1DCompatibility(db)).state!=='expanded'||await inspectP1D2Lines(db)!=='expanded'||await inspectV2DocumentDisplaySchema(db)!=='expanded')throw Error('V2 order migration incomplete');
 await verifyB25SampleSchemaContract(db);
 await verifyFulfillmentSchemaContract({async getConnection(){return {query:db.query.bind(db),release(){}};}},database);
 for(const table of ['v2_access_users','v2_access_sessions']){
  const [meta]=await db.query('SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);
  const columns=new Set(rows(meta).map(r=>r.COLUMN_NAME));
  const required=table==='v2_access_users'?['id','username','username_normalized','password_hash','display_name','role','is_active','can_manage_own_orders','can_manage_products']:['id','user_id','token_hash','expires_at','revoked_at'];
  if(required.some(c=>!columns.has(c)))throw Error('V2 access schema incomplete');
 }
}
/** Explicit operator entry only. One physical connection holds identity, advisory lock and all DDL.
 * DDL implicitly commits; rollback means retaining additions and restoring the old application.
 * No historical attribution, snapshot backfill, old product mutation or table deletion.
 */
export async function migrateV2Production(db:Db,target:V2ProductionTarget,input:{backupSha256:string;confirmation:string}){
 if(input.confirmation!=='APPLY_ADDITIVE_V2'||!/^[a-f0-9]{64}$/.test(input.backupSha256))throw Error('Verified backup and explicit migration confirmation required');
 const [identity]=await db.query('SELECT DATABASE() AS database_name, @@server_uuid AS server_uuid');
 if(rows(identity).length!==1||rows(identity)[0].database_name!==target.database||rows(identity)[0].server_uuid!==target.serverUuid)throw Error('Migration target mismatch');
 const lock='fabric-v2:'+target.database;
 const [got]=await db.query('SELECT GET_LOCK(?,0) AS acquired',[lock]);
 if(Number(rows(got)[0]?.acquired)!==1)throw Error('V2 migration lock unavailable');
 try{
  await db.query(`CREATE TABLE IF NOT EXISTS fabric_v2_migration_ledger (
   migration_id VARCHAR(64) NOT NULL PRIMARY KEY,plan_sha256 CHAR(64) NOT NULL,backup_sha256 CHAR(64) NOT NULL,
   applied_at DATETIME NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  const [ledger]=await db.query('SELECT plan_sha256,applied_at FROM fabric_v2_migration_ledger WHERE migration_id=?',['20261017-v2-additive']);
  if(rows(ledger).length&&rows(ledger)[0].plan_sha256!==PLAN_HASH)throw Error('Migration plan drift');
  if(rows(ledger)[0]?.applied_at){await verifyV2ProductionSchema(db,target.database);return {alreadyApplied:true,planSha256:PLAN_HASH};}
  await db.query('INSERT IGNORE INTO fabric_v2_migration_ledger(migration_id,plan_sha256,backup_sha256) VALUES (?,?,?)',['20261017-v2-additive',PLAN_HASH,input.backupSha256]);
  const protectedTables=['orders','order_items','products','image_assets','company_config','inventory_entries'];
  const protectedData=new Map<string,{columns:string;digest:string}>();
  for(const table of protectedTables){
   const [meta]=await db.query('SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',[table]);
   const names=rows(meta).map(r=>String(r.COLUMN_NAME));
   if(!names.length||names.some(n=>!/^[a-zA-Z0-9_]+$/.test(n)))throw Error('Protected legacy table unavailable');
   const columns=names.map(n=>'`'+n+'`').join(',');
   const [data]=await db.query('SELECT '+columns+' FROM `'+table+'` ORDER BY id');
   protectedData.set(table,{columns,digest:hash(data)});
  }
  for(const sql of creates)await db.query(sql);
  if((await inspectP1DCompatibility(db)).state==='legacy')for(const sql of getP1DAdditiveMigrationSql())await db.query(sql);
  if(await inspectP1D2Lines(db)==='legacy')for(const sql of getP1D2LineMigrationSql())await db.query(sql);
  if(await inspectV2DocumentDisplaySchema(db)==='legacy')for(const sql of getV2DocumentDisplaySchemaSql())await db.query(sql);
  await verifyV2ProductionSchema(db,target.database);
  for(const [table,{columns,digest}] of protectedData){
   const [data]=await db.query('SELECT '+columns+' FROM `'+table+'` ORDER BY id');
   if(hash(data)!==digest)throw Error('Legacy data changed during migration; release acceptance refused');
  }
  await db.query('UPDATE fabric_v2_migration_ledger SET applied_at=UTC_TIMESTAMP() WHERE migration_id=?',['20261017-v2-additive']);
  return {alreadyApplied:false,planSha256:PLAN_HASH,protectedTables:protectedData.size,legacyFieldsUnchanged:true};
 }finally{await db.query('SELECT RELEASE_LOCK(?)',[lock]);}
}
