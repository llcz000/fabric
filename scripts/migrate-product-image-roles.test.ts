import assert from 'node:assert/strict';
import test from 'node:test';

import { migrateLegacyProductRoles, parseLegacyRoleMigrationArgs, type LegacyRoleMigrationRepository } from './migrate-product-image-roles';

function repository(): LegacyRoleMigrationRepository & { writeCount: number } {
  return {
    writeCount: 0,
    async listProductImageBatches(afterProductId) {
      return afterProductId === 0 ? [{ productId: 7, images: [{ id: 4, sortOrder: 0 }, { id: 9, sortOrder: 2 }] }] : [];
    },
    async applyRoles() { this.writeCount += 1; },
  };
}

test('dry-run produces actions without writes', async () => {
  const repo = repository();
  const result = await migrateLegacyProductRoles({ mode: 'dry-run', repository: repo });
  assert.equal(result.planned, 2);
  assert.equal(result.products, 1);
  assert.equal(repo.writeCount, 0);
});

test('apply writes one atomic product plan and rerunnable empty batches do nothing', async () => {
  const repo = repository();
  const result = await migrateLegacyProductRoles({ mode: 'apply', repository: repo });
  assert.equal(result.updated, 2);
  assert.equal(repo.writeCount, 1);
});

test('command requires exactly one migration mode', () => {
  assert.deepEqual(parseLegacyRoleMigrationArgs(['--dry-run']), { mode: 'dry-run' });
  assert.throws(() => parseLegacyRoleMigrationArgs([]), /exactly one/);
  assert.throws(() => parseLegacyRoleMigrationArgs(['--dry-run', '--apply']), /exactly one/);
});
