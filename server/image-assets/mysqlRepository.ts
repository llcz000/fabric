import { ImageAssetError } from './errors';
import { getAssetPolicy } from './policy';
import type {
  AssetRepository,
  AssetTransaction,
  AssetVariantRecord,
  FinalizedUpload,
  NewUploadSession,
  ProcessingJob,
} from './repository';
import type { AssetStatus, CompanyImageRole, ImageAssetRecord, UploadSessionRecord } from './types';

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

  async finalizeUploadSession(input: FinalizedUpload): Promise<{ assetId: string; jobCreated: boolean }> {
    const finalized = await this.inTransaction(async (connection) => {
      const sessionRows = rows(await connection.query(
        'SELECT * FROM image_upload_sessions WHERE id = ? FOR UPDATE',
        [input.sessionId],
      ));
      const session = sessionRows[0] ? mapUploadSession(sessionRows[0]) : null;
      if (!session) throw new ImageAssetError('ASSET_NOT_FOUND', 404, false, 'Upload session not found');
      if (session.createdBy !== input.principalId) throw new ImageAssetError('ASSET_ACCESS_DENIED', 403, false, 'Upload session belongs to another principal');
      if (session.status === 'finalized' && session.assetId) return { assetId: session.assetId, jobCreated: false };
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
      const assetId = existing?.id ?? input.assetId ?? input.sessionId;
      let jobCreated = false;
      let needsProcessing = !existing || existing.status === 'processing' || existing.status === 'degraded';

      if (!existing) {
        await connection.query(
          `INSERT INTO image_assets
            (id, sha256, original_filename, detected_mime, detected_extension, purpose, storage_provider,
             byte_size, width, height, status, ref_count, created_by, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', 0, ?, ?)`,
          [assetId, input.sha256, input.originalFilename, input.detectedMime, input.detectedExtension, session.purpose,
            input.storageProvider, input.byteSize, input.width, input.height, input.principalId, JSON.stringify(input.metadata ?? {})],
        );
      } else if (existing.status === 'recycled') {
        const variants = rows(await connection.query(
          'SELECT variant FROM image_asset_variants WHERE asset_id = ?',
          [assetId],
        ));
        const availableVariants = new Set(variants.map((variant) => String(variant.variant)));
        const hasRequiredVariants = getAssetPolicy(existing.purpose).variants.every((variant) => availableVariants.has(variant));
        await connection.query(
          "UPDATE image_assets SET created_by = ?, created_at = NOW(), status = ?, recycled_at = NULL, purge_after = NULL, purged_at = NULL, error_code = NULL WHERE id = ?",
          [input.principalId, hasRequiredVariants ? 'ready' : 'processing', assetId],
        );
        needsProcessing = !hasRequiredVariants;
      }

      if (needsProcessing) {
        const inserted = result(await connection.query(
          `INSERT IGNORE INTO image_processing_jobs (asset_id, job_type, status, attempts, available_at)
           VALUES (?, 'process_asset', 'queued', 0, NOW())`,
          [assetId],
        ));
        jobCreated = (inserted.affectedRows ?? 0) > 0;
      }

      await connection.query(
        "UPDATE image_upload_sessions SET status = 'finalized', asset_id = ? WHERE id = ?",
        [assetId, input.sessionId],
      );
      return { assetId, jobCreated };
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

  async failJob(jobId: number, code: string, retryAt: Date | null): Promise<void> {
    await this.pool.query(
      `UPDATE image_processing_jobs
       SET status = ?, available_at = COALESCE(?, available_at), locked_at = NULL, last_error_code = ?
       WHERE id = ? AND status = 'processing'`,
      [retryAt ? 'queued' : 'failed', retryAt, code, jobId],
    );
  }

  async markAssetDegraded(assetId: string, code: string): Promise<void> {
    await this.pool.query("UPDATE image_assets SET status = 'degraded', error_code = ? WHERE id = ?", [code, assetId]);
  }

  async listExpiredUploadSessions(now: Date, limit: number): Promise<UploadSessionRecord[]> {
    return rows(await this.pool.query(
      "SELECT * FROM image_upload_sessions WHERE status = 'open' AND expires_at <= ? ORDER BY expires_at LIMIT ?",
      [now, limit],
    )).map(mapUploadSession);
  }

  async expireUploadSession(sessionId: string): Promise<void> {
    await this.pool.query("UPDATE image_upload_sessions SET status = 'expired' WHERE id = ? AND status = 'open'", [sessionId]);
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
    await this.inTransaction(async (connection) => {
      const placeholders = uniqueIds.map(() => '?').join(', ');
      const existing = rows(await connection.query(
        `SELECT asset_id FROM product_image_assets WHERE product_id = ? AND asset_id IN (${placeholders}) AND deleted_at IS NULL FOR UPDATE`,
        [productId, ...uniqueIds],
      ));
      const existingIds = new Set(existing.map((row) => String(row.asset_id)));
      await this.lockReadyTargets(connection, uniqueIds, uniqueIds);
      for (const [index, assetId] of uniqueIds.entries()) {
        await connection.query(
          `INSERT INTO product_image_assets (product_id, asset_id, role, sort_order, is_primary, deleted_at)
           VALUES (?, ?, 'gallery', ?, ?, NULL)
           ON DUPLICATE KEY UPDATE deleted_at = NULL`,
          [productId, assetId, index, index === 0 ? 1 : 0],
        );
        if (!existingIds.has(assetId)) {
          await connection.query("UPDATE image_assets SET ref_count = ref_count + 1, status = 'ready', recycled_at = NULL, purge_after = NULL WHERE id = ?", [assetId]);
        }
      }
    });
  }

  async detachProductImage(productId: number, assetId: string): Promise<void> {
    await this.inTransaction(async (connection) => {
      const linked = rows(await connection.query(
        'SELECT id FROM product_image_assets WHERE product_id = ? AND asset_id = ? AND deleted_at IS NULL FOR UPDATE',
        [productId, assetId],
      ));
      await this.lockReadyTargets(connection, [assetId], []);
      if (!linked[0]) return;
      await connection.query('UPDATE product_image_assets SET deleted_at = NOW() WHERE id = ?', [linked[0].id]);
      await this.decrementReference(connection, assetId);
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

  async markPurged(assetId: string, at: Date): Promise<void> {
    await this.inTransaction(async (connection) => {
      const found = rows(await connection.query('SELECT status, ref_count, purge_after FROM image_assets WHERE id = ? FOR UPDATE', [assetId]));
      if (!found[0]) return;
      if (found[0].status === 'purged') return;
      if (
        found[0].status !== 'recycled'
        || Number(found[0].ref_count) !== 0
        || found[0].purge_after == null
        || date(found[0].purge_after) > at
      ) {
        throw new ImageAssetError('ASSET_NOT_READY', 409, false, 'Asset is not eligible for purge');
      }
      await connection.query('DELETE FROM image_asset_variants WHERE asset_id = ?', [assetId]);
      const updated = result(await connection.query(
        `UPDATE image_assets SET status = 'purged', purged_at = ?, error_code = NULL
         WHERE id = ? AND status = 'recycled' AND ref_count = 0 AND purge_after <= ?`,
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
