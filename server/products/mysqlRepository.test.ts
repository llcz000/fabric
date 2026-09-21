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
  batchProductRows: Row[] = [];
  batchTagLinks: Row[] = [];
  duplicateTagInsert = false;
  existingTagRow: Row | null = null;
  listProductRows: Row[] = [];
  listImageSummaryRows: Row[] = [];
  listTagSummaryRows: Row[] = [];
  listIssueSummaryRows: Row[] = [];
  listTotal = 0;
  failSqlPattern: string | null = null;

  async query(sql: string, params: unknown[] = []): Promise<[unknown, unknown]> {
    this.statements.push({ sql, params });
    if (this.failSqlPattern && sql.includes(this.failSqlPattern)) throw new Error('injected transaction failure');
    if (sql.includes('INSERT INTO products ')) return [{ insertId: 7, affectedRows: 1 }, []];
    if (sql.includes('INSERT INTO pattern_tags') && this.duplicateTagInsert) {
      const error = new Error('duplicate') as Error & { code?: string };
      error.code = 'ER_DUP_ENTRY';
      throw error;
    }
    if (sql.includes('SELECT * FROM pattern_tags WHERE normalized_name = ?')) {
      return [this.existingTagRow ? [this.existingTagRow] : [], []];
    }
    if (sql.includes('SELECT id FROM products WHERE id IN')) return [this.batchProductRows, []];
    if (sql.includes('SELECT product_id, tag_id FROM product_pattern_tags')) return [this.batchTagLinks, []];
    if (sql.includes('SELECT COUNT(*) AS total FROM (')) return [[{ total: this.listTotal }], []];
    if (sql.includes('JOIN (') && sql.includes('ORDER BY p.updated_at DESC')) return [this.listProductRows, []];
    if (sql.includes('AS pattern_count') && sql.includes('FROM product_image_assets')) return [this.listImageSummaryRows, []];
    if (sql.includes('SELECT ppt.product_id, pt.id, pt.name, pt.status')) return [this.listTagSummaryRows, []];
    if (sql.includes('AS open_issue_count') && sql.includes('FROM product_issues')) return [this.listIssueSummaryRows, []];
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

test('create pattern tag reuses the normalized duplicate after a unique-key race', async () => {
  const connection = new RecordingConnection();
  connection.duplicateTagInsert = true;
  connection.existingTagRow = {
    id: 3, name: 'Floral', normalized_name: 'floral', status: 'active', created_by: 'admin-1',
    created_at: new Date('2026-09-21T00:00:00Z'), updated_at: new Date('2026-09-21T00:00:00Z'),
  };
  const repository = new MySqlProductRepository(connection);

  const tag = await repository.createPatternTag('ＦＬＯＲＡＬ', 'floral', 'admin-2');

  assert.equal(tag.id, 3);
  assert.equal(tag.name, 'Floral');
});

test('batch add rejects the whole transaction when one product would exceed twelve tags', async () => {
  const connection = new RecordingConnection();
  connection.batchProductRows = [{ id: 1 }, { id: 2 }];
  connection.tagStatuses.set(99, { id: 99, status: 'active' });
  connection.batchTagLinks = [
    ...Array.from({ length: 12 }, (_, index) => ({ product_id: 1, tag_id: index + 1 })),
    { product_id: 2, tag_id: 1 },
  ];
  const repository = new MySqlProductRepository(connection);

  await assert.rejects(repository.applyPatternTagBatch({
    productIds: [1, 2], operation: 'add', tagIds: [99],
  }, 'admin-1'), /12 pattern tags/);

  assert.deepEqual(connection.transactions, ['BEGIN', 'ROLLBACK', 'RELEASE']);
  assert.equal(connection.statements.some((statement) => statement.sql.includes('INSERT INTO product_pattern_tags') && statement.params[1] === 99), false);
});

test('editing may retain an archived tag but cannot attach it to another product', async () => {
  const retained = preparedConnection({ ...input, patternTagIds: [8] });
  retained.tagLinks = [{ tag_id: 8 }];
  retained.tagStatuses.set(8, { id: 8, status: 'archived' });
  await new MySqlProductRepository(retained).updateProduct(7, { ...input, patternTagIds: [8] }, 'admin-1');
  assert.deepEqual(retained.transactions, ['BEGIN', 'COMMIT', 'RELEASE']);

  const newlyAttached = preparedConnection({ ...input, patternTagIds: [8] });
  newlyAttached.tagLinks = [];
  newlyAttached.tagStatuses.set(8, { id: 8, status: 'archived' });
  await assert.rejects(
    new MySqlProductRepository(newlyAttached).updateProduct(7, { ...input, patternTagIds: [8] }, 'admin-1'),
    /Archived pattern tag/,
  );
  assert.deepEqual(newlyAttached.transactions, ['BEGIN', 'ROLLBACK', 'RELEASE']);
});

test('tag all-mode and keyword filtering happen before stable pagination', async () => {
  const connection = new RecordingConnection();
  connection.listTotal = 2;
  const repository = new MySqlProductRepository(connection);

  const page = await repository.listProducts({
    q: '50%_棉', tagIds: [2, 5], tagMode: 'all', issueCodes: [], limit: 50, offset: 50,
  });

  const sql = connection.statements.map((statement) => statement.sql).join('\n');
  assert.match(sql, /HAVING COUNT\(DISTINCT filter_tags\.tag_id\) = 2/);
  assert.match(sql, /ORDER BY p\.updated_at DESC, p\.id DESC LIMIT \? OFFSET \?/);
  assert.equal(connection.statements.some((statement) => statement.params.includes('%50\\%\\_棉%')), true);
  assert.equal(page.total, 2);
  assert.equal(page.offset, 50);
});

test('product page enriches two products with three batch queries and no per-product queries', async () => {
  const connection = new RecordingConnection();
  connection.listTotal = 2;
  connection.listProductRows = [
    { id: 8, item_no: 'B', product_name: 'Blue', composition: 'Cotton', weight: '120', width: '150', image_count: 1, created_at: new Date(0), updated_at: new Date(2) },
    { id: 7, item_no: 'A', product_name: 'Amber', composition: 'Linen', weight: '110', width: '145', image_count: 0, created_at: new Date(0), updated_at: new Date(1) },
  ];
  connection.listImageSummaryRows = [
    { product_id: 8, pattern_count: 1, fabric_display_count: 0, detail_count: 0, ai_effect_count: 0, unclassified_count: 0, primary_asset_id: 'asset-8' },
  ];
  connection.listTagSummaryRows = [
    { product_id: 8, id: 2, name: '碎花', status: 'active' },
    { product_id: 7, id: 5, name: '春夏', status: 'archived' },
  ];
  connection.listIssueSummaryRows = [{ product_id: 7, open_issue_count: 2 }];
  const repository = new MySqlProductRepository(connection);

  const page = await repository.listProducts({ tagIds: [], tagMode: 'all', issueCodes: [], limit: 50, offset: 0 });

  assert.equal(connection.statements.length, 5);
  assert.equal(page.items[0].categoryCounts.patternOriginal, 1);
  assert.deepEqual(page.items[0].patternTags, [{ id: 2, name: '碎花', status: 'active' }]);
  assert.equal(page.items[1].reviewStatus, 'needs_attention');
  assert.equal(page.items[1].openIssueCount, 2);
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
