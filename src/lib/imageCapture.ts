type CaptureImage = Pick<HTMLImageElement, 'complete' | 'decode' | 'naturalWidth' | 'src'>;

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
