import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { exceptImageAssetApi, mountProductRouteAssembly } from '../appAssembly';
import type { ProductImageRouteRuntime, ProductImageRuntime } from './productImages';

type Association = { assetId: string; sortOrder: number; role: 'pattern_original' | 'gallery'; isPrimary: boolean };

interface ProductState {
  products: Array<Record<string, unknown> & { id: number; item_no: string; product_name: string }>;
  links: Map<number, Association[]>;
  calls: string[];
}

function runtime(enabled: boolean, state: ProductState): ProductImageRouteRuntime {
  const get = (id: number) => state.products.find((product) => product.id === id) ?? null;
  const service: ProductImageRuntime['service'] = enabled ? {
    async getAccessUrls(requests) {
      return requests.map((request) => ({
        ...request,
        url: `https://signed.example/${request.assetId}/${request.variant}`,
        expiresAt: '2026-08-23T12:00:00.000Z',
      }));
    },
    async attachProductImages() {},
    async createProductWithImages(input, assetIds) {
      state.calls.push(`create:${assetIds.join(',')}`);
      const id = Math.max(0, ...state.products.map((product) => Number(product.id))) + 1;
      const created = { id, item_no: input.itemNo, product_name: input.productName, image_count: assetIds.length };
      state.products.push(created);
      state.links.set(id, assetIds.map((assetId, index) => ({
        assetId, sortOrder: index, role: index === 0 ? 'pattern_original' as const : 'gallery' as const, isPrimary: index === 0,
      })));
      return created as never;
    },
    async updateProductWithImages(productId, input, assetIds) {
      state.calls.push(`update:${productId}:${assetIds.join(',')}`);
      const product = get(productId);
      if (!product) return null;
      Object.assign(product, { item_no: input.itemNo, product_name: input.productName });
      const current = state.links.get(productId) ?? [];
      for (const assetId of assetIds) {
        current.push({ assetId, sortOrder: current.length, role: current.length === 0 ? 'pattern_original' as const : 'gallery' as const, isPrimary: current.length === 0 });
      }
      state.links.set(productId, current);
      product.image_count = current.length;
      return product as never;
    },
    async listProductsPage(limit, offset) { return state.products.slice(offset, offset + limit) as never[]; },
    async findProductIdsByItemNos(itemNos) { return state.products.filter((product) => itemNos.includes(product.item_no)).map((product) => product.id); },
    async getProductRecord(productId) { return get(productId) as never; },
    async listProductImageAssociations(productIds, primaryOnly) {
      return productIds.flatMap((productId) => (state.links.get(productId) ?? [])
        .filter((association) => !primaryOnly || association.isPrimary)
        .map((association) => ({ productId, ...association }))) as never[];
    },
    async listLegacyProductImages() { return []; },
    async detachProductImage(productId, assetId) {
      state.calls.push(`detach:${productId}:${assetId}`);
      state.links.set(productId, (state.links.get(productId) ?? []).filter((image) => image.assetId !== assetId));
    },
    async detachAllProductImages(productId) { state.links.delete(productId); },
    async deleteProductWithAssets(productId) {
      state.calls.push(`delete:${productId}`);
      const index = state.products.findIndex((product) => product.id === productId);
      if (index < 0) return false;
      state.links.delete(productId);
      state.products.splice(index, 1);
      return true;
    },
  } : null;
  return { enabled, principalId: 'admin', service };
}

async function withProductAssembly<T>(
  enabled: boolean,
  state: ProductState,
  work: (baseUrl: string, globalAuthCalls: () => number) => Promise<T>,
): Promise<T> {
  const app = express();
  const globalJsonParser = express.json();
  const globalUrlencodedParser = express.urlencoded({ extended: true });
  app.use(exceptImageAssetApi(globalJsonParser, enabled));
  app.use(exceptImageAssetApi(globalUrlencodedParser, enabled));

  let globalAuthCount = 0;
  mountProductRouteAssembly(app, {
    productImageRuntime: runtime(enabled, state),
    authenticateProduct: (req) => req.get('Authorization') === 'Bearer good',
    globalAuth(req, res, next) {
      globalAuthCount += 1;
      if (req.get('Authorization') !== 'Bearer good') return res.status(401).json({ error: 'Unauthorized' });
      next();
    },
  });

  // Legacy product routes, registered after the product assembly exactly as server.ts does.
  app.get('/api/products', (_req, res) => res.json({ legacyList: true }));
  app.post('/api/products', (req, res) => res.json({ legacyCreate: req.body }));
  app.get('/api/products/:id', (req, res) => res.json({ legacyGet: req.params.id }));
  app.post('/api/products/import', (_req, res) => res.json({ legacyImport: true }));
  app.post('/api/products/export', (_req, res) => res.json({ legacyExport: true }));
  app.get('/api/products/:productId/images/:imageId', (req, res) => res.json({ legacyImageGet: req.params.imageId }));
  app.delete('/api/products/:productId/images/:imageId', (req, res) => res.json({ legacyImageDelete: req.params.imageId }));
  app.get('/api/orders', (_req, res) => res.json({ orders: true }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const { port } = server.address() as AddressInfo;
  try {
    return await work(`http://127.0.0.1:${port}`, () => globalAuthCount);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const auth = { Authorization: 'Bearer good' };

test('feature-on malformed product paths never bypass auth and return a safe request ID', async () => {
  const state: ProductState = { products: [], links: new Map(), calls: [] };
  await withProductAssembly(true, state, async (baseUrl, globalAuthCalls) => {
    for (const [method, path] of [
      ['GET', '/api/products/abc'],
      ['PUT', '/api/products/abc'],
      ['DELETE', '/api/products/abc'],
      ['DELETE', '/api/products/abc/images/xyz'],
    ] as Array<[string, string]>) {
      const denied = await fetch(`${baseUrl}${path}`, { method, headers: { 'X-Request-Id': 'malformed-unauth' } });
      assert.equal(denied.status, 401, `${method} ${path}`);
      assert.equal(denied.headers.get('x-request-id'), 'malformed-unauth', `${method} ${path}`);
      assert.equal((await denied.json()).error.requestId, 'malformed-unauth', `${method} ${path}`);
    }
  });
});

test('feature-on authenticated malformed product paths return 4xx with request ID, never 500', async () => {
  const state: ProductState = { products: [], links: new Map(), calls: [] };
  await withProductAssembly(true, state, async (baseUrl) => {
    for (const [method, path] of [
      ['GET', '/api/products/abc'],
      ['PUT', '/api/products/abc'],
      ['DELETE', '/api/products/abc'],
      ['DELETE', '/api/products/abc/images/xyz'],
    ] as Array<[string, string]>) {
      const headers = { ...auth, 'X-Request-Id': 'malformed-auth', 'Content-Type': 'application/json' };
      const response = await fetch(`${baseUrl}${path}`, { method, headers, body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify({}) });
      assert.equal(response.status, 422, `${method} ${path}`);
      assert.equal(response.headers.get('x-request-id'), 'malformed-auth', `${method} ${path}`);
      const body = await response.json();
      assert.equal(body.error.requestId, 'malformed-auth', `${method} ${path}`);
      assert.doesNotMatch(JSON.stringify(body), /Internal server error|stack/i);
    }
  });
});

test('feature-on leaves legacy import/export and numeric image routes under global auth untouched', async () => {
  const state: ProductState = { products: [], links: new Map(), calls: [] };
  await withProductAssembly(true, state, async (baseUrl) => {
    const denied = await fetch(`${baseUrl}/api/products/import`, { method: 'POST' });
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get('x-request-id'), null);

    const importResponse = await fetch(`${baseUrl}/api/products/import`, { method: 'POST', headers: auth });
    assert.equal(importResponse.status, 200);
    assert.deepEqual(await importResponse.json(), { legacyImport: true });

    const exportResponse = await fetch(`${baseUrl}/api/products/export`, { method: 'POST', headers: auth });
    assert.equal(exportResponse.status, 200);
    assert.deepEqual(await exportResponse.json(), { legacyExport: true });

    const imageDelete = await fetch(`${baseUrl}/api/products/1/images/5`, { method: 'DELETE', headers: auth });
    assert.equal(imageDelete.status, 200);
    assert.deepEqual(await imageDelete.json(), { legacyImageDelete: '5' });

    const imageGet = await fetch(`${baseUrl}/api/products/1/images/5`, { headers: auth });
    assert.equal(imageGet.status, 200);
    assert.deepEqual(await imageGet.json(), { legacyImageGet: '5' });
  });
});

test('feature-on composes real create/list/update/delete with descriptors and thumbnail-only list', async () => {
  const state: ProductState = { products: [], links: new Map(), calls: [] };
  await withProductAssembly(true, state, async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json', 'X-Request-Id': 'create-product' },
      body: JSON.stringify({ itemNo: 'F-001', productName: 'Floral', imageAssetIds: ['asset-pattern', 'asset-gallery'] }),
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.deepEqual(createdBody.images.map((image: { assetId: string }) => image.assetId), ['asset-pattern', 'asset-gallery']);

    const listed = await fetch(`${baseUrl}/api/products?limit=20&offset=0`, { headers: auth });
    assert.equal(listed.status, 200);
    const listedBody = await listed.json();
    assert.equal(listedBody.length, 1);
    assert.equal(listedBody[0].images.length, 1);
    assert.equal('displayUrl' in listedBody[0].images[0], false);
    assert.equal(typeof listedBody[0].images[0].thumbnailUrl, 'string');

    const updated = await fetch(`${baseUrl}/api/products/1`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'application/json', 'X-Request-Id': 'update-product' },
      body: JSON.stringify({ itemNo: 'F-001', productName: 'Floral v2', imageAssetIds: ['asset-shared'] }),
    });
    assert.equal(updated.status, 200);
    assert.deepEqual((await updated.json()).images.map((image: { assetId: string }) => image.assetId), ['asset-pattern', 'asset-gallery', 'asset-shared']);

    const deleted = await fetch(`${baseUrl}/api/products/1`, { method: 'DELETE', headers: { ...auth, 'X-Request-Id': 'delete-product' } });
    assert.equal(deleted.status, 200);
    assert.deepEqual(state.calls, ['create:asset-pattern,asset-gallery', 'update:1:asset-shared', 'delete:1']);
  });
});

test('feature-off uses global parsing and legacy routes for products', async () => {
  const state: ProductState = { products: [], links: new Map(), calls: [] };
  await withProductAssembly(false, state, async (baseUrl, globalAuthCalls) => {
    const created = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemNo: 'legacy', productName: 'unchanged' }),
    });
    assert.equal(created.status, 200);
    assert.deepEqual(await created.json(), { legacyCreate: { itemNo: 'legacy', productName: 'unchanged' } });
    assert.equal(created.headers.get('x-request-id'), null);

    const listed = await fetch(`${baseUrl}/api/products`, { headers: auth });
    assert.equal(listed.status, 200);
    assert.deepEqual(await listed.json(), { legacyList: true });

    // Non-product /api routes still pass through global auth in both modes.
    const orders = await fetch(`${baseUrl}/api/orders`, { headers: auth });
    assert.equal(orders.status, 200);
    assert.ok(globalAuthCalls() > 0);
  });
});
