import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ProductFilters, reduceProductQuery, scheduleProductKeywordUpdate } from './ProductFilters';

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

test('keyword updates are debounced and cancelled stale values', async () => {
  const seen: string[] = [];
  const cancel = scheduleProductKeywordUpdate({ offset: 50 }, 'old', (value) => seen.push(value.q ?? ''), 10);
  cancel();
  scheduleProductKeywordUpdate({ offset: 50 }, 'new', (value) => seen.push(value.q ?? ''), 10);
  assert.deepEqual(seen, []);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(seen, ['new']);
});

test('filters expose issue-code selection for imported anomalies', () => {
  const markup = renderToStaticMarkup(React.createElement(ProductFilters, { value: {}, availableTags: [], onChange() {} }));
  assert.match(markup, /aria-label="异常类型"/);
  assert.match(markup, /缺少产品名称/);
  assert.match(markup, /图片引用缺失/);
});
