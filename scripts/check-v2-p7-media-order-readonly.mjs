import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
 auditP7ReadOnly,assertReadonlySql,createSshSelect,P7_READONLY_DB
} from './check-v2-p7-mysql-readonly.mjs';

/** P7-4e: additional SELECT-only assertions over a proven empty sandbox.
 * Never writes fixtures, invokes V2 services, or points at a production DB.
 */
const columnSql="SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,EXTRA,GENERATION_EXPRESSION FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('image_assets','pattern_colorways','v2_product_image_assets','order_items','orders') ORDER BY TABLE_NAME,COLUMN_NAME";
const fkSql="SELECT k.TABLE_NAME,k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME IN ('v2_product_image_assets','pattern_colorways','order_items','orders') AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.TABLE_NAME,k.CONSTRAINT_NAME";
const indexSql="SELECT INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='v2_product_image_assets' ORDER BY INDEX_NAME,SEQ_IN_INDEX";
const checkSql="SELECT TABLE_NAME,CONSTRAINT_NAME,ENFORCED FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='order_items' AND CONSTRAINT_TYPE='CHECK'";

async function rows(executeSql,sql,width){
 assertReadonlySql(sql);
 const result=await executeSql(sql);
 if(!Array.isArray(result)||result.some(row=>typeof row!=='string'))
  throw Error('P7 media/order metadata unavailable');
 return result.map(row=>{
  const cells=row.split('\t');
  if(cells.length>width)throw Error('P7 media/order malformed metadata');
  return [...cells,...Array(width-cells.length).fill('')];
 });
}
function mustColumn(cols,table,name,type,nullable){
 const c=cols.find(r=>r[0]===table&&r[1]===name);
 if(!c)throw Error('P7 column missing: '+table+'.'+name);
 if(c[2].toLowerCase().replace(/\s+/g,'')!==type.toLowerCase().replace(/\s+/g,'')||c[3]!==nullable)
  throw Error('P7 column type/nullability drift: '+table+'.'+name);
 return c;
}
const fkContracts=[
 ['pattern_colorways','fk_v2_colorway_image','pattern_image_asset_id','image_assets','id','RESTRICT'],
 ['v2_product_image_assets','fk_v2_product_image_asset','asset_id','image_assets','id','RESTRICT'],
 ['v2_product_image_assets','fk_v2_product_image_product','product_id','v2_products','id','RESTRICT'],
 ['order_items','fk_v2_order_line_product','v2_product_id','v2_products','id','RESTRICT'],
 ['orders','fk_v2_orders_actor','created_by_user_id','v2_access_users','id','RESTRICT']
];
function indexFields(indexes,name,unique){
 const items=indexes.filter(r=>r[0]===name).sort((a,b)=>Number(a[2])-Number(b[2]));
 if(!items.length||items.some((r,i)=>!/^\d+$/.test(r[1])||Number(r[1])!==unique||
  Number(r[2])!==i+1))throw Error('P7 image index missing or nonunique: '+name);
 return items.map(r=>r[3]);
}
export async function auditP7MediaAndOrderContracts(executeSql){
 // Crucial: no media or order structure reads before the base gate has
 // established the exact isolated MySQL 8 DB, whitelist and zero-row state.
 const base=await auditP7ReadOnly(executeSql);
 if(base.database!==P7_READONLY_DB||base.emptyTableCount!==14)
  throw Error('P7 isolated sandbox not attested');

 const cols=await rows(executeSql,columnSql,6);
 mustColumn(cols,'image_assets','id','varchar(36)','NO');
 mustColumn(cols,'image_assets','ref_count','int unsigned','NO');
 mustColumn(cols,'pattern_colorways','pattern_image_asset_id','varchar(36)','YES');
 mustColumn(cols,'v2_product_image_assets','product_id','bigint unsigned','NO');
 mustColumn(cols,'v2_product_image_assets','asset_id','varchar(36)','NO');
 mustColumn(cols,'v2_product_image_assets','role',"enum('fabric_display','detail','ai_effect')",'NO');
 mustColumn(cols,'v2_product_image_assets','sort_order','int unsigned','NO');
 mustColumn(cols,'v2_product_image_assets','deleted_at','datetime','YES');
 const active=mustColumn(cols,'v2_product_image_assets','active_asset_id','varchar(36)','YES');
 const expression=active[5].replace(/[`()\s]+/g,'').toLowerCase();
 if(!/STORED GENERATED/i.test(active[4])||
  expression!=='casewhendeleted_atisnullthenasset_idelsenullend')
  throw Error('P7 generated active image identity missing or altered');
 mustColumn(cols,'order_items','v2_product_id','bigint unsigned','YES');
 mustColumn(cols,'order_items','v2_source_kind',"enum('catalog','manual')",'YES');
 mustColumn(cols,'order_items','v2_product_snapshot','json','YES');
 mustColumn(cols,'orders','created_by_user_id','bigint unsigned','YES');

 const fks=await rows(executeSql,fkSql,6);
 for(const expected of fkContracts)
  if(!fks.some(actual=>expected.every((part,i)=>actual[i]===part)))
   throw Error('P7 media/order foreign key RESTRICT contract drift: '+expected[1]);
 const indexes=await rows(executeSql,indexSql,4);
 if(JSON.stringify(indexFields(indexes,'uq_v2_product_active_asset',0))!==
    JSON.stringify(['product_id','active_asset_id']))
  throw Error('P7 active image unique index wrong columns/order');
 if(JSON.stringify(indexFields(indexes,'idx_v2_product_images_order',1))!==
    JSON.stringify(['product_id','role','deleted_at','sort_order']))
  throw Error('P7 image role sorting index mismatch');
 const checks=await rows(executeSql,checkSql,3);
 if(!checks.some(row=>row[0]==='order_items'&&row[1]==='ck_v2_order_line_provenance'&&row[2]==='YES'))
  throw Error('P7 order provenance CHECK not enforced');
 return {database:base.database,mysqlVersion:base.mysqlVersion,mode:'remote MySQL SELECT only',
  mediaConstraints:true,imageForeignKeys:3,orderForeignKeys:2,activeImageUnique:true,
  snapshotType:'json',provenanceEnforced:true,tableCount:base.tableCount};
}

async function main(){
 if(process.env.FABRIC_V2_READONLY_TEST!=='I_ACKNOWLEDGE_READONLY')
  throw Error('P7 explicit read-only confirmation required');
 const report=await auditP7MediaAndOrderContracts(createSshSelect());
 console.log('P7_MEDIA_ORDER_READONLY_PASS '+JSON.stringify(report));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(()=>{console.error('P7 media/order read-only gate FAIL (details redacted)');process.exitCode=1;});
}
