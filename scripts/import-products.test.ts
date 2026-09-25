import assert from 'node:assert/strict';
import test from 'node:test';

import { parseImportArgs } from './import-products';

test('requires exactly one execution mode and explicit file sheet', () => {
  assert.throws(() => parseImportArgs(['--file', 'book.xlsm', '--sheet', '新']), /one mode/);
  assert.throws(() => parseImportArgs(['--file', 'book.xlsm', '--sheet', '新', '--dry-run', '--apply']), /one mode/);
  assert.throws(() => parseImportArgs(['--dry-run']), /--file/);
  assert.deepEqual(parseImportArgs(['--file', 'book.xlsm', '--sheet', '新', '--dry-run', '--report-dir', '.local/reports']), {
    mode: 'dry-run', file: 'book.xlsm', sheet: '新', reportDir: '.local/reports', allowLocalCompat: false,
  });
});

test('rollback mode accepts only a positive batch id', () => {
  assert.deepEqual(parseImportArgs(['--rollback-batch', '12', '--report-dir', '.local/reports']), { mode: 'rollback', rollbackBatch: 12, reportDir: '.local/reports', allowLocalCompat: false });
  assert.throws(() => parseImportArgs(['--rollback-batch', '0']), /batch/i);
});

test('local data root is accepted only with explicit compatibility mode', () => {
  assert.throws(() => parseImportArgs(['--file', 'book.xlsm', '--sheet', '新', '--apply', '--local-data-root', 'D:/fabric']), /allow-local-compat/);
  assert.equal(parseImportArgs(['--file', 'book.xlsm', '--sheet', '新', '--apply', '--allow-local-compat', '--local-data-root', 'D:/fabric']).localDataRoot, 'D:/fabric');
});
