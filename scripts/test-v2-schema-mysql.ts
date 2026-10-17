/**
 * Run only over SSH on the authorized remote test host:
 *   FABRIC_V2_ISOLATED_TEST=I_ACKNOWLEDGE_SANDBOX node /tmp/fabric-v2-schema-test.cjs
 * No production schema writes; no deletes/drops. The fixed sandbox is
 * separate from fabric_db and all SELECT/CREATE/fixture writes are scoped.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { initializeV2ProductMasterSchema, getV2ProductMasterCreateStatements } from '../server/product-master/schema.ts';

// Separate follow-up sandbox, so earlier schema and its audit remain untouched.
const DATABASE = 'fabric_v2_test_20261012_d01';
const allowed = new Set([
  'image_assets',
  ...getV2ProductMasterCreateStatements().map(item => item.name),
]);

if (process.env.FABRIC_V2_ISOLATED_TEST !== 'I_ACKNOWLEDGE_SANDBOX') {
  throw new Error('Explicit isolated test environment marker required');
}

function runSql(sql: string, db: string | null = DATABASE): string {
  if (db !== null && db !== DATABASE) throw new Error('Cross-database SQL refused');
  if (/\bfabric_db\b/i.test(sql)) throw new Error('Production schema reference refused');
  const args = ['--batch', '--skip-column-names', '--raw', '--default-character-set=utf8mb4'];
  if (db) args.push('--database='+db);
  args.push('-e', sql);
  const r = spawnSync('mysql', args, {encoding:'utf8', timeout:15000});
  if (r.status !== 0) throw new Error(`mysql test error: ${(r.stderr || r.error?.message || 'unknown').trim().slice(0,400)}`);
  return (r.stdout ?? '').trim();
}
function shouldRejectSql(sql: string): void {
  const args = ['--batch','--skip-column-names','--raw','--default-character-set=utf8mb4','--database='+DATABASE,'-e',sql];
  const r = spawnSync('mysql', args, { encoding: 'utf8', timeout: 15000 });
  assert.notEqual(r.status, 0, 'Expected MySQL to reject invalid/duplicate INSERT');
}
const quoteIdentifier = (s: string) => {
  if (!/^[a-z0-9_]+$/.test(s)) throw new Error('Bad table identifier');
  return s;
};
const columns = (sql: string): unknown[] =>
  runSql(sql).split(/\r?\n/).filter(Boolean).map(COLUMN_NAME => ({COLUMN_NAME}));
const indexes = (sql: string): unknown[] =>
  runSql(sql).split(/\r?\n/).filter(Boolean).map(INDEX_NAME => ({INDEX_NAME}));
const connector = {
  async query(sql: string, params?: unknown[]): Promise<[unknown, unknown]> {
    if (params && params.length !== 1) throw new Error('Unexpected SQL parameters');
    if (params) {
      const name = quoteIdentifier(String(params[0]));
      assert(allowed.has(name), 'Unexpected introspection table');
      sql = sql.replace('?', "'" + name + "'");
    }
    if (/^SELECT\s+COLUMN_NAME\s+FROM\s+INFORMATION_SCHEMA\.COLUMNS/i.test(sql)) {
      return [columns(sql), []];
    }
    if (/^SELECT\s+INDEX_NAME\s+FROM\s+INFORMATION_SCHEMA\.STATISTICS/i.test(sql)) {
      return [indexes(sql), []];
    }
    if (/^CREATE TABLE IF NOT EXISTS/i.test(sql)) {
      runSql(sql);
      return [{affectedRows:0}, []];
    }
    throw new Error('Unexpected statement in V2 bootstrap: '+sql.slice(0,70));
  },
};

function assertNoUnknownTables(): void {
  const present = runSql(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='${DATABASE}'`,
    null,
  ).split(/\r?\n/).filter(Boolean);
  for (const table of present) {
    assert(allowed.has(table), 'Sandbox contains unexpected table '+table);
  }
}

async function main(): Promise<void> {
  const exists = runSql(`SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME='${DATABASE}'`, null);
  if (exists) assertNoUnknownTables();
  runSql(`CREATE DATABASE IF NOT EXISTS ${DATABASE} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`, null);
  assert.equal(runSql('SELECT DATABASE()'), DATABASE);

  // Deliberately minimal *sandbox-only* asset fixture: production image_assets untouched.
  runSql(`CREATE TABLE IF NOT EXISTS image_assets (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    ref_count INT UNSIGNED NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Simulate a previously interrupted install: one table exists, others do not.
  const manifest = getV2ProductMasterCreateStatements();
  runSql(manifest[0].sql);
  await initializeV2ProductMasterSchema(connector);
  await initializeV2ProductMasterSchema(connector);
  assertNoUnknownTables();
  const actual = runSql(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='${DATABASE}'`, null)
    .split(/\r?\n/).filter(Boolean);
  assert.equal(actual.length, manifest.length + 1);
  console.log('PASS MySQL 8 new/partial/repeated V2 table bootstrap:', manifest.length, 'V2 tables');

  // Isolated MySQL transactions: all valid sample inserts rolled back.
  runSql(`START TRANSACTION;
    INSERT INTO pattern_masters(id,master_no) VALUES (900001,'PTEST1234');
    INSERT INTO pattern_colorways(id,master_id,colorway_no) VALUES
      (900001,900001,1),(900002,900001,5);
    INSERT INTO v2_fabrics(id,fabric_no,fabric_name,weight_value,weight_unit,width_value)
      VALUES (900001,'S23','Sample',NULL,NULL,NULL);
    INSERT INTO v2_products(id,pattern_colorway_id,fabric_id,product_no)
      VALUES (900001,900001,900001,'PTEST1234-1-S23');
    ROLLBACK;`);
  console.log('PASS sample numeric colorways 1 and 5, product FK and optional fabric specs');
  runSql(`START TRANSACTION;
    INSERT INTO pattern_masters(id,master_no) VALUES (900003,'COUNTERTEST');
    SELECT next_colorway_no FROM pattern_masters WHERE id=900003;
    UPDATE pattern_masters SET next_colorway_no=2 WHERE id=900003;
    ROLLBACK;`);
  shouldRejectSql(`INSERT INTO pattern_masters(master_no,next_colorway_no) VALUES ('BADCOUNTER',0);`);
  console.log('PASS D-01 persistent next_colorway_no defaults to 1 and CHECK rejects zero');

  shouldRejectSql(`START TRANSACTION;
    INSERT INTO pattern_masters(id,master_no) VALUES (900001,'PTEST1234');
    INSERT INTO pattern_colorways(master_id,colorway_no) VALUES (900001,1),(900001,1);
    ROLLBACK;`);
  shouldRejectSql(`START TRANSACTION;
    INSERT INTO v2_fabrics(fabric_no,fabric_name,weight_value,weight_unit)
      VALUES ('INVALID1','bad weight unit',120,NULL);
    ROLLBACK;`);
  shouldRejectSql(`START TRANSACTION;
    INSERT INTO pattern_colorways(master_id,colorway_no) VALUES (999999,1);
    ROLLBACK;`);
  shouldRejectSql(`START TRANSACTION;
    INSERT INTO pattern_masters(id,master_no) VALUES (900001,'PTEST1234');
    INSERT INTO pattern_colorways(id,master_id,colorway_no) VALUES (900001,900001,1);
    INSERT INTO v2_fabrics(id,fabric_no,fabric_name) VALUES (900001,'S23','Sample');
    INSERT INTO v2_products(pattern_colorway_id,fabric_id,product_no)
      VALUES (900001,900001,'PTEST1234-1-S23');
    INSERT INTO v2_products(pattern_colorway_id,fabric_id,product_no)
      VALUES (900001,900001,'PTEST1234-1-DUPLICATE');
    ROLLBACK;`);
  shouldRejectSql(`START TRANSACTION;
    INSERT INTO pattern_masters(id,master_no) VALUES (900001,'PTEST1234');
    INSERT INTO pattern_colorways(id,master_id,colorway_no) VALUES (900001,900001,0);
    ROLLBACK;`);
  console.log('PASS MySQL rejects duplicate colorway, duplicate product pairing, zero version, invalid weight pair and dangling master FK');

  for (const name of manifest.map(x => x.name)) {
    assert.equal(runSql('SELECT COUNT(*) FROM '+quoteIdentifier(name)), '0', name+' must remain empty');
  }
  assert.equal(runSql('SELECT COUNT(*) FROM image_assets'), '0');
  console.log('PASS sandbox contains no persistent business fixture rows');
  console.log('MY_SQL_V2_P1_ISOLATED_PASS database='+DATABASE);
}
void main().catch(error => { console.error('MySQL V2 sandbox test failed:', error); process.exitCode = 1; });
