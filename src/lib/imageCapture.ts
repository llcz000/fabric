import { fetchAssetBlob } from './imageAssets';

type CompanyImageRole = 'brand_logo' | 'wechat_qr' | 'alipay_qr';
type CaptureImage = Pick<HTMLImageElement, 'complete' | 'dataset' | 'decode' | 'naturalWidth' | 'src'>;

export interface CaptureResourceOptions {
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface PreparedCaptureClone {
  clone: HTMLElement;
  objectUrls: string[];
}

const COMPANY_IMAGE_ROLES = new Set<CompanyImageRole>(['brand_logo', 'wechat_qr', 'alipay_qr']);
const DEFAULT_CAPTURE_TIMEOUT_MS = 15_000;

function companyImageRole(image: CaptureImage): CompanyImageRole | null {
  const role = image.dataset.companyImageRole;
  return role && COMPANY_IMAGE_ROLES.has(role as CompanyImageRole) ? role as CompanyImageRole : null;
}

function contentUrl(role: CompanyImageRole): string {
  return `/api/company/images/${role}/content`;
}

function imageLabel(image: CaptureImage): string {
  return (image.dataset.companyImageRole ?? image.src) || 'image';
}

export async function waitForCaptureImages(images: Iterable<CaptureImage>, signal?: AbortSignal): Promise<void> {
  await Promise.all(Array.from(images, async (image) => {
    throwIfAborted(signal);
    if (image.complete && image.naturalWidth > 0) {
      if (typeof image.decode === 'function') {
        try {
          await waitWithSignal(image.decode(), signal);
        } catch (error) {
          if (signal?.aborted) throw abortReason(signal);
          // Already decoded images can reject decode() in some browsers.
        }
      }
      return;
    }

    try {
      await waitWithSignal(image.decode(), signal);
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal);
      if (image.complete && image.naturalWidth > 0) return;
      throw new Error(`Unable to load ${imageLabel(image)} for image export`, { cause: error });
    }

    if (!image.complete || image.naturalWidth <= 0) {
      throw new Error(`Unable to load ${imageLabel(image)} for image export`);
    }
  }));
}

export async function prepareCaptureClone(
  source: HTMLElement,
  apiFetch: typeof fetch,
  resources: CaptureResourceOptions = {},
): Promise<PreparedCaptureClone> {
  const clone = source.cloneNode(true) as HTMLElement;
  const sourceImages = Array.from(source.querySelectorAll('img'));
  const cloneImages = Array.from(clone.querySelectorAll('img'));
  const createObjectUrl = resources.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const objectUrls: string[] = [];
  const abortScope = createAbortScope(resources.signal, resources.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS);

  try {
    throwIfAborted(abortScope.signal);
    const replacements = await Promise.allSettled(sourceImages.map(async (sourceImage, index) => {
      const role = companyImageRole(sourceImage);
      const cloneImage = cloneImages[index];
      if (!role || !cloneImage) return;
      const blob = await waitWithSignal(
        fetchAssetBlob(contentUrl(role), { apiFetch, signal: abortScope.signal }),
        abortScope.signal,
      );
      const objectUrl = createObjectUrl(blob);
      objectUrls.push(objectUrl);
      cloneImage.src = objectUrl;
    }));
    const failedReplacement = replacements.find((result) => result.status === 'rejected');
    if (failedReplacement?.status === 'rejected') throw failedReplacement.reason;
    await waitForCaptureImages(cloneImages, abortScope.signal);
    return { clone, objectUrls };
  } catch (error) {
    releaseCaptureResources(objectUrls, resources);
    throw error;
  } finally {
    abortScope.dispose();
  }
}

export async function withPreparedCapture<T>(
  source: HTMLElement,
  apiFetch: typeof fetch,
  capture: (clone: HTMLElement) => Promise<T>,
  resources: CaptureResourceOptions = {},
): Promise<T> {
  const prepared = await prepareCaptureClone(source, apiFetch, resources);
  try {
    return await capture(prepared.clone);
  } finally {
    releaseCaptureResources(prepared.objectUrls, resources);
  }
}

export function releaseCaptureResources(objectUrls: Iterable<string>, resources: CaptureResourceOptions = {}): void {
  const revokeObjectUrl = resources.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));
  for (const objectUrl of objectUrls) revokeObjectUrl(objectUrl);
}

function createAbortScope(parentSignal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(abortReason(parentSignal));
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  const timeout = setTimeout(() => {
    controller.abort(new DOMException('Image export preparation timed out', 'TimeoutError'));
  }, Math.max(1, timeoutMs));
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException('Image export cancelled', 'AbortError');
}

function waitWithSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortReason(signal));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
  });
}
