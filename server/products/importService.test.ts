import assert from 'node:assert/strict';
import test from 'node:test';

import { ProductImportService } from './importService';
import type { AtomicImportedProduct, ProductImportBatch, ProductImportRepository } from './importTypes';
import type { PlannedProduct } from '../../scripts/product-import/normalize';

class FakeRepository implements ProductImportRepository {
  readonly applied: AtomicImportedProduct[] = [];
  readonly failures: string[] = [];
  completed = new Set<number>();
  failPlanOnce = new Set<string>();
  rollbackBlockers: Array<{ productId: number; reason: 'modified' | 'order_reference' | 'other_batch' }> = [];
  rolledBack = false;
  async beginOrResumeBatch(): Promise<ProductImportBatch> { return batch; }
  async getSourceResult(_batchId: number, _sheet: string, row: number) { return this.completed.has(row) ? { productId: 7, status: 'applied' as const } : null; }
  async applyImportedProduct(input: AtomicImportedProduct) {
    if (this.failPlanOnce.delete(input.planKey)) throw new Error('injected commit failure');
    this.applied.push(input);
    input.sources.forEach((source) => this.completed.add(source.rowNumber));
    return { productId: this.applied.length, updatedAt: new Date('2026-09-25T00:00:00Z') };
  }
  async recordProductFailure(_batchId: number, planKey: string) { this.failures.push(planKey); }
  async finishBatch() {}
  async listRollbackBlockers() { return this.rollbackBlockers; }
  async rollbackBatch() { if (this.rollbackBlockers.length) return this.rollbackBlockers; this.rolledBack = true; return []; }
  async markBatchRolledBack() { this.rolledBack = true; }
}

const batch: ProductImportBatch = { id: 12, fileSha256: 'a'.repeat(64), sheetName: '新', status: 'running', createdBy: 'admin' };
function product(planKey: string, rowNumber: number): PlannedProduct {
  return {
    planKey, fields: { itemNo: planKey, productName: '', composition: '', weight: '', width: '' }, patternTagIds: [],
    sources: [{ sheet: '新', rowNumber, cells: { A: planKey, B: '', C: '', D: '', E: '', F: '', G: '', H: '', I: '', J: '' }, imageRefs: [], fingerprint: `fp-${rowNumber}` }],
    images: [{ cell: `F${rowNumber}`, dispImgId: `img-${rowNumber}`, mediaEntry: `xl/media/${rowNumber}.png`, role: 'pattern_original', sortOrder: 0 }], issues: [],
  };
}

test('resume after asset ingestion reuses asset and creates one product', async () => {
  const repository = new FakeRepository();
  repository.failPlanOnce.add('G1');
  const ingested = new Map<string, string>();
  let physicalIngests = 0;
  const service = new ProductImportService(repository, { async ingest(image) { if (!ingested.has(image.mediaEntry)) { physicalIngests += 1; ingested.set(image.mediaEntry, 'asset-1'); } return { assetId: ingested.get(image.mediaEntry)! }; } });
  assert.equal((await service.applyProduct(batch, product('G1', 2), 'admin')).status, 'failed');
  assert.equal((await service.applyProduct(batch, product('G1', 2), 'admin')).status, 'applied');
  assert.equal(physicalIngests, 1);
  assert.equal(repository.applied.length, 1);
});

test('one product failure marks partial and later products continue', async () => {
  const repository = new FakeRepository();
  repository.failPlanOnce.add('bad');
  const service = new ProductImportService(repository, { async ingest(image) { return { assetId: image.dispImgId }; } });
  const result = await service.applyPlan(batch, [product('good-1', 2), product('bad', 3), product('good-2', 4)], 'admin');
  assert.deepEqual(result, { succeeded: 2, failed: 1, skipped: 0, status: 'partial' });
  assert.deepEqual(repository.applied.map((item) => item.planKey), ['good-1', 'good-2']);
});

test('one image failure keeps product metadata and records visible image issues', async () => {
  const repository = new FakeRepository();
  const service = new ProductImportService(repository, { async ingest() { throw Object.assign(new Error('bad image'), { code: 'IMAGE_DECODE_FAILED' }); } });
  const result = await service.applyProduct(batch, product('G1', 2), 'admin');
  assert.equal(result.status, 'applied');
  assert.equal(repository.applied[0].images.length, 0);
  assert.equal(repository.applied[0].issues.some((issue) => issue.code === 'IMAGE_REFERENCE_MISSING'), true);
  assert.equal(repository.applied[0].issues.some((issue) => issue.code === 'MISSING_PATTERN_ORIGINAL'), true);
});

test('rollback refuses the whole batch when any product is blocked', async () => {
  const repository = new FakeRepository();
  repository.rollbackBlockers = [{ productId: 8, reason: 'modified' }, { productId: 9, reason: 'order_reference' }];
  const service = new ProductImportService(repository, { async ingest(image) { return { assetId: image.dispImgId }; } });
  await assert.rejects(service.rollbackBatch(12), /ROLLBACK_BLOCKED/);
  assert.equal(repository.rolledBack, false);
});
