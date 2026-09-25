import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeImportPlan, type WpsProductWorkbook } from './normalize';

function workbook(rows: WpsProductWorkbook['rows']): WpsProductWorkbook {
  return { filePath: 'book.xlsm', fileSha256: 'a'.repeat(64), sheet: '新', rows };
}

function row(rowNumber: number, itemNo: string, overrides: Partial<WpsProductWorkbook['rows'][number]> = {}): WpsProductWorkbook['rows'][number] {
  return {
    sheet: '新', rowNumber,
    cells: { A: itemNo, B: '花布', C: '棉', D: '120g', E: '150cm', F: '', G: '', H: '', I: '', J: '' },
    imageRefs: [], ...overrides,
  };
}

test('missing WPS media retains product and plans an image issue', () => {
  const source = row(2, 'G1', { imageRefs: [{ cell: 'F2', dispImgId: 'missing' }] });
  const plan = normalizeImportPlan(workbook([source]));
  assert.equal(plan.products.length, 1);
  assert.equal(plan.products[0].issues.some((issue) => issue.code === 'IMAGE_REFERENCE_MISSING'), true);
  assert.equal(plan.products[0].issues.some((issue) => issue.code === 'MISSING_PATTERN_ORIGINAL'), true);
});

test('exact duplicate rows merge metadata while retaining sources and images', () => {
  const plan = normalizeImportPlan(workbook([
    row(2, 'G1', { imageRefs: [{ cell: 'F2', dispImgId: 'p1', mediaEntry: 'xl/media/a.png' }] }),
    row(3, ' G1 ', { imageRefs: [{ cell: 'G3', dispImgId: 'p2', mediaEntry: 'xl/media/b.png' }] }),
  ]));
  assert.equal(plan.products.length, 1);
  assert.deepEqual(plan.products[0].sources.map((source) => source.rowNumber), [2, 3]);
  assert.equal(plan.products[0].images.length, 2);
  assert.equal(plan.products[0].images[0].role, 'pattern_original');
  assert.equal(plan.products[0].images[1].role, 'unclassified');
});

test('conflicting same-item rows remain separate and both receive conflict issues', () => {
  const plan = normalizeImportPlan(workbook([
    row(2, 'G1'),
    row(3, 'G1', { cells: { ...row(3, 'G1').cells, C: '涤纶' } }),
  ]));
  assert.equal(plan.products.length, 2);
  for (const product of plan.products) {
    assert.equal(product.issues.some((issue) => issue.code === 'DUPLICATE_ITEM_NO'), true);
    assert.equal(product.issues.some((issue) => issue.code === 'CONFLICTING_PRODUCT_DATA'), true);
  }
});

test('text-only F and extra G-J data are retained as unmapped source issues', () => {
  const source = row(2, 'G1');
  source.cells.F = '图片待补';
  source.cells.J = '旧备注';
  const product = normalizeImportPlan(workbook([source])).products[0];
  assert.equal(product.issues.some((issue) => issue.code === 'UNMAPPED_SOURCE_DATA'), true);
  assert.equal(product.sources[0].cells.J, '旧备注');
});
