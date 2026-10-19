import {createHash} from 'node:crypto';
import type {V2ProductionTarget} from '../product-master/v2ProductionTarget';
interface Db{query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>}
const fields=[
 ['orders','order_no','varchar(100)','NULL'],['orders','style_no','varchar(100)','NULL'],
 ['orders','sign_person','varchar(100)','NULL'],['orders','receiver','varchar(100)','NULL'],['orders','receiver_phone','varchar(100)','NULL'],
 ['orders','total_meters','decimal(14,2)','NULL DEFAULT 0'],['orders','total_amount','decimal(14,2)','NULL DEFAULT 0'],
 ['order_items','product_no','varchar(160)','NULL'],['order_items','product_name','varchar(255)','NULL'],['order_items','composition','varchar(255)','NULL'],
 ['company_config','issuer_label','varchar(100)','NULL'],['company_config','receiver_label','varchar(100)','NULL']
] as const;
const COUNTERS=`CREATE TABLE IF NOT EXISTS v2_document_number_counters (
 document_type ENUM('sample','bulk','deposit') NOT NULL,document_date DATE NOT NULL,next_number BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(document_type,document_date),CONSTRAINT ck_v2_doc_counter_positive CHECK(next_number>0)
 ) ENGINE=InnoDB`;
const PLAN=createHash('sha256').update(JSON.stringify([COUNTERS,fields])).digest('hex');
const rows=(raw:unknown):Record<string,any>[]=>{if(!Array.isArray(raw))throw Error('Document support metadata unavailable');return raw;};
async function metadata(db:Db,table:string){const [raw]=await db.query('SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',[table]);return rows(raw);}
/** Preserve larger compatible storage; unknown types/scale changes require their own reviewed migration. */
export function shouldWidenDocumentColumn(actual:string,required:string):boolean{
 const a=/^varchar\((\d+)\)$/.exec(actual.toLowerCase()),b=/^varchar\((\d+)\)$/.exec(required);
 if(a&&b)return Number(a[1])<Number(b[1]);
 const x=/^decimal\((\d+),(\d+)\)$/.exec(actual.toLowerCase()),y=/^decimal\((\d+),(\d+)\)$/.exec(required);
 if(x&&y&&x[2]===y[2])return Number(x[1])<Number(y[1]);
 throw Error('Document storage drift requires a separate migration');
}
export async function verifyV2DocumentSupportSchema(db:Db){
 for(const table of ['orders','order_items','company_config']){
  const columns=await metadata(db,table);
  if(fields.filter(f=>f[0]===table).some(([,name,type])=>{const column=columns.find(c=>c.COLUMN_NAME===name);return !column||shouldWidenDocumentColumn(column.COLUMN_TYPE,type);}))throw Error('Document field storage contract incomplete');
 }
 const columns=await metadata(db,'v2_document_number_counters');
 for(const [name,type] of [['document_type',"enum('sample','bulk','deposit')"],['document_date','date'],['next_number','bigint unsigned']]){
  if(!columns.some(c=>c.COLUMN_NAME===name&&c.COLUMN_TYPE.toLowerCase()===type&&c.IS_NULLABLE==='NO'))throw Error('Document counter schema incomplete');
 }
 const [indices]=await db.query("SELECT COLUMN_NAME,NON_UNIQUE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='v2_document_number_counters' AND INDEX_NAME='PRIMARY' ORDER BY SEQ_IN_INDEX");
 if(JSON.stringify(rows(indices).map(r=>[r.COLUMN_NAME,Number(r.NON_UNIQUE)]))!==JSON.stringify([['document_type',0],['document_date',0]]))throw Error('Document counter uniqueness missing');
 const [checks]=await db.query("SELECT ENFORCED FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='v2_document_number_counters' AND CONSTRAINT_NAME='ck_v2_doc_counter_positive' AND CONSTRAINT_TYPE='CHECK'");
 if(rows(checks).length!==1||rows(checks)[0].ENFORCED!=='YES')throw Error('Document counter check missing');
}
/** Second additive migration; the already-reviewed core migration plan/hash remains immutable. */
export async function migrateV2DocumentSupport(db:Db,target:V2ProductionTarget,backupSha256:string){
 if(!/^[a-f0-9]{64}$/.test(backupSha256))throw Error('Verified backup required');
 const [identity]=await db.query('SELECT DATABASE() AS database_name,@@server_uuid AS server_uuid');
 if(rows(identity).length!==1||rows(identity)[0].database_name!==target.database||rows(identity)[0].server_uuid!==target.serverUuid)throw Error('Document migration target mismatch');
 const lock='fabric-v2:'+target.database,[held]=await db.query('SELECT GET_LOCK(?,0) AS acquired',[lock]);
 if(Number(rows(held)[0]?.acquired)!==1)throw Error('Document migration lock unavailable');
 try{
  const id='20261017-v2-document-support',[ledger]=await db.query('SELECT plan_sha256,applied_at FROM fabric_v2_migration_ledger WHERE migration_id=?',[id]);
  if(rows(ledger).length&&rows(ledger)[0].plan_sha256!==PLAN)throw Error('Document migration plan drift');
  if(rows(ledger)[0]?.applied_at){await verifyV2DocumentSupportSchema(db);return {alreadyApplied:true,planSha256:PLAN};}
  await db.query('INSERT IGNORE INTO fabric_v2_migration_ledger(migration_id,plan_sha256,backup_sha256) VALUES(?,?,?)',[id,PLAN,backupSha256]);
  const protectedData=new Map<string,{columns:string;digest:string}>();
  for(const table of ['orders','order_items','company_config']){
   const columns=(await metadata(db,table)).map(c=>String(c.COLUMN_NAME));if(!columns.length||columns.some(c=>!/^[a-zA-Z0-9_]+$/.test(c)))throw Error('Legacy metadata unavailable');
   const projection=columns.map(c=>'`'+c+'`').join(','),[data]=await db.query('SELECT '+projection+' FROM '+table+' ORDER BY id');
   protectedData.set(table,{columns:projection,digest:createHash('sha256').update(JSON.stringify(data)).digest('hex')});
  }
  const upgrades:{table:string;name:string;type:string;extra:string;exists:boolean}[]=[];
  for(const [table,name,type,extra] of fields){
   const existing=(await metadata(db,table)).find(c=>c.COLUMN_NAME===name);
   if(!existing&&!['issuer_label','receiver_label'].includes(name))throw Error('Required legacy column absent');
   if(existing&&!shouldWidenDocumentColumn(existing.COLUMN_TYPE,type))continue;
   upgrades.push({table,name,type,extra:existing?.IS_NULLABLE==='NO'?extra.replace(/^NULL/,'NOT NULL'):extra,exists:!!existing});
  }
  await db.query(COUNTERS);
  for(const {table,name,type,extra,exists} of upgrades)await db.query('ALTER TABLE '+table+' '+(exists?'MODIFY':'ADD')+' COLUMN '+name+' '+type+' '+extra);
  await verifyV2DocumentSupportSchema(db);
  for(const [table,{columns,digest}] of protectedData){const [data]=await db.query('SELECT '+columns+' FROM '+table+' ORDER BY id');if(createHash('sha256').update(JSON.stringify(data)).digest('hex')!==digest)throw Error('Legacy fields changed during document migration');}
  await db.query('UPDATE fabric_v2_migration_ledger SET applied_at=UTC_TIMESTAMP() WHERE migration_id=?',[id]);
  return {alreadyApplied:false,planSha256:PLAN,legacyFieldsUnchanged:true};
 }finally{await db.query('SELECT RELEASE_LOCK(?)',[lock]);}
}
