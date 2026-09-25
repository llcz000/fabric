import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ProductImportBatch } from '../../server/products/importTypes';
import { LocalCompatImportAdapter } from './localCompat';
import type { MaterializedImportImage } from './imagePlan';
import type { PlannedProduct } from './normalize';

test('local compatibility mode writes roles sources and issues atomically', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'fabric-local-import-'));
  try {
    const adapter = new LocalCompatImportAdapter(root);
    const batch: ProductImportBatch = { id: 1, fileSha256: 'a'.repeat(64), sheetName: '新', status: 'running', createdBy: 'admin' };
    const product: PlannedProduct = {
      planKey: 'plan-1', fields: { itemNo: 'G1', productName: '', composition: '', weight: '', width: '' }, patternTagIds: [],
      sources: [{ sheet: '新', rowNumber: 2, cells: { A: 'G1', B: '', C: '', D: '', E: '', F: '', G: '', H: '', I: '', J: '' }, imageRefs: [], fingerprint: 'fp' }],
      images: [{ cell: 'F2', dispImgId: 'img', mediaEntry: 'xl/media/1.png', role: 'pattern_original', sortOrder: 0 }],
      issues: [{ code: 'MISSING_WIDTH', fieldName: 'width', message: '缺少门幅', sourceRef: '新!E2', severity: 'warning' }],
    };
    const image: MaterializedImportImage = { body: Buffer.from([1, 2, 3]), mime: 'image/png', extension: 'png', width: 1, height: 1, sha256: 'b'.repeat(64), originMetadata: {}, issues: [] };
    await adapter.applyProduct(batch, product, [{ planned: product.images[0], materialized: image }]);
    const saved = await adapter.readProductByPlanKey('plan-1');
    assert.equal(saved?.images[0].role, 'pattern_original');
    assert.equal(saved?.sources[0].sourceRow, 2);
    assert.equal(saved?.issues.some((issue) => issue.code === 'MISSING_WIDTH'), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
