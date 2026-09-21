import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcileProductIssues } from './issues';

const incomplete = {
  productName: 'Floral',
  composition: '',
  weight: '120',
  width: '150',
  images: [{ role: 'detail' as const }],
};

test('missing fields and image facts reconcile idempotently', () => {
  const first = reconcileProductIssues(incomplete, []);
  const second = reconcileProductIssues(incomplete, first);

  assert.deepEqual(second, first);
  assert.deepEqual(first.map((issue) => issue.code).sort(), [
    'MISSING_COMPOSITION',
    'MISSING_PATTERN_ORIGINAL',
  ]);
});

test('resolved factual issue reopens when fact recurs but ignored issue stays ignored', () => {
  const existing = reconcileProductIssues(incomplete, []).map((issue) => ({
    ...issue,
    status: issue.code === 'MISSING_COMPOSITION' ? 'ignored' as const : 'resolved' as const,
  }));

  const reconciled = reconcileProductIssues(incomplete, existing);

  assert.equal(reconciled.find((issue) => issue.code === 'MISSING_COMPOSITION')?.status, 'ignored');
  assert.equal(reconciled.find((issue) => issue.code === 'MISSING_PATTERN_ORIGINAL')?.status, 'open');
});

test('fixed facts resolve open issues and preserve unmanaged import issues', () => {
  const existing = [
    ...reconcileProductIssues(incomplete, []),
    {
      code: 'IMAGE_REFERENCE_MISSING' as const,
      severity: 'error' as const,
      fieldName: 'image',
      message: 'missing',
      sourceRef: '新!F104',
      status: 'open' as const,
    },
  ];

  const reconciled = reconcileProductIssues({
    productName: 'Floral', composition: 'Cotton', weight: '120', width: '150',
    images: [{ role: 'pattern_original' }],
  }, existing);

  assert.equal(reconciled.find((issue) => issue.code === 'MISSING_COMPOSITION')?.status, 'resolved');
  assert.equal(reconciled.find((issue) => issue.code === 'MISSING_PATTERN_ORIGINAL')?.status, 'resolved');
  assert.equal(reconciled.find((issue) => issue.code === 'IMAGE_REFERENCE_MISSING')?.status, 'open');
});
