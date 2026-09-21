import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { applySelectedProductTags, ProductTable } from './ProductTable';
import type { ProductLibraryItem } from '../../types';

test('table leads with pattern thumbnail, caps visible tags, and uses server total for paging', () => {
  const product = {
    id: '7', itemNo: 'G-7', productName: 'Floral', composition: '', weight: '', width: '', imageCount: 2,
    createdAt: '', updatedAt: '', reviewStatus: 'needs_attention', openIssueCount: 2,
    categoryCounts: { patternOriginal: 1, fabricDisplay: 0, detail: 1, aiEffect: 0, unclassified: 0 },
    patternTags: [1, 2, 3, 4].map((id) => ({ id, name: `标签${id}`, status: 'active' as const })),
    images: [
      { source: 'asset', assetId: 'detail', role: 'detail', sortOrder: 0, isPrimary: false, thumbnailUrl: '/detail' },
      { source: 'asset', assetId: 'pattern', role: 'pattern_original', sortOrder: 0, isPrimary: true, thumbnailUrl: '/pattern' },
    ],
  } as ProductLibraryItem;
  const markup = renderToStaticMarkup(React.createElement(ProductTable, {
    items: [product], total: 51, limit: 50, offset: 0, selectedIds: new Set<string>(), onSelectionChange() {}, onOpen() {}, onEdit() {}, onDelete() {}, onPageChange() {},
  }));
  assert.match(markup, /src="\/pattern"/);
  assert.doesNotMatch(markup, /src="\/detail"/);
  assert.match(markup, /\+1/);
  assert.match(markup, /下一页/);
  assert.match(markup, />删除</);
});

test('batch tag removal sends only the selected tag difference', async () => {
  let request: { url: string; body: unknown } | undefined;
  const apiFetch: typeof fetch = async (input, init: RequestInit = {}) => {
    request = { url: String(input), body: JSON.parse(String(init.body)) };
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  await applySelectedProductTags(apiFetch, ['7', '8'], 'remove', [3]);
  assert.deepEqual(request, {
    url: '/api/products/batch-pattern-tags',
    body: { productIds: [7, 8], operation: 'remove', tagIds: [3] },
  });
});
