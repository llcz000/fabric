import assert from 'node:assert/strict';
import test from 'node:test';

import { reduceProductQuery } from './ProductFilters';

test('selected tags use all-match semantics and reset to page zero', () => {
  const next = reduceProductQuery({ tagIds: [], limit: 50, offset: 100 }, { type: 'set-tags', tagIds: [2, 5] });
  assert.deepEqual(next.tagIds, [2, 5]);
  assert.equal(next.offset, 0);
});

test('every filter change resets offset while paging preserves filters', () => {
  const current = { q: 'floral', tagIds: [2], limit: 50, offset: 50 };
  assert.equal(reduceProductQuery(current, { type: 'set-review', reviewStatus: 'needs_attention' }).offset, 0);
  assert.deepEqual(reduceProductQuery(current, { type: 'set-offset', offset: 100 }), { ...current, offset: 100 });
});
