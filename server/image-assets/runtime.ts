import path from 'node:path';

import COS from 'cos-nodejs-sdk-v5';

import { CosStorageAdapter, type CosSdkBoundary } from './cosStorage';
import { ImageAssetError } from './errors';
import { LocalStorageAdapter } from './localStorage';
import { MySqlAssetRepository } from './mysqlRepository';
import { getAssetPolicy } from './policy';
import type { AssetRepository } from './repository';
import { ImageAssetService } from './service';
import { expiresAt, type StorageAdapter, type UploadGrant } from './storage';
import { ImageAssetWorker } from './worker';

const DEFAULT_ACCESS_URL_TTL_SECONDS = 300;
const DEFAULT_UPLOAD_GRANT_TTL_SECONDS = 900;
const DEFAULT_UPLOAD_SESSION_TTL_SECONDS = 86_400;
const DEFAULT_RECYCLE_DAYS = 30;

export interface ImageAssetRuntimeConfig {
  imageAssetsEnabled: boolean;
  companyImageAssetsEnabled: boolean;
  productImageAssetsEnabled: boolean;
  storageProvider: 'cos' | 'local';
  signedUrlTtlSeconds: number;
  uploadGrantTtlSeconds: number;
  uploadSessionTtlSeconds: number;
  recycleDays: number;
}

export interface LocalUploadInput {
  body: Buffer;
  contentLength: number;
  contentType: string;
  principalId: string;
}

export interface ImageAssetRuntime {
  readonly enabled: boolean;
  readonly storageProvider: 'cos' | 'local';
  readonly config: ImageAssetRuntimeConfig;
  readonly service: ImageAssetService | null;
  readonly worker: ImageAssetWorker | null;
  uploadLocalContent?(sessionId: string, input: LocalUploadInput): Promise<void>;
}

export interface CreateImageAssetRuntimeOptions {
  env?: NodeJS.ProcessEnv;
  mysqlPool?: ConstructorParameters<typeof MySqlAssetRepository>[0];
  repository?: AssetRepository;
  storage?: StorageAdapter;
  cosSdk?: CosSdkBoundary;
  localStorageRoot?: string;
  now?: () => Date;
}

export function createImageAssetRuntime(options: CreateImageAssetRuntimeOptions = {}): ImageAssetRuntime {
  const env = options.env ?? process.env;
  const config = readConfig(env);
  if (!config.imageAssetsEnabled) {
    return {
      enabled: false,
      storageProvider: config.storageProvider,
      config,
      service: null,
      worker: null,
    };
  }

  const repository = options.repository
    ?? (options.mysqlPool ? new MySqlAssetRepository(options.mysqlPool) : null);
  if (!repository) throw new Error('MySQL is required when image assets are enabled');

  const storage = options.storage ?? createStorage(config.storageProvider, env, options);
  if (storage.provider !== config.storageProvider) {
    throw new Error('Configured asset storage provider does not match the injected adapter');
  }
  const serviceStorage = storage.provider === 'local'
    ? new LocalHttpGrantStorage(storage)
    : storage;
  const now = options.now ?? (() => new Date());
  const service = new ImageAssetService(repository, serviceStorage, {
    now,
    uploadGrantTtlSeconds: config.uploadGrantTtlSeconds,
    uploadSessionTtlSeconds: config.uploadSessionTtlSeconds,
    accessUrlTtlSeconds: config.signedUrlTtlSeconds,
  });
  const worker = new ImageAssetWorker(repository, storage, { now });

  const runtime: ImageAssetRuntime = {
    enabled: true,
    storageProvider: config.storageProvider,
    config,
    service,
    worker,
  };
  if (storage.provider === 'local') {
    runtime.uploadLocalContent = async (sessionId, input) => {
      const session = await repository.getUploadSession(sessionId);
      if (!session) throw new ImageAssetError('ASSET_NOT_FOUND', 404, false, 'Upload session not found');
      if (session.createdBy !== input.principalId) {
        throw new ImageAssetError('ASSET_ACCESS_DENIED', 403, false, 'Upload session access is denied');
      }
      if (session.status !== 'open' || session.expiresAt <= now()) {
        throw new ImageAssetError('UPLOAD_SESSION_EXPIRED', 409, false, 'Upload session has expired');
      }
      const policy = getAssetPolicy(session.purpose);
      if (session.declaredByteSize > policy.maxBytes || input.contentLength > policy.maxBytes) {
        throw new ImageAssetError('IMAGE_LIMIT_EXCEEDED', 413, false, 'Uploaded image exceeds the purpose limit');
      }
      if (
        !Number.isSafeInteger(input.contentLength)
        || input.contentLength <= 0
        || input.contentLength !== session.declaredByteSize
        || input.body.length !== input.contentLength
      ) {
        throw new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'Uploaded size does not match the session');
      }
      if (input.contentType.toLowerCase() !== session.declaredMime.toLowerCase()) {
        throw new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'Uploaded content type does not match the session');
      }
      await storage.put(session.quarantineKey, input.body, session.declaredMime);
    };
  }
  return runtime;
}

function readConfig(env: NodeJS.ProcessEnv): ImageAssetRuntimeConfig {
  const recycleDays = positiveIntegerEnv(env, 'ASSET_RECYCLE_DAYS', DEFAULT_RECYCLE_DAYS);
  if (recycleDays !== DEFAULT_RECYCLE_DAYS) {
    throw new Error('ASSET_RECYCLE_DAYS must remain exactly 30');
  }
  return {
    imageAssetsEnabled: booleanEnv(env, 'IMAGE_ASSETS_ENABLED', false),
    companyImageAssetsEnabled: booleanEnv(env, 'COMPANY_IMAGE_ASSETS_ENABLED', false),
    productImageAssetsEnabled: booleanEnv(env, 'PRODUCT_IMAGE_ASSETS_ENABLED', false),
    storageProvider: storageProvider(env.ASSET_STORAGE_PROVIDER),
    signedUrlTtlSeconds: positiveIntegerEnv(env, 'ASSET_SIGNED_URL_TTL_SECONDS', DEFAULT_ACCESS_URL_TTL_SECONDS),
    uploadGrantTtlSeconds: positiveIntegerEnv(env, 'ASSET_UPLOAD_GRANT_TTL_SECONDS', DEFAULT_UPLOAD_GRANT_TTL_SECONDS),
    uploadSessionTtlSeconds: positiveIntegerEnv(env, 'ASSET_UPLOAD_SESSION_TTL_SECONDS', DEFAULT_UPLOAD_SESSION_TTL_SECONDS),
    recycleDays,
  };
}

function booleanEnv(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be "true" or "false"`);
}

function positiveIntegerEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function storageProvider(raw: string | undefined): 'cos' | 'local' {
  const value = raw?.trim().toLowerCase() || 'cos';
  if (value === 'cos' || value === 'local') return value;
  throw new Error('ASSET_STORAGE_PROVIDER must be "cos" or "local"');
}

function createStorage(
  provider: 'cos' | 'local',
  env: NodeJS.ProcessEnv,
  options: CreateImageAssetRuntimeOptions,
): StorageAdapter {
  if (provider === 'local') {
    return new LocalStorageAdapter(options.localStorageRoot ?? path.join(process.cwd(), 'image-assets'));
  }

  const secretId = env.COS_SECRET_ID?.trim();
  const secretKey = env.COS_SECRET_KEY?.trim();
  const region = env.COS_REGION?.trim();
  const bucket = env.COS_BUCKET?.trim();
  if (!secretId || !secretKey || !region || !bucket) {
    throw new Error('COS configuration is incomplete for image asset storage');
  }
  const sdk = options.cosSdk ?? new COS({ SecretId: secretId, SecretKey: secretKey }) as unknown as CosSdkBoundary;
  return new CosStorageAdapter({ bucket, region }, sdk);
}

class LocalHttpGrantStorage implements StorageAdapter {
  readonly provider = 'local' as const;

  constructor(private readonly local: StorageAdapter) {}

  async createUploadGrant(key: string, mime: string, maxBytes: number, expiresSeconds: number): Promise<UploadGrant> {
    const match = /^quarantine\/([a-zA-Z0-9_-]+)\//.exec(key);
    if (!match) throw new Error('Local upload key does not contain a safe session ID');
    return {
      url: `/api/image-assets/upload-sessions/${encodeURIComponent(match[1])}/content`,
      method: 'PUT',
      headers: { 'Content-Type': mime },
      maxBytes,
      expiresAt: expiresAt(expiresSeconds),
    };
  }

  stat(key: string) { return this.local.stat(key); }
  read(key: string, maxBytes: number) { return this.local.read(key, maxBytes); }
  put(key: string, body: Buffer, contentType: string) { return this.local.put(key, body, contentType); }
  delete(key: string) { return this.local.delete(key); }
  exists(key: string) { return this.local.exists(key); }
  signGet(key: string, expiresSeconds: number) { return this.local.signGet(key, expiresSeconds); }
}
