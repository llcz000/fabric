import { ImageAssetError } from './errors';
import { getAssetPolicy } from './policy';
import type {
  AssetRepository,
  AssetTransaction,
  AssetVariantRecord,
  FinalizedUpload,
  FinalizedUploadResult,
  NewUploadSession,
  ProcessingJob,
  ProductAssetAssociationRecord,
  ProductRecord,
  ProductWriteRecord,
  PurgeClaim,
  ReconciliationCandidate,
  LegacyProductImageRecord,
} from './repository';
import { MAX_PRODUCT_IMAGE_ASSOCIATIONS, type AssetStatus, type CompanyImageRole, type ImageAssetRecord, type UploadSessionRecord } from './types';

interface AssetPool {
  query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
  getConnection(): Promise<AssetTransaction>;
}

type Row = Record<string, unknown>;
type Result = { affectedRows?: number };

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && ((error as { code?: unknown }).code === 'ER_DUP_ENTRY' || String((error as { message?: unknown }).message).includes('Duplicate entry')),
  );
}

function date(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function optionalDate(value: unknown): Date | undefined {
  return value == null ? undefined : date(value);
}

function rows(result: [unknown, unknown]): Row[] {
  return result[0] as Row[];
}

function result(resultSet: [unknown, unknown]): Result {
  return resultSet[0] as Result;
}

function mapUploadSession(row: Row): UploadSessionRecord {
  return {
    id: String(row.id),
    purpose: row.purpose as UploadSessionRecord['purpose'],
    quarantineKey: String(row.quarantine_key),
    declaredByteSize: Number(row.declared_byte_size),
    declaredMime: String(row.declared_mime),
    createdBy: String(row.created_by),
    expiresAt: date(row.expires_at),
    status: row.status as UploadSessionRecord['status'],
    assetId: row.asset_id == null ? undefined : String(row.asset_id),
    quarantineCleanedAt: optionalDate(row.quarantine_cleaned_at),
  };
}

function mapAsset(row: Row): ImageAssetRecord {
  return {
    id: String(row.id),
    sha256: String(row.sha256),
    originalFilename: String(row.original_filename),
    detectedMime: String(row.detected_mime),
    detectedExtension: String(row.detected_extension),
    purpose: row.purpose as ImageAssetRecord['purpose'],
    storageProvider: row.storage_provider as ImageAssetRecord['storageProvider'],
    byteSize: Number(row.byte_size),
    width: Number(row.width),
    height: Number(row.height),
    status: row.status as AssetStatus,
    refCount: Number(row.ref_count),
    createdBy: String(row.created_by),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    recycledAt: optionalDate(row.recycled_at),
    purgeAfter: optionalDate(row.purge_after),
    purgedAt: optionalDate(row.purged_at),
    errorCode: row.error_code == null ? undefined : row.error_code as ImageAssetRecord['errorCode'],
    metadata: row.metadata_json == null
      ? undefined
      : typeof row.metadata_json === 'string'
        ? JSON.parse(row.metadata_json)
        : row.metadata_json as Record<string, unknown>,
  };
}

function mapProduct(row: Row): ProductRecord {
  return { ...row, id: Number(row.id), item_no: String(row.item_no), product_name: String(row.product_name) };
}

function mapVariant(row: Row): AssetVariantRecord {
  return {
    assetId: String(row.asset_id),
    variant: row.variant as AssetVariantRecord['variant'],
    objectKey: String(row.object_key),
    mime: String(row.mime),
    byteSize: Number(row.byte_size),
    width: Number(row.width),
    height: Number(row.height),
    createdAt: date(row.created_at),
  };
}

function mapJob(row: Row): ProcessingJob {
  return {
    id: Number(row.id),
    assetId: String(row.asset_id),
    jobType: String(row.job_type),
    status: row.status as ProcessingJob['status'],
    attempts: Number(row.attempts),
    availableAt: date(row.available_at),
    lockedAt: optionalDate(row.locked_at),
    lastErrorCode: row.last_error_code == null ? undefined : String(row.last_error_code),
  };
}

export class MySqlAssetRepository implements AssetRepository {
  constructor(private readonly pool: AssetPool) {}

  async createUploadSession(input: NewUploadSession): Promise<UploadSessionRecord> {
    const storedRows = rows(await this.pool.query('SELECT * FROM image_upload_sessions WHERE id = ?', [input.id]));
    if (storedRows[0]) return this.assertCompatibleUploadSession(mapUploadSession(storedRows[0]), input);
    try {
      await this.pool.query(
        `INSERT INTO image_upload_sessions
          (id, purpose, quarantine_key, declared_byte_size, declared_mime, created_by, expires_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`,
        [input.id, input.purpose, input.quarantineKey, input.declaredByteSize, input.declaredMime, input.createdBy, input.expiresAt],
      );
      return { ...input, status: 'open' };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const retriedRows = rows(await this.pool.query('SELECT * FROM image_upload_sessions WHERE id = ?', [input.id]));
      if (retriedRows[0]) return this.assertCompatibleUploadSession(mapUploadSession(retriedRows[0]), input);
      const quarantineRows = rows(await this.pool.query(
        'SELECT * FROM image_upload_sessions WHERE quarantine_key = ?',
        [input.quarantineKey],
      ));
      if (quarantineRows[0]) {
        const collision = mapUploadSession(quarantineRows[0]);
        if (collision.id === input.id) return this.assertCompatibleUploadSession(collision, input);
        throw new ImageAssetError('IMAGE_CONTENT_INVALID', 409, false, 'Upload quarantine key belongs to another session');
      }
      throw error;
    }
  }

  private assertCompatibleUploadSession(stored: UploadSessionRecord, input: NewUploadSession): UploadSessionRecord {
    if (
      stored.purpose !== input.purpose
      || stored.quarantineKey !== input.quarantineKey
      || stored.declaredByteSize !== input.declaredByteSize
      || stored.declaredMime !== input.declaredMime
      || stored.createdBy !== input.createdBy
      || stored.expiresAt.getTime() !== input.expiresAt.getTime()
    ) {
      throw new ImageAssetError('IMAGE_CONTENT_INVALID', 409, false, 'Upload session retry conflicts with the existing session');
    }
    return stored;
  }

  async getUploadSession(id: string): Promise<UploadSessionRecord | null> {
    const found = rows(await this.pool.query('SELECT * FROM image_upload_sessions WHERE id = ?', [id]));
    return found[0] ? mapUploadSession(found[0]) : null;
  }

  async finalizeUploadSession(input: FinalizedUpload): Promise<FinalizedUploadResult> {
    const finalized = await this.inTransaction(async (connection) => {
      const sessionRows = rows(await connection.query(
        'SELECT * FROM image_upload_sessions WHERE id = ? FOR UPDATE',
        [input.sessionId],
      ));
      const session = sessionRows[0] ? mapUploadSession(sessionRows[0]) : null;
      if (!session) throw new ImageAssetError('ASSET_NOT_FOUND', 404, false, 'Upload session not found');
      if (session.createdBy !== input.principalId) throw new ImageAssetError('ASSET_ACCESS_DENIED', 403, false, 'Upload session belongs to another principal');
      if (session.status === 'finalized' && session.assetId) {
        const assetRows = rows(await connection.query('SELECT status FROM image_assets WHERE id = ? FOR UPDATE', [session.assetId]));
        const processingRequired = assetRows[0]?.status === 'processing' || assetRows[0]?.status === 'degraded';
        return { assetId: session.assetId, jobCreated: false, processingRequired };
      }
      if (session.status !== 'open') throw new ImageAssetError('UPLOAD_SESSION_EXPIRED', 409, false, 'Upload session is not open');
      if (session.expiresAt <= new Date()) {
        await connection.query("UPDATE image_upload_sessions SET status = 'expired' WHERE id = ? AND status = 'open'", [input.sessionId]);
        return null;
      }

      const existingRows = rows(await connection.query(
        'SELECT * FROM image_assets WHERE sha256 = ? FOR UPDATE',
        [input.sha256],
      ));
      const existing = existingRows[0] ? mapAsset(existingRows[0]) : null;
      if (existing?.status === 'purging' || existing?.status === 'purged') {
        throw new ImageAssetError('ASSET_NOT_READY', 409, true, 'Matching asset is being purged');
      }
      const assetId = existing?.id ?? input.assetId ?? input.sessionId;
      let jobCreated = false;
      let needsProcessing = !existing;
      const purpose = mergePurpose(existing?.purpose, session.purpose);

      if (!existing) {
        await connection.query(
          `INSERT INTO image_assets
            (id, sha256, original_filename, detected_mime, detected_extension, purpose, storage_provider,
             byte_size, width, height, status, ref_count, created_by, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', 0, ?, ?)`,
          [assetId, input.sha256, input.originalFilename, input.detectedMime, input.detectedExtension, purpose,
            input.storageProvider, input.byteSize, input.width, input.height, input.principalId, JSON.stringify(input.metadata ?? {})],
        );
      } else {
        const variants = rows(await connection.query(
          'SELECT variant FROM image_asset_variants WHERE asset_id = ?',
          [assetId],
        ));
        const availableVariants = new Set(variants.map((variant) => String(variant.variant)));
        const hasRequiredVariants = getAssetPolicy(purpose).variants.every((variant) => availableVariants.has(variant));
        needsProcessing = existing.status === 'processing' || existing.status === 'degraded' || !hasRequiredVariants;
        await connection.query(
          `UPDATE image_assets SET purpose = ?, created_by = ?, created_at = NOW(), status = ?,
             recycled_at = NULL, purge_after = NULL, purged_at = NULL, error_code = NULL
           WHERE id = ? AND status NOT IN ('purging', 'purged')`,
          [purpose, input.principalId, needsProcessing ? 'processing' : 'ready', assetId],
        );
      }

      if (needsProcessing) {
        const inserted = result(await connection.query(
          `INSERT INTO image_processing_jobs (asset_id, job_type, status, attempts, available_at)
           VALUES (?, 'process_asset', 'queued', 0, NOW())
           ON DUPLICATE KEY UPDATE
             available_at = IF(status IN ('completed', 'failed'), NOW(), available_at),
             attempts = IF(status IN ('completed', 'failed'), 0, attempts),
             locked_at = IF(status IN ('completed', 'failed'), NULL, locked_at),
             last_error_code = IF(status IN ('completed', 'failed'), NULL, last_error_code),
             status = IF(status IN ('completed', 'failed'), 'queued', status)`,
          [assetId],
        ));
        jobCreated = (inserted.affectedRows ?? 0) > 0;
      }

      await connection.query(
        "UPDATE image_upload_sessions SET status = 'finalized', asset_id = ? WHERE id = ?",
        [assetId, input.sessionId],
      );
      return { assetId, jobCreated, processingRequired: needsProcessing };
    });
    if (!finalized) throw new ImageAssetError('UPLOAD_SESSION_EXPIRED', 409, false, 'Upload session has expired');
    return finalized;
  }

  async getAsset(id: string): Promise<ImageAssetRecord | null> {
    const found = rows(await this.pool.query('SELECT * FROM image_assets WHERE id = ?', [id]));
    return found[0] ? mapAsset(found[0]) : null;
  }

  async getVariants(assetId: string): Promise<AssetVariantRecord[]> {
    return rows(await this.pool.query(
      'SELECT * FROM image_asset_variants WHERE asset_id = ? ORDER BY variant',
      [assetId],
    )).map(mapVariant);
  }

  async claimNextJob(now: Date): Promise<ProcessingJob | null> {
    return this.inTransaction(async (connection) => {
      const candidates = rows(await connection.query(
        `SELECT * FROM image_processing_jobs
         WHERE status = 'queued' AND available_at <= ?
         ORDER BY available_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [now],
      ));
      if (!candidates[0]) return null;
      const job = mapJob(candidates[0]);
      await connection.query(
        "UPDATE image_processing_jobs SET status = 'processing', attempts = attempts + 1, locked_at = NOW() WHERE id = ?",
        [job.id],
      );
      return { ...job, status: 'processing', attempts: job.attempts + 1, lockedAt: now };
    });
  }

  async completeProcessing(assetId: string, variants: AssetVariantRecord[]): Promise<void> {
    if (variants.length === 0 || !variants.some((variant) => variant.variant === 'original')) {
      throw new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'Processed variants must include the original image');
    }
    await this.inTransaction(async (connection) => {
      const assets = rows(await connection.query('SELECT id FROM image_assets WHERE id = ? FOR UPDATE', [assetId]));
      if (!assets[0]) throw new ImageAssetError('ASSET_NOT_FOUND', 404, false, 'Asset not found');
      for (const variant of variants) {
        await connection.query(
          `INSERT INTO image_asset_variants (asset_id, variant, object_key, mime, byte_size, width, height, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE object_key = VALUES(object_key), mime = VALUES(mime), byte_size = VALUES(byte_size),
             width = VALUES(width), height = VALUES(height)`,
          [assetId, variant.variant, variant.objectKey, variant.mime, variant.byteSize, variant.width, variant.height, variant.createdAt],
        );
      }
      await connection.query("UPDATE image_assets SET status = 'ready', error_code = NULL WHERE id = ?", [assetId]);
      await connection.query("UPDATE image_processing_jobs SET status = 'completed', locked_at = NULL WHERE asset_id = ?", [assetId]);
    });
  }

  async failJob(jobId: number, code: string, retryAt: Date | null): Promise<boolean> {
    const failed = result(await this.pool.query(
      `UPDATE image_processing_jobs
       SET status = ?, available_at = COALESCE(?, available_at), locked_at = NULL, last_error_code = ?
       WHERE id = ? AND status = 'processing'`,
      [retryAt ? 'queued' : 'failed', retryAt, code, jobId],
    ));
    return (failed.affectedRows ?? 0) === 1;
  }

  async markAssetDegraded(assetId: string, code: string): Promise<boolean> {
    const degraded = result(await this.pool.query(
      "UPDATE image_assets SET status = 'degraded', error_code = ? WHERE id = ? AND status IN ('processing', 'degraded')",
      [code, assetId],
    ));
    return (degraded.affectedRows ?? 0) === 1;
  }

  async listExpiredUploadSessions(now: Date, limit: number): Promise<UploadSessionRecord[]> {
    return rows(await this.pool.query(
      `SELECT * FROM image_upload_sessions
       WHERE status IN ('open', 'expired') AND expires_at <= ? AND quarantine_cleaned_at IS NULL
       ORDER BY expires_at LIMIT ?`,
      [now, limit],
    )).map(mapUploadSession);
  }

  async expireUploadSession(sessionId: string): Promise<void> {
    await this.pool.query("UPDATE image_upload_sessions SET status = 'expired' WHERE id = ? AND status = 'open'", [sessionId]);
  }

  async completeExpiredUploadCleanup(sessionId: string, cleanedAt: Date): Promise<boolean> {
    const cleaned = result(await this.pool.query(
      `UPDATE image_upload_sessions SET status = 'expired', quarantine_cleaned_at = ?
       WHERE id = ? AND status IN ('open', 'expired') AND quarantine_cleaned_at IS NULL`,
      [cleanedAt, sessionId],
    ));
    return (cleaned.affectedRows ?? 0) === 1;
  }

  async listPendingAssetUploadSessions(assetId: string): Promise<UploadSessionRecord[]> {
    return rows(await this.pool.query(
      `SELECT * FROM image_upload_sessions
       WHERE asset_id = ? AND status = 'finalized' AND quarantine_cleaned_at IS NULL
       ORDER BY updated_at, id`,
      [assetId],
    )).map(mapUploadSession);
  }

  async markUploadSessionQuarantineCleaned(sessionId: string, cleanedAt: Date): Promise<boolean> {
    const cleaned = result(await this.pool.query(
      `UPDATE image_upload_sessions SET quarantine_cleaned_at = ?
       WHERE id = ? AND status = 'finalized' AND quarantine_cleaned_at IS NULL`,
      [cleanedAt, sessionId],
    ));
    return (cleaned.affectedRows ?? 0) === 1;
  }

  async replaceCompanyImage(companyId: number, role: CompanyImageRole, assetId: string | null): Promise<void> {
    await this.inTransaction(async (connection) => {
      const linked = rows(await connection.query(
        'SELECT asset_id FROM company_image_assets WHERE company_id = ? AND role = ? FOR UPDATE',
        [companyId, role],
      ));
      const previousAssetId = linked[0]?.asset_id == null ? null : String(linked[0].asset_id);
      if (previousAssetId === assetId) return;
      await this.lockReadyTargets(connection, [previousAssetId, assetId], assetId ? [assetId] : []);

      if (assetId) {
        await connection.query(
          `INSERT INTO company_image_assets (company_id, role, asset_id) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE asset_id = VALUES(asset_id)`,
          [companyId, role, assetId],
        );
        await connection.query("UPDATE image_assets SET ref_count = ref_count + 1, status = 'ready', recycled_at = NULL, purge_after = NULL WHERE id = ?", [assetId]);
      } else {
        await connection.query('DELETE FROM company_image_assets WHERE company_id = ? AND role = ?', [companyId, role]);
      }
      if (previousAssetId) await this.decrementReference(connection, previousAssetId);
    });
  }

  async attachProductImages(productId: number, assetIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(assetIds)];
    if (uniqueIds.length === 0) return;
    await this.inTransaction((connection) => this.attachProductImagesInTransaction(connection, productId, uniqueIds));
  }

  async createProductWithImages(input: ProductWriteRecord, assetIds: string[]): Promise<ProductRecord> {
    return this.inTransaction(async (connection) => {
      const createdAt = new Date();
      const inserted = result(await connection.query(
        'INSERT INTO products (item_no, product_name, composition, weight, width, image_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
        [input.itemNo, input.productName, input.composition, input.weight, input.width, createdAt, createdAt],
      ));
      const productId = Number((inserted as Result & { insertId?: number }).insertId);
      if (!Number.isSafeInteger(productId) || productId <= 0) throw new Error('Product insert did not return an ID');
      await this.attachProductImagesInTransaction(connection, productId, [...new Set(assetIds)]);
      return {
        id: productId,
        item_no: input.itemNo,
        product_name: input.productName,
        composition: input.composition,
        weight: input.weight,
        width: input.width,
        image_count: new Set(assetIds).size,
        created_at: createdAt,
        updated_at: createdAt,
      };
    });
  }

  async updateProductWithImages(productId: number, input: ProductWriteRecord, assetIds: string[]): Promise<ProductRecord | null> {
    return this.inTransaction(async (connection) => {
      const products = rows(await connection.query('SELECT * FROM products WHERE id = ? FOR UPDATE', [productId]));
      if (!products[0]) return null;
      const updatedAt = new Date();
      await connection.query(
        'UPDATE products SET item_no = ?, product_name = ?, composition = ?, weight = ?, width = ?, updated_at = ? WHERE id = ?',
        [input.itemNo, input.productName, input.composition, input.weight, input.width, updatedAt, productId],
      );
      await this.attachProductImagesInTransaction(connection, productId, [...new Set(assetIds)]);
      const count = rows(await connection.query(
        'SELECT COUNT(*) AS image_count FROM product_image_assets WHERE product_id = ? AND deleted_at IS NULL',
        [productId],
      ));
      return {
        ...mapProduct(products[0]),
        item_no: input.itemNo,
        product_name: input.productName,
        composition: input.composition,
        weight: input.weight,
        width: input.width,
        image_count: Number(count[0]?.image_count ?? 0),
        updated_at: updatedAt,
      };
    });
  }

  async listProductsPage(limit: number, offset: number): Promise<ProductRecord[]> {
    return rows(await this.pool.query('SELECT * FROM products ORDER BY updated_at DESC LIMIT ? OFFSET ?', [limit, offset])).map(mapProduct);
  }

  async findProductIdsByItemNos(itemNos: string[]): Promise<number[]> {
    if (itemNos.length === 0) return [];
    const placeholders = itemNos.map(() => '?').join(', ');
    return rows(await this.pool.query(`SELECT id FROM products WHERE item_no IN (${placeholders})`, itemNos)).map((row) => Number(row.id));
  }

  async getProductRecord(productId: number): Promise<ProductRecord | null> {
    const products = rows(await this.pool.query('SELECT * FROM products WHERE id = ?', [productId]));
    return products[0] ? mapProduct(products[0]) : null;
  }

  async listProductImageAssociations(productIds: number[], primaryOnly: boolean): Promise<ProductAssetAssociationRecord[]> {
    if (productIds.length === 0) return [];
    const placeholders = productIds.map(() => '?').join(', ');
    const primaryClause = primaryOnly ? ' AND pia.is_primary = 1' : '';
    return rows(await this.pool.query(
      `SELECT pia.product_id, pia.asset_id, pia.sort_order, pia.role, pia.is_primary
       FROM product_image_assets pia
       WHERE pia.product_id IN (${placeholders}) AND pia.deleted_at IS NULL${primaryClause}
       ORDER BY pia.product_id, pia.sort_order, pia.id`,
      productIds,
    )).map((row) => ({
      productId: Number(row.product_id),
      assetId: String(row.asset_id),
      sortOrder: Number(row.sort_order),
      role: row.role as ProductAssetAssociationRecord['role'],
      isPrimary: Boolean(row.is_primary),
    }));
  }

  async listLegacyProductImages(productIds: number[], primaryOnly: boolean): Promise<LegacyProductImageRecord[]> {
    if (productIds.length === 0) return [];
    const placeholders = productIds.map(() => '?').join(', ');
    const limitClause = primaryOnly
      ? ` AND pi.sort_order = (SELECT MIN(pi2.sort_order) FROM product_images pi2 WHERE pi2.product_id = pi.product_id)`
      : '';
    return rows(await this.pool.query(
      `SELECT pi.product_id, pi.id, pi.sort_order FROM product_images pi
       WHERE pi.product_id IN (${placeholders})${limitClause}
       ORDER BY pi.product_id, pi.sort_order, pi.id`,
      productIds,
    )).map((row) => ({ productId: Number(row.product_id), id: Number(row.id), sortOrder: Number(row.sort_order) }));
  }

  private async attachProductImagesInTransaction(connection: AssetTransaction, productId: number, uniqueIds: string[]): Promise<void> {
    if (uniqueIds.length === 0) {
      await this.recomputeProductImageCount(connection, productId);
      return;
    }
      const existing = rows(await connection.query(
        `SELECT id, asset_id, sort_order FROM product_image_assets
         WHERE product_id = ? AND deleted_at IS NULL ORDER BY sort_order, id FOR UPDATE`,
        [productId],
      ));
      const existingIds = new Set(existing.map((row) => String(row.asset_id)));
      const newIds = uniqueIds.filter((assetId) => !existingIds.has(assetId));
      if (existing.length + newIds.length > MAX_PRODUCT_IMAGE_ASSOCIATIONS) {
        throw new ImageAssetError('IMAGE_LIMIT_EXCEEDED', 413, false, `A product may have at most ${MAX_PRODUCT_IMAGE_ASSOCIATIONS} active images`);
      }
      await this.lockReadyTargets(connection, newIds, newIds);
      let nextSortOrder = existing.reduce((maximum, row) => Math.max(maximum, Number(row.sort_order)), -1) + 1;
      let hasPrimary = existing.length > 0;
      for (const assetId of newIds) {
        const role = hasPrimary ? 'gallery' : 'pattern_original';
        const isPrimary = hasPrimary ? 0 : 1;
        await connection.query(
          `INSERT INTO product_image_assets (product_id, asset_id, role, sort_order, is_primary, deleted_at)
           VALUES (?, ?, ?, ?, ?, NULL)
           ON DUPLICATE KEY UPDATE role = VALUES(role), sort_order = VALUES(sort_order), is_primary = VALUES(is_primary), deleted_at = NULL`,
          [productId, assetId, role, nextSortOrder++, isPrimary],
        );
        await connection.query("UPDATE image_assets SET ref_count = ref_count + 1, status = 'ready', recycled_at = NULL, purge_after = NULL WHERE id = ?", [assetId]);
        hasPrimary = true;
      }
      await this.recomputeProductImageCount(connection, productId);
  }

  async detachProductImage(productId: number, assetId: string): Promise<void> {
    await this.inTransaction(async (connection) => {
      const linked = rows(await connection.query(
        'SELECT id, asset_id, sort_order FROM product_image_assets WHERE product_id = ? AND deleted_at IS NULL ORDER BY sort_order, id FOR UPDATE',
        [productId],
      ));
      const target = linked.find((row) => String(row.asset_id) === assetId);
      await this.lockReadyTargets(connection, [assetId], []);
      if (!target) return;
      await connection.query('UPDATE product_image_assets SET deleted_at = NOW() WHERE id = ?', [target.id]);
      await this.decrementReference(connection, assetId);
      const remaining = linked.filter((row) => row.id !== target.id);
      for (const [index, row] of remaining.entries()) {
        await connection.query(
          'UPDATE product_image_assets SET role = ?, is_primary = ? WHERE id = ?',
          [index === 0 ? 'pattern_original' : 'gallery', index === 0 ? 1 : 0, row.id],
        );
      }
      await this.recomputeProductImageCount(connection, productId);
    });
  }

  async detachAllProductImages(productId: number): Promise<void> {
    await this.inTransaction(async (connection) => {
      const linked = rows(await connection.query(
        'SELECT id, asset_id FROM product_image_assets WHERE product_id = ? AND deleted_at IS NULL FOR UPDATE',
        [productId],
      ));
      const assetIds = linked.map((row) => String(row.asset_id));
      if (assetIds.length === 0) return;
      await this.lockReadyTargets(connection, assetIds, []);
      await connection.query('UPDATE product_image_assets SET deleted_at = NOW() WHERE product_id = ? AND deleted_at IS NULL', [productId]);
      for (const linkedAssetId of assetIds) await this.decrementReference(connection, linkedAssetId);
      await this.recomputeProductImageCount(connection, productId);
    });
  }

  async deleteProductWithAssets(productId: number): Promise<boolean> {
    return this.inTransaction(async (connection) => {
      const products = rows(await connection.query('SELECT id FROM products WHERE id = ? FOR UPDATE', [productId]));
      if (!products[0]) return false;
      const linked = rows(await connection.query(
        'SELECT id, asset_id FROM product_image_assets WHERE product_id = ? AND deleted_at IS NULL FOR UPDATE',
        [productId],
      ));
      const assetIds = linked.map((row) => String(row.asset_id));
      if (assetIds.length > 0) await this.lockReadyTargets(connection, assetIds, []);
      await connection.query('DELETE FROM product_images WHERE product_id = ?', [productId]);
      await connection.query('DELETE FROM products WHERE id = ?', [productId]);
      for (const assetId of assetIds) await this.decrementReference(connection, assetId);
      return true;
    });
  }

  async recycleExpiredUnlinkedAssets(now: Date, limit: number): Promise<number> {
    const updated = result(await this.pool.query(
      `UPDATE image_assets SET status = 'recycled', recycled_at = ?, purge_after = DATE_ADD(?, INTERVAL 30 DAY)
       WHERE status = 'ready' AND ref_count = 0 AND created_at <= DATE_SUB(?, INTERVAL 1 DAY)
       ORDER BY created_at LIMIT ?`,
      [now, now, now, limit],
    ));
    return updated.affectedRows ?? 0;
  }

  async listPurgeCandidates(now: Date, limit: number): Promise<ImageAssetRecord[]> {
    return rows(await this.pool.query(
      "SELECT * FROM image_assets WHERE status = 'recycled' AND ref_count = 0 AND purge_after <= ? ORDER BY purge_after LIMIT ?",
      [now, limit],
    )).map(mapAsset);
  }

  async claimNextPurgeCandidate(now: Date): Promise<PurgeClaim | null> {
    return this.inTransaction(async (connection) => {
      const candidates = rows(await connection.query(
        `SELECT id FROM image_assets
         WHERE status = 'recycled' AND ref_count = 0 AND purge_after <= ?
         ORDER BY purge_after, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [now],
      ));
      if (!candidates[0]) return null;
      const assetId = String(candidates[0].id);
      const claimed = result(await connection.query(
        `UPDATE image_assets SET status = 'purging'
         WHERE id = ? AND status = 'recycled' AND ref_count = 0 AND purge_after <= ?`,
        [assetId, now],
      ));
      if ((claimed.affectedRows ?? 0) !== 1) return null;
      const variants = rows(await connection.query(
        'SELECT * FROM image_asset_variants WHERE asset_id = ? ORDER BY variant FOR UPDATE',
        [assetId],
      )).map(mapVariant);
      return { assetId, variants };
    });
  }

  async releasePurgeClaim(assetId: string): Promise<boolean> {
    const released = result(await this.pool.query(
      "UPDATE image_assets SET status = 'recycled' WHERE id = ? AND status = 'purging' AND ref_count = 0",
      [assetId],
    ));
    return (released.affectedRows ?? 0) === 1;
  }

  async markPurged(assetId: string, at: Date): Promise<void> {
    await this.inTransaction(async (connection) => {
      const found = rows(await connection.query('SELECT status, ref_count, purge_after FROM image_assets WHERE id = ? FOR UPDATE', [assetId]));
      if (!found[0]) return;
      if (found[0].status === 'purged') return;
      if (
        found[0].status !== 'purging'
        || Number(found[0].ref_count) !== 0
        || found[0].purge_after == null
        || date(found[0].purge_after) > at
      ) {
        throw new ImageAssetError('ASSET_NOT_READY', 409, false, 'Asset is not eligible for purge');
      }
      await connection.query('DELETE FROM image_asset_variants WHERE asset_id = ?', [assetId]);
      const updated = result(await connection.query(
        `UPDATE image_assets SET status = 'purged', purged_at = ?, error_code = NULL
         WHERE id = ? AND status = 'purging' AND ref_count = 0 AND purge_after <= ?`,
        [at, assetId, at],
      ));
      if ((updated.affectedRows ?? 0) !== 1) {
        throw new ImageAssetError('ASSET_NOT_READY', 409, false, 'Asset is not eligible for purge');
      }
    });
  }

  async reconcileReferenceCounts(): Promise<number> {
    const update = result(await this.pool.query(`
      UPDATE image_assets assets
      LEFT JOIN (
        SELECT asset_id, COUNT(*) AS references_count
        FROM (
          SELECT asset_id FROM company_image_assets
          UNION ALL
          SELECT asset_id FROM product_image_assets WHERE deleted_at IS NULL
        ) links
        GROUP BY asset_id
      ) counts ON counts.asset_id = assets.id
      SET assets.ref_count = COALESCE(counts.references_count, 0),
          assets.status = CASE
            WHEN COALESCE(counts.references_count, 0) = 0 AND assets.status = 'ready' THEN 'recycled'
            WHEN COALESCE(counts.references_count, 0) > 0 AND assets.status = 'recycled' THEN 'ready'
            ELSE assets.status
          END,
          assets.recycled_at = CASE
            WHEN COALESCE(counts.references_count, 0) = 0 AND assets.status = 'ready' THEN NOW()
            WHEN COALESCE(counts.references_count, 0) > 0 THEN NULL
            ELSE assets.recycled_at
          END,
          assets.purge_after = CASE
            WHEN COALESCE(counts.references_count, 0) = 0 AND assets.status = 'ready' THEN DATE_ADD(NOW(), INTERVAL 30 DAY)
            WHEN COALESCE(counts.references_count, 0) > 0 THEN NULL
            ELSE assets.purge_after
          END
    `));
    return update.affectedRows ?? 0;
  }

  async recoverStaleJobs(now: Date): Promise<number> {
    const updated = result(await this.pool.query(
      "UPDATE image_processing_jobs SET status = 'queued', locked_at = NULL WHERE status = 'processing' AND locked_at <= DATE_SUB(?, INTERVAL 5 MINUTE)",
      [now],
    ));
    return updated.affectedRows ?? 0;
  }

  async listOrphanCandidates(now: Date, limit: number): Promise<ImageAssetRecord[]> {
    return rows(await this.pool.query(
      "SELECT * FROM image_assets WHERE ref_count = 0 AND status = 'recycled' AND purge_after <= ? ORDER BY purge_after LIMIT ?",
      [now, limit],
    )).map(mapAsset);
  }

  async listReconciliationCandidates(limit: number): Promise<ReconciliationCandidate[]> {
    const assetRows = rows(await this.pool.query(
      "SELECT * FROM image_assets WHERE status NOT IN ('purged', 'purging', 'quarantine') ORDER BY created_at LIMIT ?",
      [limit],
    ));
    if (assetRows.length === 0) return [];
    const assets = assetRows.map(mapAsset);
    const ids = assets.map((asset) => asset.id);
    const placeholders = ids.map(() => '?').join(', ');
    const variantRows = rows(await this.pool.query(
      'SELECT * FROM image_asset_variants WHERE asset_id IN (' + placeholders + ') ORDER BY variant',
      ids,
    )).map(mapVariant);
    const byAsset = new Map<string, AssetVariantRecord[]>();
    for (const variant of variantRows) {
      const list = byAsset.get(variant.assetId) ?? [];
      list.push(variant);
      byAsset.set(variant.assetId, list);
    }
    return assets.map((asset) => ({ asset, variants: byAsset.get(asset.id) ?? [] }));
  }

  async markAssetObjectMissing(assetId: string, code: string): Promise<boolean> {
    const updated = result(await this.pool.query(
      "UPDATE image_assets SET status = 'degraded', error_code = ? WHERE id = ? AND status NOT IN ('purged', 'purging', 'quarantine')",
      [code, assetId],
    ));
    return (updated.affectedRows ?? 0) === 1;
  }

  private async lockReadyTargets(connection: AssetTransaction, assetIds: Array<string | null>, requiredReadyIds: string[]): Promise<void> {
    const ids = [...new Set(assetIds.filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return;
    const locked = rows(await connection.query(
      `SELECT id, status, ref_count FROM image_assets WHERE id IN (${ids.map(() => '?').join(', ')}) FOR UPDATE`,
      ids,
    ));
    const byId = new Map(locked.map((asset) => [String(asset.id), asset]));
    if (locked.length !== ids.length) throw new ImageAssetError('ASSET_NOT_FOUND', 404, false, 'Linked asset not found');
    if (requiredReadyIds.some((id) => byId.get(id)?.status !== 'ready')) {
      throw new ImageAssetError('ASSET_NOT_READY', 409, false, 'Asset must be ready before linking');
    }
  }

  private async decrementReference(connection: AssetTransaction, assetId: string): Promise<void> {
    await connection.query('UPDATE image_assets SET ref_count = ref_count - 1 WHERE id = ? AND ref_count > 1', [assetId]);
    await connection.query(
      "UPDATE image_assets SET ref_count = ref_count - 1, status = 'recycled', recycled_at = NOW(), purge_after = DATE_ADD(NOW(), INTERVAL 30 DAY) WHERE id = ? AND ref_count = 1",
      [assetId],
    );
  }

  private async recomputeProductImageCount(connection: AssetTransaction, productId: number): Promise<void> {
    const counted = rows(await connection.query(
      'SELECT COUNT(*) AS image_count FROM product_image_assets WHERE product_id = ? AND deleted_at IS NULL',
      [productId],
    ));
    await connection.query('UPDATE products SET image_count = ? WHERE id = ?', [Number(counted[0]?.image_count ?? 0), productId]);
  }

  private async inTransaction<T>(work: (connection: AssetTransaction) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    await connection.beginTransaction();
    try {
      const value = await work(connection);
      await connection.commit();
      return value;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

function mergePurpose(existing: ImageAssetRecord['purpose'] | undefined, incoming: ImageAssetRecord['purpose']): ImageAssetRecord['purpose'] {
  if (existing === 'product_image' || incoming === 'product_image') return 'product_image';
  return existing ?? incoming;
}
