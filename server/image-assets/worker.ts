import { ImageAssetError, type ImageAssetErrorCode } from './errors';
import { getAssetPolicy } from './policy';
import { generateImageVariants, type ProcessedVariant } from './processor';
import type { AssetRepository, AssetVariantRecord, ProcessingJob } from './repository';
import { assetObjectKey, type StorageAdapter } from './storage';
import type { ImageAssetRecord, UploadSessionRecord } from './types';
import type { ValidatedImage } from './validator';

const RETRY_DELAYS_MS = [5_000, 30_000, 5 * 60_000];

export interface ImageAssetWorkerOptions {
  now?: () => Date;
}

export class ImageAssetWorker {
  private readonly now: () => Date;

  constructor(
    private readonly repository: AssetRepository,
    private readonly storage: StorageAdapter,
    options: ImageAssetWorkerOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
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
      await this.repository.failJob(job.id, normalized.code, retryAt);
      if (!retryAt || job.attempts >= RETRY_DELAYS_MS.length) {
        await this.repository.markAssetDegraded(job.assetId, normalized.code);
      }
    }
    return true;
  }

  async recycleOnce(limit = 25): Promise<number> {
    return this.repository.recycleExpiredUnlinkedAssets(this.now(), limit);
  }

  async purgeOnce(limit = 25): Promise<number> {
    const now = this.now();
    const candidates = await this.repository.listPurgeCandidates(now, limit);
    let purged = 0;
    for (const candidate of candidates) {
      const current = await this.repository.getAsset(candidate.id);
      if (!isPurgeEligible(current, now)) continue;
      const variants = await this.repository.getVariants(candidate.id);
      for (const variant of variants) {
        if (await storageOperation(() => this.storage.exists(variant.objectKey))) {
          await storageOperation(() => this.storage.delete(variant.objectKey));
        }
        if (await storageOperation(() => this.storage.exists(variant.objectKey))) {
          throw new ImageAssetError('STORAGE_UNAVAILABLE', 503, true, 'Purged image variant still exists');
        }
      }
      await this.repository.markPurged(candidate.id, now);
      purged += 1;
    }
    return purged;
  }

  private async processJob(job: ProcessingJob): Promise<void> {
    const asset = await this.repository.getAsset(job.assetId);
    if (!asset) throw new ImageAssetError('ASSET_NOT_FOUND', 404, false, 'Processing asset not found');
    const policy = getAssetPolicy(asset.purpose);
    const existingVariants = await this.repository.getVariants(asset.id);
    const originalKey = assetObjectKey(asset.sha256, 'original', asset.detectedExtension);
    const originalExists = await storageOperation(() => this.storage.exists(originalKey));
    const session = originalExists ? null : await this.repository.getUploadSession(asset.id);
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

    const quarantine = session ?? await this.repository.getUploadSession(asset.id);
    if (quarantine) {
      if (await storageOperation(() => this.storage.exists(quarantine.quarantineKey))) {
        await storageOperation(() => this.storage.delete(quarantine.quarantineKey));
      }
      if (await storageOperation(() => this.storage.exists(quarantine.quarantineKey))) {
        throw new ImageAssetError('STORAGE_UNAVAILABLE', 503, true, 'Quarantine image still exists');
      }
    }
    await this.repository.completeProcessing(asset.id, records);
  }
}

function requireQuarantineSession(session: UploadSessionRecord | null): UploadSessionRecord {
  if (!session) throw new ImageAssetError('ASSET_PROCESSING_FAILED', 500, true, 'Processing source is unavailable');
  return session;
}

function isPurgeEligible(asset: ImageAssetRecord | null, now: Date): asset is ImageAssetRecord {
  return Boolean(
    asset
    && asset.status === 'recycled'
    && asset.refCount === 0
    && asset.purgeAfter
    && asset.purgeAfter <= now,
  );
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
