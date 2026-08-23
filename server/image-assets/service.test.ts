import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { ImageAssetError } from './errors';
import { getAssetPolicy } from './policy';
import type {
  AssetRepository,
  AssetVariantRecord,
  FinalizedUpload,
  LegacyProductImageRecord,
  NewUploadSession,
  ProcessingJob,
  ProductAssetAssociationRecord,
  ProductRecord,
  ProductWriteRecord,
  ReconciliationCandidate,
} from './repository';
import { ImageAssetService } from './service';
import { assetObjectKey, type StorageAdapter, type UploadGrant } from './storage';
import type {
  CompanyImageRole,
  ImageAssetRecord,
  UploadSessionRecord,
} from './types';
import { ImageAssetWorker } from './worker';
import { redactLogText, safeLogLine } from './observability';
import { validateImageBuffer } from './validator';

const START = new Date('2026-08-22T00:00:00.000Z');
const SHARP_MODULE: string = 'sharp';

class MutableClock {
  constructor(public current = new Date(START)) {}

  now = (): Date => new Date(this.current);

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

class MemoryAssetRepository implements AssetRepository {
  readonly sessions = new Map<string, UploadSessionRecord>();
  readonly assets = new Map<string, ImageAssetRecord>();
  readonly variants = new Map<string, AssetVariantRecord[]>();
  readonly jobs = new Map<number, ProcessingJob>();
  readonly events: string[];
  readonly linkEvents: string[] = [];
  readonly products = new Map<number, ProductRecord>();
  readonly recycleCalls: Array<{ now: Date; limit: number }> = [];
  purgeCandidateIds: string[] = [];
  purgeClaimAllowed = true;
  releasePurgeCalls = 0;
  markPurgedCalls = 0;
  completeProcessingFailures = 0;
  completeOnFailJob = false;
  markDegradedCalls = 0;
  reconcileCounts = 0;
  private nextJobId = 1;

  constructor(private readonly clock: MutableClock, events: string[] = []) {
    this.events = events;
  }

  async createUploadSession(input: NewUploadSession): Promise<UploadSessionRecord> {
    const existing = this.sessions.get(input.id);
    if (existing) return existing;
    const session: UploadSessionRecord = { ...input, status: 'open' };
    this.sessions.set(input.id, session);
    return session;
  }

  async getUploadSession(id: string): Promise<UploadSessionRecord | null> {
    return this.sessions.get(id) ?? null;
  }

  async finalizeUploadSession(input: FinalizedUpload): Promise<{ assetId: string; jobCreated: boolean; processingRequired: boolean }> {
    const session = this.sessions.get(input.sessionId);
    if (!session) throw new ImageAssetError('ASSET_NOT_FOUND', 404, false, 'Upload session not found');
    if (session.createdBy !== input.principalId) {
      throw new ImageAssetError('ASSET_ACCESS_DENIED', 403, false, 'Upload session belongs to another principal');
    }
    if (session.status === 'finalized' && session.assetId) {
      const asset = this.requireAsset(session.assetId);
      return {
        assetId: session.assetId,
        jobCreated: false,
        processingRequired: asset.status === 'processing' || asset.status === 'degraded',
      };
    }

    let asset = [...this.assets.values()].find((candidate) => candidate.sha256 === input.sha256);
    let jobCreated = false;
    let processingRequired = false;
    if (!asset) {
      const now = this.clock.now();
      asset = {
        id: input.assetId ?? input.sessionId,
        sha256: input.sha256,
        originalFilename: input.originalFilename,
        detectedMime: input.detectedMime,
        detectedExtension: input.detectedExtension,
        purpose: session.purpose,
        storageProvider: input.storageProvider,
        byteSize: input.byteSize,
        width: input.width,
        height: input.height,
        status: 'processing',
        refCount: 0,
        createdBy: input.principalId,
        createdAt: now,
        updatedAt: now,
        metadata: input.metadata,
      };
      this.assets.set(asset.id, asset);
      const job: ProcessingJob = {
        id: this.nextJobId++,
        assetId: asset.id,
        jobType: 'process_asset',
        status: 'queued',
        attempts: 0,
        availableAt: now,
      };
      this.jobs.set(job.id, job);
      jobCreated = true;
      processingRequired = true;
    } else {
      if (asset.status === 'purging' || asset.status === 'purged') {
        throw new ImageAssetError('ASSET_NOT_READY', 409, true, 'Matching asset is being purged');
      }
      const purpose = asset.purpose === 'product_image' || session.purpose === 'product_image'
        ? 'product_image'
        : asset.purpose;
      const available = new Set((this.variants.get(asset.id) ?? []).map((variant) => variant.variant));
      const hasRequiredVariants = getAssetPolicy(purpose).variants.every((variant) => available.has(variant));
      processingRequired = asset.status === 'processing' || asset.status === 'degraded' || !hasRequiredVariants;
      asset.purpose = purpose;
      asset.createdBy = input.principalId;
      asset.createdAt = this.clock.now();
      asset.status = processingRequired ? 'processing' : 'ready';
      asset.recycledAt = undefined;
      asset.purgeAfter = undefined;
      asset.purgedAt = undefined;
      asset.errorCode = undefined;
      if (processingRequired) {
        let job = [...this.jobs.values()].find((candidate) => candidate.assetId === asset.id);
        if (!job) {
          job = {
            id: this.nextJobId++,
            assetId: asset.id,
            jobType: 'process_asset',
            status: 'queued',
            attempts: 0,
            availableAt: this.clock.now(),
          };
          this.jobs.set(job.id, job);
          jobCreated = true;
        } else if (job.status === 'completed' || job.status === 'failed') {
          job.status = 'queued';
          job.attempts = 0;
          job.availableAt = this.clock.now();
          job.lockedAt = undefined;
          job.lastErrorCode = undefined;
          jobCreated = true;
        }
      }
    }

    session.status = 'finalized';
    session.assetId = asset.id;
    return { assetId: asset.id, jobCreated, processingRequired };
  }

  async getAsset(id: string): Promise<ImageAssetRecord | null> {
    return this.assets.get(id) ?? null;
  }

  async getVariants(assetId: string): Promise<AssetVariantRecord[]> {
    this.events.push(`variants:${assetId}`);
    return [...(this.variants.get(assetId) ?? [])];
  }

  async claimNextJob(now: Date): Promise<ProcessingJob | null> {
    const job = [...this.jobs.values()]
      .filter((candidate) => candidate.status === 'queued' && candidate.availableAt <= now)
      .sort((left, right) => left.id - right.id)[0];
    if (!job) return null;
    job.status = 'processing';
    job.attempts += 1;
    job.lockedAt = now;
    return { ...job };
  }

  async completeProcessing(assetId: string, variants: AssetVariantRecord[]): Promise<void> {
    if (this.completeProcessingFailures > 0) {
      this.completeProcessingFailures -= 1;
      throw new Error('database completion failed');
    }
    this.variants.set(assetId, variants.map((variant) => ({ ...variant })));
    const asset = this.requireAsset(assetId);
    asset.status = 'ready';
    asset.errorCode = undefined;
    asset.updatedAt = this.clock.now();
    for (const job of this.jobs.values()) {
      if (job.assetId === assetId) {
        job.status = 'completed';
        job.lockedAt = undefined;
      }
    }
  }

  async failJob(jobId: number, code: string, retryAt: Date | null): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'processing') return false;
    if (this.completeOnFailJob) {
      job.status = 'completed';
      job.lockedAt = undefined;
      const asset = this.requireAsset(job.assetId);
      asset.status = 'ready';
      asset.errorCode = undefined;
      return false;
    }
    job.status = retryAt ? 'queued' : 'failed';
    if (retryAt) job.availableAt = retryAt;
    job.lockedAt = undefined;
    job.lastErrorCode = code;
    return true;
  }

  async markAssetDegraded(assetId: string, code: string): Promise<boolean> {
    const asset = this.requireAsset(assetId);
    if (asset.status !== 'processing' && asset.status !== 'degraded') return false;
    this.markDegradedCalls += 1;
    asset.status = 'degraded';
    asset.errorCode = code as ImageAssetRecord['errorCode'];
    return true;
  }

  async listExpiredUploadSessions(now: Date, limit: number): Promise<UploadSessionRecord[]> {
    return [...this.sessions.values()]
      .filter((session) => (session.status === 'open' || session.status === 'expired')
        && session.expiresAt <= now
        && !(session as UploadSessionRecord & { quarantineCleanedAt?: Date }).quarantineCleanedAt)
      .slice(0, limit);
  }

  async expireUploadSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session?.status === 'open') session.status = 'expired';
  }

  async completeExpiredUploadCleanup(sessionId: string, cleanedAt: Date): Promise<boolean> {
    const session = this.sessions.get(sessionId) as (UploadSessionRecord & { quarantineCleanedAt?: Date }) | undefined;
    if (!session || (session.status !== 'open' && session.status !== 'expired') || session.quarantineCleanedAt) return false;
    session.status = 'expired';
    session.quarantineCleanedAt = cleanedAt;
    this.events.push(`expired-cleaned:${sessionId}`);
    return true;
  }

  async listPendingAssetUploadSessions(assetId: string): Promise<UploadSessionRecord[]> {
    return [...this.sessions.values()]
      .filter((session) => session.assetId === assetId
        && session.status === 'finalized'
        && !session.quarantineCleanedAt);
  }

  async markUploadSessionQuarantineCleaned(sessionId: string, cleanedAt: Date): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'finalized' || session.quarantineCleanedAt) return false;
    session.quarantineCleanedAt = cleanedAt;
    this.events.push(`finalized-cleaned:${sessionId}`);
    return true;
  }

  async replaceCompanyImage(companyId: number, role: CompanyImageRole, assetId: string | null): Promise<void> {
    this.linkEvents.push(`company:${companyId}:${role}:${assetId ?? 'null'}`);
  }

  async attachProductImages(productId: number, assetIds: string[]): Promise<void> {
    this.linkEvents.push(`attach:${productId}:${assetIds.join(',')}`);
  }

  async createProductWithImages(input: ProductWriteRecord, assetIds: string[]): Promise<ProductRecord> {
    const id = Math.max(0, ...this.products.keys()) + 1;
    const product: ProductRecord = { id, item_no: input.itemNo, product_name: input.productName, image_count: assetIds.length };
    this.products.set(id, product);
    this.linkEvents.push(`create-product:${id}:${assetIds.join(',')}`);
    return product;
  }

  async updateProductWithImages(productId: number, input: ProductWriteRecord, assetIds: string[]): Promise<ProductRecord | null> {
    const product = this.products.get(productId);
    if (!product) return null;
    Object.assign(product, { item_no: input.itemNo, product_name: input.productName });
    this.linkEvents.push(`update-product:${productId}:${assetIds.join(',')}`);
    return product;
  }

  async listProductsPage(limit: number, offset: number): Promise<ProductRecord[]> {
    return [...this.products.values()].slice(offset, offset + limit);
  }

  async findProductIdsByItemNos(itemNos: string[]): Promise<number[]> {
    return [...this.products.values()].filter((product) => itemNos.includes(product.item_no)).map((product) => product.id);
  }

  async getProductRecord(productId: number): Promise<ProductRecord | null> {
    return this.products.get(productId) ?? null;
  }

  async listProductImageAssociations(_productIds: number[], _primaryOnly: boolean): Promise<ProductAssetAssociationRecord[]> {
    return [];
  }

  async listLegacyProductImages(_productIds: number[], _primaryOnly: boolean): Promise<LegacyProductImageRecord[]> {
    return [];
  }

  async detachProductImage(productId: number, assetId: string): Promise<void> {
    this.linkEvents.push(`detach:${productId}:${assetId}`);
  }

  async detachAllProductImages(productId: number): Promise<void> {
    this.linkEvents.push(`detach-all:${productId}`);
  }

  async deleteProductWithAssets(productId: number): Promise<boolean> {
    this.linkEvents.push(`delete-product:${productId}`);
    return true;
  }

  async recycleExpiredUnlinkedAssets(now: Date, limit: number): Promise<number> {
    this.recycleCalls.push({ now, limit });
    return 1;
  }

  async listPurgeCandidates(_now: Date, limit: number): Promise<ImageAssetRecord[]> {
    return this.purgeCandidateIds
      .map((id) => this.assets.get(id))
      .filter((asset): asset is ImageAssetRecord => Boolean(asset))
      .slice(0, limit)
      .map((asset) => ({ ...asset }));
  }

  async claimNextPurgeCandidate(now: Date): Promise<{ assetId: string; variants: AssetVariantRecord[] } | null> {
    if (!this.purgeClaimAllowed) return null;
    const asset = this.purgeCandidateIds
      .map((id) => this.assets.get(id))
      .find((candidate) => candidate?.status === 'recycled'
        && candidate.refCount === 0
        && candidate.purgeAfter
        && candidate.purgeAfter <= now);
    if (!asset) return null;
    asset.status = 'purging' as ImageAssetRecord['status'];
    this.events.push(`claimed:${asset.id}`);
    return { assetId: asset.id, variants: [...(this.variants.get(asset.id) ?? [])] };
  }

  async releasePurgeClaim(assetId: string): Promise<boolean> {
    const asset = this.assets.get(assetId);
    if (!asset || asset.status !== ('purging' as ImageAssetRecord['status']) || asset.refCount !== 0) return false;
    asset.status = 'recycled';
    this.releasePurgeCalls += 1;
    this.events.push(`released:${assetId}`);
    return true;
  }

  async markPurged(assetId: string, at: Date): Promise<void> {
    this.events.push(`purged:${assetId}`);
    const asset = this.requireAsset(assetId);
    if (
      asset.status !== ('purging' as ImageAssetRecord['status'])
      || asset.refCount !== 0
      || !asset.purgeAfter
      || asset.purgeAfter > at
    ) {
      throw new ImageAssetError('ASSET_NOT_READY', 409, false, 'Asset is not eligible for purge');
    }
    this.variants.delete(assetId);
    asset.status = 'purged';
    asset.purgedAt = at;
    this.markPurgedCalls += 1;
  }

  async reconcileReferenceCounts(): Promise<number> {
    return this.reconcileCounts;
  }

  async recoverStaleJobs(now: Date): Promise<number> {
    let recovered = 0;
    const threshold = now.getTime() - 5 * 60_000;
    for (const job of this.jobs.values()) {
      if (job.status === 'processing' && job.lockedAt && job.lockedAt.getTime() <= threshold) {
        job.status = 'queued';
        job.lockedAt = undefined;
        recovered += 1;
      }
    }
    return recovered;
  }

  async listOrphanCandidates(now: Date, limit: number): Promise<ImageAssetRecord[]> {
    return [...this.assets.values()]
      .filter((asset) => asset.refCount === 0 && asset.status === 'recycled' && asset.purgeAfter && asset.purgeAfter <= now)
      .slice(0, limit);
  }

  async listReconciliationCandidates(limit: number): Promise<ReconciliationCandidate[]> {
    return [...this.assets.values()]
      .filter((asset) => !['purged', 'purging', 'quarantine'].includes(asset.status))
      .slice(0, limit)
      .map((asset) => ({ asset, variants: [...(this.variants.get(asset.id) ?? [])] }));
  }

  async markAssetObjectMissing(assetId: string, code: string): Promise<boolean> {
    const asset = this.assets.get(assetId);
    if (!asset || ['purged', 'purging', 'quarantine'].includes(asset.status)) return false;
    asset.status = 'degraded';
    asset.errorCode = code as ImageAssetRecord['errorCode'];
    return true;
  }

  requireAsset(id: string): ImageAssetRecord {
    const asset = this.assets.get(id);
    if (!asset) throw new Error(`Missing test asset ${id}`);
    return asset;
  }
}

type StoredObject = { body: Buffer; contentType: string };

class MemoryStorage implements StorageAdapter {
  readonly provider = 'local' as const;
  readonly objects = new Map<string, StoredObject>();
  readonly deletes: string[] = [];
  readonly reads: Array<{ key: string; maxBytes: number }> = [];
  readonly events: string[];
  readonly putFailures = new Map<string, number>();
  readonly deleteFailures = new Map<string, number>();
  quarantineDeleteFailures = 0;
  strictMissingDeletes = false;

  constructor(events: string[] = []) {
    this.events = events;
  }

  async createUploadGrant(key: string, mime: string, maxBytes: number, expiresSeconds: number): Promise<UploadGrant> {
    return {
      url: `https://upload.test/${encodeURIComponent(key)}`,
      method: 'PUT',
      headers: { 'Content-Type': mime },
      maxBytes,
      expiresAt: new Date(START.getTime() + expiresSeconds * 1_000).toISOString(),
    };
  }

  async stat(key: string): Promise<{ byteSize: number; contentType?: string }> {
    const stored = this.requireObject(key);
    return { byteSize: stored.body.length, contentType: stored.contentType };
  }

  async read(key: string, maxBytes: number): Promise<Buffer> {
    this.reads.push({ key, maxBytes });
    const body = this.requireObject(key).body;
    if (body.length > maxBytes) throw new ImageAssetError('IMAGE_LIMIT_EXCEEDED', 413, false, 'Image exceeds byte limit');
    return Buffer.from(body);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const variant = key.match(/\/(original|display|thumbnail)\./)?.[1];
    if (variant && this.consumeFailure(this.putFailures, variant)) throw storageUnavailable();
    this.objects.set(key, { body: Buffer.from(body), contentType });
  }

  async delete(key: string): Promise<void> {
    this.deletes.push(key);
    this.events.push(`delete:${key}`);
    if (key.startsWith('quarantine/') && this.quarantineDeleteFailures > 0) {
      this.quarantineDeleteFailures -= 1;
      throw storageUnavailable();
    }
    const variant = key.match(/\/(original|display|thumbnail)\./)?.[1];
    if (variant && this.consumeFailure(this.deleteFailures, variant)) throw storageUnavailable();
    if (this.strictMissingDeletes && !this.objects.has(key)) {
      throw new ImageAssetError('ASSET_NOT_FOUND', 404, false, 'Object not found');
    }
    this.objects.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async signGet(key: string, expiresSeconds: number): Promise<{ url: string; expiresAt: string }> {
    this.requireObject(key);
    return {
      url: `https://read.test/${encodeURIComponent(key)}`,
      expiresAt: new Date(START.getTime() + expiresSeconds * 1_000).toISOString(),
    };
  }

  private requireObject(key: string): StoredObject {
    const stored = this.objects.get(key);
    if (!stored) throw new ImageAssetError('ASSET_NOT_FOUND', 404, false, 'Object not found');
    return stored;
  }

  private consumeFailure(failures: Map<string, number>, key: string): boolean {
    const remaining = failures.get(key) ?? 0;
    if (remaining <= 0) return false;
    failures.set(key, remaining - 1);
    return true;
  }
}

function storageUnavailable(): ImageAssetError {
  return new ImageAssetError('STORAGE_UNAVAILABLE', 503, true, 'Storage unavailable');
}

function idSequence(...ids: string[]): () => string {
  let index = 0;
  return () => ids[index++] ?? `generated-${index}`;
}

async function png(width = 640, height = 480): Promise<Buffer> {
  const sharp = (await import(SHARP_MODULE)).default;
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 24, g: 120, b: 210, alpha: 1 },
    },
  }).png().toBuffer();
}

async function createUploadedSession(
  service: ImageAssetService,
  repository: MemoryAssetRepository,
  storage: MemoryStorage,
  body: Buffer,
  principalId = 'principal-1',
  purpose: 'company_logo' | 'product_image' = 'company_logo',
): Promise<string> {
  const grant = await service.createUploadSession({
    purpose,
    originalFilename: 'fixture.png',
    declaredMime: 'image/png',
    declaredByteSize: body.length,
    principalId,
  });
  const session = repository.sessions.get(grant.sessionId);
  assert.ok(session);
  storage.objects.set(session.quarantineKey, { body: Buffer.from(body), contentType: 'image/png' });
  return grant.sessionId;
}

test('create upload session uses a server-owned quarantine key and a 15-minute grant', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const storage = new MemoryStorage();
  const service = new ImageAssetService(repository, storage, { now: clock.now, randomId: idSequence('session-1', 'object-1') });
  const bytes = await png();

  const response = await service.createUploadSession({
    purpose: 'company_logo',
    originalFilename: '../../logo.png',
    declaredMime: 'image/png',
    declaredByteSize: bytes.length,
    principalId: 'principal-1',
  });
  const session = repository.sessions.get(response.sessionId);

  assert.deepEqual(Object.keys(response).sort(), ['expiresAt', 'headers', 'method', 'sessionId', 'uploadUrl']);
  assert.equal(response.sessionId, 'session-1');
  assert.match(session?.quarantineKey ?? '', /^quarantine\/session-1\/object-1~[A-Za-z0-9_-]+\.png$/);
  assert.equal(session?.createdBy, 'principal-1');
  assert.equal(session?.expiresAt.getTime(), START.getTime() + 24 * 60 * 60 * 1_000);
  assert.equal(new Date(response.expiresAt).getTime(), START.getTime() + 15 * 60 * 1_000);
});

test('finalize hashes server bytes and queues one idempotent job', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const storage = new MemoryStorage();
  const service = new ImageAssetService(repository, storage, { now: clock.now, randomId: idSequence('session-1', 'object-1') });
  const bytes = await png();
  const sessionId = await createUploadedSession(service, repository, storage, bytes);

  const first = await service.finalizeUploadSession(sessionId, 'principal-1');
  const second = await service.finalizeUploadSession(sessionId, 'principal-1');

  assert.equal(first.id, second.id);
  assert.equal(repository.assets.size, 1);
  assert.equal(repository.jobs.size, 1);
  assert.equal(repository.requireAsset(first.id).sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(repository.requireAsset(first.id).originalFilename, 'fixture.png');
  assert.equal(repository.requireAsset(first.id).status, 'processing');
  assert.equal(storage.reads[0].maxBytes, 2 * 1024 * 1024 + 1);
});

test('same verified bytes reuse one asset and one permanent original key', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const storage = new MemoryStorage();
  const service = new ImageAssetService(repository, storage, {
    now: clock.now,
    randomId: idSequence('session-1', 'object-1', 'session-2', 'object-2'),
  });
  const worker = new ImageAssetWorker(repository, storage, { now: clock.now });
  const bytes = await png(2000, 1000);
  const firstSession = await createUploadedSession(service, repository, storage, bytes);
  const secondSession = await createUploadedSession(service, repository, storage, bytes);

  const first = await service.finalizeUploadSession(firstSession, 'principal-1');
  const second = await service.finalizeUploadSession(secondSession, 'principal-1');
  await worker.runOnce();

  assert.equal(first.id, second.id);
  assert.equal(repository.assets.size, 1);
  assert.equal(repository.jobs.size, 1);
  assert.equal([...storage.objects.keys()].filter((key) => key.includes('/original.')).length, 1);
  assert.equal(storage.objects.has(repository.sessions.get(firstSession)?.quarantineKey ?? ''), false);
  assert.equal(storage.objects.has(repository.sessions.get(secondSession)?.quarantineKey ?? ''), false);
  const display = repository.variants.get(first.id)?.find((variant) => variant.variant === 'display');
  const original = repository.variants.get(first.id)?.find((variant) => variant.variant === 'original');
  assert.ok(display && original);
  assert.deepEqual(storage.objects.get(original.objectKey)?.body, bytes);
  const sharp = (await import(SHARP_MODULE)).default;
  const displayMetadata = await sharp(storage.objects.get(display.objectKey)?.body).metadata();
  assert.deepEqual({ format: displayMetadata.format, width: displayMetadata.width, height: displayMetadata.height }, {
    format: 'webp',
    width: 1600,
    height: 800,
  });
});

test('invalid raster deletes its quarantine object before returning IMAGE_CONTENT_INVALID', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const storage = new MemoryStorage();
  const service = new ImageAssetService(repository, storage, { now: clock.now, randomId: idSequence('session-1', 'object-1') });
  const bytes = Buffer.from('not an image');
  const sessionId = await createUploadedSession(service, repository, storage, bytes);
  const key = repository.sessions.get(sessionId)?.quarantineKey ?? '';

  await assert.rejects(
    service.finalizeUploadSession(sessionId, 'principal-1'),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'IMAGE_CONTENT_INVALID',
  );

  assert.deepEqual(storage.deletes, [key]);
  assert.equal(storage.objects.has(key), false);
  assert.equal(repository.assets.size, 0);
  assert.equal(repository.sessions.get(sessionId)?.status, 'expired');
});

test('validator rejects MIME and extension mismatches from real image bytes', async () => {
  const bytes = await png(10, 10);
  const policy = getAssetPolicy('company_logo');

  await assert.rejects(
    validateImageBuffer(bytes, { mime: 'image/jpeg', extension: 'png', byteSize: bytes.length }, policy),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'IMAGE_CONTENT_INVALID',
  );
  await assert.rejects(
    validateImageBuffer(bytes, { mime: 'image/png', extension: 'jpg', byteSize: bytes.length }, policy),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'IMAGE_CONTENT_INVALID',
  );
});

test('validator enforces byte and decoded pixel limits from real image bytes', async () => {
  const bytes = await png(10, 10);
  const policy = getAssetPolicy('company_logo');

  await assert.rejects(
    validateImageBuffer(bytes, { mime: 'image/png', extension: 'png', byteSize: bytes.length }, {
      ...policy,
      maxBytes: bytes.length - 1,
    }),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'IMAGE_LIMIT_EXCEEDED',
  );
  await assert.rejects(
    validateImageBuffer(bytes, { mime: 'image/png', extension: 'png', byteSize: bytes.length }, {
      ...policy,
      maxPixels: 99,
    }),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'IMAGE_LIMIT_EXCEEDED',
  );
});

test('verified company asset reuse for product escalates purpose and retains quarantine until thumbnail processing', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const storage = new MemoryStorage();
  const service = new ImageAssetService(repository, storage, {
    now: clock.now,
    randomId: idSequence('company-session', 'company-object', 'product-session', 'product-object'),
  });
  const worker = new ImageAssetWorker(repository, storage, { now: clock.now });
  const bytes = await png();
  const companySession = await createUploadedSession(service, repository, storage, bytes, 'company-principal', 'company_logo');
  const company = await service.finalizeUploadSession(companySession, 'company-principal');
  await worker.runOnce();
  const productSession = await createUploadedSession(service, repository, storage, bytes, 'product-principal', 'product_image');
  const productQuarantine = repository.sessions.get(productSession)?.quarantineKey ?? '';

  const product = await service.finalizeUploadSession(productSession, 'product-principal');
  const repeated = await service.finalizeUploadSession(productSession, 'product-principal');

  assert.equal(product.id, company.id);
  assert.equal(repeated.id, company.id);
  assert.equal(product.purpose, 'product_image');
  assert.equal(product.status, 'processing');
  assert.equal(repository.requireAsset(company.id).createdBy, 'product-principal');
  assert.equal(storage.objects.has(productQuarantine), true);
  assert.equal([...repository.jobs.values()].filter((job) => job.assetId === company.id).length, 1);
  assert.equal([...repository.jobs.values()].find((job) => job.assetId === company.id)?.status, 'queued');

  await worker.runOnce();

  assert.equal(repository.requireAsset(company.id).status, 'ready');
  assert.deepEqual(repository.variants.get(company.id)?.map((variant) => variant.variant), ['original', 'display', 'thumbnail']);
  assert.equal(storage.objects.has(productQuarantine), false);
  assert.equal(repository.sessions.get(productSession)?.quarantineCleanedAt?.getTime(), START.getTime());
});

test('verified product asset reuse for company keeps thumbnail and transfers creator window', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const storage = new MemoryStorage();
  const service = new ImageAssetService(repository, storage, {
    now: clock.now,
    randomId: idSequence('product-session', 'product-object', 'company-session', 'company-object'),
  });
  const worker = new ImageAssetWorker(repository, storage, { now: clock.now });
  const bytes = await png();
  const productSession = await createUploadedSession(service, repository, storage, bytes, 'product-principal', 'product_image');
  const product = await service.finalizeUploadSession(productSession, 'product-principal');
  await worker.runOnce();
  const companySession = await createUploadedSession(service, repository, storage, bytes, 'company-principal', 'company_logo');
  const companyQuarantine = repository.sessions.get(companySession)?.quarantineKey ?? '';

  const company = await service.finalizeUploadSession(companySession, 'company-principal');

  assert.equal(company.id, product.id);
  assert.equal(company.purpose, 'product_image');
  assert.equal(company.status, 'ready');
  assert.equal(repository.requireAsset(product.id).createdBy, 'company-principal');
  assert.equal(repository.variants.get(product.id)?.some((variant) => variant.variant === 'thumbnail'), true);
  assert.equal(storage.objects.has(companyQuarantine), false);
  assert.equal(repository.sessions.get(companySession)?.quarantineCleanedAt?.getTime(), START.getTime());
  await assert.rejects(
    service.getDescriptor(product.id, 'product-principal'),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'ASSET_ACCESS_DENIED',
  );
});

test('verified same-purpose duplicate transfers the unlinked creator window to the new principal', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const storage = new MemoryStorage();
  const service = new ImageAssetService(repository, storage, {
    now: clock.now,
    randomId: idSequence('first-session', 'first-object', 'second-session', 'second-object'),
  });
  const worker = new ImageAssetWorker(repository, storage, { now: clock.now });
  const bytes = await png();
  const firstSession = await createUploadedSession(service, repository, storage, bytes, 'first-principal');
  const first = await service.finalizeUploadSession(firstSession, 'first-principal');
  await worker.runOnce();
  const secondSession = await createUploadedSession(service, repository, storage, bytes, 'second-principal');

  const second = await service.finalizeUploadSession(secondSession, 'second-principal');

  assert.equal(second.id, first.id);
  assert.equal(repository.requireAsset(first.id).createdBy, 'second-principal');
  assert.equal((await service.getDescriptor(first.id, 'second-principal')).id, first.id);
  await assert.rejects(
    service.getDescriptor(first.id, 'first-principal'),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'ASSET_ACCESS_DENIED',
  );
});

test('verified recycled duplicate restores ready state and a new creator window', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const storage = new MemoryStorage();
  const service = new ImageAssetService(repository, storage, {
    now: clock.now,
    randomId: idSequence('first-session', 'first-object', 'restore-session', 'restore-object'),
  });
  const worker = new ImageAssetWorker(repository, storage, { now: clock.now });
  const bytes = await png();
  const firstSession = await createUploadedSession(service, repository, storage, bytes, 'first-principal');
  const first = await service.finalizeUploadSession(firstSession, 'first-principal');
  await worker.runOnce();
  const asset = repository.requireAsset(first.id);
  asset.status = 'recycled';
  asset.recycledAt = new Date('2026-08-01T00:00:00Z');
  asset.purgeAfter = new Date('2026-09-01T00:00:00Z');
  const restoreSession = await createUploadedSession(service, repository, storage, bytes, 'restore-principal');

  const restored = await service.finalizeUploadSession(restoreSession, 'restore-principal');

  assert.equal(restored.id, first.id);
  assert.equal(restored.status, 'ready');
  assert.equal(asset.createdBy, 'restore-principal');
  assert.equal(asset.recycledAt, undefined);
  assert.equal(asset.purgeAfter, undefined);
});

test('client-supplied hash cannot bypass server-byte validation or transfer creator access', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const storage = new MemoryStorage();
  const service = new ImageAssetService(repository, storage, {
    now: clock.now,
    randomId: idSequence('first-session', 'first-object', 'invalid-session', 'invalid-object'),
  });
  const worker = new ImageAssetWorker(repository, storage, { now: clock.now });
  const bytes = await png();
  const firstSession = await createUploadedSession(service, repository, storage, bytes, 'first-principal');
  const first = await service.finalizeUploadSession(firstSession, 'first-principal');
  await worker.runOnce();
  const invalid = Buffer.from('not the verified image');
  const grant = await service.createUploadSession({
    purpose: 'company_logo',
    originalFilename: 'fixture.png',
    declaredMime: 'image/png',
    declaredByteSize: invalid.length,
    principalId: 'attacker-principal',
    sha256: repository.requireAsset(first.id).sha256,
  } as Parameters<ImageAssetService['createUploadSession']>[0] & { sha256: string });
  const session = repository.sessions.get(grant.sessionId);
  assert.ok(session);
  storage.objects.set(session.quarantineKey, { body: invalid, contentType: 'image/png' });

  await assert.rejects(
    service.finalizeUploadSession(grant.sessionId, 'attacker-principal'),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'IMAGE_CONTENT_INVALID',
  );

  assert.equal(repository.assets.size, 1);
  assert.equal(repository.requireAsset(first.id).createdBy, 'first-principal');
});

test('partial variant failure leaves processing job retryable and resumes from permanent original bytes', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const storage = new MemoryStorage();
  const service = new ImageAssetService(repository, storage, { now: clock.now, randomId: idSequence('session-1', 'object-1') });
  const worker = new ImageAssetWorker(repository, storage, { now: clock.now });
  const bytes = await png(500, 400);
  const sessionId = await createUploadedSession(service, repository, storage, bytes, 'principal-1', 'product_image');
  const descriptor = await service.finalizeUploadSession(sessionId, 'principal-1');
  storage.putFailures.set('display', 1);

  await worker.runOnce();

  const job = [...repository.jobs.values()][0];
  assert.equal(repository.requireAsset(descriptor.id).status, 'processing');
  assert.equal(job.status, 'queued');
  assert.equal(job.attempts, 1);
  assert.equal(job.availableAt.getTime(), START.getTime() + 5_000);
  assert.equal(repository.variants.has(descriptor.id), false);
  assert.equal([...storage.objects.keys()].filter((key) => key.includes('/original.')).length, 1);

  clock.advance(5_000);
  await worker.runOnce();

  assert.equal(repository.requireAsset(descriptor.id).status, 'ready');
  assert.equal(job.status, 'completed');
  assert.deepEqual(repository.variants.get(descriptor.id)?.map((variant) => variant.variant), ['original', 'display', 'thumbnail']);
  const thumbnailKey = repository.variants.get(descriptor.id)?.find((variant) => variant.variant === 'thumbnail')?.objectKey;
  assert.ok(thumbnailKey);
  const sharp = (await import(SHARP_MODULE)).default;
  const thumbnailMetadata = await sharp(storage.objects.get(thumbnailKey)?.body).metadata();
  assert.deepEqual({ format: thumbnailMetadata.format, width: thumbnailMetadata.width, height: thumbnailMetadata.height }, {
    format: 'webp',
    width: 320,
    height: 320,
  });
});

test('processing preserves metadata for confirmed variants while creating only missing variants', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const storage = new MemoryStorage();
  const worker = new ImageAssetWorker(repository, storage, { now: clock.now });
  const bytes = await png(500, 400);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const assetId = 'existing-asset';
  repository.assets.set(assetId, {
    id: assetId,
    sha256: hash,
    originalFilename: 'fixture.png',
    detectedMime: 'image/png',
    detectedExtension: 'png',
    purpose: 'product_image',
    storageProvider: 'local',
    byteSize: bytes.length,
    width: 500,
    height: 400,
    status: 'processing',
    refCount: 0,
    createdBy: 'principal-1',
    createdAt: START,
    updatedAt: START,
  });
  const originalKey = assetObjectKey(hash, 'original', 'png');
  const displayKey = assetObjectKey(hash, 'display', 'webp');
  const existingCreatedAt = new Date('2026-08-21T00:00:00Z');
  repository.variants.set(assetId, [
    {
      assetId,
      variant: 'original',
      objectKey: originalKey,
      mime: 'image/png',
      byteSize: bytes.length,
      width: 500,
      height: 400,
      createdAt: existingCreatedAt,
    },
    {
      assetId,
      variant: 'display',
      objectKey: displayKey,
      mime: 'image/webp',
      byteSize: 12_345,
      width: 500,
      height: 400,
      createdAt: existingCreatedAt,
    },
  ]);
  repository.jobs.set(1, {
    id: 1,
    assetId,
    jobType: 'process_asset',
    status: 'queued',
    attempts: 0,
    availableAt: START,
  });
  storage.objects.set(originalKey, { body: bytes, contentType: 'image/png' });
  storage.objects.set(displayKey, { body: Buffer.from('existing-display'), contentType: 'image/webp' });

  await worker.runOnce();

  const display = repository.variants.get(assetId)?.find((variant) => variant.variant === 'display');
  assert.equal(display?.byteSize, 12_345);
  assert.equal(display?.createdAt, existingCreatedAt);
  assert.equal(repository.variants.get(assetId)?.some((variant) => variant.variant === 'thumbnail'), true);
  assert.equal(repository.requireAsset(assetId).status, 'ready');
});

test('quarantine cleanup failure keeps a fully stored asset retryable until cleanup succeeds', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const storage = new MemoryStorage();
  const service = new ImageAssetService(repository, storage, { now: clock.now, randomId: idSequence('session-1', 'object-1') });
  const worker = new ImageAssetWorker(repository, storage, { now: clock.now });
  const bytes = await png();
  const sessionId = await createUploadedSession(service, repository, storage, bytes);
  const descriptor = await service.finalizeUploadSession(sessionId, 'principal-1');
  const quarantineKey = repository.sessions.get(sessionId)?.quarantineKey ?? '';
  storage.quarantineDeleteFailures = 1;

  await worker.runOnce();

  const job = [...repository.jobs.values()][0];
  assert.equal(repository.requireAsset(descriptor.id).status, 'processing');
  assert.equal(job.status, 'queued');
  assert.equal(repository.variants.has(descriptor.id), false);
  assert.equal(storage.objects.has(quarantineKey), true);
  assert.equal([...storage.objects.keys()].filter((key) => key.startsWith('assets/')).length, 2);

  clock.advance(5_000);
  await worker.runOnce();

  assert.equal(repository.requireAsset(descriptor.id).status, 'ready');
  assert.equal(job.status, 'completed');
  assert.equal(storage.objects.has(quarantineKey), false);
});

test('database completion failure retries after quarantine was already deleted', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const storage = new MemoryStorage();
  storage.strictMissingDeletes = true;
  const service = new ImageAssetService(repository, storage, { now: clock.now, randomId: idSequence('session-1', 'object-1') });
  const worker = new ImageAssetWorker(repository, storage, { now: clock.now });
  const bytes = await png();
  const sessionId = await createUploadedSession(service, repository, storage, bytes);
  const descriptor = await service.finalizeUploadSession(sessionId, 'principal-1');
  const quarantineKey = repository.sessions.get(sessionId)?.quarantineKey ?? '';
  repository.completeProcessingFailures = 1;

  await worker.runOnce();

  const job = [...repository.jobs.values()][0];
  assert.equal(repository.requireAsset(descriptor.id).status, 'processing');
  assert.equal(job.status, 'queued');
  assert.equal(storage.objects.has(quarantineKey), false);

  clock.advance(5_000);
  await worker.runOnce();

  assert.equal(repository.requireAsset(descriptor.id).status, 'ready');
  assert.equal(job.status, 'completed');
  assert.equal(repository.variants.get(descriptor.id)?.length, 2);
});

test('storage failures use 5-second, 30-second, and one 5-minute retry before terminal degradation', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const storage = new MemoryStorage();
  const service = new ImageAssetService(repository, storage, { now: clock.now, randomId: idSequence('session-1', 'object-1') });
  const worker = new ImageAssetWorker(repository, storage, { now: clock.now });
  const bytes = await png();
  const sessionId = await createUploadedSession(service, repository, storage, bytes);
  const descriptor = await service.finalizeUploadSession(sessionId, 'principal-1');
  storage.putFailures.set('display', 4);

  await worker.runOnce();
  let job = [...repository.jobs.values()][0];
  assert.equal(job.availableAt.getTime(), START.getTime() + 5_000);
  assert.equal(repository.requireAsset(descriptor.id).status, 'processing');
  clock.advance(5_000);

  await worker.runOnce();
  job = [...repository.jobs.values()][0];
  assert.equal(job.availableAt.getTime(), START.getTime() + 35_000);
  assert.equal(repository.requireAsset(descriptor.id).status, 'processing');
  clock.advance(30_000);

  await worker.runOnce();
  job = [...repository.jobs.values()][0];
  assert.equal(job.availableAt.getTime(), START.getTime() + 335_000);
  assert.equal(job.lastErrorCode, 'STORAGE_UNAVAILABLE');
  assert.equal(repository.requireAsset(descriptor.id).status, 'degraded');
  assert.equal(repository.requireAsset(descriptor.id).errorCode, 'STORAGE_UNAVAILABLE');
  assert.equal(job.status, 'queued');
  clock.advance(5 * 60_000);

  await worker.runOnce();

  assert.equal(job.attempts, 4);
  assert.equal(job.status, 'failed');
  assert.equal(repository.requireAsset(descriptor.id).status, 'degraded');
  assert.equal(repository.requireAsset(descriptor.id).errorCode, 'STORAGE_UNAVAILABLE');
});

test('successful final retry restores a degraded asset to ready', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const storage = new MemoryStorage();
  const service = new ImageAssetService(repository, storage, { now: clock.now, randomId: idSequence('session-1', 'object-1') });
  const worker = new ImageAssetWorker(repository, storage, { now: clock.now });
  const bytes = await png();
  const sessionId = await createUploadedSession(service, repository, storage, bytes);
  const descriptor = await service.finalizeUploadSession(sessionId, 'principal-1');
  storage.putFailures.set('display', 3);

  await worker.runOnce();
  clock.advance(5_000);
  await worker.runOnce();
  clock.advance(30_000);
  await worker.runOnce();
  assert.equal(repository.requireAsset(descriptor.id).status, 'degraded');
  clock.advance(5 * 60_000);

  await worker.runOnce();

  const job = [...repository.jobs.values()][0];
  assert.equal(job.attempts, 4);
  assert.equal(job.status, 'completed');
  assert.equal(repository.requireAsset(descriptor.id).status, 'ready');
  assert.equal(repository.requireAsset(descriptor.id).errorCode, undefined);
});

test('completed job race prevents degradation from overwriting ready', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const storage = new MemoryStorage();
  const service = new ImageAssetService(repository, storage, { now: clock.now, randomId: idSequence('session-1', 'object-1') });
  const worker = new ImageAssetWorker(repository, storage, { now: clock.now });
  const bytes = await png();
  const sessionId = await createUploadedSession(service, repository, storage, bytes);
  const descriptor = await service.finalizeUploadSession(sessionId, 'principal-1');
  const job = [...repository.jobs.values()][0];
  job.attempts = 2;
  storage.putFailures.set('display', 1);
  repository.completeOnFailJob = true;

  await worker.runOnce();

  assert.equal(job.status, 'completed');
  assert.equal(repository.requireAsset(descriptor.id).status, 'ready');
  assert.equal(repository.markDegradedCalls, 0);
});

test('purge waits for zero references and every variant storage deletion', async () => {
  const events: string[] = [];
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock, events);
  const storage = new MemoryStorage(events);
  storage.strictMissingDeletes = true;
  const worker = new ImageAssetWorker(repository, storage, { now: clock.now });
  const assetId = 'purge-asset';
  const asset: ImageAssetRecord = {
    id: assetId,
    sha256: 'aa'.repeat(32),
    originalFilename: 'fixture.png',
    detectedMime: 'image/png',
    detectedExtension: 'png',
    purpose: 'product_image',
    storageProvider: 'local',
    byteSize: 8,
    width: 2,
    height: 2,
    status: 'recycled',
    refCount: 1,
    createdBy: 'principal-1',
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    recycledAt: new Date('2026-07-01T00:00:00Z'),
    purgeAfter: new Date('2026-08-01T00:00:00Z'),
  };
  repository.assets.set(assetId, asset);
  repository.purgeCandidateIds = [assetId];
  const records: AssetVariantRecord[] = ['original', 'display', 'thumbnail'].map((variant) => ({
    assetId,
    variant: variant as AssetVariantRecord['variant'],
    objectKey: `assets/${assetId}/${variant}.webp`,
    mime: 'image/webp',
    byteSize: 8,
    width: 2,
    height: 2,
    createdAt: new Date('2026-06-01T00:00:00Z'),
  }));
  repository.variants.set(assetId, records);
  for (const record of records) storage.objects.set(record.objectKey, { body: Buffer.alloc(8), contentType: record.mime });

  assert.equal(await worker.purgeOnce(), 0);
  assert.equal(storage.deletes.length, 0);
  assert.equal(repository.markPurgedCalls, 0);

  asset.refCount = 0;
  storage.deleteFailures.set('display', 1);
  await assert.rejects(worker.purgeOnce(), (error: unknown) => error instanceof ImageAssetError && error.code === 'STORAGE_UNAVAILABLE');
  assert.equal(repository.markPurgedCalls, 0);
  assert.equal(repository.variants.get(assetId)?.length, 3);
  assert.equal(repository.requireAsset(assetId).status, 'recycled');
  assert.equal(repository.releasePurgeCalls, 1);

  await worker.purgeOnce();

  assert.equal(repository.requireAsset(assetId).status, 'purged');
  assert.equal(repository.markPurgedCalls, 1);
  assert.equal(repository.variants.has(assetId), false);
  assert.equal(storage.objects.size, 0);
  const markIndex = events.lastIndexOf(`purged:${assetId}`);
  const firstClaimIndex = events.indexOf(`claimed:${assetId}`);
  const firstDeleteIndex = events.indexOf(`delete:${records[0].objectKey}`);
  const releaseIndex = events.indexOf(`released:${assetId}`);
  const retryClaimIndex = events.lastIndexOf(`claimed:${assetId}`);
  assert.ok(firstClaimIndex >= 0 && firstClaimIndex < firstDeleteIndex);
  assert.ok(releaseIndex > firstDeleteIndex && releaseIndex < retryClaimIndex && retryClaimIndex < markIndex);
  assert.ok(events.indexOf(`variants:${assetId}`) < markIndex);
  assert.ok(records.every((record) => events.lastIndexOf(`delete:${record.objectKey}`) < markIndex));
});

test('purge claim failure performs no storage deletion or metadata transition', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const storage = new MemoryStorage();
  const worker = new ImageAssetWorker(repository, storage, { now: clock.now });
  const assetId = 'contended-asset';
  repository.assets.set(assetId, {
    id: assetId,
    sha256: 'cc'.repeat(32),
    originalFilename: 'fixture.png',
    detectedMime: 'image/png',
    detectedExtension: 'png',
    purpose: 'company_logo',
    storageProvider: 'local',
    byteSize: 8,
    width: 2,
    height: 2,
    status: 'recycled',
    refCount: 0,
    createdBy: 'principal-1',
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    recycledAt: new Date('2026-07-01T00:00:00Z'),
    purgeAfter: new Date('2026-08-01T00:00:00Z'),
  });
  const variant: AssetVariantRecord = {
    assetId,
    variant: 'original',
    objectKey: 'assets/contended/original.png',
    mime: 'image/png',
    byteSize: 8,
    width: 2,
    height: 2,
    createdAt: new Date('2026-06-01T00:00:00Z'),
  };
  repository.variants.set(assetId, [variant]);
  repository.purgeCandidateIds = [assetId];
  repository.purgeClaimAllowed = false;
  storage.objects.set(variant.objectKey, { body: Buffer.alloc(8), contentType: variant.mime });

  assert.equal(await worker.purgeOnce(), 0);

  assert.equal(storage.deletes.length, 0);
  assert.equal(repository.markPurgedCalls, 0);
  assert.equal(repository.variants.get(assetId)?.length, 1);
  assert.equal(repository.requireAsset(assetId).status, 'recycled');
});

test('descriptor, signed URL, and content reads enforce creator-window or linked access', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const storage = new MemoryStorage();
  const service = new ImageAssetService(repository, storage, { now: clock.now, randomId: idSequence() });
  const asset: ImageAssetRecord = {
    id: 'ready-asset',
    sha256: 'bb'.repeat(32),
    originalFilename: 'fixture.png',
    detectedMime: 'image/png',
    detectedExtension: 'png',
    purpose: 'company_logo',
    storageProvider: 'local',
    byteSize: 4,
    width: 2,
    height: 2,
    status: 'ready',
    refCount: 0,
    createdBy: 'creator',
    createdAt: clock.now(),
    updatedAt: clock.now(),
  };
  const variant: AssetVariantRecord = {
    assetId: asset.id,
    variant: 'display',
    objectKey: 'assets/ready/display.webp',
    mime: 'image/webp',
    byteSize: 4,
    width: 2,
    height: 2,
    createdAt: clock.now(),
  };
  repository.assets.set(asset.id, asset);
  repository.variants.set(asset.id, [variant]);
  storage.objects.set(variant.objectKey, { body: Buffer.from('webp'), contentType: variant.mime });

  assert.equal((await service.getDescriptor(asset.id, 'creator')).id, asset.id);
  await assert.rejects(
    service.getDescriptor(asset.id, 'other-principal'),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'ASSET_ACCESS_DENIED',
  );

  clock.advance(24 * 60 * 60 * 1_000);
  await assert.rejects(
    service.getDescriptor(asset.id, 'creator'),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'ASSET_ACCESS_DENIED',
  );

  asset.refCount = 1;
  const access = await service.getAccessUrls([{ assetId: asset.id, variant: 'display' }], 'other-principal');
  const content = await service.readContent(asset.id, 'display', 'other-principal');
  assert.match(access[0].url, /^https:\/\/read\.test\//);
  assert.equal(content.mime, 'image/webp');
  assert.deepEqual(content.body, Buffer.from('webp'));
  assert.equal(content.etag, `\"${asset.sha256}-display\"`);
});

test('business link methods delegate only through the repository contract', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const service = new ImageAssetService(repository, new MemoryStorage(), { now: clock.now, randomId: idSequence() });

  await service.replaceCompanyImage(7, 'brand_logo', 'asset-1');
  await service.attachProductImages(8, ['asset-2', 'asset-3']);
  await service.detachProductImage(8, 'asset-2');

  assert.deepEqual(repository.linkEvents, [
    'company:7:brand_logo:asset-1',
    'attach:8:asset-2,asset-3',
    'detach:8:asset-2',
  ]);
});

test('recycle pass uses the injected clock for the creator binding-window transition', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const worker = new ImageAssetWorker(repository, new MemoryStorage(), { now: clock.now });

  assert.equal(await worker.recycleOnce(17), 1);
  assert.deepEqual(repository.recycleCalls, [{ now: START, limit: 17 }]);
});

test('expired upload sweep cleans both open and already-expired quarantine exactly once', async () => {
  const clock = new MutableClock();
  const events: string[] = [];
  const repository = new MemoryAssetRepository(clock, events);
  const storage = new MemoryStorage(events);
  const worker = new ImageAssetWorker(repository, storage, { now: clock.now }) as ImageAssetWorker & {
    cleanupExpiredUploadsOnce(limit?: number): Promise<number>;
  };
  const openSession: UploadSessionRecord = {
    id: 'open-expired',
    purpose: 'company_logo',
    quarantineKey: 'quarantine/open-expired/file.png',
    declaredByteSize: 4,
    declaredMime: 'image/png',
    createdBy: 'principal-1',
    expiresAt: new Date('2026-08-21T00:00:00Z'),
    status: 'open',
  };
  const expiredSession: UploadSessionRecord = {
    ...openSession,
    id: 'already-expired',
    quarantineKey: 'quarantine/already-expired/file.png',
    status: 'expired',
  };
  repository.sessions.set(openSession.id, openSession);
  repository.sessions.set(expiredSession.id, expiredSession);
  storage.objects.set(openSession.quarantineKey, { body: Buffer.from('open'), contentType: 'image/png' });

  assert.equal(await worker.cleanupExpiredUploadsOnce(), 2);
  assert.equal(await worker.cleanupExpiredUploadsOnce(), 0);

  assert.equal(storage.objects.has(openSession.quarantineKey), false);
  assert.equal(storage.deletes.filter((key) => key === openSession.quarantineKey).length, 1);
  assert.equal((repository.sessions.get(openSession.id) as UploadSessionRecord & { quarantineCleanedAt?: Date }).quarantineCleanedAt?.getTime(), START.getTime());
  assert.equal((repository.sessions.get(expiredSession.id) as UploadSessionRecord & { quarantineCleanedAt?: Date }).quarantineCleanedAt?.getTime(), START.getTime());
  assert.ok(events.indexOf(`delete:${openSession.quarantineKey}`) < events.indexOf(`expired-cleaned:${openSession.id}`));
});

test('expired upload storage failure leaves the session discoverable for retry', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const storage = new MemoryStorage();
  const worker = new ImageAssetWorker(repository, storage, { now: clock.now }) as ImageAssetWorker & {
    cleanupExpiredUploadsOnce(limit?: number): Promise<number>;
  };
  const session: UploadSessionRecord = {
    id: 'retry-expired',
    purpose: 'company_logo',
    quarantineKey: 'quarantine/retry-expired/file.png',
    declaredByteSize: 4,
    declaredMime: 'image/png',
    createdBy: 'principal-1',
    expiresAt: new Date('2026-08-21T00:00:00Z'),
    status: 'expired',
  };
  repository.sessions.set(session.id, session);
  storage.objects.set(session.quarantineKey, { body: Buffer.from('data'), contentType: 'image/png' });
  storage.quarantineDeleteFailures = 1;

  await assert.rejects(
    worker.cleanupExpiredUploadsOnce(),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'STORAGE_UNAVAILABLE',
  );
  assert.deepEqual((await repository.listExpiredUploadSessions(clock.now(), 25)).map((candidate) => candidate.id), [session.id]);
  assert.equal((session as UploadSessionRecord & { quarantineCleanedAt?: Date }).quarantineCleanedAt, undefined);

  assert.equal(await worker.cleanupExpiredUploadsOnce(), 1);
  assert.equal((session as UploadSessionRecord & { quarantineCleanedAt?: Date }).quarantineCleanedAt?.getTime(), START.getTime());
});

test('reconciliation recomputes reference-count drift and reports it', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  repository.reconcileCounts = 2;
  const worker = new ImageAssetWorker(repository, new MemoryStorage(), { now: clock.now, log: () => {} });

  const summary = await worker.reconcileOnce();

  assert.equal(summary.refCountDrift, 2);
  assert.equal(summary.missingObjects, 0);
  assert.equal(summary.orphanCandidates, 0);
});

test('reconciliation marks missing objects degraded without deleting them', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const storage = new MemoryStorage();
  const worker = new ImageAssetWorker(repository, storage, { now: clock.now, log: () => {} });
  const assetId = 'missing-object-asset';
  repository.assets.set(assetId, {
    id: assetId,
    sha256: 'de'.repeat(32),
    originalFilename: 'fixture.png',
    detectedMime: 'image/png',
    detectedExtension: 'png',
    purpose: 'company_logo',
    storageProvider: 'local',
    byteSize: 8,
    width: 2,
    height: 2,
    status: 'ready',
    refCount: 0,
    createdBy: 'principal-1',
    createdAt: START,
    updatedAt: START,
  });
  const variant: AssetVariantRecord = {
    assetId,
    variant: 'display',
    objectKey: 'assets/missing-object/display.webp',
    mime: 'image/webp',
    byteSize: 4,
    width: 2,
    height: 2,
    createdAt: START,
  };
  repository.variants.set(assetId, [variant]);

  const summary = await worker.reconcileOnce();

  assert.equal(summary.missingObjects, 1);
  assert.equal(repository.requireAsset(assetId).status, 'degraded');
  assert.equal(repository.requireAsset(assetId).errorCode, 'ASSET_NOT_FOUND');
  assert.equal(storage.deletes.length, 0);
});

test('reconciliation lists orphan candidates without deleting them', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const storage = new MemoryStorage();
  const worker = new ImageAssetWorker(repository, storage, { now: clock.now, log: () => {} });
  const assetId = 'orphan-asset';
  repository.assets.set(assetId, {
    id: assetId,
    sha256: 'ef'.repeat(32),
    originalFilename: 'fixture.png',
    detectedMime: 'image/png',
    detectedExtension: 'png',
    purpose: 'product_image',
    storageProvider: 'local',
    byteSize: 8,
    width: 2,
    height: 2,
    status: 'recycled',
    refCount: 0,
    createdBy: 'principal-1',
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    recycledAt: new Date('2026-07-01T00:00:00Z'),
    purgeAfter: new Date('2026-08-01T00:00:00Z'),
  });
  const variant: AssetVariantRecord = {
    assetId,
    variant: 'original',
    objectKey: 'assets/orphan/original.png',
    mime: 'image/png',
    byteSize: 8,
    width: 2,
    height: 2,
    createdAt: new Date('2026-06-01T00:00:00Z'),
  };
  repository.variants.set(assetId, [variant]);
  storage.objects.set(variant.objectKey, { body: Buffer.alloc(8), contentType: 'image/png' });

  const summary = await worker.reconcileOnce();

  assert.equal(summary.orphanCandidates, 1);
  assert.equal(storage.deletes.length, 0);
  assert.equal(repository.requireAsset(assetId).status, 'recycled');
});

test('recoverStaleJobs requeues jobs locked longer than five minutes', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const worker = new ImageAssetWorker(repository, new MemoryStorage(), { now: clock.now, log: () => {} });
  repository.jobs.set(1, {
    id: 1,
    assetId: 'stale-asset',
    jobType: 'process_asset',
    status: 'processing',
    attempts: 2,
    availableAt: START,
    lockedAt: new Date(START.getTime() - 6 * 60_000),
  });
  repository.jobs.set(2, {
    id: 2,
    assetId: 'fresh-asset',
    jobType: 'process_asset',
    status: 'processing',
    attempts: 1,
    availableAt: START,
    lockedAt: new Date(START.getTime() - 60_000),
  });

  const recovered = await worker.recoverStaleJobs();

  assert.equal(recovered, 1);
  assert.equal(repository.jobs.get(1)?.status, 'queued');
  assert.equal(repository.jobs.get(1)?.lockedAt, undefined);
  assert.equal(repository.jobs.get(2)?.status, 'processing');
});

test('reconciliation emits a redacted JSON summary with counts and elapsed ms', async () => {
  const clock = new MutableClock();
  const repository = new MemoryAssetRepository(clock);
  const storage = new MemoryStorage();
  const logs: string[] = [];
  const worker = new ImageAssetWorker(repository, storage, { now: clock.now, log: (line) => logs.push(line) });

  await worker.reconcileOnce();

  const summaryLine = JSON.parse(logs[logs.length - 1]);
  assert.equal(summaryLine.stage, 'reconciliation');
  assert.equal(typeof summaryLine.refCountDrift, 'number');
  assert.equal(typeof summaryLine.missingObjects, 'number');
  assert.equal(typeof summaryLine.orphanCandidates, 'number');
  assert.equal(typeof summaryLine.elapsedMs, 'number');
  assert.ok(summaryLine.elapsedMs >= 0);
});

test('redactLogText scrubs Authorization, Bearer, SecretKey, sign, and Cookie values', () => {
  const input = 'Authorization: Bearer abc.def; SecretKey=XYZ123; sign=SECRETSIGN; Cookie: sid=COOKIEVAL';
  const output = redactLogText(input);
  assert.doesNotMatch(output, /abc\.def/);
  assert.doesNotMatch(output, /XYZ123/);
  assert.doesNotMatch(output, /SECRETSIGN/);
  assert.doesNotMatch(output, /COOKIEVAL/);
  assert.match(output, /\[redacted\]/);
});

test('safeLogLine keeps stable ids and codes while dropping secret fields', () => {
  const line = safeLogLine({
    stage: 'process',
    requestId: 'req-1',
    assetId: 'asset-9',
    jobId: 42,
    errorCode: 'STORAGE_UNAVAILABLE',
    authorization: 'Bearer leak-me',
    cookie: 'sid=leak-cookie',
    url: 'https://bucket.cos.region.myqcloud.com/key?sign=leak-sign',
  });
  const parsed = JSON.parse(line);
  assert.equal(parsed.stage, 'process');
  assert.equal(parsed.requestId, 'req-1');
  assert.equal(parsed.assetId, 'asset-9');
  assert.equal(parsed.jobId, 42);
  assert.equal(parsed.errorCode, 'STORAGE_UNAVAILABLE');
  assert.equal(Object.hasOwn(parsed, 'authorization'), false);
  assert.equal(Object.hasOwn(parsed, 'cookie'), false);
  assert.doesNotMatch(line, /leak-me|leak-cookie|leak-sign/);
});
