import assert from 'node:assert/strict';
import test from 'node:test';
import { initializeV2ProductMasterSchema, getV2ProductMasterCreateStatements } from './schema.ts';

const requiredTables = [
  'pattern_masters', 'pattern_colorways', 'v2_fabrics',
  'shared_tags', 'pattern_master_tag_links', 'pattern_colorway_tag_links',
  'v2_products', 'v2_product_image_assets',
] as const;

const expectedColumns: Record<string, string[]> = {
  image_assets: ['id', 'ref_count'],
  pattern_masters: ['id','master_no','next_colorway_no','is_active'],
  pattern_colorways: ['id','master_id','colorway_no','pattern_image_asset_id','remark','is_active'],
  v2_fabrics: ['id','fabric_no','fabric_name','weight_value','weight_unit','width_value','is_active'],
  shared_tags: ['id','dimension','name','normalized_name','is_archived'],
  pattern_master_tag_links: ['master_id','tag_id'],
  pattern_colorway_tag_links: ['colorway_id','tag_id'],
  v2_products: ['id','pattern_colorway_id','fabric_id','product_no','remark','is_active','is_available_for_sampling','row_version'],
  v2_product_image_assets: ['id','product_id','asset_id','role','sort_order','deleted_at'],
};
const requiredIndexes: Record<string, string[]> = {
  pattern_masters: ['PRIMARY','uq_v2_master_no'],
  pattern_colorways: ['PRIMARY','uq_v2_master_colorway'],
  v2_fabrics: ['PRIMARY','uq_v2_fabric_no'],
  shared_tags: ['PRIMARY','uq_v2_dimension_normalized'],
  pattern_master_tag_links: ['PRIMARY'],
  pattern_colorway_tag_links: ['PRIMARY'],
  v2_products: ['PRIMARY','uq_v2_colorway_fabric','uq_v2_product_no'],
  v2_product_image_assets: ['PRIMARY','uq_v2_product_active_asset'],
};

class SchemaRecorder {
  readonly executed: string[] = [];
  constructor(
    readonly options: {
      missingAssets?: boolean;
      corruptTable?: string;
      corruptIndexTable?: string;
    } = {},
  ) {}
  async query(sql: string, params?: unknown[]): Promise<[unknown, unknown]> {
    this.executed.push(sql.trim());
    if (/INFORMATION_SCHEMA\.COLUMNS/i.test(sql)) {
      const table = String(params?.[0] ?? 'image_assets');
      let columns = this.options.missingAssets && table === 'image_assets'
        ? ['id'] : expectedColumns[table] ?? [];
      if (table === this.options.corruptTable) columns = columns.filter(c => c !== expectedColumns[table][1]);
      return [columns.map(COLUMN_NAME => ({COLUMN_NAME})), []];
    }
    if (/INFORMATION_SCHEMA\.STATISTICS/i.test(sql)) {
      const table = String(params?.[0]);
      let names = requiredIndexes[table] ?? [];
      if (table === this.options.corruptIndexTable) names = names.filter(n => n !== requiredIndexes[table][1]);
      return [names.map(INDEX_NAME => ({INDEX_NAME})), []];
    }
    return [{affectedRows: 0}, []];
  }
  get sql() { return this.executed.join('\n'); }
}

test('P1 V2 isolated fixture can retrieve create-only statements for partial-install simulation', () => {
  const ddls = getV2ProductMasterCreateStatements();
  assert.equal(ddls.length, requiredTables.length);
  assert.ok(ddls.every(x => x.name && x.sql.startsWith('CREATE TABLE IF NOT EXISTS')));
  assert.deepEqual(ddls.map(x => x.name), [...requiredTables]);
});

test('D-01 approved monotonic non-reused colorway identity requires persisted master counter', () => {
  const ddl = getV2ProductMasterCreateStatements().find(x => x.name === 'pattern_masters')?.sql ?? '';
  assert.match(ddl, /next_colorway_no BIGINT UNSIGNED NOT NULL DEFAULT 1/i);
  assert.match(ddl, /CHECK\s*\(next_colorway_no\s*>\s*0\)/i);
});

test('AC-97 sampling availability independent of active flag, defaults enabled, constrained in fresh product schema',()=>{
 const stmt=getV2ProductMasterCreateStatements().find(x=>x.name==='v2_products');assert(stmt);
 assert.match(stmt.sql,/is_available_for_sampling/);
 assert.match(stmt.sql,/is_available_for_sampling TINYINT\(1\) NOT NULL DEFAULT 1/);
 assert.match(stmt.sql,/CONSTRAINT ck_v2_product_sampling CHECK \(is_available_for_sampling IN \(0,1\)\)/);
});
test('P1 V2 standalone tables avoid legacy table names, writes and unsupported ALTER syntax', async () => {
  const c = new SchemaRecorder();
  await initializeV2ProductMasterSchema(c);
  for (const table of requiredTables) {
    assert.match(c.sql, new RegExp('CREATE TABLE IF NOT EXISTS '+table+'\\s*\\(', 'i'), table);
  }
  assert.doesNotMatch(c.sql, /\bDROP\s+TABLE\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bALTER\s+TABLE\b/i);
  assert.doesNotMatch(c.sql, /CREATE TABLE IF NOT EXISTS (products|fabrics|product_image_assets|orders|order_items)\b/i);
  assert.doesNotMatch(c.sql, /ADD (COLUMN|KEY) IF NOT EXISTS/i);
  assert.match(c.sql, /UNIQUE KEY uq_v2_master_colorway\s*\(master_id,\s*colorway_no\)/);
  assert.match(c.sql, /UNIQUE KEY uq_v2_colorway_fabric\s*\(pattern_colorway_id,\s*fabric_id\)/);
  assert.match(c.sql, /REFERENCES image_assets\s*\(id\) ON DELETE RESTRICT/);
});

test('P1 V2 refuses to create tables if shared image_assets contract is absent', async () => {
  const c = new SchemaRecorder({missingAssets: true});
  await assert.rejects(initializeV2ProductMasterSchema(c), /image_assets/i);
  assert.doesNotMatch(c.sql, /CREATE TABLE/i);
});

test('P1 V2 refuses drifted existing table columns rather than accepting IF NOT EXISTS silently', async () => {
  const c = new SchemaRecorder({corruptTable: 'v2_fabrics'});
  await assert.rejects(initializeV2ProductMasterSchema(c), /v2_fabrics.*column/i);
});

test('P1 V2 checks unique indexes of existing tables after init', async () => {
  const c = new SchemaRecorder({corruptIndexTable: 'v2_products'});
  await assert.rejects(initializeV2ProductMasterSchema(c), /v2_products.*index/i);
});

test('P1 V2 re-initialization stays within schema create/introspection (idempotent)', async () => {
  const c = new SchemaRecorder();
  await initializeV2ProductMasterSchema(c);
  await initializeV2ProductMasterSchema(c);
  assert.equal((c.sql.match(/CREATE TABLE IF NOT EXISTS/g)||[]).length, requiredTables.length*2);
  assert.doesNotMatch(c.sql, /ALTER TABLE|UPDATE\s+orders|DELETE FROM|DROP TABLE/i);
});

test('P1 V2 constraints include positive numeric version and nullable paired weight-unit', async () => {
  const c = new SchemaRecorder();
  await initializeV2ProductMasterSchema(c);
  assert.match(c.sql, /CHECK\s*\(colorway_no > 0\)/i);
  assert.match(c.sql, /weight_unit ENUM\('gsm', 'mm'\) NULL/i);
  assert.match(c.sql, /weight_value IS NULL AND weight_unit IS NULL/i);
  assert.match(c.sql, /role ENUM\('fabric_display', 'detail', 'ai_effect'\)/i);
});
