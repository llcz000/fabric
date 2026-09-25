import type { AssetTransaction } from '../image-assets/repository';
import { validateImageLayout } from './validation';
import type { AtomicImportedProduct, BeginImportBatch, ImportBatchSummary, ImportSourceResult, ProductImportBatch, ProductImportRepository, RollbackBlocker } from './importTypes';

interface ImportPool { getConnection(): Promise<AssetTransaction>; query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>; }
type Row = Record<string, unknown>;

export class MySqlProductImportRepository implements ProductImportRepository {
  constructor(private readonly pool: ImportPool) {}

  async beginOrResumeBatch(input: BeginImportBatch): Promise<ProductImportBatch> {
    await this.pool.query(
      `INSERT INTO product_import_batches (file_sha256, source_file, sheet_name, status, created_by)
       VALUES (?, ?, ?, 'running', ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), updated_at = NOW()`,
      [input.fileSha256, input.sourceFile, input.sheetName, input.createdBy],
    );
    const found = rows(await this.pool.query('SELECT * FROM product_import_batches WHERE file_sha256 = ? AND sheet_name = ? LIMIT 1', [input.fileSha256, input.sheetName]))[0];
    if (!found) throw new Error('IMPORT_BATCH_NOT_FOUND');
    return mapBatch(found);
  }

  async getSourceResult(batchId: number, sheet: string, row: number): Promise<ImportSourceResult | null> {
    const found = rows(await this.pool.query('SELECT product_id, status, error_code FROM product_import_sources WHERE batch_id = ? AND source_sheet = ? AND source_row = ? LIMIT 1', [batchId, sheet, row]))[0];
    return found ? { productId: found.product_id === null ? undefined : Number(found.product_id), status: found.status === 'applied' ? 'applied' : 'failed', errorCode: found.error_code ? String(found.error_code) : undefined } : null;
  }

  async applyImportedProduct(input: AtomicImportedProduct): Promise<{ productId: number; updatedAt: Date }> {
    validateImageLayout(input.images.map(({ assetId, role, sortOrder }) => ({ assetId, role, sortOrder })));
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const existing = rows(await connection.query(
        `SELECT source_row, product_id, status FROM product_import_sources
         WHERE batch_id = ? AND source_sheet = ? AND source_row IN (${input.sources.map(() => '?').join(',')}) FOR UPDATE`,
        [input.batchId, input.sources[0]?.sheet ?? '', ...input.sources.map((source) => source.rowNumber)],
      ));
      if (existing.some((row) => row.status === 'applied')) throw Object.assign(new Error('Import source already applied'), { code: 'IMPORT_SOURCE_CONFLICT' });
      const assetIds = [...new Set(input.images.map((image) => image.assetId))].sort();
      if (assetIds.length) {
        const assets = rows(await connection.query(`SELECT id, status FROM image_assets WHERE id IN (${assetIds.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`, assetIds));
        if (assets.length !== assetIds.length || assets.some((asset) => asset.status !== 'ready')) throw Object.assign(new Error('Import asset is not ready'), { code: 'ASSET_NOT_READY' });
      }
      const now = new Date();
      const inserted = result(await connection.query(
        'INSERT INTO products (item_no, product_name, composition, weight, width, image_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [input.fields.itemNo, input.fields.productName, input.fields.composition, input.fields.weight, input.fields.width, input.images.length, now, now],
      ));
      const productId = Number(inserted.insertId);
      if (!Number.isSafeInteger(productId) || productId <= 0) throw new Error('IMPORT_PRODUCT_INSERT_FAILED');
      for (const image of input.images) {
        await connection.query(
          `INSERT INTO product_image_assets (product_id, asset_id, role, sort_order, is_primary, origin_type, origin_metadata, deleted_at)
           VALUES (?, ?, ?, ?, ?, 'excel_import', ?, NULL)`,
          [productId, image.assetId, image.role, image.sortOrder, image.role === 'pattern_original' ? 1 : 0, JSON.stringify({ sourceRef: image.sourceRef, ...(image.originMetadata ?? {}) })],
        );
        await connection.query('UPDATE image_assets SET ref_count = ref_count + 1, recycled_at = NULL, purge_after = NULL WHERE id = ?', [image.assetId]);
      }
      for (const source of input.sources) {
        const payload = validateImportSourcePayload(source.cells);
        await connection.query(
          `INSERT INTO product_import_sources (batch_id, product_id, plan_key, source_sheet, source_row, source_fingerprint, source_payload, status, imported_product_updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'applied', ?)`,
          [input.batchId, productId, input.planKey, source.sheet, source.rowNumber, source.fingerprint, JSON.stringify(payload), now],
        );
      }
      for (const issue of input.issues) {
        await connection.query(
          `INSERT INTO product_issues (product_id, code, severity, field_name, message, source_ref, status)
           VALUES (?, ?, ?, ?, ?, ?, 'open')
           ON DUPLICATE KEY UPDATE severity = VALUES(severity), message = VALUES(message), status = IF(status = 'ignored', status, 'open')`,
          [productId, issue.code, issue.severity, issue.fieldName, issue.message, issue.sourceRef],
        );
      }
      await connection.commit();
      return { productId, updatedAt: now };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }

  async recordProductFailure(batchId: number, planKey: string, code: string): Promise<void> {
    await this.pool.query("UPDATE product_import_batches SET status = 'partial', last_error_code = ?, checkpoint_json = JSON_SET(COALESCE(checkpoint_json, JSON_OBJECT()), '$.lastFailedPlanKey', ?), updated_at = NOW() WHERE id = ?", [code, planKey, batchId]);
  }

  async finishBatch(batchId: number, summary: ImportBatchSummary): Promise<void> {
    await this.pool.query('UPDATE product_import_batches SET status = ?, stats_json = ?, updated_at = NOW() WHERE id = ?', [summary.status, JSON.stringify(summary), batchId]);
  }

  async listRollbackBlockers(batchId: number): Promise<RollbackBlocker[]> {
    const imported = uniqueImportedProducts(rows(await this.pool.query(
      `SELECT DISTINCT p.id, p.item_no, p.updated_at, s.imported_product_updated_at
       FROM product_import_sources s JOIN products p ON p.id = s.product_id WHERE s.batch_id = ?`,
      [batchId],
    )));
    return await this.findRollbackBlockers(this.pool, batchId, imported);
  }

  async rollbackBatch(batchId: number): Promise<RollbackBlocker[]> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const imported = uniqueImportedProducts(rows(await connection.query(
        `SELECT p.id, p.item_no, p.updated_at, s.imported_product_updated_at
         FROM product_import_sources s JOIN products p ON p.id = s.product_id
         WHERE s.batch_id = ? FOR UPDATE`,
        [batchId],
      )));
      const blockers = await this.findRollbackBlockers(connection, batchId, imported);
      if (blockers.length) { await connection.rollback(); return blockers; }
      for (const product of imported) {
        const productId = Number(product.id);
        const links = rows(await connection.query('SELECT asset_id FROM product_image_assets WHERE product_id = ? AND deleted_at IS NULL FOR UPDATE', [productId]));
        const assetIds = links.map((link) => String(link.asset_id));
        if (assetIds.length) await connection.query(`SELECT id FROM image_assets WHERE id IN (${assetIds.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`, assetIds);
        await connection.query('DELETE FROM products WHERE id = ?', [productId]);
        for (const assetId of assetIds) await connection.query('UPDATE image_assets SET ref_count = GREATEST(ref_count - 1, 0) WHERE id = ?', [assetId]);
      }
      await connection.query("UPDATE product_import_sources SET status = 'rolled_back', updated_at = NOW() WHERE batch_id = ?", [batchId]);
      await connection.query("UPDATE product_import_batches SET status = 'rolled_back', updated_at = NOW() WHERE id = ?", [batchId]);
      await connection.commit();
      return [];
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }

  async markBatchRolledBack(batchId: number): Promise<void> { await this.pool.query("UPDATE product_import_batches SET status = 'rolled_back', updated_at = NOW() WHERE id = ?", [batchId]); }

  private async findRollbackBlockers(queryable: { query(sql: string, params?: unknown[]): Promise<[unknown, unknown]> }, batchId: number, imported: Row[]): Promise<RollbackBlocker[]> {
    const blockers: RollbackBlocker[] = [];
    const ids = imported.map((product) => Number(product.id)).filter((id) => Number.isSafeInteger(id) && id > 0);
    for (const product of imported) {
      const productId = Number(product.id);
      if (date(product.updated_at).getTime() !== date(product.imported_product_updated_at).getTime()) blockers.push({ productId, reason: 'modified' });
    }
    if (!ids.length) return blockers;
    const otherSources = rows(await queryable.query(
      `SELECT DISTINCT product_id FROM product_import_sources WHERE product_id IN (${ids.map(() => '?').join(',')}) AND batch_id <> ? AND status = 'applied'`,
      [...ids, batchId],
    ));
    for (const row of otherSources) blockers.push({ productId: Number(row.product_id), reason: 'other_batch' });
    const itemNos = imported.map((product) => String(product.item_no));
    const ordered = rows(await queryable.query(`SELECT DISTINCT product_no FROM order_items WHERE product_no IN (${itemNos.map(() => '?').join(',')})`, itemNos));
    const orderedNos = new Set(ordered.map((row) => String(row.product_no)));
    for (const product of imported) if (orderedNos.has(String(product.item_no))) blockers.push({ productId: Number(product.id), reason: 'order_reference' });
    return uniqueBlockers(blockers);
  }
}

export function validateImportSourcePayload(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Import source payload must contain A-J cells');
  const entries = Object.entries(value);
  const allowed = new Set('ABCDEFGHIJ'.split(''));
  if (entries.length !== 10 || entries.some(([key, cell]) => !allowed.has(key) || typeof cell !== 'string')) throw new Error('Import source payload must contain only A-J string cells');
  const normalized = Object.fromEntries('ABCDEFGHIJ'.split('').map((key) => [key, String((value as Record<string, string>)[key])]));
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > 16 * 1024) throw new Error('Import source payload exceeds 16 KiB');
  return normalized;
}

function rows(value: [unknown, unknown]): Row[] { return Array.isArray(value[0]) ? value[0] as Row[] : []; }
function result(value: [unknown, unknown]): { insertId?: number } { return value[0] as { insertId?: number }; }
function mapBatch(row: Row): ProductImportBatch { return { id: Number(row.id), fileSha256: String(row.file_sha256), sheetName: String(row.sheet_name), status: String(row.status) as ProductImportBatch['status'], createdBy: String(row.created_by) }; }
function date(value: unknown): Date { return value instanceof Date ? value : new Date(String(value)); }
function uniqueBlockers(blockers: RollbackBlocker[]): RollbackBlocker[] { const seen = new Set<string>(); return blockers.filter((item) => { const key = `${item.productId}:${item.reason}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
function uniqueImportedProducts(products: Row[]): Row[] { const seen = new Set<number>(); return products.filter((product) => { const id = Number(product.id); if (seen.has(id)) return false; seen.add(id); return true; }); }
