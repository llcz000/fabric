import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ImportPlan } from './normalize';

export interface DryRunReportPaths { jsonPath: string; csvPath: string; }

export async function writeDryRunReport(plan: ImportPlan, outputDir: string): Promise<DryRunReportPaths> {
  const resolvedDir = path.resolve(outputDir);
  await mkdir(resolvedDir, { recursive: true });
  const base = `product-import-${plan.fileSha256.slice(0, 12)}-${safeName(plan.sheet)}`;
  const jsonPath = path.join(resolvedDir, `${base}.json`);
  const csvPath = path.join(resolvedDir, `${base}.csv`);
  const issueCounts = new Map<string, number>();
  for (const product of plan.products) for (const issue of product.issues) issueCounts.set(issue.code, (issueCounts.get(issue.code) ?? 0) + 1);
  const report = {
    sourceFile: plan.sourceFile,
    fileSha256: plan.fileSha256,
    sheet: plan.sheet,
    counts: {
      sourceRows: plan.products.reduce((sum, product) => sum + product.sources.length, 0),
      products: plan.products.length,
      images: plan.products.reduce((sum, product) => sum + product.images.length, 0),
      issues: [...issueCounts.values()].reduce((sum, count) => sum + count, 0),
      issueCodes: Object.fromEntries([...issueCounts].sort(([left], [right]) => left.localeCompare(right))),
    },
    products: plan.products.map((product) => ({
      planKey: product.planKey,
      itemNo: product.fields.itemNo,
      sourceRows: product.sources.map((source) => ({ row: source.rowNumber, fingerprint: source.fingerprint })),
      images: product.images.map((image) => ({ role: image.role, sourceCell: image.cell, sortOrder: image.sortOrder })),
      issues: product.issues.map((issue) => ({ code: issue.code, fieldName: issue.fieldName, sourceRef: issue.sourceRef, severity: issue.severity })),
    })),
  };
  const csvRows = [['planKey', 'itemNo', 'sourceRows', 'imageCount', 'issueCodes']];
  for (const product of plan.products) csvRows.push([
    product.planKey, product.fields.itemNo, product.sources.map((source) => source.rowNumber).join('|'),
    String(product.images.length), [...new Set(product.issues.map((issue) => issue.code))].join('|'),
  ]);
  await atomicWrite(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await atomicWrite(csvPath, `${csvRows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`);
  return { jsonPath, csvPath };
}

async function atomicWrite(target: string, content: string): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, target);
}

function csvCell(value: string): string { return `"${value.replace(/"/g, '""')}"`; }
function safeName(value: string): string { return value.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 64) || 'sheet'; }
