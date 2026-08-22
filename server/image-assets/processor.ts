import type { AssetPolicy, AssetVariantName } from './types';
import type { ValidatedImage } from './validator';

type SharpFactory = typeof import('sharp')['default'];

const SHARP_MODULE: string = 'sharp';

export interface ProcessedVariant {
  variant: AssetVariantName;
  body: Buffer;
  mime: string;
  extension: string;
  width: number;
  height: number;
  byteSize: number;
}

export async function generateImageVariants(
  original: Buffer,
  image: ValidatedImage,
  policy: AssetPolicy,
): Promise<ProcessedVariant[]> {
  const sharp = await loadSharp();
  const variants: ProcessedVariant[] = [];
  for (const variant of policy.variants) {
    if (variant === 'original') {
      variants.push({
        variant,
        body: original,
        mime: image.mime,
        extension: image.extension,
        width: image.width,
        height: image.height,
        byteSize: original.length,
      });
      continue;
    }

    const pipeline = sharp(original, { limitInputPixels: policy.maxPixels, animated: false });
    const output = variant === 'display'
      ? await pipeline
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true })
      : await pipeline
        .resize({ width: 320, height: 320, fit: 'cover', position: 'centre' })
        .webp({ quality: 72 })
        .toBuffer({ resolveWithObject: true });

    variants.push({
      variant,
      body: output.data,
      mime: 'image/webp',
      extension: 'webp',
      width: output.info.width,
      height: output.info.height,
      byteSize: output.data.length,
    });
  }
  return variants;
}

async function loadSharp(): Promise<SharpFactory> {
  return (await import(SHARP_MODULE)).default;
}
