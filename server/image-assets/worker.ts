import { ImageAssetError, type ImageAssetErrorCode } from './errors';
import { safeLogLine } from './observability';
import { getAssetPolicy } from './policy';
import { generateImageVariants, type ProcessedVariant } from './processor';
import type { AssetRepository, AssetVariantRecord, ProcessingJob, ReconciliationCursor } from './repository';
import { assetObjectKey, type StorageAdapter } from './storage';
import type { UploadSessionRecord } from './types';
import type { ValidatedImage } from './validator';

const RETRY_DELAYS_MS = [5_000, 30_000, 5 * 60_000];

export interface ImageAssetWorkerOptions {
  now?: () => Date;
  log?: (line: string) => void;
}

export interface ReconciliationSummary {
  refCountDrift: number;
  missingObjects: number;
  orphanCandidates: number;
  elapsedMs: number;
}

export interface WorkerMaintenanceTarget {
  runOnce(): Promise<boolean>;
  recycleOnce(limit?: number): Promise<number>;
  cleanupExpiredUploadsOnce(limit?: number): Promise<number>;
  purgeOnce(limit?: number): Promise<number>;
}

export async function runWorkerMaintenanceCycle(worker: WorkerMaintenanceTarget, maxJobs = 10): Promise<void> {
  for (let index = 0; index < maxJobs; index += 1) {
    const didWork = await worker.runOnce();
    if (!didWork) break;
  }
  await worker.recycleOnce();
  await worker.cleanupExpiredUploadsOnce();
  await worker.purgeOnce();
}

export class ImageAssetWorker {
  private readonly now: () => Date;
  private readonly log: ((line: string) => void) | undefined;
  private reconcileCursor: ReconciliationCursor | null = null;

  constructor(
    private readonly repository: AssetRepository,
    private readonly storage: StorageAdapter,
    options: ImageAssetWorkerOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.log = options.log;
  }

  async runOnce(): Promise<boolean> {
    const claimedAt = this.now();
    const job = await this.repository.claimNextJob(claimedAt);
    if (!job) return false;
    try {
      await this.processJob(job);
    } catch (error) {
      const current = await this.repository.getAsset(job.assetId);
      if (current?.status === 'ready') return true;
      const normalized = normalizeProcessingError(error);
      const retryAt = normalized.retryable && job.attempts <= RETRY_DELAYS_MS.length
        ? new Date(claimedAt.getTime() + RETRY_DELAYS_MS[job.attempts - 1])
        : null;
      const transitioned = await this.repository.failJob(job.id, normalized.code, retryAt);
      if (!transitioned) return true;
      if (!retryAt || job.attempts >= RETRY_DELAYS_MS.length) {
        await this.repository.markAssetDegraded(job.assetId, normalized.code);
      }
    }
    return true;
  }

  async recycleOnce(limit = 25): Promise<number> {
    return this.repository.recycleExpiredUnlinkedAssets(this.now(), limit);
  }

  async cleanupExpiredUploadsOnce(limit = 25): Promise<number> {
    const now = this.now();
    const sessions = await this.repository.listExpiredUploadSessions(now, limit);
    let cleaned = 0;
    for (const session of sessions) {
      await this.deleteAndConfirm(session.quarantineKey, 'Expired quarantine image still exists');
      if (await this.repository.completeExpiredUploadCleanup(session.id, now)) cleaned += 1;
    }
    return cleaned;
  }

  async purgeOnce(limit = 25): Promise<number> {
    const now = this.now();
    let purged = 0;
    for (let index = 0; index < limit; index += 1) {
      const claim = await this.repository.claimNextPurgeCandidate(now);
      if (!claim) break;
      try {
        for (const variant of claim.variants) {
          if (await storageOperation(() => this.storage.exists(variant.objectKey))) {
            await storageOperation(() => this.storage.delete(variant.objectKey));
          }
          if (await storageOperation(() => this.storage.exists(variant.objectKey))) {
            throw new ImageAssetError('STORAGE_UNAVAILABLE', 503, true, 'Purged image variant still exists');
          }
        }
        await this.repository.markPurged(claim.assetId, now);
        purged += 1;
      } catch (error) {
        await this.repository.releasePurgeClaim(claim.assetId);
        throw error;
      }
    }
    return purged;
  }

  async recoverStaleJobs(): Promise<number> {
    return this.repository.recoverStaleJobs(this.now());
  }

  async reconcileOnce(limit = 100): Promise<ReconciliationSummary> {
    const startedAt = this.now().getTime();
    const refCountDrift = await this.repository.reconcileReferenceCounts();
    const orphanCandidates = (await this.repository.listOrphanCandidates(this.now(), limit)).length;
    const candidates = await this.repository.listReconciliationCandidates(this.reconcileCursor, limit);
    let missingObjects = 0;
    for (const candidate of candidates) {
      let missing = false;
      for (const variant of candidate.variants) {
        if (!await storageOperation(() => this.storage.exists(variant.objectKey))) {
          missing = true;
          break;
        }
      }
      if (missing && await this.repository.markAssetObjectMissing(candidate.asset.id, 'ASSET_NOT_FOUND')) {
        missingObjects += 1;
      }
    }
    if (candidates.length > 0) {
      const last = candidates[candidates.length - 1].asset;
      this.reconcileCursor = { createdAt: last.createdAt, id: last.id };
    } else {
      this.reconcileCursor = null;
    }
    const elapsedMs = this.now().getTime() - startedAt;
    const summary: ReconciliationSummary = { refCountDrift, missingObjects, orphanCandidates, elapsedMs };
    this.logSafe({ stage: 'reconciliation', ...summary });
    return summary;
  }

  private async processJob(job: ProcessingJob): Promise<void> {
    const asset = await this.repository.getAsset(job.assetId);
    if (!asset) throw new ImageAssetError('ASSET_NOT_FOUND', 404, false, 'Processing asset not found');
    const policy = getAssetPolicy(asset.purpose);
    const existingVariants = await this.repository.getVariants(asset.id);
    const pendingSessions = await this.repository.listPendingAssetUploadSessions(asset.id);
    const originalKey = assetObjectKey(asset.sha256, 'original', asset.detectedExtension);
    const originalExists = await storageOperation(() => this.storage.exists(originalKey));
    const session = originalExists ? null : pendingSessions[0] ?? await this.repository.getUploadSession(asset.id);
    const sourceKey = originalExists ? originalKey : requireQuarantineSession(session).quarantineKey;
    const original = await storageOperation(() => this.storage.read(sourceKey, policy.maxBytes + 1));
    const validated: ValidatedImage = {
      mime: asset.detectedMime,
      extension: asset.detectedExtension,
      width: asset.width,
      height: asset.height,
      byteSize: asset.byteSize,
      sha256: asset.sha256,
    };

    let processed: ProcessedVariant[];
    try {
      processed = await generateImageVariants(original, validated, policy);
    } catch {
      throw new ImageAssetError('ASSET_PROCESSING_FAILED', 500, true, 'Image variant processing failed');
    }

    const createdAt = this.now();
    const records: AssetVariantRecord[] = [];
    for (const variant of processed) {
      const objectKey = assetObjectKey(asset.sha256, variant.variant, variant.extension);
      const existed = await storageOperation(() => this.storage.exists(objectKey));
      if (!existed) {
        await storageOperation(() => this.storage.put(objectKey, variant.body, variant.mime));
      }
      if (!await storageOperation(() => this.storage.exists(objectKey))) {
        throw new ImageAssetError('STORAGE_UNAVAILABLE', 503, true, 'Stored image variant could not be confirmed');
      }
      const existing = existed
        ? existingVariants.find((candidate) => candidate.variant === variant.variant && candidate.objectKey === objectKey)
        : undefined;
      records.push(existing ?? {
        assetId: asset.id,
        variant: variant.variant,
        objectKey,
        mime: variant.mime,
        byteSize: variant.byteSize,
        width: variant.width,
        height: variant.height,
        createdAt,
      });
    }

    for (const quarantine of pendingSessions) {
      await this.deleteAndConfirm(quarantine.quarantineKey, 'Quarantine image still exists');
      await this.repository.markUploadSessionQuarantineCleaned(quarantine.id, this.now());
    }
    await this.repository.completeProcessing(asset.id, records);
  }

  private async deleteAndConfirm(objectKey: string, message: string): Promise<void> {
    if (await storageOperation(() => this.storage.exists(objectKey))) {
      await storageOperation(() => this.storage.delete(objectKey));
    }
    if (await storageOperation(() => this.storage.exists(objectKey))) {
      throw new ImageAssetError('STORAGE_UNAVAILABLE', 503, true, message);
    }
  }

  private logSafe(entry: Record<string, unknown>): void {
    if (this.log) this.log(safeLogLine(entry));
  }
}

function requireQuarantineSession(session: UploadSessionRecord | null): UploadSessionRecord {
  if (!session) throw new ImageAssetError('ASSET_PROCESSING_FAILED', 500, true, 'Processing source is unavailable');
  return session;
}

async function storageOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ImageAssetError) throw error;
    throw new ImageAssetError('STORAGE_UNAVAILABLE', 503, true, 'Storage operation failed');
  }
}

function normalizeProcessingError(error: unknown): { code: ImageAssetErrorCode; retryable: boolean } {
  if (error instanceof ImageAssetError) return { code: error.code, retryable: error.retryable };
  return { code: 'ASSET_PROCESSING_FAILED', retryable: true };
}
