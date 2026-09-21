import assert from 'node:assert/strict';
import test from 'node:test';

import { mapLegacyProductImages, planLegacyRoles } from './legacyCompatibility';

test('legacy first image becomes pattern original and remaining images become unclassified', () => {
  assert.deepEqual(planLegacyRoles([{ id: 9, sortOrder: 2 }, { id: 4, sortOrder: 0 }]), [
    { legacyImageId: 4, role: 'pattern_original', sortOrder: 0, isPrimary: true },
    { legacyImageId: 9, role: 'unclassified', sortOrder: 0, isPrimary: false },
  ]);
});

test('existing pattern original remains primary and old gallery or swatch roles become unclassified', () => {
  assert.deepEqual(planLegacyRoles([
    { id: 1, sortOrder: 9, role: 'gallery' },
    { id: 2, sortOrder: 5, role: 'pattern_original', isPrimary: true },
    { id: 3, sortOrder: 0, role: 'swatch' },
  ]), [
    { legacyImageId: 2, role: 'pattern_original', sortOrder: 0, isPrimary: true },
    { legacyImageId: 3, role: 'unclassified', sortOrder: 0, isPrimary: false },
    { legacyImageId: 1, role: 'unclassified', sortOrder: 1, isPrimary: false },
  ]);
});

test('feature-off legacy rows expose the same role contract without raw paths', () => {
  const mapped = mapLegacyProductImages(7, [
    { id: 9, sortOrder: 2, localPath: 'D:/secret/9.png' },
    { id: 4, sortOrder: 0, cosKey: 'secret/4.png' },
  ]);
  assert.deepEqual(mapped, [
    { source: 'legacy', legacyImageId: 4, role: 'pattern_original', sortOrder: 0, isPrimary: true, contentUrl: '/api/products/7/images/4' },
    { source: 'legacy', legacyImageId: 9, role: 'unclassified', sortOrder: 0, isPrimary: false, contentUrl: '/api/products/7/images/9' },
  ]);
  assert.doesNotMatch(JSON.stringify(mapped), /secret|localPath|cosKey/);
});
