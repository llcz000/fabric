import assert from 'node:assert/strict';
import test from 'node:test';

import { MySqlProductImportRepository, validateImportSourcePayload } from './mysqlImportRepository';

test('source payload accepts only bounded A-J string cells', () => {
  const valid = Object.fromEntries('ABCDEFGHIJ'.split('').map((column) => [column, column]));
  assert.deepEqual(validateImportSourcePayload(valid), valid);
  assert.throws(() => validateImportSourcePayload({ ...valid, K: 'extra' }), /A-J/);
  assert.throws(() => validateImportSourcePayload({ ...valid, J: 'x'.repeat(17_000) }), /16 KiB/);
});

test('imported product fields assets sources and issues commit in one transaction', async () => {
  const transactions: string[] = [];
  const statements: string[] = [];
  const connection = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes('SELECT source_row')) return [[], []] as [unknown, unknown];
      if (sql.includes('SELECT id, status FROM image_assets')) return [[{ id: 'asset-1', status: 'ready' }], []] as [unknown, unknown];
      if (sql.includes('INSERT INTO products')) return [{ insertId: 7 }, []] as [unknown, unknown];
      return [{ affectedRows: 1 }, []] as [unknown, unknown];
    },
    async beginTransaction() { transactions.push('BEGIN'); }, async commit() { transactions.push('COMMIT'); }, async rollback() { transactions.push('ROLLBACK'); }, release() { transactions.push('RELEASE'); },
  };
  const repository = new MySqlProductImportRepository({ async getConnection() { return connection; }, query: connection.query });
  const cells = Object.fromEntries('ABCDEFGHIJ'.split('').map((column) => [column, column])) as Record<'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'I'|'J', string>;
  const result = await repository.applyImportedProduct({
    batchId: 12, planKey: 'a'.repeat(64), fields: { itemNo: 'G1', productName: '', composition: '', weight: '', width: '' }, patternTagIds: [], principalId: 'admin',
    sources: [{ sheet: '新', rowNumber: 2, cells, imageRefs: [], fingerprint: 'b'.repeat(64) }],
    images: [{ assetId: 'asset-1', role: 'pattern_original', sortOrder: 0, sourceRef: '新!F2' }],
    issues: [{ code: 'MISSING_PRODUCT_NAME', fieldName: 'productName', message: '缺少产品名称', sourceRef: '新!B2', severity: 'warning' }],
  });
  assert.equal(result.productId, 7);
  assert.deepEqual(transactions, ['BEGIN', 'COMMIT', 'RELEASE']);
  assert.equal(statements.some((sql) => sql.includes('INSERT INTO product_import_sources')), true);
  assert.equal(statements.some((sql) => sql.includes('INSERT INTO product_issues')), true);
});
