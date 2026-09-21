import assert from 'node:assert/strict';
import test from 'node:test';

import { canAddPatternTag, canAddProductImage, moveProductImage, reduceEditorState, type ProductEditorState } from './ProductEditor';
import { ImageAssetClientError } from '../../lib/imageAssets';

test('editor blocks the thirteenth tag and twenty-first image', () => {
  assert.equal(canAddPatternTag(Array.from({ length: 12 }, (_, index) => index + 1)), false);
  assert.equal(canAddProductImage(Array.from({ length: 20 }, (_, index) => ({ assetId: `a${index}`, role: 'detail' as const, sortOrder: index }))), false);
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
