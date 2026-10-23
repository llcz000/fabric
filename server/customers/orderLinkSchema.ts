import {createHash} from 'node:crypto';
import type {CustomerSchemaTarget,CustomerMigrationPool,CustomerMetadataPool,CustomerMetadataConnection} from './schema';
import {rows} from './model';
export const CUSTOMER_ORDER_SQL=`CREATE TABLE IF NOT EXISTS customer_order_links (
 order_id INT NOT NULL PRIMARY KEY,customer_id BIGINT UNSIGNED NULL,
 row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,linked_by_user_id BIGINT UNSIGNED NOT NULL,
 KEY ix_customer_order(customer_id,order_id),
 CONSTRAINT fk_customer_order FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_customer_order_customer FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_customer_order_actor FOREIGN KEY(linked_by_user_id) REFERENCES v2_access_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`;
// Customer names already allow 160 characters; the old document field allowed only 100.
const widenPlan='orders.receiving_unit varchar(160), preserve nullability/default and existing values';
export const CUSTOMER_ORDER_PLAN_SHA256=createHash('sha256').update(CUSTOMER_ORDER_SQL+'\n'+widenPlan).digest('hex');
async function nameColumn(db:CustomerMetadataConnection){const [raw]=await db.query("SELECT COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='receiving_unit'");const list=rows(raw),c=list[0];if(list.length!==1||!/^varchar\(\d+\)$/.test(c.COLUMN_TYPE)||!['YES','NO'].includes(c.IS_NULLABLE)||c.COLUMN_DEFAULT!==null&&typeof c.COLUMN_DEFAULT!=='string')throw Error('Customer document name storage mismatch');return c;}
async function identity(db:CustomerMetadataConnection,target:CustomerSchemaTarget){
 if(!/^[A-Za-z0-9_]{1,64}$/.test(target.database)||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(target.serverUuid))throw Error('Explicit customer order target required');
 const [raw]=await db.query('SELECT DATABASE() AS selected_database,@@server_uuid AS server_uuid');const found=rows(raw);if(found.length!==1||found[0].selected_database!==target.database||found[0].server_uuid!==target.serverUuid)throw Error('Customer order target mismatch');
}
async function inspect(db:CustomerMetadataConnection,target:CustomerSchemaTarget){
 await identity(db,target);
 if(Number((await nameColumn(db)).COLUMN_TYPE.match(/\d+/)[0])<160)throw Error('Customer document name storage too short');
 const [table]=await db.query("SELECT ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customer_order_links'");if(rows(table).length!==1||rows(table)[0].ENGINE!=='InnoDB')throw Error('Customer order table unavailable');
 const [raw]=await db.query("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customer_order_links'");const columns=rows(raw);
 const expected=[['order_id','int','NO',null],['customer_id','bigint unsigned','YES',null],['row_version','bigint unsigned','NO','1'],['linked_by_user_id','bigint unsigned','NO',null]];
 if(columns.length!==4||expected.some(([name,type,nullable,def])=>!columns.some(c=>c.COLUMN_NAME===name&&c.COLUMN_TYPE===type&&c.IS_NULLABLE===nullable&&c.EXTRA===''&&(def===null?c.COLUMN_DEFAULT===null:String(c.COLUMN_DEFAULT)===def))))throw Error('Customer order columns mismatch');
 const [index]=await db.query("SELECT INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,IS_VISIBLE,EXPRESSION FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customer_order_links'");const indices=rows(index),primary=indices.filter(i=>i.INDEX_NAME==='PRIMARY');if(primary.length!==1||primary[0].COLUMN_NAME!=='order_id'||Number(primary[0].NON_UNIQUE)!==0||primary[0].SUB_PART!==null||primary[0].IS_VISIBLE!=='YES'||primary[0].EXPRESSION!==null)throw Error('Customer order uniqueness mismatch');
 if(!indices.some(i=>i.COLUMN_NAME==='customer_id'&&Number(i.SEQ_IN_INDEX)===1&&i.SUB_PART===null&&i.IS_VISIBLE==='YES'&&i.EXPRESSION===null))throw Error('Customer order history index missing');
 const [refs]=await db.query("SELECT k.COLUMN_NAME,k.REFERENCED_TABLE_SCHEMA,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE,r.UPDATE_RULE FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME='customer_order_links' AND k.REFERENCED_TABLE_NAME IS NOT NULL");const fks=rows(refs);
 if(fks.length!==3||[['order_id','orders'],['customer_id','customers'],['linked_by_user_id','v2_access_users']].some(([column,parent])=>!fks.some(f=>f.COLUMN_NAME===column&&f.REFERENCED_TABLE_SCHEMA===target.database&&f.REFERENCED_TABLE_NAME===parent&&f.REFERENCED_COLUMN_NAME==='id'&&f.DELETE_RULE==='RESTRICT'&&f.UPDATE_RULE==='RESTRICT')))throw Error('Customer order references mismatch');
}
export async function verifyCustomerOrderSchema(pool:CustomerMetadataPool,target:CustomerSchemaTarget){const db=await pool.getConnection();try{await inspect(db,target);}finally{db.release();}}
/** Operator entry only; startup never calls this function. Original customer migration stays immutable. */
export async function migrateCustomerOrders(pool:CustomerMigrationPool,target:CustomerSchemaTarget,backupSha256:string,confirmation:string){
 if(confirmation!=='APPLY_CUSTOMER_V12'||!/^[a-f0-9]{64}$/.test(backupSha256))throw Error('Explicit V1.2 confirmation and verified backup required');
 const db=await pool.getConnection(),lock='fabric-v2:'+target.database,id='20261021-customer-v12';let state:'none'|'uncertain'|'held'='none';
 try{await identity(db,target);state='uncertain';const [raw]=await db.query('SELECT GET_LOCK(?,0) AS acquired',[lock]);const got=rows(raw);if(got.length!==1)throw Error('Customer order lock unknown');if(got[0].acquired===0||got[0].acquired===null){state='none';throw Error('Customer order lock busy');}if(Number(got[0].acquired)!==1)throw Error('Customer order lock unknown');state='held';
  const [rawLedger]=await db.query('SELECT plan_sha256,applied_at FROM fabric_v2_migration_ledger WHERE migration_id=?',[id]);const ledger=rows(rawLedger);if(ledger.length>1||ledger[0]&&ledger[0].plan_sha256!==CUSTOMER_ORDER_PLAN_SHA256)throw Error('Customer order plan drift');if(ledger[0]?.applied_at){await inspect(db,target);return {alreadyApplied:true,planSha256:CUSTOMER_ORDER_PLAN_SHA256};}
  const column=await nameColumn(db),[before]=await db.query('SELECT id,receiving_unit FROM orders ORDER BY id');
  const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
  await db.query('INSERT IGNORE INTO fabric_v2_migration_ledger(migration_id,plan_sha256,backup_sha256) VALUES (?,?,?)',[id,CUSTOMER_ORDER_PLAN_SHA256,backupSha256]);await db.query(CUSTOMER_ORDER_SQL);
  if(Number(column.COLUMN_TYPE.match(/\d+/)[0])<160){const defaultSql=column.COLUMN_DEFAULT===null?'':" DEFAULT '"+column.COLUMN_DEFAULT.replace(/'/g,"''")+"'";if(column.COLUMN_DEFAULT?.includes('\\'))throw Error('Unsupported document name default');await db.query('ALTER TABLE orders MODIFY COLUMN receiving_unit VARCHAR(160) '+(column.IS_NULLABLE==='YES'?'NULL':'NOT NULL')+defaultSql);}
  await inspect(db,target);const [after]=await db.query('SELECT id,receiving_unit FROM orders ORDER BY id');if(digest(before)!==digest(after))throw Error('Customer migration changed historical names');const [written]=await db.query('UPDATE fabric_v2_migration_ledger SET applied_at=UTC_TIMESTAMP() WHERE migration_id=? AND plan_sha256=? AND applied_at IS NULL',[id,CUSTOMER_ORDER_PLAN_SHA256]);if((written as {affectedRows?:number})?.affectedRows!==1)throw Error('Customer order ledger write failed');return {alreadyApplied:false,planSha256:CUSTOMER_ORDER_PLAN_SHA256};
 }finally{if(state==='held'){state='uncertain';try{const [released]=await db.query('SELECT RELEASE_LOCK(?) AS released',[lock]);if(rows(released).length!==1||Number(rows(released)[0].released)!==1)throw Error('Unknown lock');state='none';}catch{db.destroy();throw Error('Customer order lock release unverified; connection discarded');}}if(state==='uncertain')db.destroy();else db.release();}
}
