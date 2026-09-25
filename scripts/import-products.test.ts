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

