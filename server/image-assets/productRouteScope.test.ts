import assert from 'node:assert/strict';
import test from 'node:test';

import { isProductImageApiRequest, isProductImageRequest } from './productRouteScope';

function request(method: string, path: string): { method: string; path: string } {
  return { method, path };
}

test('structurally-product malformed paths are classified as product image scope', () => {
  assert.equal(isProductImageRequest(request('GET', '/abc')), true);
  assert.equal(isProductImageRequest(request('PUT', '/abc')), true);
  assert.equal(isProductImageRequest(request('DELETE', '/abc')), true);
  assert.equal(isProductImageRequest(request('DELETE', '/abc/images/xyz')), true);
  assert.equal(isProductImageRequest(request('GET', '/abc/thumbnails')), true);
});

test('valid product image paths remain in scope', () => {
  assert.equal(isProductImageRequest(request('GET', '/')), true);
  assert.equal(isProductImageRequest(request('POST', '/')), true);
  assert.equal(isProductImageRequest(request('POST', '/batch-delete')), true);
  assert.equal(isProductImageRequest(request('GET', '/123')), true);
  assert.equal(isProductImageRequest(request('PUT', '/123')), true);
  assert.equal(isProductImageRequest(request('DELETE', '/123')), true);
  assert.equal(isProductImageRequest(request('GET', '/123/thumbnails')), true);
  assert.equal(isProductImageRequest(request('DELETE', '/123/images/asset_1')), true);
});

test('legacy import/export and numeric image paths stay out of scope', () => {
  assert.equal(isProductImageRequest(request('POST', '/import')), false);
  assert.equal(isProductImageRequest(request('POST', '/export')), false);
  assert.equal(isProductImageRequest(request('DELETE', '/123/images/456')), false);
  assert.equal(isProductImageRequest(request('GET', '/123/images/456')), false);
  assert.equal(isProductImageRequest(request('GET', '/123/456')), false);
  assert.equal(isProductImageRequest(request('POST', '/anything')), false);
});

test('isProductImageApiRequest strips the /api/products prefix and delegates', () => {
  assert.equal(isProductImageApiRequest(request('GET', '/api/products')), true);
  assert.equal(isProductImageApiRequest(request('GET', '/api/products/abc')), true);
  assert.equal(isProductImageApiRequest(request('POST', '/api/products/import')), false);
  assert.equal(isProductImageApiRequest(request('GET', '/api/company')), false);
  assert.equal(isProductImageApiRequest(request('GET', '/api/orders/1')), false);
});
