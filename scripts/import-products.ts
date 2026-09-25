import path from 'node:path';

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

import { createImageAssetRuntime } from '../server/image-assets/runtime';
import { initializeImageAssetSchema } from '../server/image-assets/schema';
import { ProductImportService } from '../server/products/importService';
import { MySqlProductImportRepository } from '../server/products/mysqlImportRepository';
import type { ProductImportBatch } from '../server/products/importTypes';
import { AssetIngestor } from './product-import/assetIngest';
import { materializeImportImage } from './product-import/imagePlan';
import { LocalCompatImportAdapter } from './product-import/localCompat';
import { normalizeImportPlan, type ImportPlan } from './product-import/normalize';
import { OoxmlArchive } from './product-import/ooxmlArchive';
import { writeDryRunReport } from './product-import/report';
import { readWpsProductWorkbook } from './product-import/wpsWorkbook';

export type ImportProductsArgs = { mode: 'dry-run' | 'apply' | 'rollback'; file?: string; sheet?: string; reportDir: string; resumeBatch?: number; rollbackBatch?: number; allowLocalCompat: boolean; };

export function parseImportArgs(argv: string[]): ImportProductsArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const valueFlags = new Set(['--file', '--sheet', '--report-dir', '--resume-batch', '--rollback-batch']);
  const booleanFlags = new Set(['--dry-run', '--apply', '--allow-local-compat']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (booleanFlags.has(arg)) { flags.add(arg); continue; }
    if (!valueFlags.has(arg)) throw new Error(`Unknown import argument: ${arg}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    values.set(arg, value);
  }
  const modes = [flags.has('--dry-run'), flags.has('--apply'), values.has('--rollback-batch')].filter(Boolean).length;
  if (modes !== 1) throw new Error('Select exactly one mode: --dry-run, --apply, or --rollback-batch');
  const reportDir = values.get('--report-dir') ?? '.local/import-reports';
  const allowLocalCompat = flags.has('--allow-local-compat');
  if (values.has('--rollback-batch')) return { mode: 'rollback', rollbackBatch: positiveInteger(values.get('--rollback-batch'), 'rollback batch'), reportDir, allowLocalCompat };
  const file = values.get('--file'); const sheet = values.get('--sheet');
  if (!file) throw new Error('--file is required');
  if (!sheet) throw new Error('--sheet is required');
  if (!/\.xlsm?$/i.test(file) && !/\.xlsx$/i.test(file)) throw new Error('--file must be an .xlsm or .xlsx workbook');
  if (flags.has('--dry-run')) return { mode: 'dry-run', file, sheet, reportDir, allowLocalCompat };
  const resume = values.has('--resume-batch') ? positiveInteger(values.get('--resume-batch'), 'resume batch') : undefined;
  return { mode: 'apply', file, sheet, reportDir, allowLocalCompat, ...(resume ? { resumeBatch: resume } : {}) };
}

export async function runProductImport(args: ImportProductsArgs): Promise<void> {
  if (args.mode === 'rollback') return runRollback(args);
  const filePath = path.resolve(args.file!);
  const workbook = await readWpsProductWorkbook(filePath, args.sheet!);
  const plan = normalizeImportPlan(workbook);
  if (args.mode === 'dry-run') {
    await inspectPlanMedia(plan, await OoxmlArchive.open(filePath));
    const report = await writeDryRunReport(plan, args.reportDir);
    safeLog({ stage: 'dry-run-complete', products: plan.products.length, sourceRows: workbook.rows.length, report: path.basename(report.jsonPath) });
    return;
  }
  if (args.allowLocalCompat) await applyLocal(plan, filePath);
  else await applyMySql(plan, filePath, args.resumeBatch);
  const report = await writeDryRunReport(plan, args.reportDir);
  safeLog({ stage: 'apply-report', report: path.basename(report.jsonPath) });
}

async function inspectPlanMedia(plan: ImportPlan, archive: OoxmlArchive): Promise<void> {
  for (const product of plan.products) for (const image of product.images) {
    try { product.issues.push(...(await materializeImportImage(await archive.readBuffer(image.mediaEntry, 100 * 1024 * 1024), `${plan.sheet}!${image.cell}`)).issues); }
    catch { product.issues.push({ code: 'IMAGE_REFERENCE_MISSING', fieldName: 'images', message: '图片无法解析', sourceRef: `${plan.sheet}!${image.cell}`, severity: 'warning' }); }
  }
}

async function applyLocal(plan: ImportPlan, filePath: string): Promise<void> {
  const archive = await OoxmlArchive.open(filePath);
  const adapter = new LocalCompatImportAdapter(process.cwd());
  const batch: ProductImportBatch = { id: Number.parseInt(plan.fileSha256.slice(0, 8), 16), fileSha256: plan.fileSha256, sheetName: plan.sheet, status: 'running', createdBy: principalId() };
  let succeeded = 0; let failed = 0; let skipped = 0;
  for (const product of plan.products) {
    const images: Parameters<LocalCompatImportAdapter['applyProduct']>[2] = [];
    for (const planned of product.images) {
      try { images.push({ planned, materialized: await materializeImportImage(await archive.readBuffer(planned.mediaEntry, 100 * 1024 * 1024), `${plan.sheet}!${planned.cell}`) }); }
      catch { product.issues.push({ code: 'IMAGE_REFERENCE_MISSING', fieldName: 'images', message: '图片无法解析或导入', sourceRef: `${plan.sheet}!${planned.cell}`, severity: 'warning' }); }
    }
    if (!images.some((image) => image.planned.role === 'pattern_original') && !product.issues.some((issue) => issue.code === 'MISSING_PATTERN_ORIGINAL')) product.issues.push({ code: 'MISSING_PATTERN_ORIGINAL', fieldName: 'images', message: '缺少花型原图', sourceRef: `${plan.sheet}!${product.sources[0]?.rowNumber ?? 0}`, severity: 'warning' });
    try {
      const result = await adapter.applyProduct(batch, product, images);
      result.status === 'applied' ? succeeded += 1 : skipped += 1;
      safeLog({ batch: batch.id, planKey: product.planKey, productId: result.productId, stage: result.status });
    } catch { failed += 1; safeLog({ batch: batch.id, planKey: product.planKey, stage: 'failed', code: 'IMPORT_PRODUCT_FAILED' }); }
  }
  const status = failed ? 'partial' : 'completed';
  await adapter.finishBatch(batch.id, status);
  safeLog({ batch: batch.id, stage: 'apply-complete', succeeded, failed, skipped, status });
}

async function applyMySql(plan: ImportPlan, filePath: string, resumeBatch?: number): Promise<void> {
  const pool = createPoolFromEnv();
  try {
    await initializeImageAssetSchema(pool as unknown as Parameters<typeof initializeImageAssetSchema>[0]);
    const runtime = createImageAssetRuntime({ env: { ...process.env, IMAGE_ASSETS_ENABLED: 'true', PRODUCT_IMAGE_ASSETS_ENABLED: 'true' }, mysqlPool: pool as never });
    const repository = new MySqlProductImportRepository(pool as never);
    const batch = await repository.beginOrResumeBatch({ fileSha256: plan.fileSha256, sourceFile: plan.sourceFile, sheetName: plan.sheet, createdBy: principalId() });
    if (resumeBatch !== undefined && batch.id !== resumeBatch) throw new Error('Resume batch does not match this workbook and sheet');
    const archive = await OoxmlArchive.open(filePath);
    const assetIngestor = new AssetIngestor(runtime);
    const service = new ProductImportService(repository, { async ingest(image, actor) {
      const materialized = await materializeImportImage(await archive.readBuffer(image.mediaEntry, 100 * 1024 * 1024), `${plan.sheet}!${image.cell}`);
      return { ...(await assetIngestor.ingest(materialized, `${plan.sheet}-${image.cell}.${materialized.extension}`, actor)), originMetadata: materialized.originMetadata, issues: materialized.issues };
    } });
    const summary = await service.applyPlan(batch, plan.products, principalId());
    safeLog({ batch: batch.id, stage: 'apply-complete', ...summary });
  } finally { await pool.end(); }
}

async function runRollback(args: ImportProductsArgs): Promise<void> {
  if (args.allowLocalCompat) throw new Error('Local compatibility rollback is not automatic; restore the pre-import backup');
  const pool = createPoolFromEnv();
  try {
    const blockers = await new MySqlProductImportRepository(pool as never).rollbackBatch(args.rollbackBatch!);
    if (blockers.length) throw Object.assign(new Error('ROLLBACK_BLOCKED'), { code: 'ROLLBACK_BLOCKED', blockers });
    safeLog({ batch: args.rollbackBatch, stage: 'rolled-back' });
  } finally { await pool.end(); }
}

function createPoolFromEnv() {
  const host = process.env.DB_HOST?.trim(); const user = process.env.DB_USER?.trim(); const password = process.env.DB_PASSWORD?.trim(); const database = process.env.DB_DATABASE?.trim();
  if (!host || !user || !password || !database) throw new Error('MySQL configuration (DB_HOST, DB_USER, DB_PASSWORD, DB_DATABASE) is required; use --allow-local-compat only for the explicit local fallback');
  return mysql.createPool({ host, port: Number(process.env.DB_PORT) || 3306, user, password, database, connectionLimit: 3 });
}
function principalId(): string { return process.env.IMPORT_PRINCIPAL_ID?.trim() || 'product-import'; }
function positiveInteger(value: string | undefined, label: string): number { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Invalid ${label}`); return parsed; }
function safeLog(value: Record<string, unknown>): void { process.stdout.write(`${JSON.stringify(value)}\n`); }

const invoked = process.argv[1] != null && /import-products\.(?:ts|js)$/.test(process.argv[1]);
if (invoked) { dotenv.config(); void runProductImport(parseImportArgs(process.argv.slice(2))).catch((error) => { process.stderr.write(`${JSON.stringify({ stage: 'failed', code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'IMPORT_FAILED', message: error instanceof Error ? error.message : 'Import failed' })}\n`); process.exitCode = 1; }); }
