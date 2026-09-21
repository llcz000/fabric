import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePatternTagName, validateImageLayout } from './validation';

test('layout accepts the five roles and derives only pattern original as primary', () => {
  const layout = validateImageLayout([
    { assetId: 'pattern', role: 'pattern_original', sortOrder: 0 },
    { assetId: 'display', role: 'fabric_display', sortOrder: 0 },
    { assetId: 'detail', role: 'detail', sortOrder: 0 },
    { assetId: 'effect', role: 'ai_effect', sortOrder: 0 },
    { assetId: 'unknown', role: 'unclassified', sortOrder: 0 },
  ]);

  assert.deepEqual(layout.map((item) => item.isPrimary), [true, false, false, false, false]);
});
test('layout rejects a second pattern original', () => {
  assert.throws(() => validateImageLayout([
    { assetId: 'pattern-a', role: 'pattern_original', sortOrder: 0 },
    { assetId: 'pattern-b', role: 'pattern_original', sortOrder: 1 },
  ]), /one pattern_original/);
});

test('layout rejects duplicate assets and a twenty-first association', () => {
  assert.throws(() => validateImageLayout([
    { assetId: 'same', role: 'detail', sortOrder: 0 },
    { assetId: 'same', role: 'ai_effect', sortOrder: 0 },
  ]), /duplicate assetId/);

  assert.throws(() => validateImageLayout(Array.from({ length: 21 }, (_, index) => ({
    assetId: `asset-${index}`,
    role: 'detail' as const,
    sortOrder: index,
  }))), /at most 20/);
});

test('layout requires contiguous zero-based order inside every role', () => {
  assert.throws(() => validateImageLayout([
    { assetId: 'detail-a', role: 'detail', sortOrder: 0 },
    { assetId: 'detail-b', role: 'detail', sortOrder: 2 },
  ]), /contiguous/);
});

test('tag normalization collapses full-width case variants and outer whitespace', () => {
  assert.equal(normalizePatternTagName('  Ｆｌｏｒａｌ  '), 'floral');
});
