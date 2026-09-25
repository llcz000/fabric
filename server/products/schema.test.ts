import assert from 'node:assert/strict';
import test from 'node:test';

import { initializeProductDomainSchema } from './schema';

class RecordingConnection {
  readonly statements: string[] = [];

  async query(sql: string): Promise<[unknown, unknown]> {
    this.statements.push(sql);
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
  assert.match(recorded, /UNIQUE KEY uq_pattern_tags_normalized_name \(normalized_name\)/);
  assert.match(recorded, /PRIMARY KEY \(product_id, tag_id\)/);
  assert.doesNotMatch(recorded, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
});
