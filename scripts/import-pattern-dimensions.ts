/** Operator-only, user-authorized import. Never invoked by application startup. */
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import ExcelJS from 'exceljs';
import mysql from 'mysql2/promise';
import {mergePatternDimensionRows,applyPatternDimensionImport,validateDimensionImportTarget} from '../server/product-master/patternDimensionImport';
import {migratePatternDimensions} from '../server/product-master/patternDimensionsSchema';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function main(){
 const [mode,...args]=process.argv.slice(2);
 if(mode==='prepare'){
  const [source,corrections,output]=args;
  async function read(path:string){const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(path);return wb.worksheets[0].getSheetValues().slice(1).map(row=>(row as unknown[]).slice(1));}
  const rows=mergePatternDimensionRows(await read(source),await read(corrections));
  const plan={format:'fabric-pattern-dimensions-v1',sourceSha256:sha(await fs.readFile(source)),correctionsSha256:sha(await fs.readFile(corrections)),rows};
  await fs.writeFile(output,JSON.stringify(plan,null,2));console.log(JSON.stringify({total:rows.length,sourceSha256:plan.sourceSha256,correctionsSha256:plan.correctionsSha256,planSha256:sha(await fs.readFile(output))}));return;
 }
 if(!['inspect','apply','rehearse'].includes(mode))throw Error('Use prepare SOURCE CORRECTIONS OUTPUT, inspect PLAN DATABASE UUID, or apply/rehearse PLAN DATABASE UUID BACKUP BACKUP_SHA PLAN_SHA');
 const [file,database,serverUuid,backup,backupSha,planSha]=args;
 validateDimensionImportTarget(mode,database,serverUuid);
 const bytes=await fs.readFile(file),plan=JSON.parse(bytes.toString('utf8'));
 if(plan.format!=='fabric-pattern-dimensions-v1'||!Array.isArray(plan.rows)||!plan.rows.length||![plan.sourceSha256,plan.correctionsSha256].every(v=>/^[a-f0-9]{64}$/.test(v)))throw Error('Invalid import document');
 const pool=mysql.createPool({socketPath:'/var/run/mysqld/mysqld.sock',user:'root',database,supportBigNumbers:true,bigNumberStrings:true,connectionLimit:2});
 try{
  const [identity]:any=await pool.query('SELECT DATABASE() AS database_name,@@server_uuid AS server_uuid');
  if(identity[0]?.database_name!==database||identity[0]?.server_uuid!==serverUuid)throw Error('Import target mismatch');
  const [masters]:any=await pool.query('SELECT id,master_no FROM pattern_masters WHERE deleted_at IS NULL ORDER BY id');
  const names=new Set(masters.map((r:any)=>r.master_no));const missing=plan.rows.filter((r:any)=>!names.has(r.masterNo)).map((r:any)=>r.masterNo);
  const [columns]:any=await pool.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pattern_masters' AND COLUMN_NAME IN ('width_cm','height_cm')");
  if(mode==='inspect'){console.log(JSON.stringify({mode,total:plan.rows.length,matched:plan.rows.length-missing.length,missing,currentMasters:masters.length,dimensionColumns:columns.length,planSha256:sha(bytes)}));return;}
  if(missing.length)throw Error('Import contains unmatched masters');
  if(!/^[a-f0-9]{64}$/.test(backupSha??'')||sha(await fs.readFile(backup))!==backupSha||sha(bytes)!==planSha)throw Error('Verified backup and exact plan required');
  const migration=await migratePatternDimensions(pool as never,{database,serverUuid},backupSha);
  const imported=await applyPatternDimensionImport(pool as never,plan.rows);
  let repeat:unknown;
  if(mode==='rehearse'){
   const repeatedMigration=await migratePatternDimensions(pool as never,{database,serverUuid},backupSha);
   const repeatedImport=await applyPatternDimensionImport(pool as never,plan.rows);
   if(!repeatedMigration.alreadyApplied||repeatedImport.updated!==0||repeatedImport.unchanged!==plan.rows.length)throw Error('Repeat migration/import failed idempotency');
   repeat={migration:repeatedMigration,imported:repeatedImport};
  }
  console.log(JSON.stringify({mode,database,serverUuid,backupSha256:backupSha,planSha256:planSha,migration,imported,...(repeat?{repeat}:{})}));
 }finally{await pool.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
