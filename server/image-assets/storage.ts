import type { AssetVariantName } from './types';

const ASSET_VARIANTS = new Set<AssetVariantName>(['original', 'display', 'thumbnail']);

export interface UploadGrant {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  maxBytes: number;
  expiresAt: string;
}

export interface StorageAdapter {
  readonly provider: 'cos' | 'local';
  createUploadGrant(key: string, mime: string, maxBytes: number, expiresSeconds: number): Promise<UploadGrant>;
  stat(key: string): Promise<{ byteSize: number; contentType?: string }>;
  read(key: string, maxBytes: number): Promise<Buffer>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  signGet(key: string, expiresSeconds: number): Promise<{ url: string; expiresAt: string }>;
}

export function assetObjectKey(hash: string, variant: AssetVariantName, extension: string): string {
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error('Asset hash must be a SHA-256 hex digest');
  if (!ASSET_VARIANTS.has(variant) || variant.includes('/') || variant.includes('\\') || variant.includes('..')) {
    throw new Error('Asset variant must be original, display, or thumbnail');
  }
  if (!/^[a-z0-9]+$/i.test(extension)) throw new Error('Asset extension must be alphanumeric');
  return `assets/sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}/${variant}.${extension.toLowerCase()}`;
}

export function expiresAt(expiresSeconds: number): string {
  if (!Number.isSafeInteger(expiresSeconds) || expiresSeconds <= 0) throw new Error('Expiry must be a positive number of seconds');
  return new Date(Date.now() + expiresSeconds * 1_000).toISOString();
}
