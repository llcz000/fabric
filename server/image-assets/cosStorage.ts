import { ImageAssetError } from './errors';
import { expiresAt, type StorageAdapter, type UploadGrant } from './storage';

export interface CosStorageConfig {
  bucket: string;
  region: string;
}

export interface CosObjectRequest {
  Bucket: string;
  Region: string;
  Key: string;
  [name: string]: unknown;
}

export interface CosSdkBoundary {
  getObjectUrl(params: CosObjectRequest): string;
  headObject(params: CosObjectRequest): Promise<{ headers?: Record<string, string | undefined> }>;
  getObject(params: CosObjectRequest): Promise<{ Body: Buffer | Uint8Array }>;
  putObject(params: CosObjectRequest & { Body: Buffer; ContentType: string }): Promise<unknown>;
  deleteObject(params: CosObjectRequest): Promise<unknown>;
}

function storageUnavailable(): ImageAssetError {
  return new ImageAssetError('STORAGE_UNAVAILABLE', 503, true, 'COS storage is unavailable');
}

function assetNotFound(): ImageAssetError {
  return new ImageAssetError('ASSET_NOT_FOUND', 404, false, 'Stored image was not found');
}

function header(headers: Record<string, string | undefined> | undefined, name: string): string | undefined {
  return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
}

function byteSize(headers: Record<string, string | undefined> | undefined): number {
  const value = header(headers, 'content-length');
  const parsed = value == null ? NaN : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw storageUnavailable();
  return parsed;
}

function isNotFound(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && ((error as { statusCode?: unknown }).statusCode === 404 || (error as { code?: unknown }).code === 'NoSuchKey'),
  );
}

export class CosStorageAdapter implements StorageAdapter {
  readonly provider = 'cos' as const;

  constructor(private readonly config: CosStorageConfig, private readonly sdk: CosSdkBoundary) {}

  async createUploadGrant(key: string, mime: string, maxBytes: number, expiresSeconds: number): Promise<UploadGrant> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Maximum upload bytes must be positive');
    const url = this.signedUrl(key, 'PUT', expiresSeconds);
    return { url, method: 'PUT', headers: { 'Content-Type': mime }, maxBytes, expiresAt: expiresAt(expiresSeconds) };
  }

  async stat(key: string): Promise<{ byteSize: number; contentType?: string }> {
    try {
      const result = await this.sdk.headObject(this.objectRequest(key));
      const contentType = header(result.headers, 'content-type');
      return contentType == null ? { byteSize: byteSize(result.headers) } : { byteSize: byteSize(result.headers), contentType };
    } catch (error) {
      if (error instanceof ImageAssetError) throw error;
      if (isNotFound(error)) throw assetNotFound();
      throw storageUnavailable();
    }
  }

  async read(key: string, maxBytes: number): Promise<Buffer> {
    const metadata = await this.stat(key);
    if (metadata.byteSize > maxBytes) throw new ImageAssetError('IMAGE_LIMIT_EXCEEDED', 413, false, 'Stored image exceeds the configured byte limit');
    try {
      const result = await this.sdk.getObject(this.objectRequest(key));
      const body = Buffer.isBuffer(result.Body) ? result.Body : Buffer.from(result.Body);
      if (body.length > maxBytes) throw new ImageAssetError('IMAGE_LIMIT_EXCEEDED', 413, false, 'Stored image exceeds the configured byte limit');
      return body;
    } catch (error) {
      if (error instanceof ImageAssetError) throw error;
      throw storageUnavailable();
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    try {
      await this.sdk.putObject({ ...this.objectRequest(key), Body: body, ContentType: contentType });
    } catch {
      throw storageUnavailable();
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.sdk.deleteObject(this.objectRequest(key));
    } catch {
      throw storageUnavailable();
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.stat(key);
      return true;
    } catch (error) {
      if (error instanceof ImageAssetError && error.code === 'ASSET_NOT_FOUND') return false;
      throw error;
    }
  }

  async signGet(key: string, expiresSeconds: number): Promise<{ url: string; expiresAt: string }> {
    return { url: this.signedUrl(key, 'GET', expiresSeconds), expiresAt: expiresAt(expiresSeconds) };
  }

  private objectRequest(key: string): CosObjectRequest {
    return { Bucket: this.config.bucket, Region: this.config.region, Key: key };
  }

  private signedUrl(key: string, method: 'PUT' | 'GET', expiry: number): string {
    return this.sdk.getObjectUrl({
      ...this.objectRequest(key),
      Sign: true,
      Method: method,
      Expires: expiry,
      Protocol: 'https:',
    });
  }
}
