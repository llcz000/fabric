import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ProductImportBatch } from '../../server/products/importTypes';
import type { MaterializedImportImage } from './imagePlan';
import type { PlannedImage, PlannedIssue, PlannedProduct } from './normalize';

interface LocalDatabase { company_config?: unknown; orders: unknown[]; order_items: unknown[]; products: Array<Record<string, unknown>>; product_images: Array<Record<string, unknown>>; inventory_entries: unknown[]; }
interface SavedImportProduct { productId: number; planKey: string; sources: Array<{ sourceSheet: string; sourceRow: number; fingerprint: string }>; images: Array<{ id: number; role: PlannedImage['role']; localPath: string }>; issues: PlannedIssue[]; updatedAt: string; }
interface LocalImportState { batches: Record<string, { id: number; fileSha256: string; sheetName: string; status: string }>; products: Record<string, SavedImportProduct>; }

export class LocalCompatImportAdapter {
  private readonly root: string;
  private readonly databasePath: string;
  private readonly statePath: string;
  private readonly imageRoot: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.databasePath = path.join(this.root, 'database_fallback.json');
    this.statePath = path.join(this.root, 'product_import_state.json');
    this.imageRoot = path.join(this.root, 'uploads', 'products');
  }

  async applyProduct(batch: ProductImportBatch, product: PlannedProduct, images: Array<{ planned: PlannedImage; materialized: MaterializedImportImage }>): Promise<{ productId: number; status: 'applied' | 'skipped' }> {
    await mkdir(this.imageRoot, { recursive: true });
    const [database, state] = await Promise.all([this.readDatabase(), this.readState()]);
    const existing = state.products[product.planKey];
    if (existing && product.sources.every((source) => existing.sources.some((saved) => saved.sourceSheet === source.sheet && saved.sourceRow === source.rowNumber && saved.fingerprint === source.fingerprint))) {
      return { productId: existing.productId, status: 'skipped' };
    }
    const productId = nextNumericId(database.products);
    const now = new Date().toISOString();
    const savedImages: SavedImportProduct['images'] = [];
    for (const image of images) {
      const imageId = nextNumericId(database.product_images);
      const filename = `import-${image.materialized.sha256}.${image.materialized.extension}`;
      const target = path.join(this.imageRoot, filename);
      await writeIfMissing(target, image.materialized.body);
      database.product_images.push({
        id: imageId, product_id: productId, sort_order: image.planned.sortOrder, role: image.planned.role,
        is_primary: image.planned.role === 'pattern_original', origin_type: 'excel_import', origin_metadata: image.materialized.originMetadata,
        local_path: target, thumbnail_local_path: target, cos_key: '', thumbnail_cos_key: '', created_at: now,
      });
      savedImages.push({ id: imageId, role: image.planned.role, localPath: target });
    }
    const issues = [...product.issues, ...images.flatMap((image) => image.materialized.issues)];
    database.products.push({
      id: productId, item_no: product.fields.itemNo, product_name: product.fields.productName,
      composition: product.fields.composition, weight: product.fields.weight, width: product.fields.width,
      image_count: savedImages.length, review_status: issues.length ? 'needs_attention' : 'reviewed', open_issue_count: issues.length,
      pattern_tags: [], created_at: now, updated_at: now,
    });
    state.batches[String(batch.id)] = { id: batch.id, fileSha256: batch.fileSha256, sheetName: batch.sheetName, status: 'running' };
    state.products[product.planKey] = {
      productId, planKey: product.planKey,
      sources: product.sources.map((source) => ({ sourceSheet: source.sheet, sourceRow: source.rowNumber, fingerprint: source.fingerprint })),
      images: savedImages, issues, updatedAt: now,
    };
    await atomicJson(this.databasePath, database);
    await atomicJson(this.statePath, state);
    return { productId, status: 'applied' };
  }

  async readProductByPlanKey(planKey: string): Promise<SavedImportProduct | null> { return (await this.readState()).products[planKey] ?? null; }
  async finishBatch(batchId: number, status: 'completed' | 'partial'): Promise<void> { const state = await this.readState(); if (state.batches[String(batchId)]) state.batches[String(batchId)].status = status; await atomicJson(this.statePath, state); }

  private async readDatabase(): Promise<LocalDatabase> {
    return await readJson<LocalDatabase>(this.databasePath) ?? { orders: [], order_items: [], products: [], product_images: [], inventory_entries: [] };
  }
  private async readState(): Promise<LocalImportState> { return await readJson<LocalImportState>(this.statePath) ?? { batches: {}, products: {} }; }
}

async function readJson<T>(file: string): Promise<T | null> { try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }
async function atomicJson(file: string, value: unknown): Promise<void> { const temp = `${file}.${randomUUID()}.tmp`; await mkdir(path.dirname(file), { recursive: true }); await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); await rename(temp, file); }
async function writeIfMissing(file: string, body: Buffer): Promise<void> { try { await writeFile(file, body, { flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; } }
function nextNumericId(rows: Array<Record<string, unknown>>): number { return rows.reduce((maximum, row) => Math.max(maximum, Number(row.id) || 0), 0) + 1; }
