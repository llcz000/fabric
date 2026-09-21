import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import type { ProductRouteRuntime, ProductRouteService } from '../products/routes';
import { mountProductImageServerRoutes } from './productServer';

function runtime(enabled: boolean): ProductRouteRuntime {
  const service: ProductRouteService | null = enabled ? {
    async saveProduct() { throw new Error('not used'); },
    async attachProductImages() { throw new Error('not used'); },
    async replaceImageLayout() {},
    async deleteProductImage() {},
    async deleteProduct() { return false; },
    async searchPatternTags() { return []; },
    async createPatternTag() { throw new Error('not used'); },
    async updatePatternTag() { return null; },
    async applyPatternTagBatch() {},
    async listProducts(filter) { return { items: [], total: 0, limit: filter.limit, offset: filter.offset }; },
    async getProductDetail() { return null; },
    async ignoreIssue() { return false; },
    async reopenIssue() { return false; },
  } : null;
  return { enabled, principalId: 'admin', service };
}

async function withComposedServer<T>(enabled: boolean, work: (baseUrl: string, globalAuthCalls: () => number) => Promise<T>): Promise<T> {
  const app = express();
  let globalAuthCount = 0;
  const globalParser = express.json();
  app.use((req, res, next) => {
    if (enabled && (req.path === '/api/products' || req.path.startsWith('/api/products/')
      || req.path === '/api/product-pattern-tags' || req.path.startsWith('/api/product-pattern-tags/'))) return next();
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

test('production product mount authenticates product and tag routes before global auth', async () => {
  await withComposedServer(true, async (baseUrl, globalAuthCalls) => {
    for (const path of ['/api/products?limit=20', '/api/product-pattern-tags?status=active']) {
      const denied = await fetch(`${baseUrl}${path}`, { headers: { 'X-Request-Id': 'product-auth-denied' } });
      assert.equal(denied.status, 401);
      assert.equal(denied.headers.get('x-request-id'), 'product-auth-denied');
      assert.equal((await denied.json()).error.code, 'ASSET_ACCESS_DENIED');
    }
    assert.equal(globalAuthCalls(), 0);

    const allowed = await fetch(`${baseUrl}/api/products?limit=20`, {
      headers: { Authorization: 'Bearer good', 'X-Request-Id': 'product-auth-allowed' },
    });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { items: [], total: 0, limit: 20, offset: 0 });
    assert.equal(globalAuthCalls(), 0);
  });
});

test('production product mount owns feature-on parsing but leaves import under global auth', async () => {
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
