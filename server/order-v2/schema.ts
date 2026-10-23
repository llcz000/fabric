import type {AppPrincipal} from '../access/types';
import {scopeOrdersQuery} from '../access/sessions';

interface MetadataDb {
 query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>;
}
export type OrderSchemaState='legacy'|'expanded';

const OWNER_DDL=`ALTER TABLE orders
 ADD COLUMN created_by_user_id BIGINT UNSIGNED NULL,
 ADD INDEX idx_v2_orders_owner (created_by_user_id),
 ADD CONSTRAINT fk_v2_orders_actor FOREIGN KEY (created_by_user_id)
 REFERENCES v2_access_users(id) ON DELETE RESTRICT`;

/**
 * Intentionally additive: never assign a historical order's unknown owner
 * to a guessed employee. Legacy NULL means admin-only until explicit attribution.
 * Physical database changes are tested ONLY in a fixed isolated sandbox.
 */
export function getP1DAdditiveMigrationSql():readonly string[]{return [OWNER_DDL];}

async function getColumns(db:MetadataDb,table:'orders'|'order_items') {
 const [raw]=await db.query(
  'SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',
  [table]
 );
 if(!Array.isArray(raw))throw Error('Cannot read MySQL metadata '+table);
 return raw as {COLUMN_NAME:string;COLUMN_TYPE:string;IS_NULLABLE:string}[];
}
async function hasIdPrimary(db:MetadataDb,table:'orders'|'order_items'):Promise<boolean>{
 const [raw]=await db.query(
  "SELECT INDEX_NAME,COLUMN_NAME,NON_UNIQUE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME='PRIMARY'",
  [table]
 );
 if(!Array.isArray(raw))throw Error('Cannot inspect primary key for '+table);
 return raw.length===1 && (raw[0] as {INDEX_NAME:string;COLUMN_NAME:string;NON_UNIQUE:number}).COLUMN_NAME==='id';
}
export async function inspectP1DCompatibility(db:MetadataDb):Promise<{state:OrderSchemaState}> {
 const orders=await getColumns(db,'orders'),items=await getColumns(db,'order_items');
 for(const table of ['orders','order_items'] as const){
  if(!await hasIdPrimary(db,table))throw Error('Missing stable '+table+'.id primary key');
 }
 for(const name of ['id','order_no','order_date']){
  if(!orders.some(c=>c.COLUMN_NAME===name))throw Error('Missing required orders.'+name);
 }
 for(const name of ['id','order_id','product_no','product_name']){
  if(!items.some(c=>c.COLUMN_NAME===name))throw Error('Missing required order_items.'+name);
 }
 const owner=orders.find(c=>c.COLUMN_NAME==='created_by_user_id');
 if(owner){
  if(owner.COLUMN_TYPE.toLowerCase()!=='bigint unsigned')
   throw Error('orders.created_by_user_id type drift; refuse migration');
  if(owner.IS_NULLABLE!=='YES')throw Error('orders.created_by_user_id must be nullable for unknown historical owners');
  const [indexRows]=await db.query(
   "SELECT INDEX_NAME,COLUMN_NAME,NON_UNIQUE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND INDEX_NAME='idx_v2_orders_owner'"
  );
  const indices=Array.isArray(indexRows)?indexRows as Record<string,unknown>[]:[];
  if(indices.length!==1||indices[0].COLUMN_NAME!=='created_by_user_id')
   throw Error('idx_v2_orders_owner missing or altered');
  const [fkRows]=await db.query(
   "SELECT k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME='orders' AND k.CONSTRAINT_NAME='fk_v2_orders_actor'"
  );
  const fks=Array.isArray(fkRows)?fkRows as Record<string,unknown>[]:[];
  if(fks.length!==1||fks[0].COLUMN_NAME!=='created_by_user_id'||
     fks[0].REFERENCED_TABLE_NAME!=='v2_access_users'||
     fks[0].REFERENCED_COLUMN_NAME!=='id'||
     String(fks[0].DELETE_RULE).toUpperCase()!=='RESTRICT')
    throw Error('fk_v2_orders_actor missing or unsafe delete behavior');
 }
 return {state:owner?'expanded':'legacy'};
}
/** Reuse one SQL-side mandatory filter for list, search, stats, print/export. */
export function buildP1DOrderListScope(actor:AppPrincipal|null|undefined):{where:string;params:string[]} {
 const scoped=scopeOrdersQuery(actor);
 return {where:scoped.predicate,params:scoped.parameters};
}
