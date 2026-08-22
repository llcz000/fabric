import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import {
  describeProductImages,
  createProductImageRouter,
  parseProductImageAssetIds,
  type ProductRecord,
  type ProductImageRouteRuntime,
  type ProductImageRuntime,
} from './productImages';

const RAW_COS_URL = 'https://fabric-images-1448065940.cos.ap-shanghai.myqcloud.com/products/legacy.png';

function runtime(overrides: Partial<ProductImageRuntime> = {}): ProductImageRuntime {
  return {
    enabled: true,
    service: {
      async getAccessUrls(requests) {
        return requests.map((request) => ({
          ...request,
          url: `https://signed.example/${request.assetId}/${request.variant}`,
          expiresAt: '2026-08-23T12:00:00.000Z',
        }));
      },
      async attachProductImages() {},
      async detachProductImage() {},
      async detachAllProductImages() {},
      async deleteProductWithAssets() { return false; },
    },
    async findAssociations() {
      return [];
    },
    async findLegacyImages() {
      return [];
    },
    ...overrides,
  };
}

test('product asset descriptors preserve persisted order and primary roles with signed thumbnail and display URLs', async () => {
  const images = await describeProductImages(7, 'admin', runtime({
    async findAssociations() {
      return [
        { assetId: 'asset-pattern', sortOrder: 0, role: 'pattern_original', isPrimary: true },
        { assetId: 'asset-gallery', sortOrder: 1, role: 'gallery', isPrimary: false },
      ];
    },
  }));

  assert.deepEqual(images, [
    {
      assetId: 'asset-pattern',
      sortOrder: 0,
      role: 'pattern_original',
      isPrimary: true,
      thumbnailUrl: 'https://signed.example/asset-pattern/thumbnail',
      displayUrl: 'https://signed.example/asset-pattern/display',
      expiresAt: '2026-08-23T12:00:00.000Z',
    },
    {
      assetId: 'asset-gallery',
      sortOrder: 1,
      role: 'gallery',
      isPrimary: false,
      thumbnailUrl: 'https://signed.example/asset-gallery/thumbnail',
      displayUrl: 'https://signed.example/asset-gallery/display',
      expiresAt: '2026-08-23T12:00:00.000Z',
    },
  ]);
});

test('product descriptors fall back to controlled legacy content URLs and never expose raw COS URLs', async () => {
  const images = await describeProductImages(7, 'admin', runtime({
    async findLegacyImages() {
      return [{ id: 19, sortOrder: 3, rawSource: RAW_COS_URL }];
    },
  }));

  assert.deepEqual(images, [{
    legacyImageId: 19,
    sortOrder: 3,
    role: 'legacy',
    isPrimary: true,
    contentUrl: '/api/products/7/images/19',
  }]);
  assert.equal(JSON.stringify(images).includes(RAW_COS_URL), false);
});

test('product asset input accepts a bounded ordered unique list and rejects malformed, duplicate, or excessive IDs', () => {
  assert.deepEqual(parseProductImageAssetIds(['asset-1', 'asset_2']), ['asset-1', 'asset_2']);
  assert.throws(() => parseProductImageAssetIds(['asset-1', 'asset-1']), /duplicate/i);
  assert.throws(() => parseProductImageAssetIds('asset-1'), /array/i);
  assert.throws(() => parseProductImageAssetIds(Array.from({ length: 21 }, (_, index) => `asset-${index}`)), /20/i);
  assert.throws(() => parseProductImageAssetIds(['https://attacker.example/image.png']), /invalid/i);
});

interface ProductState {
  products: ProductRecord[];
  links: Map<number, Array<{ assetId: string; sortOrder: number; role: 'pattern_original' | 'gallery'; isPrimary: boolean }>>;
  calls: string[];
  failAttach?: boolean;
}

function routeRuntime(state: ProductState): ProductImageRouteRuntime {
  const get = (id: number) => state.products.find((product) => product.id === id) ?? null;
  const base = runtime({
    async findAssociations(productId) {
      return state.links.get(productId) ?? [];
    },
    service: {
      async getAccessUrls(requests) {
        return requests.map((request) => ({ ...request, url: `https://signed.example/${request.assetId}/${request.variant}`, expiresAt: '2026-08-23T12:00:00.000Z' }));
      },
      async attachProductImages(productId, assetIds) {
        state.calls.push(`attach:${productId}:${assetIds.join(',')}`);
        if (state.failAttach) throw new Error('asset storage failure');
        const current = state.links.get(productId) ?? [];
        let nextOrder = current.length;
        for (const assetId of assetIds) {
          if (current.some((image) => image.assetId === assetId)) continue;
          current.push({ assetId, sortOrder: nextOrder++, role: current.length === 0 ? 'pattern_original' : 'gallery', isPrimary: current.length === 0 });
        }
        state.links.set(productId, current);
      },
      async detachProductImage(productId, assetId) {
        state.calls.push(`detach:${productId}:${assetId}`);
        state.links.set(productId, (state.links.get(productId) ?? []).filter((image) => image.assetId !== assetId));
      },
      async detachAllProductImages(productId) {
        state.calls.push(`detach-all:${productId}`);
        state.links.delete(productId);
      },
      async deleteProductWithAssets(productId) {
        state.calls.push(`delete:${productId}`);
        const index = state.products.findIndex((product) => product.id === productId);
        if (index < 0) return false;
        state.links.delete(productId);
        state.products.splice(index, 1);
        return true;
      },
    },
  });
  return {
    ...base,
    principalId: 'admin',
    async listProducts() { return state.products; },
    async getProduct(productId) { return get(productId); },
    async createProduct(input) {
      const id = Math.max(0, ...state.products.map((product) => Number(product.id))) + 1;
      const created = { id, item_no: input.itemNo, product_name: input.productName, composition: input.composition, weight: input.weight, width: input.width, image_count: 0 };
      state.products.push(created);
      state.calls.push(`create:${id}`);
      return created;
    },
    async updateProduct(productId, input) {
      const product = get(productId);
      if (!product) return null;
      const previous = { ...product };
      Object.assign(product, { item_no: input.itemNo, product_name: input.productName, composition: input.composition, weight: input.weight, width: input.width });
      state.calls.push(`update:${productId}`);
      return { product, previous };
    },
    async restoreProduct(previous) {
      const product = get(Number(previous.id));
      if (product) Object.assign(product, previous);
      state.calls.push(`restore:${previous.id}`);
    },
    async deleteCreatedProduct(productId) {
      const index = state.products.findIndex((product) => product.id === productId);
      if (index >= 0) state.products.splice(index, 1);
      state.calls.push(`delete-created:${productId}`);
    },
  };
}

async function withProductRouter<T>(runtimeValue: ProductImageRouteRuntime, work: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use('/api/products', createProductImageRouter(runtimeValue));
  app.use((_req, res) => res.status(404).json({ error: 'legacy route' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const { port } = server.address() as AddressInfo;
  try {
    return await work(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function productJson(method: string, body: unknown, requestId = 'product-route-test'): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId }, body: JSON.stringify(body) };
}

test('product router composes actual CRUD routes with ordered asset descriptors and shared-asset-safe deletes', async () => {
  const state: ProductState = { products: [], links: new Map(), calls: [] };
  await withProductRouter(routeRuntime(state), async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/products`, productJson('POST', {
      itemNo: 'F-001', productName: 'Floral', composition: 'Cotton', weight: '120', width: '150', imageAssetIds: ['asset-pattern', 'asset-gallery'],
    }));
    assert.equal(created.status, 201);
    assert.deepEqual((await created.json()).images.map((image: { assetId: string }) => image.assetId), ['asset-pattern', 'asset-gallery']);

    const updated = await fetch(`${baseUrl}/api/products/1`, productJson('PUT', {
      itemNo: 'F-001', productName: 'Floral', composition: 'Cotton', weight: '120', width: '150', imageAssetIds: ['asset-shared'],
    }));
    assert.equal(updated.status, 200);
    assert.deepEqual((await updated.json()).images.map((image: { assetId: string }) => image.assetId), ['asset-pattern', 'asset-gallery', 'asset-shared']);

    const detached = await fetch(`${baseUrl}/api/products/1/images/asset-pattern`, { method: 'DELETE', headers: { 'X-Request-Id': 'detach-product-image' } });
    assert.equal(detached.status, 200);
    assert.equal((await detached.json()).image_count, 2);

    const deleted = await fetch(`${baseUrl}/api/products/1`, { method: 'DELETE', headers: { 'X-Request-Id': 'delete-product' } });
    assert.equal(deleted.status, 200);
    assert.deepEqual(state.calls, [
      'create:1', 'attach:1:asset-pattern,asset-gallery', 'update:1', 'attach:1:asset-shared', 'detach:1:asset-pattern', 'delete:1',
    ]);
  });
});

test('product router rejects legacy multipart, unexpected JSON, unsafe query input, and returns one safe request ID', async () => {
  const state: ProductState = { products: [], links: new Map(), calls: [] };
  await withProductRouter(routeRuntime(state), async (baseUrl) => {
    const multipart = await fetch(`${baseUrl}/api/products`, {
      method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=test', 'X-Request-Id': 'legacy-multipart' }, body: '--test--',
    });
    assert.equal(multipart.status, 400);
    assert.deepEqual(await multipart.json(), { error: { code: 'IMAGE_CONTENT_INVALID', message: 'Create image assets before attaching product files', requestId: 'legacy-multipart', retryable: false } });

    const extra = await fetch(`${baseUrl}/api/products?url=https://attacker.example/image.png`, productJson('POST', { itemNo: 'F-002', productName: 'Bad', imageAssetIds: [], url: 'https://attacker.example/image.png' }, 'product-extra'));
    assert.equal(extra.status, 422);
    const extraBody = await extra.json();
    assert.equal(extra.headers.get('x-request-id'), 'product-extra');
    assert.equal(extraBody.error.requestId, 'product-extra');
    assert.doesNotMatch(JSON.stringify(extraBody), /attacker|zod|stack/i);
  });
});

test('product router compensates a created product when asset attachment fails', async () => {
  const state: ProductState = { products: [], links: new Map(), calls: [], failAttach: true };
  await withProductRouter(routeRuntime(state), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/products`, productJson('POST', { itemNo: 'F-003', productName: 'Rollback', imageAssetIds: ['asset-fails'] }, 'product-rollback'));
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.requestId, 'product-rollback');
    assert.equal(state.products.length, 0);
    assert.deepEqual(state.calls, ['create:1', 'attach:1:asset-fails', 'delete-created:1']);
  });
});

test('product router restores prior product fields when an append association fails', async () => {
  const state: ProductState = {
    products: [{ id: 1, item_no: 'F-004', product_name: 'Before', composition: 'Cotton', weight: '100', width: '150', image_count: 0 }],
    links: new Map(),
    calls: [],
    failAttach: true,
  };
  await withProductRouter(routeRuntime(state), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/products/1`, productJson('PUT', {
      itemNo: 'F-004', productName: 'After', composition: 'Silk', weight: '120', width: '160', imageAssetIds: ['asset-fails'],
    }, 'product-update-rollback'));
    assert.equal(response.status, 503);
  });
  assert.deepEqual(state.products[0], { id: 1, item_no: 'F-004', product_name: 'Before', composition: 'Cotton', weight: '100', width: '150', image_count: 0 });
  assert.deepEqual(state.calls, ['update:1', 'attach:1:asset-fails', 'restore:1']);
});

test('product router rejects an update that repeats an already associated asset before changing product fields', async () => {
  const state: ProductState = {
    products: [{ id: 1, item_no: 'F-005', product_name: 'Existing', composition: 'Cotton', weight: '100', width: '150', image_count: 1 }],
    links: new Map([[1, [{ assetId: 'asset-existing', sortOrder: 0, role: 'pattern_original', isPrimary: true }]]]),
    calls: [],
  };
  await withProductRouter(routeRuntime(state), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/products/1`, productJson('PUT', {
      itemNo: 'F-005', productName: 'Changed', composition: 'Silk', weight: '120', width: '160', imageAssetIds: ['asset-existing'],
    }, 'product-existing-asset'));
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'IMAGE_CONTENT_INVALID');
  });
  assert.equal(state.products[0].product_name, 'Existing');
  assert.deepEqual(state.calls, []);
});

test('feature-off product image router delegates unchanged JSON handling to the existing product API', async () => {
  const state: ProductState = { products: [], links: new Map(), calls: [] };
  const disabled = { ...routeRuntime(state), enabled: false, service: null };
  const app = express();
  app.use(express.json());
  app.use('/api/products', createProductImageRouter(disabled));
  app.post('/api/products', (req, res) => res.status(200).json({ legacy: req.body }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/products`, productJson('POST', { itemNo: 'legacy', productName: 'unchanged' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { legacy: { itemNo: 'legacy', productName: 'unchanged' } });
    assert.equal(response.headers.get('x-request-id'), null);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
