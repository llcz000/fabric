import { mkdir, readFile, realpath, stat as fileStat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ImageAssetError } from './errors';
import type { StorageAdapter, UploadGrant } from './storage';

function deniedPath(): ImageAssetError {
  return new ImageAssetError('ASSET_ACCESS_DENIED', 403, false, 'Storage key is outside the local storage root');
}

function exceedsLimit(): ImageAssetError {
  return new ImageAssetError('IMAGE_LIMIT_EXCEEDED', 413, false, 'Stored image exceeds the configured byte limit');
}

function isContained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function boundedRead(target: string, maxBytes: number): Promise<Buffer> {
  const metadata = await fileStat(target);
  if (metadata.size > maxBytes) throw exceedsLimit();
  const body = await readFile(target);
  if (body.length > maxBytes) throw exceedsLimit();
  return body;
}

export async function readContainedLocalFile(root: string, candidate: string, maxBytes: number): Promise<Buffer> {
  const resolvedRoot = await realpath(root);
  const target = path.resolve(candidate);
  if (!isContained(resolvedRoot, target)) throw deniedPath();
  const realTarget = await realpath(target);
  if (!isContained(resolvedRoot, realTarget)) throw deniedPath();
  return boundedRead(target, maxBytes);
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly provider = 'local' as const;

  constructor(private readonly root: string) {}

  async createUploadGrant(_key: string, _mime: string, _maxBytes: number, _expiresSeconds: number): Promise<UploadGrant> {
    throw new ImageAssetError('STORAGE_UNAVAILABLE', 503, false, 'Local storage does not support direct browser upload grants');
  }

  async stat(key: string): Promise<{ byteSize: number }> {
    const target = await this.existingPath(key);
    return { byteSize: (await fileStat(target)).size };
  }

  async read(key: string, maxBytes: number): Promise<Buffer> {
    return readContainedLocalFile(await this.rootPath(), await this.existingPath(key), maxBytes);
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const target = await this.writablePath(key);
    await writeFile(target, body);
  }

  async delete(key: string): Promise<void> {
    await unlink(await this.existingPath(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.existingPath(key);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  async signGet(_key: string, _expiresSeconds: number): Promise<{ url: string; expiresAt: string }> {
    throw new ImageAssetError('STORAGE_UNAVAILABLE', 503, false, 'Local storage does not support signed GET URLs');
  }

  private async rootPath(): Promise<string> {
    await mkdir(this.root, { recursive: true });
    return realpath(this.root);
  }

  private async existingPath(key: string): Promise<string> {
    const root = await this.rootPath();
    const target = this.resolveKey(root, key);
    const realTarget = await realpath(target);
    if (!isContained(root, realTarget)) throw deniedPath();
    return target;
  }

  private async writablePath(key: string): Promise<string> {
    const root = await this.rootPath();
    const target = this.resolveKey(root, key);
    await mkdir(path.dirname(target), { recursive: true });
    const parent = await realpath(path.dirname(target));
    if (!isContained(root, parent)) throw deniedPath();
    try {
      const realTarget = await realpath(target);
      if (!isContained(root, realTarget)) throw deniedPath();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return target;
  }

  private resolveKey(root: string, key: string): string {
    if (!key || path.isAbsolute(key) || path.win32.isAbsolute(key)) throw deniedPath();
    const target = path.resolve(root, key);
    if (!isContained(root, target)) throw deniedPath();
    return target;
  }
}
