import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CosStorageAdapter, type CosSdkBoundary, type CosStorageConfig } from './cosStorage';
import { ImageAssetError } from './errors';
import { readLegacyImage, parseManagedCosUrl } from './legacySource';
import { LocalStorageAdapter } from './localStorage';
import { assetObjectKey } from './storage';

const cosConfig: CosStorageConfig = {
  bucket: 'assets-1250000000',
  region: 'ap-shanghai',
};

function recordingCos(body = Buffer.from('image-bytes')): { client: CosSdkBoundary; calls: Array<{ name: string; params: Record<string, unknown> }> } {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const client: CosSdkBoundary = {
    getObjectUrl(params) {
      calls.push({ name: 'getObjectUrl', params });
      return `https://signed.example/${encodeURIComponent(String(params.Key))}`;
    },
    async headObject(params) {
      calls.push({ name: 'headObject', params });
      return { headers: { 'content-length': String(body.length), 'content-type': 'image/png' } };
    },
    async getObject(params) {
      calls.push({ name: 'getObject', params });
      return { Body: body };
    },
    async putObject(params) {
      calls.push({ name: 'putObject', params });
      return {};
    },
    async deleteObject(params) {
      calls.push({ name: 'deleteObject', params });
      return {};
    },
  };
  return { client, calls };
}

test('content-addressed asset keys shard by the first two hash byte pairs', () => {
  const hash = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';

  assert.equal(assetObjectKey(hash, 'original', 'png'), `assets/sha256/aa/bb/${hash}/original.png`);
});

test('content-addressed asset keys reject unsafe runtime variant casts', () => {
  const hash = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';

  assert.throws(() => assetObjectKey(hash, '../escape' as never, 'png'), /variant/i);
});

test('COS adapter signs constrained PUT and GET object requests through the injected SDK', async () => {
  const recording = recordingCos();
  const adapter = new CosStorageAdapter(cosConfig, recording.client);

  const upload = await adapter.createUploadGrant('quarantine/session-1', 'image/png', 1024, 60);
  const download = await adapter.signGet('assets/a.png', 30);

  assert.deepEqual(recording.calls, [
    {
      name: 'getObjectUrl',
      params: {
        Bucket: cosConfig.bucket,
        Region: cosConfig.region,
        Key: 'quarantine/session-1',
        Sign: true,
        Method: 'PUT',
        Expires: 60,
        Protocol: 'https:',
      },
    },
    {
      name: 'getObjectUrl',
      params: {
        Bucket: cosConfig.bucket,
        Region: cosConfig.region,
        Key: 'assets/a.png',
        Sign: true,
        Method: 'GET',
        Expires: 30,
        Protocol: 'https:',
      },
    },
  ]);
  assert.equal(upload.url, 'https://signed.example/quarantine%2Fsession-1');
  assert.equal(upload.method, 'PUT');
  assert.deepEqual(upload.headers, { 'Content-Type': 'image/png' });
  assert.equal(upload.maxBytes, 1024);
  assert.match(upload.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(download.url, 'https://signed.example/assets%2Fa.png');
  assert.match(download.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('COS adapter enforces read byte limits before downloading an object', async () => {
  const recording = recordingCos(Buffer.alloc(8));
  const adapter = new CosStorageAdapter(cosConfig, recording.client);

  await assert.rejects(
    adapter.read('assets/large.png', 7),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'IMAGE_LIMIT_EXCEEDED',
  );
  assert.deepEqual(recording.calls.map((call) => call.name), ['headObject']);
});

test('COS adapter treats an injected COS not-found response as a missing object', async () => {
  const recording = recordingCos();
  const adapter = new CosStorageAdapter(cosConfig, {
    ...recording.client,
    async headObject(params) {
      recording.calls.push({ name: 'headObject', params });
      throw { statusCode: 404, code: 'NoSuchKey' };
    },
  });

  await assert.rejects(
    adapter.stat('assets/missing.png'),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'ASSET_NOT_FOUND',
  );
  assert.equal(await adapter.exists('assets/missing.png'), false);
  assert.deepEqual(recording.calls.map((call) => call.name), ['headObject', 'headObject']);
});

test('COS adapter maps an object disappearance after stat to ASSET_NOT_FOUND', async () => {
  const recording = recordingCos();
  const adapter = new CosStorageAdapter(cosConfig, {
    ...recording.client,
    async getObject(params) {
      recording.calls.push({ name: 'getObject', params });
      throw { statusCode: 404, code: 'NoSuchKey' };
    },
  });

  await assert.rejects(
    adapter.read('assets/raced-away.png', 32),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'ASSET_NOT_FOUND',
  );
  assert.deepEqual(recording.calls.map((call) => call.name), ['headObject', 'getObject']);
});

test('COS adapter reads an async-iterable object body within its byte limit', async () => {
  const recording = recordingCos();
  const adapter = new CosStorageAdapter(cosConfig, {
    ...recording.client,
    async headObject(params) {
      recording.calls.push({ name: 'headObject', params });
      return { headers: { 'content-length': '5' } };
    },
    async getObject(params) {
      recording.calls.push({ name: 'getObject', params });
      return { Body: streamChunks([Buffer.from('im'), Buffer.from('age')]) };
    },
  });

  assert.deepEqual(await adapter.read('assets/streamed.png', 5), Buffer.from('image'));
});

test('COS adapter stops an underreported async stream when an incoming chunk exceeds the byte limit', async () => {
  const recording = recordingCos();
  const yielded: number[] = [];
  const adapter = new CosStorageAdapter(cosConfig, {
    ...recording.client,
    async headObject(params) {
      recording.calls.push({ name: 'headObject', params });
      return { headers: { 'content-length': '2' } };
    },
    async getObject(params) {
      recording.calls.push({ name: 'getObject', params });
      return { Body: streamChunks([Buffer.alloc(3), Buffer.alloc(3), Buffer.alloc(1)], yielded) };
    },
  });

  await assert.rejects(
    adapter.read('assets/underreported.png', 5),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'IMAGE_LIMIT_EXCEEDED',
  );
  assert.deepEqual(yielded, [1, 2]);
});

test('local adapter reads only keys contained by its root across traversal, sibling-prefix, and drive inputs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'image-assets-root-'));
  const adapter = new LocalStorageAdapter(root);
  try {
    await adapter.put('nested/image.png', Buffer.from('local-image'), 'image/png');

    assert.deepEqual(await adapter.read('nested/image.png', 20), Buffer.from('local-image'));
    assert.deepEqual(await adapter.stat('nested/image.png'), { byteSize: 11 });
    await assert.rejects(
      adapter.read('../image-assets-root-sibling/escape.png', 20),
      (error: unknown) => error instanceof ImageAssetError && error.code === 'ASSET_ACCESS_DENIED',
    );
    await assert.rejects(
      adapter.read('C:\\windows\\temp\\escape.png', 20),
      (error: unknown) => error instanceof ImageAssetError && error.code === 'ASSET_ACCESS_DENIED',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('managed COS URL parsing accepts only the configured bucket and region host', () => {
  assert.deepEqual(
    parseManagedCosUrl(`https://${cosConfig.bucket}.cos.${cosConfig.region}.myqcloud.com/a%20b.png`, cosConfig),
    { key: 'a b.png' },
  );
  assert.equal(parseManagedCosUrl(`https://other-bucket.cos.${cosConfig.region}.myqcloud.com/a.png`, cosConfig), null);
  assert.equal(parseManagedCosUrl(`https://${cosConfig.bucket}.cos.ap-beijing.myqcloud.com/a.png`, cosConfig), null);
  assert.equal(parseManagedCosUrl('https://images.example.com/a.png', cosConfig), null);
});

test('legacy resolution reads only managed COS, contained local files, and bounded raster data URLs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'image-assets-legacy-'));
  const localPath = path.join(root, 'legacy.png');
  const recording = recordingCos(Buffer.from('cos-image'));
  const storage = new CosStorageAdapter(cosConfig, recording.client);
  await writeFile(localPath, 'local-image');
  try {
    assert.deepEqual(
      await readLegacyImage(`https://${cosConfig.bucket}.cos.${cosConfig.region}.myqcloud.com/legacy.png`, {
        cos: { config: cosConfig, storage },
        localRoot: root,
        maxBytes: 16,
      }),
      Buffer.from('cos-image'),
    );
    assert.deepEqual(
      await readLegacyImage(localPath, { localRoot: root, maxBytes: 16 }),
      Buffer.from('local-image'),
    );
    assert.deepEqual(
      await readLegacyImage('data:image/png;base64,aW1hZ2U=', { maxBytes: 16 }),
      Buffer.from('image'),
    );
    assert.equal(
      await readLegacyImage('https://images.example.com/a.png', { cos: { config: cosConfig, storage }, maxBytes: 16 }),
      null,
    );
    await assert.rejects(
      readLegacyImage('data:image/png;base64,MTIzNDU=', { maxBytes: 4 }),
      (error: unknown) => error instanceof ImageAssetError && error.code === 'IMAGE_LIMIT_EXCEEDED',
    );
    assert.deepEqual(recording.calls.map((call) => call.name), ['headObject', 'getObject']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function* streamChunks(chunks: Buffer[], yielded?: number[]): AsyncGenerator<Buffer> {
  for (const [index, chunk] of chunks.entries()) {
    yielded?.push(index + 1);
    yield chunk;
  }
}
