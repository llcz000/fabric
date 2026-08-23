import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { mountProductImageServerRoutes } from './productServer';
import type { ProductImageRouteRuntime } from './productImages';

function runtime(enabled: boolean): ProductImageRouteRuntime {
  return {
    enabled,
    principalId: 'admin',
    service: enabled ? {
      async getAccessUrls() { return []; },
      async attachProductImages() {},
      async createProductWithImages(input, assetIds) {
        return { id: 1, item_no: input.itemNo, product_name: input.productName, image_count: assetIds.length };
      },
      async updateProductWithImages() { return null; },
      async listProductsPage() { return []; },
      async findProductIdsByItemNos() { return []; },
      async getProductRecord() { return null; },
      async listProductImageAssociations() { return []; },
      async listLegacyProductImages() { return []; },
      async detachProductImage() {},
      async detachAllProductImages() {},
      async deleteProductWithAssets() { return false; },
    } : null,
  };
}

async function withComposedServer<T>(enabled: boolean, work: (baseUrl: string, globalAuthCalls: () => number) => Promise<T>): Promise<T> {
  const app = express();
  let globalAuthCount = 0;
  const globalParser = express.json();
  app.use((req, res, next) => {
    if (enabled && (req.path === '/api/products' || req.path.startsWith('/api/products/'))) return next();
    globalParser(req, res, next);
  });
  mountProductImageServerRoutes(app, {
    runtime: runtime(enabled),
    authenticate: (req) => req.get('Authorization') === 'Bearer good',
    globalAuth(req, res, next) {
      globalAuthCount += 1;
      if (req.get('Authorization') !== 'Bearer good') return res.status(401).json({ error: 'Unauthorized' });
      next();
    },
  });
  app.post('/api/products', (req, res) => res.json({ legacy: req.body }));
  app.post('/api/products/import', (_req, res) => res.json({ legacyImport: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const { port } = server.address() as AddressInfo;
  try {
    return await work(`http://127.0.0.1:${port}`, () => globalAuthCount);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('production product mount authenticates exact feature-on routes before global auth with one safe request ID', async () => {
  await withComposedServer(true, async (baseUrl, globalAuthCalls) => {
    const denied = await fetch(`${baseUrl}/api/products?limit=20`, { headers: { 'X-Request-Id': 'product-auth-denied' } });
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get('x-request-id'), 'product-auth-denied');
    assert.deepEqual(await denied.json(), {
      error: { code: 'ASSET_ACCESS_DENIED', message: 'Asset access is denied', requestId: 'product-auth-denied', retryable: false },
    });
    assert.equal(globalAuthCalls(), 0);

    const allowed = await fetch(`${baseUrl}/api/products?limit=20`, { headers: { Authorization: 'Bearer good', 'X-Request-Id': 'product-auth-allowed' } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('x-request-id'), 'product-auth-allowed');
    assert.equal(globalAuthCalls(), 0);
  });
});

test('production product mount owns feature-on parsing but leaves non-image product routes under global auth', async () => {
  await withComposedServer(true, async (baseUrl, globalAuthCalls) => {
    const malformed = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: { Authorization: 'Bearer good', 'Content-Type': 'application/json', 'X-Request-Id': 'product-parser' },
      body: '{"itemNo":',
    });
    assert.equal(malformed.status, 422);
    assert.equal((await malformed.json()).error.requestId, 'product-parser');

    const legacyImport = await fetch(`${baseUrl}/api/products/import`, { method: 'POST' });
    assert.equal(legacyImport.status, 401);
    assert.equal(legacyImport.headers.get('x-request-id'), null);
    assert.equal(globalAuthCalls(), 1);
  });
});

test('production product mount preserves feature-off global parsing and legacy route behavior', async () => {
  await withComposedServer(false, async (baseUrl, globalAuthCalls) => {
    const response = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: { Authorization: 'Bearer good', 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemNo: 'legacy', productName: 'unchanged' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { legacy: { itemNo: 'legacy', productName: 'unchanged' } });
    assert.equal(response.headers.get('x-request-id'), null);
    assert.equal(globalAuthCalls(), 1);
  });
});
