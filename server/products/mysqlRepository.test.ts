import assert from 'node:assert/strict';
import test from 'node:test';

import { MySqlProductRepository } from './mysqlRepository';
import type { ProductWriteInput } from './types';

type Row = Record<string, unknown>;

class RecordingConnection {
  readonly statements: Array<{ sql: string; params: unknown[] }> = [];
  readonly transactions: string[] = [];
  productRows: Row[] = [{
    id: 7, item_no: 'OLD', product_name: 'Before', composition: '', weight: '', width: '',
    image_count: 1, created_at: new Date('2026-09-20T00:00:00Z'), updated_at: new Date('2026-09-20T00:00:00Z'),
  }];
  imageLinks: Row[] = [];
  tagLinks: Row[] = [];
  assetStatuses = new Map<string, Row>();
  tagStatuses = new Map<number, Row>();
  failSqlPattern: string | null = null;

  async query(sql: string, params: unknown[] = []): Promise<[unknown, unknown]> {
    this.statements.push({ sql, params });
    if (this.failSqlPattern && sql.includes(this.failSqlPattern)) throw new Error('injected transaction failure');
    if (sql.includes('INSERT INTO products ')) return [{ insertId: 7, affectedRows: 1 }, []];
    if (sql.includes('SELECT * FROM products WHERE id = ? FOR UPDATE')) return [this.productRows, []];
    if (sql.includes('FROM product_image_assets') && sql.includes('FOR UPDATE')) return [this.imageLinks, []];
    if (sql.includes('FROM product_pattern_tags') && sql.includes('FOR UPDATE')) return [this.tagLinks, []];
    if (sql.includes('FROM image_assets') && sql.includes('FOR UPDATE')) {
      return [params.map((id) => this.assetStatuses.get(String(id))).filter(Boolean), []];
    }
    if (sql.includes('FROM pattern_tags') && sql.includes('FOR UPDATE')) {
      return [params.map((id) => this.tagStatuses.get(Number(id))).filter(Boolean), []];
    }
    if (sql.includes('COUNT(*) AS image_count')) return [[{ image_count: 0 }], []];
    return [{ affectedRows: 1 }, []];
  }

  async getConnection(): Promise<this> { return this; }
  async beginTransaction(): Promise<void> { this.transactions.push('BEGIN'); }
  async commit(): Promise<void> { this.transactions.push('COMMIT'); }
  async rollback(): Promise<void> { this.transactions.push('ROLLBACK'); }
  release(): void { this.transactions.push('RELEASE'); }
}

const input: ProductWriteInput = {
  itemNo: 'G-001', productName: 'Floral', composition: 'Cotton', weight: '120', width: '150',
  patternTagIds: [2, 5],
  images: [
    { assetId: 'pattern', role: 'pattern_original', sortOrder: 0 },
    { assetId: 'display', role: 'fabric_display', sortOrder: 0 },
    { assetId: 'detail', role: 'detail', sortOrder: 0 },
    { assetId: 'effect', role: 'ai_effect', sortOrder: 0 },
  ],
};

test('create locks ready assets and active tags then commits fields tags and categorized layout', async () => {
  const connection = preparedConnection(input);
  const repository = new MySqlProductRepository(connection);

  const created = await repository.createProduct(input, 'admin-1');

  assert.equal(created.id, 7);
  assert.deepEqual(connection.transactions, ['BEGIN', 'COMMIT', 'RELEASE']);
  const imageInserts = connection.statements.filter((statement) => statement.sql.includes('INSERT INTO product_image_assets'));
  assert.deepEqual(imageInserts.map((statement) => statement.params.slice(2, 5)), [
    ['pattern_original', 0, 1],
    ['fabric_display', 0, 0],
    ['detail', 0, 0],
    ['ai_effect', 0, 0],
  ]);
  const tagInserts = connection.statements.filter((statement) => statement.sql.includes('INSERT INTO product_pattern_tags'));
  assert.deepEqual(tagInserts.map((statement) => statement.params.slice(0, 2)), [[7, 2], [7, 5]]);
});

test('not-ready asset rolls back the complete update transaction', async () => {
  const connection = preparedConnection(input);
  connection.assetStatuses.set('effect', { id: 'effect', status: 'processing', ref_count: 0 });
  const repository = new MySqlProductRepository(connection);

  await assert.rejects(repository.updateProduct(7, input, 'admin-1'), /ready/);

  assert.deepEqual(connection.transactions, ['BEGIN', 'ROLLBACK', 'RELEASE']);
  assert.equal(connection.statements.some((statement) => statement.sql.includes('UPDATE products SET item_no')), false);
});

test('layout replacement increments new references and recycles removed references', async () => {
  const connection = preparedConnection(input);
  connection.imageLinks = [{ id: 10, asset_id: 'old', role: 'pattern_original', sort_order: 0, is_primary: 1 }];
  connection.assetStatuses.set('old', { id: 'old', status: 'ready', ref_count: 1 });
  const repository = new MySqlProductRepository(connection);

  await repository.replaceImageLayout(7, [
    { assetId: 'pattern', role: 'pattern_original', sortOrder: 0, isPrimary: true },
  ]);

  const sql = connection.statements.map((statement) => statement.sql).join('\n');
  assert.match(sql, /ref_count = ref_count \+ 1/);
  assert.match(sql, /status = 'recycled'/);
  assert.deepEqual(connection.transactions, ['BEGIN', 'COMMIT', 'RELEASE']);
});

function preparedConnection(value: ProductWriteInput): RecordingConnection {
  const connection = new RecordingConnection();
  for (const image of value.images) {
    connection.assetStatuses.set(image.assetId, { id: image.assetId, status: 'ready', ref_count: 0 });
  }
  for (const tagId of value.patternTagIds) {
    connection.tagStatuses.set(tagId, { id: tagId, status: 'active' });
  }
  return connection;
}
