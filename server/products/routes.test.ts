import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import {
  createPatternTagRouter,
  createProductRouter,
  ProductError,
  type ProductAssetAccessService,
  type ProductRouteService,
} from './routes';
import type { ProductDetail, ProductPage } from './types';
import { ImageAssetError } from '../image-assets/errors';

const emptyPage: ProductPage = { items: [], total: 0, limit: 50, offset: 0 };

function service(overrides: Partial<ProductRouteService> = {}): ProductRouteService {
  return {
    async saveProduct() { throw new Error('not used'); },
    async attachProductImages() { throw new Error('not used'); },
    async replaceImageLayout() {},
    async deleteProductImage() {},
    async deleteProduct() { return false; },
    async searchPatternTags() { return []; },
    async createPatternTag() { throw new Error('not used'); },
    async updatePatternTag() { return null; },
    async applyPatternTagBatch() {},
    async listProducts() { return emptyPage; },
    async getProductDetail() { return null; },
    async ignoreIssue() { return false; },
    async reopenIssue() { return false; },
    ...overrides,
  };
}

async function withServer<T>(
  productService: ProductRouteService,
  work: (baseUrl: string) => Promise<T>,
  assetAccess?: ProductAssetAccessService,
): Promise<T> {
  const app = express();
  const runtime = { enabled: true, service: productService, assetAccess, principalId: 'admin-1' };
  app.use('/api/products', createProductRouter(runtime));
  app.use('/api/product-pattern-tags', createPatternTagRouter(runtime));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const { port } = server.address() as AddressInfo;
  try {
    return await work(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('list parses combined filters and returns a page envelope', async () => {
  let received: unknown;
  const expected: ProductPage = { items: [], total: 2, limit: 50, offset: 0 };
  await withServer(service({
    async listProducts(filter) {
      received = filter;
      return expected;
    },
  }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/products?q=floral&tagIds=2,5&tagMode=all&reviewStatus=needs_attention&issueCodes=MISSING_WIDTH,IMAGE_UNCLASSIFIED&imageState=has_unclassified&batchId=9&duplicateItemNo=true&limit=50&offset=0`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
  });

  assert.deepEqual(received, {
    q: 'floral',
    tagIds: [2, 5],
    tagMode: 'all',
    reviewStatus: 'needs_attention',
    issueCodes: ['MISSING_WIDTH', 'IMAGE_UNCLASSIFIED'],
    imageState: 'has_unclassified',
    batchId: 9,
    duplicateItemNo: true,
    limit: 50,
    offset: 0,
  });
});

test('list signs primary thumbnails in one batch and returns image descriptors', async () => {
  const requests: unknown[] = [];
  const page: ProductPage = {
    items: [{
      id: 7, itemNo: 'G-007', productName: 'Floral', composition: '', weight: '', width: '', imageCount: 1,
      createdAt: new Date('2026-09-21T00:00:00.000Z'), updatedAt: new Date('2026-09-21T00:00:00.000Z'),
      categoryCounts: { patternOriginal: 1, fabricDisplay: 0, detail: 0, aiEffect: 0, unclassified: 0 },
      primaryAssetId: 'pattern-7', patternTags: [], reviewStatus: 'reviewed', openIssueCount: 0,
    }],
    total: 1, limit: 50, offset: 0,
  };
  const access: ProductAssetAccessService = {
    async getAccessUrls(input) {
      requests.push(input);
      return input.map((request) => ({
        ...request,
        url: `https://signed.example/${request.assetId}/${request.variant}`,
        expiresAt: '2026-09-21T01:00:00.000Z',
      }));
    },
  };

  await withServer(service({ async listProducts() { return page; } }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/products`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.items[0].images, [{
      assetId: 'pattern-7', role: 'pattern_original', sortOrder: 0, isPrimary: true,
      thumbnailUrl: 'https://signed.example/pattern-7/thumbnail',
      expiresAt: '2026-09-21T01:00:00.000Z',
    }]);
  }, access);

  assert.deepEqual(requests, [[{ assetId: 'pattern-7', variant: 'thumbnail' }]]);
});

test('detail signs thumbnail and display variants for every categorized image', async () => {
  const detail: ProductDetail = {
    id: 7, itemNo: 'G-007', productName: 'Floral', composition: '', weight: '', width: '', imageCount: 2,
    createdAt: new Date('2026-09-21T00:00:00.000Z'), updatedAt: new Date('2026-09-21T00:00:00.000Z'),
    categoryCounts: { patternOriginal: 1, fabricDisplay: 0, detail: 1, aiEffect: 0, unclassified: 0 },
    primaryAssetId: 'pattern-7', patternTags: [], reviewStatus: 'reviewed', openIssueCount: 0,
    images: [
      { assetId: 'pattern-7', role: 'pattern_original', sortOrder: 0, isPrimary: true, originType: 'upload' },
      { assetId: 'detail-7', role: 'detail', sortOrder: 0, isPrimary: false, originType: 'upload' },
    ],
    issues: [],
  };
  const access: ProductAssetAccessService = {
    async getAccessUrls(input) {
      return input.map((request) => ({
        ...request,
        url: `https://signed.example/${request.assetId}/${request.variant}`,
        expiresAt: '2026-09-21T01:00:00.000Z',
      }));
    },
  };

  await withServer(service({ async getProductDetail() { return detail; } }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/products/7`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.images[0].displayUrl, 'https://signed.example/pattern-7/display');
    assert.equal(body.images[1].thumbnailUrl, 'https://signed.example/detail-7/thumbnail');
    assert.equal(body.images[1].role, 'detail');
  }, access);
});

test('list rejects unknown query fields with a stable safe error', async () => {
  await withServer(service(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/products?limti=50`, {
      headers: { 'X-Request-Id': 'bad-query' },
    });
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), {
      error: {
        code: 'PRODUCT_INVALID',
        message: 'Product request is invalid',
        requestId: 'bad-query',
        retryable: false,
      },
    });
  });
});

test('unexpected service failures return a retryable safe server error', async () => {
  await withServer(service({
    async listProducts() { throw new Error('mysql password and host details'); },
  }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/products`, { headers: { 'X-Request-Id': 'db-failure' } });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: {
        code: 'PRODUCT_FAILED',
        message: 'Product request failed',
        requestId: 'db-failure',
        retryable: true,
      },
    });
  });
});

test('asset readiness errors keep their stable code for editor retry handling', async () => {
  await withServer(service({
    async attachProductImages() { throw new ImageAssetError('ASSET_NOT_READY', 409, true, 'Asset is not ready'); },
  }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/products/7/images`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'asset-processing' },
      body: JSON.stringify({ role: 'detail', assetIds: ['processing-asset'] }),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: { code: 'ASSET_NOT_READY', message: 'Asset is not ready', requestId: 'asset-processing', retryable: true },
    });
  });
});

test('empty-body mutations reject undeclared non-JSON request bodies', async () => {
  await withServer(service({ async deleteProduct() { return true; } }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/products/7`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'text/plain', 'X-Request-Id': 'unexpected-body' },
      body: 'undeclared',
    });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'PRODUCT_INVALID');
  });
});

test('layout rejects a stale asset set without partial mutation', async () => {
  await withServer(service({
    async replaceImageLayout() {
      throw new ProductError('PRODUCT_LAYOUT_STALE', 409, false, 'Product image layout is stale');
    },
  }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/products/7/image-layout`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'stale-layout' },
      body: JSON.stringify({ images: [{ assetId: 'missing', role: 'detail', sortOrder: 0 }] }),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: {
        code: 'PRODUCT_LAYOUT_STALE',
        message: 'Product image layout is stale',
        requestId: 'stale-layout',
        retryable: false,
      },
    });
  });
});

test('tag routes create, search, and archive through strict contracts', async () => {
  const calls: string[] = [];
  await withServer(service({
    async searchPatternTags(query, status) {
      calls.push(`search:${query}:${status}`);
      return [];
    },
    async createPatternTag(name, principalId) {
      calls.push(`create:${name}:${principalId}`);
      return {
        id: 3, name, normalizedName: name.toLowerCase(), status: 'active', createdBy: principalId,
        createdAt: new Date('2026-09-21T00:00:00.000Z'), updatedAt: new Date('2026-09-21T00:00:00.000Z'),
      };
    },
    async updatePatternTag(tagId, update, principalId) {
      calls.push(`update:${tagId}:${update.status}:${principalId}`);
      return {
        id: tagId, name: '碎花', normalizedName: '碎花', status: update.status ?? 'active', createdBy: principalId,
        createdAt: new Date('2026-09-21T00:00:00.000Z'), updatedAt: new Date('2026-09-21T00:00:00.000Z'),
      };
    },
  }), async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/product-pattern-tags?q=%E7%A2%8E%E8%8A%B1&status=active`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/product-pattern-tags`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '碎花' }),
    })).status, 201);
    assert.equal((await fetch(`${baseUrl}/api/product-pattern-tags/3`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'archived' }),
    })).status, 200);
  });
  assert.deepEqual(calls, ['search:碎花:active', 'create:碎花:admin-1', 'update:3:archived:admin-1']);
});
