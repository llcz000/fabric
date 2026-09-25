import { createHash } from 'node:crypto';
import path from 'node:path';

import type { ImportImageReference, ImportSourceRow, WpsProductWorkbook } from './wpsWorkbook';
export type { WpsProductWorkbook } from './wpsWorkbook';

export interface PlannedIssue {
  code: string;
  fieldName: string;
  message: string;
  sourceRef: string;
  severity: 'info' | 'warning' | 'error';
}
export interface PlannedImage extends Required<ImportImageReference> {
  role: 'pattern_original' | 'unclassified';
  sortOrder: number;
}
export interface PlannedProduct {
  planKey: string;
  fields: { itemNo: string; productName: string; composition: string; weight: string; width: string };
  patternTagIds: [];
  sources: Array<ImportSourceRow & { fingerprint: string }>;
  images: PlannedImage[];
  issues: PlannedIssue[];
}
export interface ImportPlan {
  sourceFile: string;
  fileSha256: string;
  sheet: string;
  products: PlannedProduct[];
}

export function normalizeImportPlan(workbook: WpsProductWorkbook): ImportPlan {
  const grouped = new Map<string, ImportSourceRow[]>();
  for (const row of workbook.rows) {
    const key = exactKey(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const products = [...grouped].map(([key, rows]) => buildProduct(workbook, key, rows));
  const byItem = new Map<string, PlannedProduct[]>();
  for (const product of products) {
    if (!product.fields.itemNo) continue;
    byItem.set(product.fields.itemNo, [...(byItem.get(product.fields.itemNo) ?? []), product]);
  }
  for (const conflicts of byItem.values()) {
    if (conflicts.length < 2) continue;
    for (const product of conflicts) {
      product.issues.push(issue('DUPLICATE_ITEM_NO', 'itemNo', '货号重复', product.sources[0]));
      product.issues.push(issue('CONFLICTING_PRODUCT_DATA', 'itemNo', '同一货号存在冲突的产品数据', product.sources[0]));
    }
  }
  return { sourceFile: path.basename(workbook.filePath), fileSha256: workbook.fileSha256, sheet: workbook.sheet, products };
}

export function sourceFingerprint(fileSha256: string, sheet: string, row: ImportSourceRow): string {
  return createHash('sha256').update(JSON.stringify([fileSha256, sheet, row.rowNumber, row.cells])).digest('hex');
}

function exactKey(row: ImportSourceRow): string {
  return JSON.stringify(['A', 'B', 'C', 'D', 'E'].map((column) => row.cells[column as keyof typeof row.cells].trim()));
}

function buildProduct(workbook: WpsProductWorkbook, key: string, rows: ImportSourceRow[]): PlannedProduct {
  const first = rows[0];
  const fields = {
    itemNo: first.cells.A.trim(), productName: first.cells.B.trim(), composition: first.cells.C.trim(),
    weight: first.cells.D.trim(), width: first.cells.E.trim(),
  };
  const sources = rows.map((row) => ({ ...row, fingerprint: sourceFingerprint(workbook.fileSha256, workbook.sheet, row) }));
  const issues: PlannedIssue[] = [];
  const images: PlannedImage[] = [];
  let hasPattern = false;
  for (const row of rows) {
    for (const image of row.imageRefs) {
      if (!image.mediaEntry) {
        issues.push(issue('IMAGE_REFERENCE_MISSING', 'images', '图片引用缺失', row, image.cell));
        continue;
      }
      if (images.length >= 20) {
        issues.push(issue('IMAGE_LIMIT_EXCEEDED', 'images', '源图片超过产品上限', row, image.cell));
        continue;
      }
      const isPattern = image.cell.startsWith('F') && !hasPattern;
      if (isPattern) hasPattern = true;
      const role = isPattern ? 'pattern_original' : 'unclassified';
      images.push({ ...image, mediaEntry: image.mediaEntry, role, sortOrder: images.filter((item) => item.role === role).length });
    }
    const imageCells = new Set(row.imageRefs.map((image) => image.cell));
    for (const column of ['F', 'G', 'H', 'I', 'J'] as const) {
      if (row.cells[column].trim() && !imageCells.has(`${column}${row.rowNumber}`)) {
        issues.push(issue('UNMAPPED_SOURCE_DATA', column, '存在未映射的源数据', row, `${column}${row.rowNumber}`));
      }
    }
  }
  if (!fields.productName) issues.push(issue('MISSING_PRODUCT_NAME', 'productName', '缺少产品名称', first));
  if (!fields.composition) issues.push(issue('MISSING_COMPOSITION', 'composition', '缺少成分', first));
  if (!fields.weight) issues.push(issue('MISSING_WEIGHT', 'weight', '缺少克重', first));
  if (!fields.width) issues.push(issue('MISSING_WIDTH', 'width', '缺少门幅', first));
  if (!hasPattern) issues.push(issue('MISSING_PATTERN_ORIGINAL', 'images', '缺少花型原图', first));
  const planKey = createHash('sha256').update(JSON.stringify([workbook.fileSha256, workbook.sheet, key])).digest('hex');
  return { planKey, fields, patternTagIds: [], sources, images, issues };
}

function issue(code: string, fieldName: string, message: string, row: ImportSourceRow, cell = `${row.sheet}!${fieldName}:${row.rowNumber}`): PlannedIssue {
  const sourceRef = cell.includes('!') ? cell : `${row.sheet}!${cell}`;
  return { code, fieldName, message, sourceRef, severity: code.startsWith('MISSING_') || code.includes('CONFLICT') ? 'warning' : 'info' };
}
