import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { ImageAssetError } from './errors';
import type {
  AssetRepository,
  AssetVariantRecord,
  FinalizedUpload,
  NewUploadSession,
  ProcessingJob,
} from './repository';
import { ImageAssetService } from './service';
import { assetObjectKey, type StorageAdapter, type UploadGrant } from './storage';
import type {
  CompanyImageRole,
  ImageAssetRecord,
  UploadSessionRecord,
} from './types';
import { ImageAssetWorker } from './worker';

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
  readonly recycleCalls: Array<{ now: Date; limit: number }> = [];
  purgeCandidateIds: string[] = [];
  markPurgedCalls = 0;
  completeProcessingFailures = 0;
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

  async finalizeUploadSession(input: FinalizedUpload): Promise<{ assetId: string; jobCreated: boolean }> {
    const session = this.sessions.get(input.sessionId);
    if (!session) throw new ImageAssetError('ASSET_NOT_FOUND', 404, false, 'Upload session not found');
    if (session.createdBy !== input.principalId) {
      throw new ImageAssetError('ASSET_ACCESS_DENIED', 403, false, 'Upload session belongs to another principal');
    }
    if (session.status === 'finalized' && session.assetId) return { assetId: session.assetId, jobCreated: false };

    let asset = [...this.assets.values()].find((candidate) => candidate.sha256 === input.sha256);
    let jobCreated = false;
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
    }

    session.status = 'finalized';
    session.assetId = asset.id;
    return { assetId: asset.id, jobCreated };
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

  async failJob(jobId: number, code: string, retryAt: Date | null): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'processing') return;
    job.status = retryAt ? 'queued' : 'failed';
    if (retryAt) job.availableAt = retryAt;
    job.lockedAt = undefined;
    job.lastErrorCode = code;
  }

  async markAssetDegraded(assetId: string, code: string): Promise<void> {
    const asset = this.requireAsset(assetId);
    asset.status = 'degraded';
    asset.errorCode = code as ImageAssetRecord['errorCode'];
  }

  async listExpiredUploadSessions(now: Date, limit: number): Promise<UploadSessionRecord[]> {
    return [...this.sessions.values()]
      .filter((session) => session.status === 'open' && session.expiresAt <= now)
      .slice(0, limit);
  }

  async expireUploadSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session?.status === 'open') session.status = 'expired';
  }

  async replaceCompanyImage(companyId: number, role: CompanyImageRole, assetId: string | null): Promise<void> {
    this.linkEvents.push(`company:${companyId}:${role}:${assetId ?? 'null'}`);
  }

  async attachProductImages(productId: number, assetIds: string[]): Promise<void> {
    this.linkEvents.push(`attach:${productId}:${assetIds.join(',')}`);
  }

  async detachProductImage(productId: number, assetId: string): Promise<void> {
    this.linkEvents.push(`detach:${productId}:${assetId}`);
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

  async markPurged(assetId: string, at: Date): Promise<void> {
    this.events.push(`purged:${assetId}`);
    const asset = this.requireAsset(assetId);
    if (
      asset.status !== 'recycled'
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
    return 0;
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

test('storage retries use 5-second, 30-second, and 5-minute backoffs before preserving degraded state', async () => {
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
  let job = [...repository.jobs.values()][0];
  assert.equal(job.availableAt.getTime(), START.getTime() + 5_000);
  clock.advance(5_000);

  await worker.runOnce();
  job = [...repository.jobs.values()][0];
  assert.equal(job.availableAt.getTime(), START.getTime() + 35_000);
  clock.advance(30_000);

  await worker.runOnce();
  job = [...repository.jobs.values()][0];
  assert.equal(job.availableAt.getTime(), START.getTime() + 335_000);
  assert.equal(job.lastErrorCode, 'STORAGE_UNAVAILABLE');
  assert.equal(repository.requireAsset(descriptor.id).status, 'degraded');
  assert.equal(repository.requireAsset(descriptor.id).errorCode, 'STORAGE_UNAVAILABLE');
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

  await worker.purgeOnce();

  assert.equal(repository.requireAsset(assetId).status, 'purged');
  assert.equal(repository.markPurgedCalls, 1);
  assert.equal(repository.variants.has(assetId), false);
  assert.equal(storage.objects.size, 0);
  const markIndex = events.lastIndexOf(`purged:${assetId}`);
  assert.ok(events.indexOf(`variants:${assetId}`) < markIndex);
  assert.ok(records.every((record) => events.lastIndexOf(`delete:${record.objectKey}`) < markIndex));
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
