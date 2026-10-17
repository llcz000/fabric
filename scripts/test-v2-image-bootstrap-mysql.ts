/**
 * P1-C remote MySQL integration test: execute through SSH/stdin ONLY on a
 * controlled test host. No production schema or existing app process is used.
 * Requires explicit acknowledgement + fixed sandbox DB name.
 * No drop/delete/update of existing business data.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {bootstrapIsolatedV2Schema} from '../server/product-master/bootstrap';
import {getV2ProductMasterCreateStatements} from '../server/product-master/schema';
import {requireIsolatedV2SchemaTarget} from '../server/product-master/bootstrapTarget';

const DATABASE = requireIsolatedV2SchemaTarget({
  database: 'fabric_v2_test_20261012_p1c',
  confirmation: process.env.FABRIC_V2_ISOLATED_TEST
});

function sql(statement: string, db: string | null = DATABASE): string {
  if (db !== null && db !== DATABASE) throw Error('Forbidden database');
  if (/\bfabric_db\b/i.test(statement)) throw Error('Production DB reference forbidden');
  if (/^\s*(?:DELETE|DROP|TRUNCATE|ALTER|REPLACE|UPDATE)\b/i.test(statement)) throw Error('Destructive SQL refused');
  const args = ['--batch','--skip-column-names','--raw','--default-character-set=utf8mb4'];
  if (db !== null) args.push('--database='+db);
  args.push('-e',statement);
  const result = spawnSync('mysql',args,{encoding:'utf8',timeout:15000});
  if(result.status !== 0) throw Error('Isolated MySQL error: '+(result.stderr ?? result.error?.message ?? '').slice(0,450));
  return (result.stdout ?? '').trim();
}
function cleanRows(query: string, db: string | null = DATABASE): string[] {
  return sql(query,db).split(/\r?\n/).filter(Boolean);
}
const allowed = new Set([
  'company_config',
  'image_assets','image_asset_variants','image_upload_sessions',
  'image_processing_jobs','company_image_assets',
  ...getV2ProductMasterCreateStatements().map(x=>x.name)
]);
const conn = {
  async query(statement:string, params:unknown[]=[]):Promise<[unknown, unknown]> {
    if (params.length > 0) {
      if(params.length!==1 || !allowed.has(String(params[0]))) throw Error('Unexpected introspection target');
      statement=statement.replace('?', "'"+String(params[0])+"'");
    }
    if (/^SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM INFORMATION_SCHEMA\.COLUMNS/i.test(statement.trim())) {
      return [cleanRows(statement).map(line=>{
        const [COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE]=line.split('\t');
        return {COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE};
      }),[]];
    }
    if (/^SELECT COLUMN_NAME FROM INFORMATION_SCHEMA\.COLUMNS/i.test(statement.trim())) {
      return [cleanRows(statement).map(COLUMN_NAME=>({COLUMN_NAME})),[]];
    }
    if (/^SELECT INDEX_NAME,NON_UNIQUE,COLUMN_NAME,SEQ_IN_INDEX FROM INFORMATION_SCHEMA\.STATISTICS/i.test(statement.trim())) {
      return [cleanRows(statement).map(line=>{
        const [INDEX_NAME,NON_UNIQUE,COLUMN_NAME,SEQ_IN_INDEX]=line.split('\t');
        return {INDEX_NAME,NON_UNIQUE:Number(NON_UNIQUE),COLUMN_NAME,SEQ_IN_INDEX:Number(SEQ_IN_INDEX)};
      }),[]];
    }
    if (/^SELECT INDEX_NAME FROM INFORMATION_SCHEMA\.STATISTICS/i.test(statement.trim())) {
      return [cleanRows(statement).map(INDEX_NAME=>({INDEX_NAME})),[]];
    }
    if (/^SELECT k\.CONSTRAINT_NAME/i.test(statement.trim())) {
      return [cleanRows(statement).map(line=>{
        const [CONSTRAINT_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME,DELETE_RULE]=line.split('\t');
        return {CONSTRAINT_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME,DELETE_RULE};
      }),[]];
    }
    if (/^SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA\.TABLE_CONSTRAINTS/i.test(statement.trim())) {
      return [cleanRows(statement).map(CONSTRAINT_NAME=>({CONSTRAINT_NAME})),[]];
    }
    if (!/^CREATE TABLE IF NOT EXISTS/i.test(statement.trim())) throw Error('Unexpected initializer DDL');
    sql(statement);
    return [{affectedRows:0},[]];
  }
};

async function main() {
  const found=cleanRows("SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME='"+DATABASE+"'",null);
  if (found.length) {
    const already=cleanRows("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='"+DATABASE+"'",null);
    for(const table of already) assert(allowed.has(table), 'Unexpected table in sandbox: '+table);
  }
  sql('CREATE DATABASE IF NOT EXISTS '+DATABASE+' CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci',null);
  // The shared image initializer expects the core company table to be created
  // by the owning service; use only a structurally compatible sandbox fixture.
  sql('CREATE TABLE IF NOT EXISTS company_config (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
  await bootstrapIsolatedV2Schema({connection:conn,database:DATABASE,confirmation:process.env.FABRIC_V2_ISOLATED_TEST});
  await bootstrapIsolatedV2Schema({connection:conn,database:DATABASE,confirmation:process.env.FABRIC_V2_ISOLATED_TEST});

  const tableNames=cleanRows("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='"+DATABASE+"'");
  assert.equal(tableNames.length,allowed.size);
  for(const name of allowed) assert(tableNames.includes(name), 'Missing expected sandbox table: '+name);
  const oldTables=['products','product_images','product_image_assets','pattern_tags','product_pattern_tags','product_issues','product_import_batches','product_import_sources','orders','order_items'];
  for(const name of oldTables) assert(!tableNames.includes(name), 'Legacy product/order table must not be created: '+name);
  assert.deepEqual(
    cleanRows("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pattern_masters' AND COLUMN_NAME='next_colorway_no'"),
    ['next_colorway_no']
  );
  for(const name of allowed) {
    assert.equal(sql('SELECT COUNT(*) FROM '+name),'0','Sandbox fixture must have no business records: '+name);
  }
  console.log('PASS P1-C MySQL 8.0.46 image/V2 shared bootstrap two passes, '+tableNames.length+' tables, no legacy tables, no rows');
  console.log('P1C_IMAGE_V2_ISOLATED_PASS database='+DATABASE);
}
void main().catch(error => { console.error(error);process.exitCode=1;});
