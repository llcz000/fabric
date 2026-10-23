/**
 * P1-D-2 additive *isolated rehearsal* only. Existing lines get NULL source /
 * product ID / frozen snapshot; they are NEVER labeled as admin manual lines.
 */
export const LINE_DDL=`ALTER TABLE order_items
 ADD COLUMN v2_product_id BIGINT UNSIGNED NULL,
 ADD COLUMN v2_source_kind ENUM('catalog','manual') NULL,
 ADD COLUMN v2_product_snapshot JSON NULL,
 ADD INDEX idx_v2_order_line_product (v2_product_id),
 ADD CONSTRAINT fk_v2_order_line_product FOREIGN KEY (v2_product_id) REFERENCES v2_products(id) ON DELETE RESTRICT,
 ADD CONSTRAINT ck_v2_order_line_provenance CHECK (
    (v2_source_kind IS NULL AND v2_product_id IS NULL AND v2_product_snapshot IS NULL)
 OR (v2_source_kind = 'catalog' AND v2_product_id IS NOT NULL AND v2_product_snapshot IS NOT NULL)
 OR (v2_source_kind = 'manual' AND v2_product_id IS NULL AND v2_product_snapshot IS NOT NULL)
 )`;
export function getP1D2LineMigrationSql():readonly string[]{return [LINE_DDL];}
interface Db{query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>}
type Meta=Record<string,unknown>;
const arr=(x:unknown):Meta[]=>{if(!Array.isArray(x))throw Error('P1-D-2 metadata unavailable');return x as Meta[];};
export async function inspectP1D2Lines(db:Db):Promise<'legacy'|'expanded'>{
 const [raw]=await db.query(
  'SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',
  ['order_items']);
 const columns=arr(raw);
 if(!columns.some(x=>x.COLUMN_NAME==='id')||!columns.some(x=>x.COLUMN_NAME==='order_id'))
  throw Error('order_items stable id/order_id missing');
 const spec:Record<string,string>={v2_product_id:'bigint unsigned',v2_source_kind:"enum('catalog','manual')",v2_product_snapshot:'json'};
 const fields=Object.keys(spec).filter(name=>columns.some(x=>x.COLUMN_NAME===name));
 if(fields.length===0)return 'legacy';
 if(fields.length!==3)throw Error('P1-D-2 partial line schema migration');
 for(const name of Object.keys(spec)){
  const col=columns.find(x=>x.COLUMN_NAME===name)!;
  if(String(col.COLUMN_TYPE).toLowerCase()!==spec[name]||String(col.IS_NULLABLE)!=='YES')
   throw Error('P1-D-2 order_items.'+name+' type/null drift');
 }
 const [idxRaw]=await db.query(
  "SELECT COLUMN_NAME,NON_UNIQUE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='order_items' AND INDEX_NAME='idx_v2_order_line_product'");
 const idx=arr(idxRaw);
 if(idx.length!==1||idx[0].COLUMN_NAME!=='v2_product_id')throw Error('idx_v2_order_line_product missing');
 const [fkRaw]=await db.query(
  "SELECT k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME='order_items' AND k.CONSTRAINT_NAME='fk_v2_order_line_product'");
 const fks=arr(fkRaw);
 if(fks.length!==1||fks[0].COLUMN_NAME!=='v2_product_id'||fks[0].REFERENCED_TABLE_NAME!=='v2_products'||fks[0].REFERENCED_COLUMN_NAME!=='id'||String(fks[0].DELETE_RULE)!=='RESTRICT')
  throw Error('fk_v2_order_line_product incorrect');
 const [checksRaw]=await db.query(
  "SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='order_items' AND CONSTRAINT_TYPE='CHECK'");
 if(!arr(checksRaw).some(x=>x.CONSTRAINT_NAME==='ck_v2_order_line_provenance'))
  throw Error('ck_v2_order_line_provenance absent');
 return 'expanded';
}
