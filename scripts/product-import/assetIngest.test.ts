import assert from 'node:assert/strict';
import test from 'node:test';

import { AssetIngestor } from './assetIngest';
import type { MaterializedImportImage } from './imagePlan';

test('local asset ingestion uploads finalizes and runs worker until ready', async () => {
  let status: 'processing' | 'ready' = 'processing';
  const calls: string[] = [];
  const runtime = {
    storageProvider: 'local' as const,
    service: {
      async createUploadSession() { calls.push('session'); return { sessionId: 'session-1', uploadUrl: '/api/local', method: 'PUT' as const, headers: {}, expiresAt: '' }; },
      async finalizeUploadSession() { calls.push('finalize'); return { id: 'asset-1', status, purpose: 'product_image' as const, detectedMime: 'image/png', byteSize: 3, width: 1, height: 1, variants: {} }; },
      async getDescriptor() { return { id: 'asset-1', status, purpose: 'product_image' as const, detectedMime: 'image/png', byteSize: 3, width: 1, height: 1, variants: {} }; },
    },
    worker: { async runOnce() { calls.push('worker'); status = 'ready'; return true; } },
    async uploadLocalContent() { calls.push('upload'); },
  };
  const image: MaterializedImportImage = { body: Buffer.from([1, 2, 3]), mime: 'image/png', extension: 'png', width: 1, height: 1, sha256: 'a'.repeat(64), originMetadata: {}, issues: [] };
  assert.deepEqual(await new AssetIngestor(runtime).ingest(image, '新-F2.png', 'admin'), { assetId: 'asset-1' });
  assert.deepEqual(calls, ['session', 'upload', 'finalize', 'worker']);
});

