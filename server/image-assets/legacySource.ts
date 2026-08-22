import { ImageAssetError } from './errors';
import type { CosStorageConfig } from './cosStorage';
import { readContainedLocalFile } from './localStorage';
import type { StorageAdapter } from './storage';

const RASTER_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export interface LegacySourceOptions {
  cos?: { config: CosStorageConfig; storage: StorageAdapter };
  localRoot?: string;
  maxBytes: number;
}

function validKey(key: string): boolean {
  return Boolean(key)
    && !key.includes('\\')
    && !key.includes('\0')
    && key.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

export function parseManagedCosUrl(value: string, config: CosStorageConfig): { key: string } | null {
  try {
    const url = new URL(value);
    const expectedHost = `${config.bucket}.cos.${config.region}.myqcloud.com`.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.hostname !== expectedHost || url.port) return null;
    const key = decodeURIComponent(url.pathname.slice(1));
    return validKey(key) ? { key } : null;
  } catch {
    return null;
  }
}

function decodeRasterDataUrl(value: string, maxBytes: number): Buffer | null {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value);
  if (!match || !RASTER_MIMES.has(match[1].toLowerCase())) return null;
  const encoded = match[2];
  if (encoded.length % 4 !== 0 || (encoded.includes('=') && !/={1,2}$/.test(encoded))) return null;
  if (encoded.length > Math.ceil(maxBytes / 3) * 4) {
    throw new ImageAssetError('IMAGE_LIMIT_EXCEEDED', 413, false, 'Legacy data URL exceeds the configured byte limit');
  }
  const body = Buffer.from(encoded, 'base64');
  if (body.length > maxBytes) throw new ImageAssetError('IMAGE_LIMIT_EXCEEDED', 413, false, 'Legacy data URL exceeds the configured byte limit');
  return body;
}

export async function readLegacyImage(source: unknown, options: LegacySourceOptions): Promise<Buffer | null> {
  if (typeof source !== 'string' || !source) return null;
  if (source.startsWith('data:')) return decodeRasterDataUrl(source, options.maxBytes);

  if (options.cos) {
    const managed = parseManagedCosUrl(source, options.cos.config);
    if (managed) return options.cos.storage.read(managed.key, options.maxBytes);
  }

  try {
    const protocol = new URL(source).protocol;
    if (protocol === 'http:' || protocol === 'https:') return null;
  } catch {
    // Local paths are not URLs and are evaluated only against the configured root below.
  }

  if (!options.localRoot) return null;
  try {
    return await readContainedLocalFile(options.localRoot, source, options.maxBytes);
  } catch (error) {
    if (error instanceof ImageAssetError && error.code === 'IMAGE_LIMIT_EXCEEDED') throw error;
    return null;
  }
}
