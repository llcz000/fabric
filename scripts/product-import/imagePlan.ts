import { createHash } from 'node:crypto';

import sharp, { type Sharp } from 'sharp';

import type { PlannedIssue } from './normalize';

export interface MaterializedImportImage {
  body: Buffer;
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  extension: string;
  width: number;
  height: number;
  sha256: string;
  originMetadata: Record<string, string | number>;
  issues: PlannedIssue[];
}

export interface ImageMaterializeOptions { maxPixels?: number; }

export async function inspectPlannedImage(bytes: Buffer, sourceRef: string): Promise<{ format: string; width: number; height: number; mpo: boolean }> {
  try {
    const image = sharp(bytes, { animated: false, limitInputPixels: false, failOn: 'error' });
    const metadata = await image.metadata();
    if (!metadata.format || !metadata.width || !metadata.height) throw new Error('missing image metadata');
    await image.clone().stats();
    return { format: metadata.format, width: metadata.width, height: metadata.height, mpo: isMpo(bytes) };
  } catch (error) {
    throw new Error(`IMAGE_DECODE_FAILED at ${sourceRef}: ${error instanceof Error ? error.message : 'unable to decode image'}`);
  }
}

export async function materializeImportImage(bytes: Buffer, sourceRef: string, options: ImageMaterializeOptions = {}): Promise<MaterializedImportImage> {
  const maxPixels = options.maxPixels ?? 40_000_000;
  if (!Number.isSafeInteger(maxPixels) || maxPixels < 1) throw new Error('Invalid maxPixels');
  const inspected = await inspectPlannedImage(bytes, sourceRef);
  const allowed = new Set(['jpeg', 'png', 'webp', 'gif']);
  if (!allowed.has(inspected.format)) throw new Error(`IMAGE_DECODE_FAILED at ${sourceRef}: unsupported ${inspected.format}`);
  const issues: PlannedIssue[] = [];
  const originMetadata: Record<string, string | number> = { sourceRef, originalWidth: inspected.width, originalHeight: inspected.height };
  let pipeline = sharp(bytes, { animated: false, limitInputPixels: false, failOn: 'error' }).rotate();
  let format = inspected.format;
  let transformed = false;
  if (inspected.mpo) {
    format = 'jpeg';
    transformed = true;
    originMetadata.convertedFrom = 'image/mpo';
    issues.push(imageIssue('IMAGE_FORMAT_CONVERTED', 'MPO 图片已转换为 JPEG', sourceRef));
  }
  if (inspected.width * inspected.height > maxPixels) {
    const scale = Math.sqrt(maxPixels / (inspected.width * inspected.height));
    const width = Math.max(1, Math.floor(inspected.width * scale));
    const height = Math.max(1, Math.floor(inspected.height * scale));
    pipeline = pipeline.resize({ width, height, fit: 'inside', withoutEnlargement: true });
    transformed = true;
    originMetadata.resizedFromPixels = inspected.width * inspected.height;
    issues.push(imageIssue('IMAGE_RESIZED', '图片已按比例缩小到像素上限内', sourceRef));
  }
  if (transformed) pipeline = encode(pipeline, format);
  const body = transformed ? await pipeline.toBuffer() : Buffer.from(bytes);
  const result = await sharp(body, { animated: false, limitInputPixels: false }).metadata();
  if (!result.width || !result.height) throw new Error(`IMAGE_DECODE_FAILED at ${sourceRef}: output metadata missing`);
  const mime = mimeFor(format);
  return {
    body, mime, extension: format === 'jpeg' ? 'jpg' : format,
    width: result.width, height: result.height,
    sha256: createHash('sha256').update(body).digest('hex'), originMetadata, issues,
  };
}

function isMpo(bytes: Buffer): boolean {
  return bytes.subarray(0, Math.min(bytes.length, 64 * 1024)).includes(Buffer.from('MPF\0', 'binary'));
}

function encode(image: Sharp, format: string): Sharp {
  if (format === 'jpeg') return image.jpeg({ quality: 90 });
  if (format === 'png') return image.png();
  if (format === 'webp') return image.webp({ quality: 90 });
  return image.gif();
}

function mimeFor(format: string): MaterializedImportImage['mime'] {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'png') return 'image/png';
  if (format === 'webp') return 'image/webp';
  return 'image/gif';
}

function imageIssue(code: string, message: string, sourceRef: string): PlannedIssue {
  return { code, fieldName: 'images', message, sourceRef, severity: 'info' };
}
