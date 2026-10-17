import assert from 'node:assert/strict';
import test from 'node:test';
import {auditP7MediaAndOrderContracts} from './check-v2-p7-media-order-readonly.mjs';
import {P7_READONLY_DB,P7_TABLES} from './check-v2-p7-mysql-readonly.mjs';

const imageColumns=[
 ['image_assets','id','varchar(36)','NO','',''],
 ['image_assets','ref_count','int unsigned','NO','',''],
 ['pattern_colorways','pattern_image_asset_id','varchar(36)','YES','',''],
 ['v2_product_image_assets','product_id','bigint unsigned','NO','',''],
 ['v2_product_image_assets','asset_id','varchar(36)','NO','',''],
 ['v2_product_image_assets','role',"enum('fabric_display','detail','ai_effect')",'NO','',''],
 ['v2_product_image_assets','sort_order','int unsigned','NO','',''],
 ['v2_product_image_assets','deleted_at','datetime','YES','',''],
 ['v2_product_image_assets','active_asset_id','varchar(36)','YES','STORED GENERATED','case when deleted_at is null then asset_id else NULL end'],
 ['order_items','v2_product_id','bigint unsigned','YES','',''],
 ['order_items','v2_source_kind',"enum('catalog','manual')",'YES','',''],
 ['order_items','v2_product_snapshot','json','YES','',''],
 ['orders','created_by_user_id','bigint unsigned','YES','',''],
];
const refs=[
 ['pattern_colorways','fk_v2_colorway_image','pattern_image_asset_id','image_assets','id','RESTRICT'],
 ['v2_product_image_assets','fk_v2_product_image_asset','asset_id','image_assets','id','RESTRICT'],
 ['v2_product_image_assets','fk_v2_product_image_product','product_id','v2_products','id','RESTRICT'],
 ['order_items','fk_v2_order_line_product','v2_product_id','v2_products','id','RESTRICT'],
 ['orders','fk_v2_orders_actor','created_by_user_id','v2_access_users','id','RESTRICT']
];
const indexes=[
 ['uq_v2_product_active_asset',0,1,'product_id'],
 ['uq_v2_product_active_asset',0,2,'active_asset_id'],
 ['idx_v2_product_images_order',1,1,'product_id'],
 ['idx_v2_product_images_order',1,2,'role'],
 ['idx_v2_product_images_order',1,3,'deleted_at'],
 ['idx_v2_product_images_order',1,4,'sort_order']
];
const checks=[['order_items','ck_v2_order_line_provenance','YES']];
const ser=rows=>rows.map(r=>r.join('\t'));
function fixture(over={}){
 const calls=[];
 const query=async(sql)=>{
  calls.push(sql);
  if(sql.startsWith('SELECT DATABASE()'))return [`${over.db??P7_READONLY_DB}\t8.0.46\tserver-test-uuid`];
  if(sql.includes('FROM INFORMATION_SCHEMA.TABLES'))return [...P7_TABLES].sort();
  if(sql.includes('INFORMATION_SCHEMA.COLUMNS')&&sql.includes("TABLE_NAME='order_items'"))
   return ['v2_product_id','v2_product_snapshot','v2_source_kind'];
  if(sql.includes('INFORMATION_SCHEMA.TABLE_CONSTRAINTS')&&sql.includes("TABLE_NAME='order_items'")&&!sql.includes('ENFORCED'))
   return ['ck_v2_order_line_provenance'];
  if(sql.includes('INFORMATION_SCHEMA.KEY_COLUMN_USAGE')&&sql.includes("TABLE_NAME='order_items'"))
   return ['v2_product_id\tv2_products\tRESTRICT'];
  if(sql.includes('INFORMATION_SCHEMA.KEY_COLUMN_USAGE')&&sql.includes("TABLE_NAME='orders'"))
   return ['created_by_user_id\tv2_access_users\tRESTRICT'];
  if(sql.startsWith('SELECT COUNT(*) FROM '))return [String(over.nonempty===sql.slice('SELECT COUNT(*) FROM '.length)?1:0)];
  if(sql.includes('COLUMN_TYPE,IS_NULLABLE,EXTRA,GENERATION_EXPRESSION'))
   return ser(over.columns??imageColumns);
  if(sql.includes('k.TABLE_NAME,k.CONSTRAINT_NAME,k.COLUMN_NAME'))
   return ser(over.refs??refs);
  if(sql.includes('INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME'))
   return ser(over.indexes??indexes);
  if(sql.includes('TABLE_NAME,CONSTRAINT_NAME,ENFORCED'))
   return ser(over.checks??checks);
  throw Error('Unexpected SQL: '+sql);
 };
 return {query,calls};
}
test('P7-4e real read-only media/order schema audit validates FKs, generated uniqueness, frozen JSON and no DML',async()=>{
 const f=fixture();
 const result=await auditP7MediaAndOrderContracts(f.query);
 assert.equal(result.mediaConstraints,true);
 assert.equal(result.mode,'remote MySQL SELECT only');
 assert(f.calls.length>=24);
 assert(f.calls.every(sql=>/^SELECT\s/i.test(sql)&&!sql.includes(';')));
});
test('P7-4e rejects image asset FK cascade/missing and absent generated active-image uniqueness',async()=>{
 await assert.rejects(auditP7MediaAndOrderContracts(fixture({refs:refs.map(r=>r[1]==='fk_v2_product_image_asset'?[...r.slice(0,5),'CASCADE']:r)}).query),/image|reference|foreign key/i);
 await assert.rejects(auditP7MediaAndOrderContracts(fixture({indexes:indexes.filter(r=>r[0]!=='uq_v2_product_active_asset')}).query),/unique|active|image/i);
});
test('P7-4e refuses incorrect enum/image generated column/nullable snapshot type',async()=>{
 await assert.rejects(auditP7MediaAndOrderContracts(fixture({columns:imageColumns.map(r=>r[1]==='role'?[...r.slice(0,2),"enum('detail')",...r.slice(3)]:r)}).query),/role|enum|image/i);
 await assert.rejects(auditP7MediaAndOrderContracts(fixture({columns:imageColumns.map(r=>r[1]==='active_asset_id'?[...r.slice(0,4),'','']:r)}).query),/generated|active/i);
 await assert.rejects(auditP7MediaAndOrderContracts(fixture({columns:imageColumns.map(r=>r[1]==='v2_product_snapshot'?[...r.slice(0,2),'text',...r.slice(3)]:r)}).query),/snapshot|json|type/i);
});
test('P7-4e active-image generated expression must be exactly live-row-only, never inverted',async()=>{
 const inverted=imageColumns.map(r=>r[1]==='active_asset_id'?
  [...r.slice(0,5),'case when deleted_at is not null then asset_id else NULL end']:r);
 await assert.rejects(
  auditP7MediaAndOrderContracts(fixture({columns:inverted}).query),
  /generated|active|identity/i
 );
});
test('P7-4e rejects unenforced provenance CHECK and production/occupied DB before media queries',async()=>{
 await assert.rejects(auditP7MediaAndOrderContracts(fixture({checks:[['order_items','ck_v2_order_line_provenance','NO']]}).query),/enforced|provenance|check/i);
 const p=fixture({db:'fabric_db'});
 await assert.rejects(auditP7MediaAndOrderContracts(p.query),/sandbox|isolated|target/i);
 assert.equal(p.calls.length,1);
 const occupied=fixture({nonempty:'orders'});
 await assert.rejects(auditP7MediaAndOrderContracts(occupied.query),/nonempty|occupied/i);
 assert(!occupied.calls.some(x=>x.includes('GENERATION_EXPRESSION')),'nonempty sandbox fails before extra inspection');
});
