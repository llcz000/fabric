import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { ImageAssetError } from './errors';
import { getAssetPolicy } from './policy';
import type { AssetRepository, AssetVariantRecord } from './repository';
import type { StorageAdapter } from './storage';
import type {
  AssetDescriptor,
  AssetPurpose,
  AssetVariantName,
  CompanyImageRole,
  ImageAssetRecord,
} from './types';
import { validateImageBuffer } from './validator';

const UPLOAD_GRANT_TTL_SECONDS = 15 * 60;
const UPLOAD_SESSION_TTL_SECONDS = 24 * 60 * 60;
const ACCESS_URL_TTL_SECONDS = 5 * 60;
const CREATOR_BINDING_WINDOW_MS = 24 * 60 * 60 * 1_000;

export interface CreateUploadSessionInput {
  purpose: AssetPurpose;
  originalFilename: string;
  declaredMime: string;
  declaredByteSize: number;
  principalId: string;
}

export interface UploadGrantResponse {
  sessionId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

export interface AccessUrlRequest {
  assetId: string;
  variant: AssetVariantName;
}

export interface AccessUrlResult extends AccessUrlRequest {
  url: string;
  expiresAt: string;
}

export interface AssetContent {
  body: Buffer;
  mime: string;
  byteSize: number;
  etag: string;
}

export interface ImageAssetServiceOptions {
  now?: () => Date;
  randomId?: () => string;
  uploadGrantTtlSeconds?: number;
  uploadSessionTtlSeconds?: number;
  accessUrlTtlSeconds?: number;
}

export class ImageAssetService {
  private readonly now: () => Date;
  private readonly randomId: () => string;
  private readonly uploadGrantTtlSeconds: number;
  private readonly uploadSessionTtlSeconds: number;
  private readonly accessUrlTtlSeconds: number;

  constructor(
    private readonly repository: AssetRepository,
    private readonly storage: StorageAdapter,
    options: ImageAssetServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.randomId = options.randomId ?? randomUUID;
    this.uploadGrantTtlSeconds = options.uploadGrantTtlSeconds ?? UPLOAD_GRANT_TTL_SECONDS;
    this.uploadSessionTtlSeconds = options.uploadSessionTtlSeconds ?? UPLOAD_SESSION_TTL_SECONDS;
    this.accessUrlTtlSeconds = options.accessUrlTtlSeconds ?? ACCESS_URL_TTL_SECONDS;
  }

  async createUploadSession(input: CreateUploadSessionInput): Promise<UploadGrantResponse> {
    const policy = getAssetPolicy(input.purpose);
    const declaredMime = input.declaredMime.toLowerCase();
    if (!Number.isSafeInteger(input.declaredByteSize) || input.declaredByteSize <= 0) {
      throw new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'Declared image size must be positive');
    }
    if (input.declaredByteSize > policy.maxBytes) {
      throw new ImageAssetError('IMAGE_LIMIT_EXCEEDED', 413, false, 'Declared image size exceeds the limit');
    }
    if (!policy.allowedMimes.has(declaredMime)) {
      throw new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'Declared image type is not allowed');
    }

    const sessionId = safeGeneratedId(this.randomId());
    const objectId = safeGeneratedId(this.randomId());
    const originalFilename = safeOriginalFilename(input.originalFilename);
    const extension = safeFilenameExtension(originalFilename);
    const encodedFilename = Buffer.from(originalFilename, 'utf8').toString('base64url');
    const quarantineKey = `quarantine/${sessionId}/${objectId}~${encodedFilename}${extension ? `.${extension}` : ''}`;
    const now = this.now();
    await this.repository.createUploadSession({
      id: sessionId,
      purpose: input.purpose,
      quarantineKey,
      declaredByteSize: input.declaredByteSize,
      declaredMime,
      createdBy: input.principalId,
      expiresAt: new Date(now.getTime() + this.uploadSessionTtlSeconds * 1_000),
    });
    const grant = await this.storage.createUploadGrant(
      quarantineKey,
      declaredMime,
      policy.maxBytes,
      this.uploadGrantTtlSeconds,
    );
    return {
      sessionId,
      uploadUrl: grant.url,
      method: grant.method,
      headers: grant.headers,
      expiresAt: grant.expiresAt,
    };
  }

  async finalizeUploadSession(sessionId: string, principalId: string): Promise<AssetDescriptor> {
    const session = await this.repository.getUploadSession(sessionId);
    if (!session) throw new ImageAssetError('ASSET_NOT_FOUND', 404, false, 'Upload session not found');
    if (session.createdBy !== principalId) {
      throw new ImageAssetError('ASSET_ACCESS_DENIED', 403, false, 'Upload session belongs to another principal');
    }
    if (session.status === 'finalized' && session.assetId) {
      const asset = await this.repository.getAsset(session.assetId);
      if (asset?.status === 'ready' && !session.quarantineCleanedAt) await this.cleanupFinalizedSession(session);
      return this.getDescriptor(session.assetId, principalId);
    }
    if (session.status !== 'open' || session.expiresAt <= this.now()) {
      await this.repository.expireUploadSession(session.id);
      throw new ImageAssetError('UPLOAD_SESSION_EXPIRED', 409, false, 'Upload session has expired');
    }

    const policy = getAssetPolicy(session.purpose);
    try {
      const stored = await this.storage.stat(session.quarantineKey);
      if (stored.byteSize > policy.maxBytes) {
        throw new ImageAssetError('IMAGE_LIMIT_EXCEEDED', 413, false, 'Uploaded image exceeds the byte limit');
      }
      if (stored.byteSize !== session.declaredByteSize) {
        throw new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'Uploaded size does not match the session');
      }
      const buffer = await this.storage.read(session.quarantineKey, policy.maxBytes + 1);
      const validated = await validateImageBuffer(buffer, {
        mime: session.declaredMime,
        byteSize: session.declaredByteSize,
        extension: safeFilenameExtension(session.quarantineKey),
      }, policy);
      const finalized = await this.repository.finalizeUploadSession({
        sessionId: session.id,
        principalId,
        assetId: session.id,
        sha256: validated.sha256,
        originalFilename: originalFilenameFromQuarantineKey(session.quarantineKey),
        detectedMime: validated.mime,
        detectedExtension: validated.extension,
        storageProvider: this.storage.provider,
        byteSize: validated.byteSize,
        width: validated.width,
        height: validated.height,
      });
      if (!finalized.processingRequired) await this.cleanupFinalizedSession(session);
      return this.getDescriptor(finalized.assetId, principalId);
    } catch (error) {
      if (isInvalidUploadError(error)) {
        await this.storage.delete(session.quarantineKey);
        await this.repository.completeExpiredUploadCleanup(session.id, this.now());
      }
      throw error;
    }
  }

  async getDescriptor(assetId: string, principalId: string): Promise<AssetDescriptor> {
    const asset = await this.requireAuthorizedAsset(assetId, principalId);
    const variants = await this.repository.getVariants(asset.id);
    return descriptor(asset, variants);
  }

  async getAccessUrls(requests: AccessUrlRequest[], principalId: string): Promise<AccessUrlResult[]> {
    if (requests.length > 100) {
      throw new ImageAssetError('IMAGE_LIMIT_EXCEEDED', 413, false, 'At most 100 asset URLs may be requested');
    }
    return Promise.all(requests.map(async (request) => {
      const asset = await this.requireReadyAsset(request.assetId, principalId);
      const variant = await this.requireVariant(asset.id, request.variant);
      const signed = await this.storage.signGet(variant.objectKey, this.accessUrlTtlSeconds);
      return { ...request, url: signed.url, expiresAt: signed.expiresAt };
    }));
  }

  async readContent(assetId: string, variantName: AssetVariantName, principalId: string): Promise<AssetContent> {
    const asset = await this.requireReadyAsset(assetId, principalId);
    const variant = await this.requireVariant(asset.id, variantName);
    const body = await this.storage.read(variant.objectKey, variant.byteSize);
    return {
      body,
      mime: variant.mime,
      byteSize: body.length,
      etag: `\"${asset.sha256}-${variantName}\"`,
    };
  }

  async replaceCompanyImage(companyId: number, role: CompanyImageRole, assetId: string | null): Promise<void> {
    await this.repository.replaceCompanyImage(companyId, role, assetId);
  }

  async attachProductImages(productId: number, assetIds: string[]): Promise<void> {
    await this.repository.attachProductImages(productId, assetIds);
  }

  async detachProductImage(productId: number, assetId: string): Promise<void> {
    await this.repository.detachProductImage(productId, assetId);
  }

  private async requireReadyAsset(assetId: string, principalId: string): Promise<ImageAssetRecord> {
    const asset = await this.requireAuthorizedAsset(assetId, principalId);
    if (asset.status !== 'ready') {
      throw new ImageAssetError('ASSET_NOT_READY', 409, true, 'Asset is not ready');
    }
    return asset;
  }

  private async requireAuthorizedAsset(assetId: string, principalId: string): Promise<ImageAssetRecord> {
    const asset = await this.repository.getAsset(assetId);
    if (!asset) throw new ImageAssetError('ASSET_NOT_FOUND', 404, false, 'Asset not found');
    const creatorWindowOpen = asset.createdBy === principalId
      && this.now().getTime() < asset.createdAt.getTime() + CREATOR_BINDING_WINDOW_MS
      && asset.status !== 'recycled'
      && asset.status !== 'purged';
    if (asset.refCount <= 0 && !creatorWindowOpen) {
      throw new ImageAssetError('ASSET_ACCESS_DENIED', 403, false, 'Asset access is denied');
    }
    return asset;
  }

  private async requireVariant(assetId: string, variantName: AssetVariantName): Promise<AssetVariantRecord> {
    const variant = (await this.repository.getVariants(assetId)).find((candidate) => candidate.variant === variantName);
    if (!variant) throw new ImageAssetError('ASSET_NOT_READY', 409, true, 'Asset variant is not ready');
    return variant;
  }

  private async cleanupFinalizedSession(session: { id: string; quarantineKey: string }): Promise<void> {
    if (await this.storage.exists(session.quarantineKey)) await this.storage.delete(session.quarantineKey);
    if (await this.storage.exists(session.quarantineKey)) {
      throw new ImageAssetError('STORAGE_UNAVAILABLE', 503, true, 'Finalized quarantine image still exists');
    }
    await this.repository.markUploadSessionQuarantineCleaned(session.id, this.now());
  }
}

function descriptor(asset: ImageAssetRecord, variants: AssetVariantRecord[]): AssetDescriptor {
  const mapped: AssetDescriptor['variants'] = {};
  for (const variant of variants) {
    mapped[variant.variant] = { width: variant.width, height: variant.height, byteSize: variant.byteSize };
  }
  return {
    id: asset.id,
    status: asset.status,
    purpose: asset.purpose,
    detectedMime: asset.detectedMime,
    byteSize: asset.byteSize,
    width: asset.width,
    height: asset.height,
    variants: mapped,
    errorCode: asset.errorCode,
  };
}

function safeFilenameExtension(filename: string): string | undefined {
  const extension = path.extname(safeOriginalFilename(filename)).slice(1).toLowerCase();
  return /^[a-z0-9]+$/.test(extension) ? extension : undefined;
}

function safeOriginalFilename(filename: string): string {
  const basename = path.posix.basename(filename.replace(/\\/g, '/')).trim();
  return basename || 'image';
}

function originalFilenameFromQuarantineKey(key: string): string {
  const basename = path.posix.basename(key.replace(/\\/g, '/'));
  const separator = basename.indexOf('~');
  if (separator < 0) return basename;
  const extensionIndex = basename.lastIndexOf('.');
  const encoded = basename.slice(separator + 1, extensionIndex > separator ? extensionIndex : undefined);
  try {
    return safeOriginalFilename(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return basename;
  }
}

function safeGeneratedId(value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Generated asset ID is unsafe');
  return value;
}

function isInvalidUploadError(error: unknown): error is ImageAssetError {
  return error instanceof ImageAssetError
    && (error.code === 'IMAGE_CONTENT_INVALID' || error.code === 'IMAGE_LIMIT_EXCEEDED');
}
