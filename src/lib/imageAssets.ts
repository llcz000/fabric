export type AssetPurpose = 'company_logo' | 'company_qr' | 'product_image';
export type AssetStatus = 'quarantine' | 'processing' | 'ready' | 'recycled' | 'degraded' | 'purged';

export interface AssetDescriptor {
  id: string;
  status: AssetStatus;
  purpose: AssetPurpose;
  detectedMime: string;
  byteSize: number;
  width: number;
  height: number;
  variants: Partial<Record<'original' | 'display' | 'thumbnail', { width: number; height: number; byteSize: number }>>;
  errorCode?: string;
}

export interface ImageAssetClientErrorShape {
  code: string;
  message: string;
  requestId?: string;
  retryable: boolean;
}

export class ImageAssetClientError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly retryable: boolean;

  constructor(input: ImageAssetClientErrorShape) {
    super(input.message);
    this.name = 'ImageAssetClientError';
    this.code = input.code;
    this.requestId = input.requestId;
    this.retryable = input.retryable;
  }
}

export interface UploadImageAssetOptions {
  apiFetch: typeof fetch;
  directFetch?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface WaitForReadyAssetOptions {
  apiFetch: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface FetchAssetBlobOptions {
  apiFetch: typeof fetch;
  signal?: AbortSignal;
}

export interface ApplyCompanyImageMutationsOptions {
  apiFetch: typeof fetch;
  reloadCompanyProfile: () => Promise<unknown>;
}

interface UploadGrant {
  sessionId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

const COMPANY_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_TIMEOUT_MS = 60_000;

export async function uploadImageAsset(
  file: File,
  purpose: AssetPurpose,
  options: UploadImageAssetOptions,
): Promise<AssetDescriptor> {
  validateSelectedFile(file, purpose);
  const grant = await requestJson<UploadGrant>(options.apiFetch, '/api/image-assets/upload-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      purpose,
      originalFilename: file.name,
      declaredMime: file.type || 'application/octet-stream',
      declaredByteSize: file.size,
    }),
  });

  const uploadHeaders = new Headers(grant.headers);
  uploadHeaders.delete('Authorization');
  const upload = await (options.directFetch ?? fetch)(grant.uploadUrl, {
    method: grant.method,
    headers: uploadHeaders,
    body: file,
  });
  if (!upload.ok) throw await toClientError(upload);

  const finalized = await requestJson<AssetDescriptor>(
    options.apiFetch,
    `/api/image-assets/upload-sessions/${encodeURIComponent(grant.sessionId)}/finalize`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  );
  if (finalized.status === 'ready') return finalized;
  if (finalized.status === 'degraded' || finalized.status === 'purged' || finalized.status === 'recycled') {
    throw new ImageAssetClientError({
      code: finalized.errorCode ?? 'ASSET_PROCESSING_FAILED',
      message: '图片处理失败，请重新上传。',
      retryable: false,
    });
  }
  return waitForReadyAsset(finalized.id, options);
}

export async function waitForReadyAsset(
  assetId: string,
  options: WaitForReadyAssetOptions,
): Promise<AssetDescriptor> {
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  for (;;) {
    try {
      const descriptor = await requestJson<AssetDescriptor>(options.apiFetch, `/api/image-assets/${encodeURIComponent(assetId)}`);
      if (descriptor.status === 'ready') return descriptor;
      if (descriptor.status === 'degraded' || descriptor.status === 'purged' || descriptor.status === 'recycled') {
        throw new ImageAssetClientError({
          code: descriptor.errorCode ?? 'ASSET_PROCESSING_FAILED',
          message: '图片处理失败，请重新上传。',
          retryable: false,
        });
      }
    } catch (error) {
      if (error instanceof ImageAssetClientError && !error.retryable) throw error;
    }
    if (Date.now() >= deadline) {
      throw new ImageAssetClientError({
        code: 'ASSET_NOT_READY',
        message: '图片处理超时，请稍后重试。',
        retryable: true,
      });
    }
    await pause(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  }
}

export async function fetchAssetBlob(contentUrl: string, options: FetchAssetBlobOptions): Promise<Blob> {
  if (!isSameOriginContentUrl(contentUrl)) {
    throw new ImageAssetClientError({
      code: 'ASSET_ACCESS_DENIED',
      message: '图片必须通过同源受控内容地址读取。',
      retryable: false,
    });
  }
  const response = await options.apiFetch(contentUrl, { signal: options.signal });
  if (!response.ok) throw await toClientError(response);
  return response.blob();
}

export async function applyCompanyImageMutations(
  mutations: CompanyImageMutation[],
  options: ApplyCompanyImageMutationsOptions,
): Promise<void> {
  try {
    for (const mutation of mutations) {
      const response = await options.apiFetch(`/api/company/images/${mutation.role}`, mutation.action === 'replace'
        ? {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assetId: mutation.assetId }),
        }
        : { method: 'DELETE' });
      if (!response.ok) throw await toClientError(response);
    }
  } catch (error) {
    try {
      await options.reloadCompanyProfile();
    } catch {
      // The original mutation error remains the useful error for the editor.
    }
    throw error;
  }
}

function validateSelectedFile(file: File, purpose: AssetPurpose): void {
  const limit = purpose === 'product_image' ? 10 * 1024 * 1024 : COMPANY_IMAGE_MAX_BYTES;
  if (!file.type.startsWith('image/')) {
    throw new ImageAssetClientError({ code: 'IMAGE_CONTENT_INVALID', message: '请选择图片文件。', retryable: false });
  }
  if (file.size <= 0 || file.size > limit) {
    throw new ImageAssetClientError({ code: 'IMAGE_LIMIT_EXCEEDED', message: '图片文件大小超出限制。', retryable: false });
  }
}

async function requestJson<T>(apiFetch: typeof fetch, input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await apiFetch(input, init);
  if (!response.ok) throw await toClientError(response);
  return response.json() as Promise<T>;
}

async function toClientError(response: Response): Promise<ImageAssetClientError> {
  let body: { error?: Partial<ImageAssetClientErrorShape> } | undefined;
  try {
    body = await response.json() as { error?: Partial<ImageAssetClientErrorShape> };
  } catch {
    body = undefined;
  }
  const error = body?.error;
  return new ImageAssetClientError({
    code: typeof error?.code === 'string' ? error.code : 'ASSET_PROCESSING_FAILED',
    message: typeof error?.message === 'string' ? error.message : '图片请求失败，请稍后重试。',
    requestId: typeof error?.requestId === 'string' ? error.requestId : response.headers.get('X-Request-Id') ?? undefined,
    retryable: error?.retryable === true,
  });
}

function isSameOriginContentUrl(value: string): boolean {
  if (value.startsWith('/')) return value.startsWith('/api/');
  if (typeof window === 'undefined') return false;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

function pause(delayMs: number): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
import type { CompanyImageMutation } from './companyImageState';
