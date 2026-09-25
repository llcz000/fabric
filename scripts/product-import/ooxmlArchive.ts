import { createReadStream } from 'node:fs';

import { Unzip, UnzipInflate, type UnzipFile } from 'fflate';

export interface ArchiveEntryInfo {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
}

function assertSafeEntryName(name: string): void {
  const normalized = name.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`Unsafe OOXML entry: ${name}`);
  }
}

export class OoxmlArchive {
  private constructor(private readonly filePath: string, private readonly entries: ArchiveEntryInfo[]) {}

  static async open(filePath: string): Promise<OoxmlArchive> {
    const entries: ArchiveEntryInfo[] = [];
    const seen = new Set<string>();
    await scanZip(filePath, (file) => {
      assertSafeEntryName(file.name);
      if (seen.has(file.name)) throw new Error(`Duplicate OOXML entry: ${file.name}`);
      seen.add(file.name);
      entries.push({
        name: file.name,
        compressedSize: file.size ?? 0,
        uncompressedSize: file.originalSize ?? 0,
      });
    });
    return new OoxmlArchive(filePath, entries);
  }

  list(): readonly ArchiveEntryInfo[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  async readText(name: string, maxBytes: number): Promise<string> {
    return new TextDecoder('utf-8', { fatal: true }).decode(await this.readBuffer(name, maxBytes));
  }

  async readBuffer(name: string, maxBytes: number): Promise<Buffer> {
    assertSafeEntryName(name);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('Invalid entry byte limit');
    const info = this.entries.find((entry) => entry.name === name);
    if (!info) throw new Error(`OOXML entry not found: ${name}`);
    if (info.uncompressedSize > maxBytes) throw new Error(`OOXML entry byte limit exceeded: ${name}`);

    const chunks: Buffer[] = [];
    let total = 0;
    let found = false;
    await scanZip(this.filePath, (file) => {
      if (file.name !== name) return;
      found = true;
      file.ondata = (error, chunk) => {
        if (error) throw error;
        total += chunk.byteLength;
        if (total > maxBytes) {
          file.terminate();
          throw new Error(`OOXML entry byte limit exceeded: ${name}`);
        }
        chunks.push(Buffer.from(chunk));
      };
      file.start();
    });
    if (!found) throw new Error(`OOXML entry not found: ${name}`);
    return Buffer.concat(chunks, total);
  }

  async *stream(name: string, maxBytes = 256 * 1024 * 1024): AsyncIterable<Buffer> {
    yield await this.readBuffer(name, maxBytes);
  }
}

async function scanZip(filePath: string, onFile: (file: UnzipFile) => void): Promise<void> {
  let callbackError: unknown;
  const unzip = new Unzip((file) => {
    if (callbackError) return;
    try { onFile(file); } catch (error) { callbackError = error; }
  });
  unzip.register(UnzipInflate);
  try {
    for await (const chunk of createReadStream(filePath)) {
      if (callbackError) throw callbackError;
      unzip.push(new Uint8Array(chunk as Buffer), false);
    }
    unzip.push(new Uint8Array(0), true);
    if (callbackError) throw callbackError;
  } catch (error) {
    throw error instanceof Error ? error : new Error('Unable to read OOXML archive');
  }
}

