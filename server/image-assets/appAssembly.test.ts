import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { exceptImageAssetApi, mountProductRouteAssembly } from '../appAssembly';
import type { ProductRouteRuntime, ProductRouteService } from '../products/routes';
import type { ProductWriteInput } from '../products/types';

interface ProductState {
  products: Map<number, ProductWriteInput>;
  calls: string[];
}

function runtime(enabled: boolean, state: ProductState): ProductRouteRuntime {
  const service: ProductRouteService | null = enabled ? {
    async saveProduct(productId, input) {
      const id = productId ?? Math.max(0, ...state.products.keys()) + 1;
      state.products.set(id, input);
      state.calls.push(`${productId === null ? 'create' : 'update'}:${id}`);
      return {
        id, itemNo: input.itemNo, productName: input.productName, composition: input.composition,
        weight: input.weight, width: input.width, imageCount: input.images.length,
        createdAt: new Date('2026-09-21T00:00:00Z'), updatedAt: new Date('2026-09-21T00:00:00Z'),
      };
    },
    async attachProductImages() { throw new Error('not used'); },
    async replaceImageLayout() {},
    async deleteProductImage() {},
    async deleteProduct(id) { state.calls.push(`delete:${id}`); return state.products.delete(id); },
    async searchPatternTags() { return []; },
    async createPatternTag() { throw new Error('not used'); },
    async updatePatternTag() { return null; },
    async applyPatternTagBatch() {},
    async listProducts(filter) { return { items: [], total: state.products.size, limit: filter.limit, offset: filter.offset }; },
    async getProductDetail() { return null; },
    async ignoreIssue() { return false; },
    async reopenIssue() { return false; },
  } : null;
  return { enabled, principalId: 'admin', service };
}

async function withAssembly<T>(enabled: boolean, state: ProductState, work: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(exceptImageAssetApi(express.json(), enabled));
  mountProductRouteAssembly(app, {
    productRuntime: runtime(enabled, state),
    authenticateProduct: (req) => req.get('Authorization') === 'Bearer good',
    globalAuth(req, res, next) {
      if (req.get('Authorization') !== 'Bearer good') return res.status(401).json({ error: 'Unauthorized' });
      next();
    },
  });
  app.get('/api/products', (_req, res) => res.json({ legacyList: true }));
  app.post('/api/products', (req, res) => res.json({ legacyCreate: req.body }));
  app.post('/api/products/import', (_req, res) => res.json({ legacyImport: true }));
  app.post('/api/products/export', (_req, res) => res.json({ legacyExport: true }));
  app.get('/api/products/:productId/images/:imageId', (req, res) => res.json({ legacyImageGet: req.params.imageId }));
  app.delete('/api/products/:productId/images/:imageId', (req, res) => res.json({ legacyImageDelete: req.params.imageId }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const { port } = server.address() as AddressInfo;
  try {
    return await work(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const auth = { Authorization: 'Bearer good' };

test('feature-on routes reject unauthenticated malformed identifiers before handlers', async () => {
  await withAssembly(true, { products: new Map(), calls: [] }, async (baseUrl) => {
    for (const [method, path] of [
      ['GET', '/api/products/abc'],
      ['PATCH', '/api/products/abc/image-layout'],
      ['POST', '/api/products/abc/issues/nope/ignore'],
      ['PATCH', '/api/product-pattern-tags/nope'],
    ] as Array<[string, string]>) {
      const response = await fetch(`${baseUrl}${path}`, { method, headers: { 'X-Request-Id': 'auth-first' } });
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.equal((await response.json()).error.requestId, 'auth-first');
    }
  });
});

test('feature-on serves new product envelopes and tag endpoint', async () => {
  await withAssembly(true, { products: new Map(), calls: [] }, async (baseUrl) => {
    const listed = await fetch(`${baseUrl}/api/products?limit=20&offset=0`, { headers: auth });
    assert.equal(listed.status, 200);
    assert.deepEqual(await listed.json(), { items: [], total: 0, limit: 20, offset: 0 });

    const tags = await fetch(`${baseUrl}/api/product-pattern-tags?status=active`, { headers: auth });
    assert.equal(tags.status, 200);
    assert.deepEqual(await tags.json(), { items: [] });
  });
});

test('feature-on leaves legacy import export and numeric image routes untouched', async () => {
  await withAssembly(true, { products: new Map(), calls: [] }, async (baseUrl) => {
    assert.deepEqual(await (await fetch(`${baseUrl}/api/products/import`, { method: 'POST', headers: auth })).json(), { legacyImport: true });
    assert.deepEqual(await (await fetch(`${baseUrl}/api/products/export`, { method: 'POST', headers: auth })).json(), { legacyExport: true });
    assert.deepEqual(await (await fetch(`${baseUrl}/api/products/1/images/5`, { headers: auth })).json(), { legacyImageGet: '5' });
    assert.deepEqual(await (await fetch(`${baseUrl}/api/products/1/images/5`, { method: 'DELETE', headers: auth })).json(), { legacyImageDelete: '5' });
  });
});

test('feature-off preserves legacy product parsing and routes', async () => {
  await withAssembly(false, { products: new Map(), calls: [] }, async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/products`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemNo: 'legacy', productName: 'unchanged' }),
    });
    assert.equal(created.status, 200);
    assert.deepEqual(await created.json(), { legacyCreate: { itemNo: 'legacy', productName: 'unchanged' } });
    assert.equal(created.headers.get('x-request-id'), null);
  });
});
