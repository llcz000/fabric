import assert from 'node:assert/strict';
import test from 'node:test';

import { ImageAssetError } from './errors';
import { getAssetPolicy } from './policy';

test('company QR policy keeps original and display only', () => {
  assert.deepEqual(getAssetPolicy('company_qr').variants, ['original', 'display']);
  assert.equal(getAssetPolicy('company_qr').maxBytes, 2 * 1024 * 1024);
});

test('product policy includes a thumbnail and rejects SVG', () => {
  const policy = getAssetPolicy('product_image');
  assert.deepEqual(policy.variants, ['original', 'display', 'thumbnail']);
  assert.equal(policy.allowedMimes.has('image/svg+xml'), false);
});

test('asset policy mutations do not affect later callers', () => {
  const first = getAssetPolicy('product_image');
  first.variants.pop();
  first.allowedMimes.delete('image/png');

  const second = getAssetPolicy('product_image');
  assert.deepEqual(second.variants, ['original', 'display', 'thumbnail']);
  assert.equal(second.allowedMimes.has('image/png'), true);
});

test('asset errors expose stable safe fields', () => {
  const body = new ImageAssetError('ASSET_NOT_READY', 409, false, 'processing').toResponse('req-1');
  assert.deepEqual(body, {
    error: {
      code: 'ASSET_NOT_READY',
      message: 'processing',
      requestId: 'req-1',
      retryable: false,
    },
  });
});
