import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

/** P7 release readiness: fixed existing P6 sandbox, metadata/row-count SELECT only.
 * Does NOT mount the unified HTTP router, exercise a write transaction, migrate
 * production, alter files on remote, or prove COS/real browser integration.
 */
export const P7_READONLY_DB='fabric_v2_test_20261012_p6documents';
export const P7_TABLES=Object.freeze([
 'image_assets','company_config','orders','order_items','v2_access_users','v2_access_sessions',
 'pattern_masters','pattern_colorways','v2_fabrics','shared_tags','pattern_master_tag_links',
 'pattern_colorway_tag_links','v2_products','v2_product_image_assets'
]);

export function assertReadonlySql(sql){
 if(typeof sql!=='string'||!/^SELECT\s/i.test(sql)||
    /;|--|\/\*|\*\//.test(sql)||
    /\b(?:INTO|OUTFILE|DUMPFILE|LOAD_FILE|SLEEP|BENCHMARK)\b/i.test(sql))
  throw new Error('P7 read-only SELECT statement required');
 return sql;
}
function exactlyOne(rows,label){
 if(!Array.isArray(rows)||rows.length!==1)throw Error('P7 '+label+' unavailable');
 return rows[0];
}
const readOnlyDatabaseSql='SELECT DATABASE(), VERSION(), @@server_uuid';
const listTablesSql='SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME';
const orderColumnsSql="SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='order_items' ORDER BY COLUMN_NAME";
const lineageCheckSql="SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='order_items' AND CONSTRAINT_TYPE='CHECK'";
const foreignKeysSql=table=>`SELECT k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,r.DELETE_RULE FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME='${table}'`;

export async function auditP7ReadOnly(executeSql){
 async function select(sql){
  assertReadonlySql(sql);
  const result=await executeSql(sql);
  if(!Array.isArray(result)||result.some(row=>typeof row!=='string'))
   throw Error('P7 read-only SQL rows unavailable');
  return result;
 }
 const identity=exactlyOne(await select(readOnlyDatabaseSql),'database identity').split('\t');
 if(identity[0]!==P7_READONLY_DB)throw Error('P7 isolated sandbox target mismatch');
 if(!/^8\./.test(identity[1]??''))throw Error('P7 MySQL 8 version required');
 if(!identity[2]||identity[2].length<8)throw Error('P7 database instance identity unavailable');

 const tables=await select(listTablesSql);
 if(tables.length!==P7_TABLES.length||
    tables.some(name=>!P7_TABLES.includes(name))||
    P7_TABLES.some(name=>!tables.includes(name)))
  throw Error('P7 sandbox unexpected or missing table');

 const cols=await select(orderColumnsSql);
 if(['v2_product_id','v2_product_snapshot','v2_source_kind'].some(name=>!cols.includes(name)))
  throw Error('P7 order provenance columns missing');

 const checks=await select(lineageCheckSql);
 if(!checks.includes('ck_v2_order_line_provenance'))
  throw Error('P7 order provenance CHECK missing');

 const productKeys=await select(foreignKeysSql('order_items'));
 if(!productKeys.includes('v2_product_id\tv2_products\tRESTRICT'))
  throw Error('P7 product foreign key RESTRICT missing');
 const ownerKeys=await select(foreignKeysSql('orders'));
 if(!ownerKeys.includes('created_by_user_id\tv2_access_users\tRESTRICT'))
  throw Error('P7 owner foreign key RESTRICT missing');

 for(const table of P7_TABLES){
  // Identifiers come only from the fixed compile-time allowlist, never from remote rows.
  const raw=exactlyOne(await select('SELECT COUNT(*) FROM '+table),'table count');
  if(!/^\d+$/.test(raw))throw Error('P7 table count unavailable');
  if(raw!=='0')throw Error('P7 isolated sandbox nonempty; stop without touching data');
 }
 return {database:P7_READONLY_DB,mysqlVersion:identity[1],tableCount:tables.length,
  emptyTableCount:P7_TABLES.length,fkOk:true,mode:'remote MySQL SELECT only'};
}

export function createSshSelect(){
 const config=JSON.parse(readFileSync(resolve('.local/server/_config/ssh.local.json'),'utf8')).ssh;
 const host=String(config?.host??''),user=String(config?.username??''),port=String(config?.port??22);
 if(!/^[a-zA-Z0-9.:-]+$/.test(host)||!/^[a-zA-Z0-9_.-]+$/.test(user)||
    !/^[0-9]+$/.test(port))throw Error('P7 trusted SSH settings unavailable');
 return async function query(sql){
  assertReadonlySql(sql);
  const command='mysql --batch --skip-column-names --socket=/var/run/mysqld/mysqld.sock --database='+P7_READONLY_DB+' -e '+JSON.stringify(sql);
  const result=spawnSync('ssh',
   ['-o','BatchMode=yes','-o','ConnectTimeout=5','-o','StrictHostKeyChecking=yes','-p',port,user+'@'+host,command],
   {encoding:'utf8',timeout:15000,maxBuffer:512*1024});
  if(result.status!==0||result.error)throw Error('P7 read-only isolated MySQL connection unavailable');
  return String(result.stdout??'').trim().split(/\r?\n/).filter(Boolean);
 };
}

async function main(){
 if(process.env.FABRIC_V2_READONLY_TEST!=='I_ACKNOWLEDGE_READONLY')
  throw Error('P7 explicit READONLY-only confirmation required');
 const report=await auditP7ReadOnly(createSshSelect());
 console.log('P7_REAL_MYSQL_READONLY_PASS '+JSON.stringify(report));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(error=>{
  console.error('P7 real sandbox readonly gate FAIL: '+(error instanceof Error?error.message:'unknown'));
  process.exitCode=1;
 });
}
