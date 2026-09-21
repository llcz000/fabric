import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyPatternTagBatch,
  getProduct,
  ignoreProductIssue,
  listPatternTags,
  listProducts,
  patchImageLayout,
  reopenProductIssue,
  saveProduct,
} from './products';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const serverProduct = {
  id: 7,
  itemNo: 'G-007',
  productName: 'Floral',
  composition: 'Cotton',
  weight: '120gsm',
  width: '150cm',
  imageCount: 3,
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z',
  categoryCounts: { patternOriginal: 1, fabricDisplay: 0, detail: 1, aiEffect: 1, unclassified: 0 },
  patternTags: [{ id: 2, name: '碎花', status: 'active' }, { id: 5, name: '春夏', status: 'active' }],
  reviewStatus: 'needs_attention',
  openIssueCount: 1,
  images: [
    { assetId: 'a', role: 'pattern_original', sortOrder: 0, isPrimary: true, thumbnailUrl: '/a-thumb' },
    { assetId: 'b', role: 'mystery', sortOrder: 0, isPrimary: false, thumbnailUrl: '/b-thumb' },
    { assetId: 'c', role: 'ai_effect', sortOrder: 0, isPrimary: false, thumbnailUrl: '/c-thumb' },
  ],
  issues: [{
    id: 9, productId: 7, code: 'IMAGE_UNCLASSIFIED', severity: 'warning', fieldName: 'images',
    message: '待分类', sourceRef: 'asset:b', status: 'open',
    createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
  }],
};

test('maps four roles tags issues and page metadata with unknown roles unclassified', async () => {
  const urls: string[] = [];
  const apiFetch: typeof fetch = async (input) => {
    urls.push(String(input));
    return jsonResponse({ items: [serverProduct], total: 1, limit: 50, offset: 0 });
  };

  const page = await listProducts(apiFetch, { q: 'floral', tagIds: [2, 5], limit: 50, offset: 0 });

  assert.equal(urls[0], '/api/products?q=floral&tagIds=2%2C5&tagMode=all&limit=50&offset=0');
  assert.equal(page.total, 1);
  assert.equal(page.items[0].images?.[1].role, 'unclassified');
  assert.equal(page.items[0].images?.[2].role, 'ai_effect');
  assert.deepEqual(page.items[0].patternTags.map(({ id, name }) => ({ id, name })), [{ id: 2, name: '碎花' }, { id: 5, name: '春夏' }]);
  assert.equal(page.items[0].reviewStatus, 'needs_attention');
});

test('detail maps structured issues and save sends tags plus the complete categorized layout', async () => {
  const requests: Array<{ url: string; method: string; body?: unknown }> = [];
  const apiFetch: typeof fetch = async (input, init: RequestInit = {}) => {
    requests.push({
      url: String(input), method: init.method ?? 'GET',
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return jsonResponse(serverProduct);
  };

  const detail = await getProduct(apiFetch, '7');
  assert.equal(detail.issues?.[0].code, 'IMAGE_UNCLASSIFIED');
  await saveProduct(apiFetch, {
    id: '7', itemNo: 'G-007', productName: 'Floral', composition: 'Cotton', weight: '120gsm', width: '150cm',
    patternTagIds: [2, 5],
    images: [{ assetId: 'a', role: 'pattern_original', sortOrder: 0 }],
  });
  assert.deepEqual(requests[1], {
    url: '/api/products/7', method: 'PUT', body: {
      itemNo: 'G-007', productName: 'Floral', composition: 'Cotton', weight: '120gsm', width: '150cm',
      patternTagIds: [2, 5], images: [{ assetId: 'a', role: 'pattern_original', sortOrder: 0 }],
    },
  });
});

test('layout issue batch-tag and tag-search clients use dedicated endpoints', async () => {
  const requests: Array<{ url: string; method: string; body?: unknown }> = [];
  const apiFetch: typeof fetch = async (input, init: RequestInit = {}) => {
    requests.push({ url: String(input), method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (String(input).startsWith('/api/product-pattern-tags')) return jsonResponse({ items: [] });
    return jsonResponse(String(input).includes('image-layout') ? serverProduct : { success: true });
  };

  await patchImageLayout(apiFetch, '7', [{ assetId: 'a', role: 'detail', sortOrder: 0 }]);
  await ignoreProductIssue(apiFetch, '7', 9, '已确认');
  await reopenProductIssue(apiFetch, '7', 9);
  await applyPatternTagBatch(apiFetch, { productIds: [7, 8], operation: 'add', tagIds: [2] });
  await listPatternTags(apiFetch, { q: '碎花', status: 'active' });

  assert.deepEqual(requests.map(({ url, method }) => ({ url, method })), [
    { url: '/api/products/7/image-layout', method: 'PATCH' },
    { url: '/api/products/7/issues/9/ignore', method: 'POST' },
    { url: '/api/products/7/issues/9/reopen', method: 'POST' },
    { url: '/api/products/batch-pattern-tags', method: 'POST' },
    { url: '/api/product-pattern-tags?q=%E7%A2%8E%E8%8A%B1&status=active', method: 'GET' },
  ]);
});
