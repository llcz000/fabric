type CaptureImage = Pick<HTMLImageElement, 'complete' | 'decode' | 'naturalWidth' | 'src'>;
type FetchImage = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function loadCaptureImageBlob(
  src: string,
  proxyUrl: string,
  proxyHeaders: Record<string, string>,
  fetchImage: FetchImage = fetch,
): Promise<Blob> {
  try {
    const directResponse = await fetchImage(src, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    });
    if (directResponse.ok) {
      const directBlob = await directResponse.blob();
      if (directBlob.type.startsWith('image/')) return directBlob;
    }
  } catch {
    // CORS or client networking can block direct access; the authenticated
    // same-origin proxy is the fallback for those images.
  }

  const proxyResponse = await fetchImage(proxyUrl, { headers: proxyHeaders });
  if (!proxyResponse.ok) {
    let hostname = 'remote image';
    try {
      hostname = new URL(src).hostname || hostname;
    } catch {
      // Keep the generic label for malformed URLs.
    }
    throw new Error(`${hostname} proxy returned HTTP ${proxyResponse.status}`);
  }
  return proxyResponse.blob();
}

export function shouldProxyImageForCapture(src: string, pageOrigin: string): boolean {
  try {
    const url = new URL(src, pageOrigin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== pageOrigin;
  } catch {
    return false;
  }
}

function imageLabel(image: CaptureImage): string {
  if (image.src.startsWith('data:')) return 'embedded image';

  try {
    return new URL(image.src).hostname || 'image';
  } catch {
    return 'image';
  }
}

export async function waitForCaptureImages(images: Iterable<CaptureImage>): Promise<void> {
  await Promise.all(Array.from(images, async (image) => {
    if (image.complete && image.naturalWidth > 0) {
      if (typeof image.decode === 'function') {
        try {
          await image.decode();
        } catch {
          // Some browsers reject decode() for an already-rendered image.
          // naturalWidth still proves that the image is available to capture.
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
