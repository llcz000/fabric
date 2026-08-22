import { fetchAssetBlob } from './imageAssets';

type CompanyImageRole = 'brand_logo' | 'wechat_qr' | 'alipay_qr';
type CaptureImage = Pick<HTMLImageElement, 'complete' | 'dataset' | 'decode' | 'naturalWidth' | 'src'>;

export interface CaptureResourceOptions {
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
}

export interface PreparedCaptureClone {
  clone: HTMLElement;
  objectUrls: string[];
}

const COMPANY_IMAGE_ROLES = new Set<CompanyImageRole>(['brand_logo', 'wechat_qr', 'alipay_qr']);

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

export async function waitForCaptureImages(images: Iterable<CaptureImage>): Promise<void> {
  await Promise.all(Array.from(images, async (image) => {
    if (image.complete && image.naturalWidth > 0) {
      if (typeof image.decode === 'function') {
        try {
          await image.decode();
        } catch {
          // Already decoded images can reject decode() in some browsers.
        }
      }
      return;
    }

    try {
      await image.decode();
    } catch (error) {
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

  try {
    const replacements = await Promise.allSettled(sourceImages.map(async (sourceImage, index) => {
      const role = companyImageRole(sourceImage);
      const cloneImage = cloneImages[index];
      if (!role || !cloneImage) return;
      const blob = await fetchAssetBlob(contentUrl(role), { apiFetch });
      const objectUrl = createObjectUrl(blob);
      objectUrls.push(objectUrl);
      cloneImage.src = objectUrl;
    }));
    const failedReplacement = replacements.find((result) => result.status === 'rejected');
    if (failedReplacement?.status === 'rejected') throw failedReplacement.reason;
    await waitForCaptureImages(cloneImages);
    return { clone, objectUrls };
  } catch (error) {
    releaseCaptureResources(objectUrls, resources);
    throw error;
  }
}

export function releaseCaptureResources(objectUrls: Iterable<string>, resources: CaptureResourceOptions = {}): void {
  const revokeObjectUrl = resources.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));
  for (const objectUrl of objectUrls) revokeObjectUrl(objectUrl);
}
