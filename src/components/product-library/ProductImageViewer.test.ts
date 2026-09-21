import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ProductImageViewer } from './ProductImageViewer';
import type { ProductDetail } from '../../types';

test('viewer exposes only four formal tabs and opens the clicked role', () => {
  const product = {
    id: '7', itemNo: 'G-7', productName: 'Floral', composition: '', weight: '', width: '', imageCount: 2,
    createdAt: '', updatedAt: '', patternTags: [], reviewStatus: 'needs_attention', openIssueCount: 1,
    categoryCounts: { patternOriginal: 1, fabricDisplay: 0, detail: 1, aiEffect: 0, unclassified: 0 }, issues: [],
    images: [
      { source: 'asset', assetId: 'pattern-1', role: 'pattern_original', sortOrder: 0, isPrimary: true, displayUrl: '/pattern' },
      { source: 'asset', assetId: 'detail-2', role: 'detail', sortOrder: 0, isPrimary: false, displayUrl: '/detail' },
    ],
  } as ProductDetail;
  const markup = renderToStaticMarkup(React.createElement(ProductImageViewer, { product, initialAssetId: 'detail-2' }));
  assert.match(markup, /花型原图/);
  assert.match(markup, /面料展示图/);
  assert.match(markup, /细节图/);
  assert.match(markup, /AI效果图/);
  assert.doesNotMatch(markup, /待分类[^<]*role="tab"/);
  assert.match(markup, /src="\/detail"/);
});

test('viewer renders a missing-pattern placeholder', () => {
  const product = {
    id: '8', itemNo: 'G-8', productName: '', composition: '', weight: '', width: '', imageCount: 0,
    createdAt: '', updatedAt: '', patternTags: [], reviewStatus: 'needs_attention', openIssueCount: 1,
    categoryCounts: { patternOriginal: 0, fabricDisplay: 0, detail: 0, aiEffect: 0, unclassified: 0 }, issues: [], images: [],
  } as ProductDetail;
  assert.match(renderToStaticMarkup(React.createElement(ProductImageViewer, { product })), /缺少花型原图/);
});
