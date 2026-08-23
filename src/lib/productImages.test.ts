/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Product image frontend client protocol tests with injected fetch.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listProducts,
  describeProduct,
  saveProduct,
  detachProductImage,
  deleteProductById,
  isDescriptorExpired,
  ImageAssetClientError,
} from './productImages';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function productRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 9,
    item_no: 'A-001',
    product_name: 'Fabric',
    composition: 'cotton',
    weight: '200',
    width: '150',
    image_count: 0,
    created_at: '2026-08-22T00:00:00.000Z',
    updated_at: '2026-08-22T00:00:00.000Z',
    images: [],
    ...overrides,
  };
}

test('listProducts requests the paginated endpoint and maps snake_case rows to primary thumbnail descriptors', async () => {
  const requestedUrls: string[] = [];
  const apiFetch: typeof fetch = async (input) => {
    requestedUrls.push(String(input));
    return jsonResponse([productRow({
      images: [{
        assetId: 'asset-1', sortOrder: 0, role: 'pattern_original', isPrimary: true,
        thumbnailUrl: 'https://cos.example/signed-thumb', expiresAt: '2026-08-22T01:00:00.000Z',
      }],
      image_count: 1,
    })]);
  };

  const products = await listProducts(apiFetch, { limit: 20, offset: 40 });
  assert.deepEqual(requestedUrls, ['/api/products?limit=20&offset=40']);
  assert.equal(products.length, 1);
  assert.equal(products[0].id, '9');
  assert.equal(products[0].itemNo, 'A-001');
  const image = products[0].images![0];
  assert.equal(image.source, 'asset');
  assert.equal(image.assetId, 'asset-1');
  assert.equal(image.thumbnailUrl, 'https://cos.example/signed-thumb');
  assert.equal(image.displayUrl, undefined);
  assert.equal(image.isPrimary, true);
  assert.equal(image.role, 'pattern_original');
});

test('listProducts defaults to limit 50 and caps limit at 100', async () => {
  const requestedUrls: string[] = [];
  const apiFetch: typeof fetch = async (input) => {
    requestedUrls.push(String(input));
    return jsonResponse([]);
  };
  await listProducts(apiFetch);
  await listProducts(apiFetch, { limit: 1000, offset: 0 });
  assert.deepEqual(requestedUrls, ['/api/products?limit=50&offset=0', '/api/products?limit=100&offset=0']);
});

test('describeProduct maps full descriptors with thumbnail+display and orders primary first', async () => {
  const apiFetch: typeof fetch = async () => jsonResponse(productRow({
    images: [
      { assetId: 'asset-2', sortOrder: 1, role: 'gallery', isPrimary: false, thumbnailUrl: 'https://cos.example/t2', displayUrl: 'https://cos.example/d2', expiresAt: '2026-08-22T01:00:00.000Z' },
      { assetId: 'asset-1', sortOrder: 0, role: 'pattern_original', isPrimary: true, thumbnailUrl: 'https://cos.example/t1', displayUrl: 'https://cos.example/d1', expiresAt: '2026-08-22T01:00:00.000Z' },
    ],
    image_count: 2,
  }));

  const product = await describeProduct(apiFetch, '9');
  const images = product.images!;
  assert.equal(images.length, 2);
  assert.equal(images[0].assetId, 'asset-1');
  assert.equal(images[0].role, 'pattern_original');
  assert.equal(images[0].isPrimary, true);
  assert.equal(images[0].thumbnailUrl, 'https://cos.example/t1');
  assert.equal(images[0].displayUrl, 'https://cos.example/d1');
  assert.equal(images[1].assetId, 'asset-2');
  assert.equal(images[1].role, 'gallery');
  assert.equal(images[1].displayUrl, 'https://cos.example/d2');
});

test('legacy feature-off descriptors use a same-origin contentUrl and never base64', async () => {
  const apiFetch: typeof fetch = async () => jsonResponse(productRow({
    images: [{ id: 12, sort_order: 0 }],
    image_count: 1,
  }));
  const product = await describeProduct(apiFetch, '9');
  const image = product.images![0];
  assert.equal(image.source, 'legacy');
  assert.equal(image.legacyImageId, 12);
  assert.equal(image.contentUrl, '/api/products/9/images/12');
  assert.equal(image.thumbnailUrl, undefined);
  assert.equal(image.displayUrl, undefined);
  assert.ok(!JSON.stringify(product).includes('base64'));
});

test('descriptor URLs reject data: URLs and raw object keys', async () => {
  const apiFetch: typeof fetch = async () => jsonResponse(productRow({
    images: [{
      assetId: 'asset-1', sortOrder: 0, role: 'pattern_original', isPrimary: true,
      thumbnailUrl: 'data:image/png;base64,aGVsbG8=',
      displayUrl: 'data:image/jpeg;base64,aGVsbG8=',
      expiresAt: '2026-08-22T01:00:00.000Z',
    }],
  }));
  const product = await describeProduct(apiFetch, '9');
  const image = product.images![0];
  assert.equal(image.thumbnailUrl, undefined);
  assert.equal(image.displayUrl, undefined);
});

test('listProducts surfaces stable error code and request ID', async () => {
  const apiFetch: typeof fetch = async () => new Response(
    JSON.stringify({ error: { code: 'STORAGE_UNAVAILABLE', message: 'unavailable', requestId: 'req-1', retryable: true } }),
    { status: 503, headers: { 'Content-Type': 'application/json' } },
  );
  await assert.rejects(
    () => listProducts(apiFetch),
    (error: unknown) => error instanceof ImageAssetClientError
      && error.code === 'STORAGE_UNAVAILABLE'
      && error.requestId === 'req-1'
      && error.retryable === true,
  );
});

test('listProducts falls back to the X-Request-Id header when the body omits it', async () => {
  const apiFetch: typeof fetch = async () => new Response(
    JSON.stringify({ error: { code: 'ASSET_NOT_READY', message: 'not ready', retryable: true } }),
    { status: 409, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-header' } },
  );
  await assert.rejects(
    () => listProducts(apiFetch),
    (error: unknown) => error instanceof ImageAssetClientError && error.requestId === 'req-header',
  );
});

test('saveProduct creates with ordered imageAssetIds (first is primary)', async () => {
  const bodies: unknown[] = [];
  const requests: { url: string; method: string; contentType: string }[] = [];
  const apiFetch: typeof fetch = async (input, init: RequestInit = {}) => {
    requests.push({ url: String(input), method: init.method ?? 'GET', contentType: new Headers(init.headers).get('Content-Type') ?? '' });
    bodies.push(JSON.parse(String(init.body)));
    return jsonResponse(productRow({ id: 10 }));
  };

  await saveProduct(apiFetch, {
    itemNo: 'A-002', productName: 'New', composition: '', weight: '', width: '',
    imageAssetIds: ['asset-1', 'asset-2', 'asset-3'],
  });
  assert.deepEqual(requests, [{ url: '/api/products', method: 'POST', contentType: 'application/json' }]);
  assert.deepEqual(bodies[0], {
    itemNo: 'A-002', productName: 'New', composition: '', weight: '', width: '',
    imageAssetIds: ['asset-1', 'asset-2', 'asset-3'],
  });
});

test('saveProduct uses PUT for a numeric existing id', async () => {
  const requests: { url: string; method: string }[] = [];
  const apiFetch: typeof fetch = async (input, init: RequestInit = {}) => {
    requests.push({ url: String(input), method: init.method ?? 'GET' });
    return jsonResponse(productRow());
  };
  await saveProduct(apiFetch, {
    id: '9', itemNo: 'A-001', productName: 'Fabric', composition: '', weight: '', width: '',
    imageAssetIds: ['asset-1'],
  });
  assert.deepEqual(requests, [{ url: '/api/products/9', method: 'PUT' }]);
});

test('detachProductImage deletes by assetId', async () => {
  const requests: { url: string; method: string }[] = [];
  const apiFetch: typeof fetch = async (input, init: RequestInit = {}) => {
    requests.push({ url: String(input), method: init.method ?? 'GET' });
    return jsonResponse({ success: true, image_count: 0 });
  };
  await detachProductImage(apiFetch, '9', 'asset-1');
  assert.deepEqual(requests, [{ url: '/api/products/9/images/asset-1', method: 'DELETE' }]);
});

test('deleteProductById deletes the product', async () => {
  const requests: { url: string; method: string }[] = [];
  const apiFetch: typeof fetch = async (input, init: RequestInit = {}) => {
    requests.push({ url: String(input), method: init.method ?? 'GET' });
    return jsonResponse({ success: true });
  };
  await deleteProductById(apiFetch, '9');
  assert.deepEqual(requests, [{ url: '/api/products/9', method: 'DELETE' }]);
});

test('isDescriptorExpired reflects expiresAt against the supplied clock', () => {
  const base = { source: 'asset', role: 'pattern_original', sortOrder: 0, isPrimary: true, assetId: 'a1' } as const;
  assert.equal(isDescriptorExpired({ ...base, expiresAt: '2026-08-22T01:00:00.000Z' }, Date.parse('2026-08-22T00:59:00.000Z')), false);
  assert.equal(isDescriptorExpired({ ...base, expiresAt: '2026-08-22T01:00:00.000Z' }, Date.parse('2026-08-22T01:00:00.000Z')), true);
  assert.equal(isDescriptorExpired({ ...base }, Date.now()), false);
});
