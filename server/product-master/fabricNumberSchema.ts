import {createHash} from 'node:crypto';
import type {V2ProductionTarget} from './v2ProductionTarget';
interface Db{query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>}
const SQL='ALTER TABLE v2_fabrics DROP CHECK ck_v2_fabric_no, ADD CONSTRAINT ck_v2_fabric_no CHECK (CHAR_LENGTH(TRIM(fabric_no))>0)';
export const FABRIC_NUMBER_PLAN_SHA256=createHash('sha256').update(SQL).digest('hex');
const rows=(raw:unknown):Record<string,unknown>[]=>{if(!Array.isArray(raw))throw Error('Fabric number metadata unavailable');return raw;};
async function constraint(db:Db){
 const [raw]=await db.query("SELECT c.CHECK_CLAUSE FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS c JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS t ON t.CONSTRAINT_SCHEMA=c.CONSTRAINT_SCHEMA AND t.CONSTRAINT_NAME=c.CONSTRAINT_NAME WHERE t.TABLE_SCHEMA=DATABASE() AND t.TABLE_NAME='v2_fabrics' AND t.CONSTRAINT_NAME='ck_v2_fabric_no' AND t.ENFORCED='YES'");
 return rows(raw);
}
const normalized=(v:unknown)=>String(v??'').toLowerCase().replaceAll('_utf8mb4','').replaceAll(String.fromCharCode(92,39),String.fromCharCode(39)).replace(/[\s\x60()]/g,'');
export async function verifyFabricNumberSchema(db:Db){
 const found=await constraint(db);
 if(found.length!==1||normalized(found[0].CHECK_CLAUSE)!=='char_lengthtrimfabric_no>0')throw Error('Fabric number nonempty constraint drift');
}
/** Explicit backed-up migration only; no application-startup DDL or row rewrites. */
export async function initializeFabricNumberSchema(db:Db){
 const found=await constraint(db),clause=normalized(found[0]?.CHECK_CLAUSE);
 if(found.length!==1)throw Error('Fabric number constraint missing');
 if(clause!=='char_lengthtrimfabric_no>0'){
  if(clause!=="regexp_likefabric_no,'^[a-z0-9]+$'")throw Error('Fabric number old constraint drift');
  await db.query(SQL);
 }
 await verifyFabricNumberSchema(db);
}
export async function migrateFabricNumber(db:Db&{getConnection?():Promise<Db&{release():void}>},target:V2ProductionTarget,backupSha256:string):Promise<{alreadyApplied:boolean;planSha256:string}>{
 if(db.getConnection){const c=await db.getConnection();try{return await migrateFabricNumber(c,target,backupSha256);}finally{c.release();}}
 if(!/^[a-f0-9]{64}$/.test(backupSha256))throw Error('Verified backup required');
 const [raw]=await db.query('SELECT DATABASE() AS database_name,@@server_uuid AS server_uuid'),identity=rows(raw);
 if(identity.length!==1||identity[0].database_name!==target.database||identity[0].server_uuid!==target.serverUuid)throw Error('Fabric number target mismatch');
 const lock='fabric-v2:'+target.database,[held]=await db.query('SELECT GET_LOCK(?,0) AS acquired',[lock]);
 if(Number(rows(held)[0]?.acquired)!==1)throw Error('Fabric number migration lock unavailable');
 const plan=FABRIC_NUMBER_PLAN_SHA256;
 try{
  const id='20261022-fabric-number-nonempty',[found]=await db.query('SELECT plan_sha256,applied_at FROM fabric_v2_migration_ledger WHERE migration_id=?',[id]),ledger=rows(found);
  if(ledger.length&&ledger[0].plan_sha256!==plan)throw Error('Fabric number migration plan drift');
  if(ledger[0]?.applied_at){await verifyFabricNumberSchema(db);return {alreadyApplied:true,planSha256:plan};}
  await db.query('INSERT IGNORE INTO fabric_v2_migration_ledger(migration_id,plan_sha256,backup_sha256) VALUES(?,?,?)',[id,plan,backupSha256]);
  await initializeFabricNumberSchema(db);
  await db.query('UPDATE fabric_v2_migration_ledger SET applied_at=UTC_TIMESTAMP() WHERE migration_id=?',[id]);
  return {alreadyApplied:false,planSha256:plan};
 }finally{await db.query('SELECT RELEASE_LOCK(?)',[lock]);}
}
