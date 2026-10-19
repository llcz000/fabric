import assert from 'node:assert/strict';
import test from 'node:test';

import { initializeImageAssetSchema } from './schema';
import { getV2ProductMasterCreateStatements } from '../product-master/schema';

class RecordingSql {
  readonly sql: string[] = [];
  private readonly columns = new Map<string, string[]>();
  private readonly indexes = new Map<string, string[]>();

  async query(query: string, params?: unknown[]): Promise<[unknown, unknown]> {
    const statement = query.trim();
    this.sql.push(statement);
    if (/INFORMATION_SCHEMA\.COLUMNS/i.test(statement)) {
      return [(this.columns.get(String(params?.[0])) ?? []).map(COLUMN_NAME => ({COLUMN_NAME})), []];
    }
    if (/INFORMATION_SCHEMA\.STATISTICS/i.test(statement)) {
      return [(this.indexes.get(String(params?.[0])) ?? []).map(INDEX_NAME => ({INDEX_NAME})), []];
    }
    const match = statement.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]+)\) ENGINE=/i);
    if (match) {
      const table = match[1];
      const colNames = [...match[2].matchAll(/^\s+([a-z_][a-z_0-9]*)\s+(?:BIGINT|INT|TINYINT|VARCHAR|CHAR|DECIMAL|JSON|TEXT|DATETIME|TIMESTAMP|ENUM)/gim)]
        .map(x => x[1]);
      const indexNames = ['PRIMARY', ...[...match[2].matchAll(/(?:UNIQUE KEY|\bKEY)\s+([a-z_][a-z_0-9]*)\s*\(/gi)].map(x=>x[1])];
      this.columns.set(table, colNames);
      this.indexes.set(table, indexNames);
    }
    return [{affectedRows:0}, []];
  }

  get all() { return this.sql.join('\n'); }
}

test('P1-C explicitly selected V2 schema initializes shared image infrastructure and 8 native tables but never old product domain', async () => {
  const conn = new RecordingSql();
  await initializeImageAssetSchema(conn, {productDomain:'v2'});
  const created = [...conn.all.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/gi)].map(x=>x[1]);
  const native = getV2ProductMasterCreateStatements().map(x=>x.name);
  assert.deepEqual(created, [
    'image_assets', 'image_asset_variants', 'image_upload_sessions',
    'image_processing_jobs', 'company_image_assets', ...native
  ]);
  assert.doesNotMatch(conn.all, /CREATE TABLE IF NOT EXISTS (?:products|product_images|product_image_assets|product_import_batches|product_issues|pattern_tags)\b/i);
  assert.doesNotMatch(conn.all, /ADD (?:COLUMN|KEY) IF NOT EXISTS|\bALTER TABLE\b|DELETE FROM|TRUNCATE|DROP TABLE/i);
});

test('P1-C rejects unknown schema modes before any image or legacy DDL', async () => {
  const conn = new RecordingSql();
  await assert.rejects(initializeImageAssetSchema(conn, {productDomain: 'unknown' as 'legacy'}), /Invalid product schema domain/);
  assert.equal(conn.sql.length, 0);
});

test('P1-C explicitly selected V2 shared/bootstrap can initialize twice without falling back to legacy DDL', async () => {
  const conn = new RecordingSql();
  await initializeImageAssetSchema(conn, {productDomain:'v2'});
  await initializeImageAssetSchema(conn, {productDomain:'v2'});
  assert.equal((conn.all.match(/CREATE TABLE IF NOT EXISTS pattern_masters\s*\(/g) ?? []).length, 2);
  assert.doesNotMatch(conn.all, /CREATE TABLE IF NOT EXISTS product_image_assets\b|ADD COLUMN IF NOT EXISTS/i);
});
