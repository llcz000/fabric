import { createHash } from 'node:crypto';

import { ImageAssetError } from './errors';
import type { AssetPolicy } from './types';

type SharpFactory = typeof import('sharp')['default'];

const SHARP_MODULE: string = 'sharp';

export interface DeclaredImage {
  mime: string;
  byteSize: number;
  extension?: string;
}

export interface ValidatedImage {
  mime: string;
  extension: string;
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
}

const FORMAT_DETAILS: Record<string, { mime: string; extension: string }> = {
  jpeg: { mime: 'image/jpeg', extension: 'jpg' },
  png: { mime: 'image/png', extension: 'png' },
  webp: { mime: 'image/webp', extension: 'webp' },
  gif: { mime: 'image/gif', extension: 'gif' },
};

export async function validateImageBuffer(
  buffer: Buffer,
  declared: DeclaredImage,
  policy: AssetPolicy,
): Promise<ValidatedImage> {
  if (buffer.length > policy.maxBytes) throw limitError('Image exceeds the byte limit');
  if (declared.byteSize !== buffer.length) throw invalidError('Declared image size does not match uploaded bytes');

  try {
    const sharp = await loadSharp();
    const image = sharp(buffer, { limitInputPixels: policy.maxPixels, animated: false });
    const metadata = await image.metadata();
    const details = metadata.format ? FORMAT_DETAILS[metadata.format] : undefined;
    if (!details || !metadata.width || !metadata.height) throw invalidError('Unsupported or undecodable image content');
    if (metadata.width * metadata.height > policy.maxPixels) throw limitError('Image exceeds the pixel limit');
    if (!policy.allowedMimes.has(details.mime)) throw invalidError('Image type is not allowed');
    if (declared.mime.toLowerCase() !== details.mime) throw invalidError('Declared MIME does not match image content');
    if (declared.extension && !extensionsMatch(declared.extension, details.extension)) {
      throw invalidError('Declared extension does not match image content');
    }

    await image.clone().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();

    return {
      mime: details.mime,
      extension: details.extension,
      width: metadata.width,
      height: metadata.height,
      byteSize: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    };
  } catch (error) {
    if (error instanceof ImageAssetError) throw error;
    if (/pixel limit|exceeds.*pixels|input image exceeds/i.test(String(error))) {
      throw limitError('Image exceeds the pixel limit');
    }
    throw invalidError('Image content is invalid');
  }
}

async function loadSharp(): Promise<SharpFactory> {
  return (await import(SHARP_MODULE)).default;
}

function extensionsMatch(declared: string, detected: string): boolean {
  const normalized = declared.replace(/^\./, '').toLowerCase();
  if (detected === 'jpg') return normalized === 'jpg' || normalized === 'jpeg';
  return normalized === detected;
}

function invalidError(message: string): ImageAssetError {
  return new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, message);
}

function limitError(message: string): ImageAssetError {
  return new ImageAssetError('IMAGE_LIMIT_EXCEEDED', 413, false, message);
}
