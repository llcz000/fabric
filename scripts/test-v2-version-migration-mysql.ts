/**
 * P1-C-2 explicit v1 -> v2 REHEARSAL ONLY.
 *
 * Creates/updates only fabric_v2_test_20261012_p1c2 on the already-authorized
 * SSH test machine. Never runs through production startup. The ALTER is
 * restricted to the exact reviewed statement from the immutable V1->V2 plan.
 * MySQL DDL implicitly commits; a real production migrator needs independent
 * backup and version-lock strategy before any deployment.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { getV2ProductMasterCreateStatements, initializeV2ProductMasterSchema } from '../server/product-master/schema';
import { planV2SchemaUpgrade, verifyV2SchemaContract, V2_SCHEMA_VERSION } from '../server/product-master/schemaContract';

const DATABASE = 'fabric_v2_test_20261012_p1c2';
if (process.env.FABRIC_V2_ISOLATED_TEST !== 'I_ACKNOWLEDGE_SANDBOX') {
  throw Error('Explicit isolated migration acknowledgement required');
}
function sql(query:string, db:string|null=DATABASE):string {
  if(db!==null && db!==DATABASE || /\bfabric_db\b/i.test(query)) throw Error('Production/cross-database SQL forbidden');
  if (/^\s*(?:DROP|TRUNCATE|DELETE)\b/i.test(query)) throw Error('Destructive SQL forbidden');
  const args=['--batch','--skip-column-names','--raw','--default-character-set=utf8mb4'];
  if(db) args.push('--database='+db);
  args.push('-e',query);
  const r=spawnSync('mysql',args,{encoding:'utf8',timeout:15000});
  if(r.status!==0) throw Error('MySQL isolated migration: '+(r.stderr ?? r.error?.message ?? '').slice(0,500));
  return (r.stdout??'').trim();
}
function rows(statement:string,db:string|null=DATABASE):string[]{
  return sql(statement,db).split(/\r?\n/).filter(Boolean);
}
const allowed=new Set(['image_assets','pattern_masters','v2_schema_migrations',...getV2ProductMasterCreateStatements().map(x=>x.name)]);
const assertTables=()=>{
  for(const table of rows(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='${DATABASE}'`,null)) {
    assert(allowed.has(table),'Unrecognized sandbox table: '+table);
  }
};
const patternCounterExists=()=>rows("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pattern_masters' AND COLUMN_NAME='next_colorway_no'").includes('next_colorway_no');
const conn={
  async query(statement:string,params:unknown[]=[]):Promise<[unknown,unknown]> {
    if(params.length>1 || params.length===1 && !allowed.has(String(params[0]))) throw Error('Unexpected schema inspection target');
    if(params.length===1) statement=statement.replace('?',"'"+String(params[0])+"'");
    if(/^SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM INFORMATION_SCHEMA\.COLUMNS/i.test(statement)){
      return [rows(statement).map(line=>{
        const [COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE]=line.split('\t');
        return {COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE};
      }),[]];
    }
    if(/^SELECT COLUMN_NAME FROM INFORMATION_SCHEMA\.COLUMNS/i.test(statement))
      return [rows(statement).map(COLUMN_NAME=>({COLUMN_NAME})),[]];
    if(/^SELECT INDEX_NAME,NON_UNIQUE,COLUMN_NAME,SEQ_IN_INDEX FROM INFORMATION_SCHEMA\.STATISTICS/i.test(statement)){
      return [rows(statement).map(line=>{
        const [INDEX_NAME,NON_UNIQUE,COLUMN_NAME,SEQ_IN_INDEX]=line.split('\t');
        return {INDEX_NAME,NON_UNIQUE:Number(NON_UNIQUE),COLUMN_NAME,SEQ_IN_INDEX:Number(SEQ_IN_INDEX)};
      }),[]];
    }
    if(/^SELECT INDEX_NAME FROM INFORMATION_SCHEMA\.STATISTICS/i.test(statement))
      return [rows(statement).map(INDEX_NAME=>({INDEX_NAME})),[]];
    if(/^SELECT k\.CONSTRAINT_NAME/i.test(statement)){
      return [rows(statement).map(line=>{
        const [CONSTRAINT_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME,DELETE_RULE]=line.split('\t');
        return {CONSTRAINT_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME,DELETE_RULE};
      }),[]];
    }
    if(/^SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA\.TABLE_CONSTRAINTS/i.test(statement))
      return [rows(statement).map(CONSTRAINT_NAME=>({CONSTRAINT_NAME})),[]];
    if(!/^CREATE TABLE IF NOT EXISTS/i.test(statement.trim())) throw Error('Only V2 CREATE + metadata SELECT permitted');
    sql(statement);
    return [{affectedRows:0},[]];
  }
};
async function main() {
  const found=rows(`SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME='${DATABASE}'`,null);
  if(found.length) assertTables();
  sql(`CREATE DATABASE IF NOT EXISTS ${DATABASE} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,null);
  assert.equal(sql('SELECT DATABASE()'),DATABASE);
  sql(`CREATE TABLE IF NOT EXISTS image_assets (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    ref_count INT UNSIGNED NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  // Explicitly modeled previous V2 definition before D-01 master counter.
  sql(`CREATE TABLE IF NOT EXISTS pattern_masters (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    master_no VARCHAR(64) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_v2_master_no (master_no),
    CONSTRAINT ck_v2_master_no CHECK (master_no REGEXP '^[A-Z0-9]+$'),
    CONSTRAINT ck_v2_master_active CHECK (is_active IN (0,1))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  sql(`CREATE TABLE IF NOT EXISTS v2_schema_migrations (
    migration_id VARCHAR(40) NOT NULL PRIMARY KEY,
    schema_version SMALLINT UNSIGNED NOT NULL,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  let version=Number(sql('SELECT COALESCE(MAX(schema_version),0) FROM v2_schema_migrations'));
  if(version===0) {
    if(patternCounterExists()) throw Error('Unversioned current schema: manual review required');
    if(sql('SELECT COUNT(*) FROM pattern_masters')!=='0') throw Error('Nonempty v1 sandbox rejected');
    sql("INSERT INTO v2_schema_migrations(migration_id,schema_version) VALUES ('baseline_v1',1)");
    version=1;
  }
  if(version===1) {
    if(patternCounterExists()) throw Error('V1 ledger disagrees with schema; repair manually');
    const count=Number(sql('SELECT COUNT(*) FROM pattern_masters'));
    const plan=planV2SchemaUpgrade({currentVersion:version,existingRows:count});
    assert.equal(plan.length,1);
    assert.equal(plan[0].version,2);
    // Exactly one reviewed, schema-scoped additive ALTER. No other SQL accepted.
    assert.equal(plan[0].sql,'ALTER TABLE pattern_masters ADD COLUMN next_colorway_no BIGINT UNSIGNED NOT NULL DEFAULT 1, ADD CONSTRAINT ck_v2_next_colorway_positive CHECK (next_colorway_no > 0)');
    sql(plan[0].sql);
    console.log('PASS explicit isolated V1->V2 ALTER; no existing product rows');
  } else if(version!==V2_SCHEMA_VERSION) {
    throw Error('Unknown migration version '+version);
  }
  await initializeV2ProductMasterSchema(conn);
  await verifyV2SchemaContract(conn);
  if(version===1) {
    sql("INSERT INTO v2_schema_migrations(migration_id,schema_version) VALUES ('d01_counter_v2',2)");
  }
  assert.equal(sql('SELECT MAX(schema_version) FROM v2_schema_migrations'),'2');
  await initializeV2ProductMasterSchema(conn);
  await verifyV2SchemaContract(conn);
  assertTables();
  assert.equal(rows(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='${DATABASE}'`,null).length,10);
  for(const name of ['image_assets',...getV2ProductMasterCreateStatements().map(x=>x.name)]) {
    assert.equal(sql('SELECT COUNT(*) FROM '+name),'0',name+' must have no business rows');
  }
  console.log('PASS MySQL 8 isolated migration ledger=2, 8 V2 tables, FK/CHECK/type/index verified twice');
  console.log('P1C2_VERSIONED_REHEARSAL_PASS database='+DATABASE);
}
void main().catch(err=>{console.error(err);process.exitCode=1;});
