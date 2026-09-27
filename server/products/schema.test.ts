import assert from 'node:assert/strict';
import test from 'node:test';

import { initializeProductDomainSchema } from './schema';

class RecordingConnection {
  readonly statements: string[] = [];
  constructor(
    private readonly existingColumns = new Set<string>(),
    private readonly existingIndexes = new Set<string>(),
  ) {}

  async query(sql: string, params: unknown[] = []): Promise<[unknown, unknown]> {
    this.statements.push(sql);
    if (/information_schema\.COLUMNS/i.test(sql)) {
      const key = `${String(params[0])}.${String(params[1])}`;
      return [this.existingColumns.has(key) ? [{ present: 1 }] : [], []];
    }
    if (/information_schema\.STATISTICS/i.test(sql)) {
      const key = `${String(params[0])}.${String(params[1])}`;
      return [this.existingIndexes.has(key) ? [{ present: 1 }] : [], []];
    }
    return [{ affectedRows: 0 }, []];
  }
}

function sql(connection: RecordingConnection): string {
  return connection.statements.join('\n');
}

test('schema adds product tags issues image origins and legacy roles without destructive DDL', async () => {
  const connection = new RecordingConnection();

  await initializeProductDomainSchema(connection);

  const recorded = sql(connection);
  assert.match(recorded, /CREATE TABLE IF NOT EXISTS pattern_tags/);
  assert.match(recorded, /CREATE TABLE IF NOT EXISTS product_pattern_tags/);
  assert.match(recorded, /CREATE TABLE IF NOT EXISTS product_issues/);
  assert.match(recorded, /CREATE TABLE IF NOT EXISTS product_import_batches/);
  assert.match(recorded, /CREATE TABLE IF NOT EXISTS product_import_sources/);
  assert.match(recorded, /UNIQUE KEY uq_import_batch_file_sheet \(file_sha256, sheet_name\)/);
  assert.match(recorded, /UNIQUE KEY uq_import_source_row \(batch_id, source_sheet, source_row\)/);
  assert.match(recorded, /ALTER TABLE product_image_assets[\s\S]*origin_type/);
  assert.match(recorded, /ALTER TABLE product_images[\s\S]*is_primary/);
  assert.match(recorded, /ALTER TABLE products ADD COLUMN review_status/);
  assert.match(recorded, /ALTER TABLE products ADD COLUMN reviewed_by/);
  assert.match(recorded, /ALTER TABLE products ADD COLUMN reviewed_at/);
  assert.match(recorded, /idx_products_review_status_updated/);
  assert.match(recorded, /UNIQUE KEY uq_pattern_tags_normalized_name \(normalized_name\)/);
  assert.match(recorded, /PRIMARY KEY \(product_id, tag_id\)/);
  assert.doesNotMatch(recorded, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
});

test('schema uses MySQL 8 metadata checks instead of unsupported ADD IF NOT EXISTS syntax', async () => {
  const connection = new RecordingConnection();

  await initializeProductDomainSchema(connection);

  const recorded = sql(connection);
  assert.match(recorded, /information_schema\.COLUMNS/i);
  assert.match(recorded, /information_schema\.STATISTICS/i);
  assert.doesNotMatch(recorded, /ADD\s+(?:COLUMN|KEY|INDEX)\s+IF\s+NOT\s+EXISTS/i);
});

test('schema resumes safely when the product migration is partially complete', async () => {
  const connection = new RecordingConnection(
    new Set([
      'product_image_assets.origin_type',
      'product_image_assets.origin_metadata',
      'product_images.role',
      'product_images.is_primary',
      'product_images.origin_type',
      'product_images.origin_metadata',
      'products.review_status',
      'products.reviewed_by',
      'products.reviewed_at',
    ]),
    new Set(['product_image_assets.idx_product_image_assets_role_order', 'products.idx_products_review_status_updated']),
  );

  await initializeProductDomainSchema(connection);

  const alterations = connection.statements.filter((statement) => /^\s*ALTER TABLE/i.test(statement));
  assert.deepEqual(alterations, []);
  assert.match(sql(connection), /CREATE TABLE IF NOT EXISTS product_import_sources/);
});
