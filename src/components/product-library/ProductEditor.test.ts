import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { canAddPatternTag, canAddProductImage, canAssignProductImageRole, moveProductImage, ProductEditor, reduceEditorState, type ProductEditorState } from './ProductEditor';
import { ImageAssetClientError } from '../../lib/imageAssets';

test('editor blocks the thirteenth tag and twenty-first image', () => {
  assert.equal(canAddPatternTag(Array.from({ length: 12 }, (_, index) => index + 1)), false);
  assert.equal(canAddProductImage(Array.from({ length: 20 }, (_, index) => ({ assetId: `a${index}`, role: 'detail' as const, sortOrder: index }))), false);
});

test('editor blocks a second pattern original while allowing replacement of the current one', () => {
  const images = [{ assetId: 'pattern', role: 'pattern_original' as const, sortOrder: 0 }];
  assert.equal(canAssignProductImageRole(images, 'new', 'pattern_original'), false);
  assert.equal(canAssignProductImageRole(images, 'pattern', 'pattern_original'), true);
});

test('moving an image across categories resequences both roles contiguously', () => {
  const moved = moveProductImage([
    { assetId: 'd1', role: 'detail', sortOrder: 0 },
    { assetId: 'd2', role: 'detail', sortOrder: 1 },
    { assetId: 'a1', role: 'ai_effect', sortOrder: 0 },
  ], 'd1', 'ai_effect', 1);
  assert.deepEqual(moved, [
    { assetId: 'd2', role: 'detail', sortOrder: 0 },
    { assetId: 'a1', role: 'ai_effect', sortOrder: 0 },
    { assetId: 'd1', role: 'ai_effect', sortOrder: 1 },
  ]);
});

test('failed save keeps editor open with uploaded assets in the draft', () => {
  const state = {
    open: true,
    saving: true,
    draft: {
      fields: { itemNo: 'G-1', productName: '', composition: '', weight: '', width: '' },
      patternTagIds: [],
      images: [{ assetId: 'new-asset', role: 'detail', sortOrder: 0 }],
    },
  } as ProductEditorState;
  const error = new ImageAssetClientError({ code: 'PRODUCT_FAILED', message: '失败', requestId: 'req-1', retryable: true });
  const next = reduceEditorState(state, { type: 'save-failed', error });
  assert.equal(next.open, true);
  assert.equal(next.saving, false);
  assert.equal(next.draft.images.some((image) => image.assetId === 'new-asset'), true);
  assert.match(next.error ?? '', /req-1/);
});

test('editor exposes imported issues for manual ignore or reopen review', () => {
  const state: ProductEditorState = { open: true, saving: false, draft: { fields: { itemNo: 'G-1', productName: '', composition: '', weight: '', width: '' }, patternTagIds: [], images: [] } };
  const markup = renderToStaticMarkup(React.createElement(ProductEditor, {
    state, availableTags: [], onChange() {}, onSave() {}, onClose() {},
    issues: [
      { id: 1, productId: 7, code: 'INVALID_WEIGHT', severity: 'warning', fieldName: 'weight', message: '克重格式异常', sourceRef: '新!H2', status: 'open', createdAt: '', updatedAt: '' },
      { id: 2, productId: 7, code: 'MISSING_IMAGE', severity: 'warning', fieldName: 'images', message: '缺少图片', sourceRef: '新!A2', status: 'ignored', createdAt: '', updatedAt: '' },
    ],
    onIgnoreIssue() {}, onReopenIssue() {},
  }));
  assert.match(markup, /克重格式异常/);
  assert.match(markup, /新!H2/);
  assert.match(markup, />忽略</);
  assert.match(markup, />重新打开</);
});
