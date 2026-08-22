import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { ImageAssetError } from './errors';
import type { AssetRepository } from './repository';
import { createImageAssetRouter, type ImageAssetRouteRuntime, type ImageAssetRouteService } from './routes';
import { createImageAssetRuntime } from './runtime';
import type { StorageAdapter } from './storage';
import type { AssetDescriptor, UploadSessionRecord } from './types';

const READY_DESCRIPTOR: AssetDescriptor = {
  id: 'asset-1',
  status: 'ready',
  purpose: 'company_logo',
  detectedMime: 'image/png',
  byteSize: 4,
  width: 1,
  height: 1,
  variants: { original: { width: 1, height: 1, byteSize: 4 } },
};

function routeService(overrides: Partial<ImageAssetRouteService> = {}): ImageAssetRouteService {
  return {
    async createUploadSession(input) {
      if (input.principalId !== 'admin') throw new Error('bearer token was used as the principal');
      return {
        sessionId: 'session-1',
        uploadUrl: 'https://upload.example.test/signed',
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        expiresAt: '2026-08-22T01:15:00.000Z',
      };
    },
    async finalizeUploadSession(_sessionId, principalId) {
      if (principalId !== 'admin') throw new Error('bearer token was used as the principal');
      return READY_DESCRIPTOR;
    },
    async getDescriptor(_assetId, principalId) {
      if (principalId !== 'admin') throw new Error('bearer token was used as the principal');
      return READY_DESCRIPTOR;
    },
    async getAccessUrls(_requests, principalId) {
      if (principalId !== 'admin') throw new Error('bearer token was used as the principal');
      return [{
        assetId: 'asset-1',
        variant: 'display',
        url: 'https://read.example.test/signed',
        expiresAt: '2026-08-22T01:05:00.000Z',
      }];
    },
    async readContent(_assetId, _variant, principalId) {
      if (principalId !== 'admin') throw new Error('bearer token was used as the principal');
      return { body: Buffer.from('png!'), mime: 'image/png', byteSize: 4, etag: '"hash-original"' };
    },
    ...overrides,
  };
}

function routeRuntime(overrides: Partial<ImageAssetRouteRuntime> = {}): ImageAssetRouteRuntime {
  return {
    enabled: true,
    storageProvider: 'cos',
    service: routeService(),
    ...overrides,
  };
}

async function withHttpServer<T>(runtime: ImageAssetRouteRuntime, work: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use('/api', (req, res, next) => {
    if (req.headers.authorization !== 'Bearer accepted-admin-token') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });
  app.use('/api/image-assets', createImageAssetRouter(runtime));

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const { port } = server.address() as AddressInfo;
  try {
    return await work(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function authenticatedJson(method: string, body?: unknown, requestId?: string): RequestInit {
  return {
    method,
    headers: {
      Authorization: 'Bearer accepted-admin-token',
      'Content-Type': 'application/json',
      ...(requestId ? { 'X-Request-Id': requestId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

interface RawHttpRequestOptions {
  method: string;
  contentType: string;
  chunks: Buffer[];
  chunked?: boolean;
}

async function requestWithBody(url: string, options: RawHttpRequestOptions) {
  const target = new URL(url);
  return await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const contentLength = options.chunks.reduce((total, chunk) => total + chunk.length, 0);
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: options.method,
      headers: {
        Authorization: 'Bearer accepted-admin-token',
        'Content-Type': options.contentType,
        ...(options.chunked
          ? { 'Transfer-Encoding': 'chunked' }
          : { 'Content-Length': String(contentLength) }),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.once('error', reject);
    for (const chunk of options.chunks) request.write(chunk);
    request.end();
  });
}

function requestWithJsonBody(url: string, method: string, body: unknown) {
  return requestWithBody(url, {
    method,
    contentType: 'application/json',
    chunks: [Buffer.from(JSON.stringify(body))],
  });
}

test('upload session crosses real HTTP auth and returns only the public grant contract', async () => {
  const service = routeService({
    async createUploadSession(input) {
      if (input.principalId !== 'admin') throw new Error('bearer token was used as the principal');
      return {
        sessionId: 'session-1',
        uploadUrl: 'https://upload.example.test/signed',
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        expiresAt: '2026-08-22T01:15:00.000Z',
        quarantineKey: 'quarantine/session-1/private.png',
        secret: 'must-not-cross-http',
      } as never;
    },
  });

  await withHttpServer(routeRuntime({ service }), async (baseUrl) => {
    const unauthenticated = await fetch(`${baseUrl}/api/image-assets/upload-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-unauthenticated' },
      body: JSON.stringify({
        purpose: 'company_logo',
        originalFilename: 'logo.png',
        declaredMime: 'image/png',
        declaredByteSize: 4,
      }),
    });
    assert.equal(unauthenticated.status, 401);

    const response = await fetch(`${baseUrl}/api/image-assets/upload-sessions`, authenticatedJson('POST', {
      purpose: 'company_logo',
      originalFilename: 'logo.png',
      declaredMime: 'image/png',
      declaredByteSize: 4,
    }, 'req-upload-1'));

    assert.equal(response.status, 201);
    assert.equal(response.headers.get('x-request-id'), 'req-upload-1');
    assert.deepEqual(await response.json(), {
      sessionId: 'session-1',
      uploadUrl: 'https://upload.example.test/signed',
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      expiresAt: '2026-08-22T01:15:00.000Z',
    });
  });
});

test('repeated finalize requests return the same stable assetId', async () => {
  await withHttpServer(routeRuntime(), async (baseUrl) => {
    const first = await fetch(`${baseUrl}/api/image-assets/upload-sessions/session-1/finalize`, authenticatedJson('POST', {}));
    const second = await fetch(`${baseUrl}/api/image-assets/upload-sessions/session-1/finalize`, authenticatedJson('POST', {}));

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal((await first.json()).assetId, 'asset-1');
    assert.equal((await second.json()).assetId, 'asset-1');
  });
});

test('processing descriptors map to a safe 409 ASSET_NOT_READY response with a generated request ID', async () => {
  const service = routeService({
    async getDescriptor() {
      return { ...READY_DESCRIPTOR, status: 'processing' };
    },
  });

  await withHttpServer(routeRuntime({ service }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/image-assets/asset-1`, {
      headers: { Authorization: 'Bearer accepted-admin-token' },
    });
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.error.code, 'ASSET_NOT_READY');
    assert.equal(body.error.retryable, true);
    assert.match(body.error.requestId, /^[a-zA-Z0-9_-]+$/);
    assert.equal(response.headers.get('x-request-id'), body.error.requestId);
  });
});

test('authorization errors never expose object keys, signed queries, or secret-bearing exception text', async () => {
  const service = routeService({
    async getDescriptor() {
      throw new ImageAssetError(
        'ASSET_ACCESS_DENIED',
        403,
        false,
        'denied quarantine/admin/private.png?sign=secret-value SecretKey=also-secret',
      );
    },
  });

  await withHttpServer(routeRuntime({ service }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/image-assets/asset-1`, {
      headers: { Authorization: 'Bearer accepted-admin-token', 'X-Request-Id': 'req-denied-1' },
    });
    const text = await response.text();
    const body = JSON.parse(text);

    assert.equal(response.status, 403);
    assert.equal(body.error.code, 'ASSET_ACCESS_DENIED');
    assert.equal(body.error.requestId, 'req-denied-1');
    assert.doesNotMatch(text, /quarantine|private\.png|sign=|secret|object.?key/i);
  });
});

test('content responses preserve actual MIME and private anti-sniffing cache headers', async () => {
  await withHttpServer(routeRuntime(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/image-assets/asset-1/content?variant=original`, {
      headers: { Authorization: 'Bearer accepted-admin-token' },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('etag'), '"hash-original"');
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'png!');
  });
});

test('bulk access rejects request 101 before the service boundary', async () => {
  const service = routeService({
    async getAccessUrls() {
      throw new Error('bulk cap was not enforced at the HTTP boundary');
    },
  });
  const requests = Array.from({ length: 101 }, (_, index) => ({ assetId: `asset-${index}`, variant: 'display' }));

  await withHttpServer(routeRuntime({ service }), async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/image-assets/access-urls`,
      authenticatedJson('POST', { requests }, 'req-bulk-101'),
    );
    const body = await response.json();

    assert.equal(response.status, 413);
    assert.equal(body.error.code, 'IMAGE_LIMIT_EXCEEDED');
    assert.equal(body.error.requestId, 'req-bulk-101');
  });
});

test('strict route inputs reject arbitrary URL fields', async () => {
  await withHttpServer(routeRuntime(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/image-assets/upload-sessions`, authenticatedJson('POST', {
      purpose: 'company_logo',
      originalFilename: 'logo.png',
      declaredMime: 'image/png',
      declaredByteSize: 4,
      url: 'https://attacker.example/image.png',
    }, 'req-arbitrary-url'));
    const text = await response.text();

    assert.equal(response.status, 422);
    assert.equal(JSON.parse(text).error.code, 'IMAGE_CONTENT_INVALID');
    assert.doesNotMatch(text, /attacker\.example/);
  });
});

test('enabled POST routes reject arbitrary URL query parameters', async () => {
  await withHttpServer(routeRuntime(), async (baseUrl) => {
    const upload = await fetch(
      `${baseUrl}/api/image-assets/upload-sessions?url=${encodeURIComponent('https://attacker.example/upload.png')}`,
      authenticatedJson('POST', {
        purpose: 'company_logo',
        originalFilename: 'logo.png',
        declaredMime: 'image/png',
        declaredByteSize: 4,
      }),
    );
    const access = await fetch(
      `${baseUrl}/api/image-assets/access-urls?url=${encodeURIComponent('https://attacker.example/read.png')}`,
      authenticatedJson('POST', { requests: [{ assetId: 'asset-1', variant: 'display' }] }),
    );

    assert.equal(upload.status, 422);
    assert.equal((await upload.json()).error.code, 'IMAGE_CONTENT_INVALID');
    assert.equal(access.status, 422);
    assert.equal((await access.json()).error.code, 'IMAGE_CONTENT_INVALID');
  });
});

test('enabled descriptor, content, and finalize routes reject arbitrary URL JSON bodies', async () => {
  await withHttpServer(routeRuntime(), async (baseUrl) => {
    const descriptor = await requestWithJsonBody(
      `${baseUrl}/api/image-assets/asset-1`,
      'GET',
      { url: 'https://attacker.example/descriptor.png' },
    );
    const content = await requestWithJsonBody(
      `${baseUrl}/api/image-assets/asset-1/content?variant=original`,
      'GET',
      { url: 'https://attacker.example/content.png' },
    );
    const finalize = await fetch(
      `${baseUrl}/api/image-assets/upload-sessions/session-1/finalize`,
      authenticatedJson('POST', { url: 'https://attacker.example/finalize.png' }),
    );

    assert.equal(descriptor.status, 422);
    assert.equal(JSON.parse(descriptor.text).error.code, 'IMAGE_CONTENT_INVALID');
    assert.equal(content.status, 422);
    assert.equal(JSON.parse(content.text).error.code, 'IMAGE_CONTENT_INVALID');
    assert.equal(finalize.status, 422);
    assert.equal((await finalize.json()).error.code, 'IMAGE_CONTENT_INVALID');
  });
});

test('empty-body endpoints reject fixed-length and chunked non-JSON bodies', async () => {
  await withHttpServer(routeRuntime(), async (baseUrl) => {
    const descriptor = await requestWithBody(`${baseUrl}/api/image-assets/asset-1`, {
      method: 'GET',
      contentType: 'text/plain',
      chunks: [Buffer.from('url=https://attacker.example/descriptor.png')],
    });
    const content = await requestWithBody(`${baseUrl}/api/image-assets/asset-1/content?variant=original`, {
      method: 'GET',
      contentType: 'text/plain',
      chunks: [Buffer.from('url=https://attacker.example/'), Buffer.from('content.png')],
      chunked: true,
    });
    const finalize = await requestWithBody(
      `${baseUrl}/api/image-assets/upload-sessions/session-1/finalize`,
      {
        method: 'POST',
        contentType: 'application/octet-stream',
        chunks: [Buffer.from('not-empty')],
        chunked: true,
      },
    );

    assert.equal(descriptor.status, 422);
    assert.equal(JSON.parse(descriptor.text).error.code, 'IMAGE_CONTENT_INVALID');
    assert.equal(content.status, 422);
    assert.equal(JSON.parse(content.text).error.code, 'IMAGE_CONTENT_INVALID');
    assert.equal(finalize.status, 422);
    assert.equal(JSON.parse(finalize.text).error.code, 'IMAGE_CONTENT_INVALID');
  });
});

test('empty-body endpoints accept a zero-length chunked raw body', async () => {
  await withHttpServer(routeRuntime(), async (baseUrl) => {
    const response = await requestWithBody(
      `${baseUrl}/api/image-assets/upload-sessions/session-1/finalize`,
      {
        method: 'POST',
        contentType: 'text/plain',
        chunks: [],
        chunked: true,
      },
    );

    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.text).assetId, 'asset-1');
  });
});

test('declared JSON endpoints reject fixed-length and chunked JSON-shaped text bodies', async () => {
  await withHttpServer(routeRuntime(), async (baseUrl) => {
    const uploadPayload = Buffer.from(JSON.stringify({
      purpose: 'company_logo',
      originalFilename: 'logo.png',
      declaredMime: 'image/png',
      declaredByteSize: 4,
    }));
    const accessPayload = Buffer.from(JSON.stringify({
      requests: [{ assetId: 'asset-1', variant: 'display' }],
    }));
    const upload = await requestWithBody(`${baseUrl}/api/image-assets/upload-sessions`, {
      method: 'POST',
      contentType: 'text/plain',
      chunks: [uploadPayload],
    });
    const access = await requestWithBody(`${baseUrl}/api/image-assets/access-urls`, {
      method: 'POST',
      contentType: 'text/plain',
      chunks: [accessPayload.subarray(0, 12), accessPayload.subarray(12)],
      chunked: true,
    });

    assert.equal(upload.status, 422);
    assert.equal(JSON.parse(upload.text).error.code, 'IMAGE_CONTENT_INVALID');
    assert.equal(access.status, 422);
    assert.equal(JSON.parse(access.text).error.code, 'IMAGE_CONTENT_INVALID');
  });
});

test('declared JSON endpoints reject urlencoded bodies with schema-compatible fields', async () => {
  const form = Buffer.from('requests%5B0%5D%5BassetId%5D=asset-1&requests%5B0%5D%5Bvariant%5D=display');

  await withHttpServer(routeRuntime(), async (baseUrl) => {
    const response = await requestWithBody(`${baseUrl}/api/image-assets/access-urls`, {
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      chunks: [form],
    });

    assert.equal(response.status, 422);
    assert.equal(JSON.parse(response.text).error.code, 'IMAGE_CONTENT_INVALID');
  });
});

test('enabled asset parser maps malformed and oversized JSON to safe 4xx errors', async () => {
  const oversized = Buffer.alloc(10 * 1024 * 1024 + 2, 0x61);

  await withHttpServer(routeRuntime(), async (baseUrl) => {
    const malformed = await requestWithBody(`${baseUrl}/api/image-assets/upload-sessions`, {
      method: 'POST',
      contentType: 'application/json',
      chunks: [Buffer.from('{"secret":"must-not-leak"')],
    });
    const tooLarge = await requestWithBody(`${baseUrl}/api/image-assets/upload-sessions`, {
      method: 'POST',
      contentType: 'application/json',
      chunks: [oversized],
    });

    assert.equal(malformed.status, 422);
    assert.equal(JSON.parse(malformed.text).error.code, 'IMAGE_CONTENT_INVALID');
    assert.doesNotMatch(malformed.text, /SyntaxError|must-not-leak|secret/i);
    assert.equal(tooLarge.status, 413);
    assert.equal(JSON.parse(tooLarge.text).error.code, 'IMAGE_LIMIT_EXCEEDED');
    assert.doesNotMatch(tooLarge.text, /aaaaa/);
  });
});

test('enabled asset parser maps malformed and oversized urlencoded bodies to safe 4xx errors', async () => {
  const tooDeep = Buffer.from(`root${'[child]'.repeat(40)}=value`);
  const oversized = Buffer.from(`padding=${'a'.repeat(10 * 1024 * 1024 + 2)}`);

  await withHttpServer(routeRuntime(), async (baseUrl) => {
    const malformed = await requestWithBody(`${baseUrl}/api/image-assets/access-urls`, {
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      chunks: [tooDeep],
    });
    const tooLarge = await requestWithBody(`${baseUrl}/api/image-assets/access-urls`, {
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      chunks: [oversized],
    });

    assert.equal(malformed.status, 422);
    assert.equal(JSON.parse(malformed.text).error.code, 'IMAGE_CONTENT_INVALID');
    assert.doesNotMatch(malformed.text, /RangeError|root|child/i);
    assert.equal(tooLarge.status, 413);
    assert.equal(JSON.parse(tooLarge.text).error.code, 'IMAGE_LIMIT_EXCEEDED');
    assert.doesNotMatch(tooLarge.text, /aaaaa/);
  });
});

test('JSON null is rejected on finalize and descriptor empty-body channels', async () => {
  await withHttpServer(routeRuntime(), async (baseUrl) => {
    const finalize = await requestWithBody(
      `${baseUrl}/api/image-assets/upload-sessions/session-1/finalize`,
      { method: 'POST', contentType: 'application/json', chunks: [Buffer.from('null')] },
    );
    const descriptor = await requestWithBody(`${baseUrl}/api/image-assets/asset-1`, {
      method: 'GET',
      contentType: 'application/json',
      chunks: [Buffer.from('nu'), Buffer.from('ll')],
      chunked: true,
    });

    assert.equal(finalize.status, 422);
    assert.equal(JSON.parse(finalize.text).error.code, 'IMAGE_CONTENT_INVALID');
    assert.equal(descriptor.status, 422);
    assert.equal(JSON.parse(descriptor.text).error.code, 'IMAGE_CONTENT_INVALID');
  });
});

test('one-byte and parser raw-body overflow map to safe asset limit errors', async () => {
  const oneByteOverflow = Buffer.alloc(10 * 1024 * 1024 + 1, 0x61);
  const overParserLimit = Buffer.alloc(10 * 1024 * 1024 + 2, 0x62);

  await withHttpServer(routeRuntime(), async (baseUrl) => {
    const oneByteResponse = await requestWithBody(`${baseUrl}/api/image-assets/asset-1`, {
      method: 'GET',
      contentType: 'text/plain',
      chunks: [oneByteOverflow],
    });
    const parserResponse = await requestWithBody(`${baseUrl}/api/image-assets/asset-1`, {
      method: 'GET',
      contentType: 'text/plain',
      chunks: [overParserLimit.subarray(0, 6 * 1024 * 1024), overParserLimit.subarray(6 * 1024 * 1024)],
      chunked: true,
    });

    assert.equal(oneByteResponse.status, 413);
    assert.equal(JSON.parse(oneByteResponse.text).error.code, 'IMAGE_LIMIT_EXCEEDED');
    assert.doesNotMatch(oneByteResponse.text, /aaaaa/);
    assert.equal(parserResponse.status, 413);
    assert.equal(JSON.parse(parserResponse.text).error.code, 'IMAGE_LIMIT_EXCEEDED');
    assert.doesNotMatch(parserResponse.text, /bbbbb/);
  });
});

test('access URL request objects reject extra fields', async () => {
  await withHttpServer(routeRuntime(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/image-assets/access-urls`, authenticatedJson('POST', {
      requests: [{
        assetId: 'asset-1',
        variant: 'display',
        url: 'https://attacker.example/nested.png',
      }],
    }));

    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'IMAGE_CONTENT_INVALID');
  });
});

test('disabled runtime returns JSON-fallback-safe 503 without constructing a service', async () => {
  await withHttpServer({ enabled: false, storageProvider: 'cos', service: null }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/image-assets/upload-sessions`, authenticatedJson('POST', {
      purpose: 'company_logo',
      originalFilename: 'logo.png',
      declaredMime: 'image/png',
      declaredByteSize: 4,
    }, 'req-disabled'));
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.error.code, 'STORAGE_UNAVAILABLE');
    assert.equal(body.error.requestId, 'req-disabled');
  });
});

function uploadSession(overrides: Partial<UploadSessionRecord> = {}): UploadSessionRecord {
  return {
    id: 'session-local',
    purpose: 'company_logo',
    quarantineKey: 'quarantine/session-local/server-owned.png',
    declaredByteSize: 4,
    declaredMime: 'image/png',
    createdBy: 'admin',
    expiresAt: new Date('2026-08-22T02:00:00.000Z'),
    status: 'open',
    ...overrides,
  };
}

function localRuntime(session: UploadSessionRecord | null, writes: Array<{ key: string; body: Buffer; mime: string }>) {
  const repository = {
    async getUploadSession(id: string) {
      return session?.id === id ? session : null;
    },
  } as unknown as AssetRepository;
  const storage = {
    provider: 'local',
    async put(key: string, body: Buffer, mime: string) {
      writes.push({ key, body, mime });
    },
  } as unknown as StorageAdapter;
  return createImageAssetRuntime({
    env: {
      IMAGE_ASSETS_ENABLED: 'true',
      ASSET_STORAGE_PROVIDER: 'local',
      ASSET_SIGNED_URL_TTL_SECONDS: '300',
      ASSET_UPLOAD_GRANT_TTL_SECONDS: '900',
      ASSET_UPLOAD_SESSION_TTL_SECONDS: '86400',
      ASSET_RECYCLE_DAYS: '30',
    },
    repository,
    storage,
    now: () => new Date('2026-08-22T01:00:00.000Z'),
  });
}

test('local runtime returns its authenticated session content endpoint as the upload grant', async () => {
  const repository = {
    async createUploadSession(input: Omit<UploadSessionRecord, 'status'>) {
      return { ...input, status: 'open' as const };
    },
  } as unknown as AssetRepository;
  const storage = {
    provider: 'local',
    async createUploadGrant() {
      throw new Error('LocalStorageAdapter must not create a public URL');
    },
  } as unknown as StorageAdapter;
  const runtime = createImageAssetRuntime({
    env: { IMAGE_ASSETS_ENABLED: 'true', ASSET_STORAGE_PROVIDER: 'local' },
    repository,
    storage,
    now: () => new Date('2026-08-22T01:00:00.000Z'),
  });

  const grant = await runtime.service!.createUploadSession({
    purpose: 'company_logo',
    originalFilename: 'logo.png',
    declaredMime: 'image/png',
    declaredByteSize: 4,
    principalId: 'admin',
  });

  assert.equal(grant.uploadUrl, `/api/image-assets/upload-sessions/${grant.sessionId}/content`);
  assert.deepEqual(grant.headers, { 'Content-Type': 'image/png' });
  assert.equal(grant.method, 'PUT');
});

test('local-only PUT writes exactly the matched session quarantine key', async () => {
  const writes: Array<{ key: string; body: Buffer; mime: string }> = [];
  const runtime = localRuntime(uploadSession(), writes);

  await withHttpServer(runtime, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/image-assets/upload-sessions/session-local/content`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer accepted-admin-token', 'Content-Type': 'image/png' },
      body: Buffer.from('png!'),
    });

    assert.equal(response.status, 204);
    assert.deepEqual(writes, [{
      key: 'quarantine/session-local/server-owned.png',
      body: Buffer.from('png!'),
      mime: 'image/png',
    }]);
  });
});

test('local-only PUT rejects arbitrary URL query parameters before writing', async () => {
  const writes: Array<{ key: string; body: Buffer; mime: string }> = [];
  const runtime = localRuntime(uploadSession(), writes);

  await withHttpServer(runtime, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/image-assets/upload-sessions/session-local/content?url=${encodeURIComponent('https://attacker.example/put.png')}`,
      {
        method: 'PUT',
        headers: { Authorization: 'Bearer accepted-admin-token', 'Content-Type': 'image/png' },
        body: Buffer.from('png!'),
      },
    );

    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'IMAGE_CONTENT_INVALID');
    assert.deepEqual(writes, []);
  });
});

test('local-only PUT rejects mismatched length, purpose limit, and expiry before storage writes', async () => {
  const cases = [
    { name: 'declared length', session: uploadSession({ declaredByteSize: 5 }), body: Buffer.from('four'), code: 'IMAGE_CONTENT_INVALID' },
    {
      name: 'purpose limit',
      session: uploadSession({ declaredByteSize: 2 * 1024 * 1024 + 1 }),
      body: Buffer.alloc(2 * 1024 * 1024 + 1),
      code: 'IMAGE_LIMIT_EXCEEDED',
    },
    {
      name: 'expiry',
      session: uploadSession({ expiresAt: new Date('2026-08-22T00:59:59.000Z') }),
      body: Buffer.from('png!'),
      code: 'UPLOAD_SESSION_EXPIRED',
    },
  ];

  for (const fixture of cases) {
    const writes: Array<{ key: string; body: Buffer; mime: string }> = [];
    await withHttpServer(localRuntime(fixture.session, writes), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/image-assets/upload-sessions/session-local/content`, {
        method: 'PUT',
        headers: { Authorization: 'Bearer accepted-admin-token', 'Content-Type': 'image/png' },
        body: fixture.body,
      });
      const body = await response.json();

      assert.notEqual(response.status, 204, fixture.name);
      assert.equal(body.error.code, fixture.code, fixture.name);
      assert.deepEqual(writes, [], fixture.name);
    });
  }
});

test('COS runtime never exposes the development upload content endpoint', async () => {
  await withHttpServer(routeRuntime(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/image-assets/upload-sessions/session-1/content`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer accepted-admin-token', 'Content-Type': 'image/png' },
      body: Buffer.from('png!'),
    });
    assert.equal(response.status, 404);
  });
});

test('enabled runtime fails construction without MySQL and never falls back to JSON', () => {
  assert.throws(() => createImageAssetRuntime({
    env: { IMAGE_ASSETS_ENABLED: 'true', ASSET_STORAGE_PROVIDER: 'local' },
  }), /MySQL.*required/i);
});

test('product image feature requires the unified image runtime and never selects JSON fallback', () => {
  assert.throws(() => createImageAssetRuntime({
    env: { PRODUCT_IMAGE_ASSETS_ENABLED: 'true', ASSET_STORAGE_PROVIDER: 'local' },
  }), /Invalid image asset feature configuration/);

  assert.throws(() => createImageAssetRuntime({
    env: { IMAGE_ASSETS_ENABLED: 'true', PRODUCT_IMAGE_ASSETS_ENABLED: 'true', ASSET_STORAGE_PROVIDER: 'local' },
  }), /MySQL.*required/i);
});

test('production COS runtime fails safely when configuration is incomplete', () => {
  let caught: unknown;
  try {
    createImageAssetRuntime({
      env: {
        NODE_ENV: 'production',
        IMAGE_ASSETS_ENABLED: 'true',
        ASSET_STORAGE_PROVIDER: 'cos',
        COS_SECRET_ID: 'configured-id',
        COS_SECRET_KEY: 'super-secret-value',
        COS_REGION: 'ap-shanghai',
      },
      repository: {} as AssetRepository,
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof Error);
  assert.match(caught.message, /COS configuration is incomplete/i);
  assert.doesNotMatch(caught.message, /configured-id|super-secret-value|ap-shanghai/);
});

test('runtime rejects unknown providers instead of selecting local storage', () => {
  assert.throws(() => createImageAssetRuntime({
    env: { IMAGE_ASSETS_ENABLED: 'true', ASSET_STORAGE_PROVIDER: 'automatic' },
    repository: {} as AssetRepository,
  }), /ASSET_STORAGE_PROVIDER/);
});

test('runtime rejects recycle periods that violate the exact 30-day retention rule', () => {
  assert.throws(() => createImageAssetRuntime({
    env: {
      IMAGE_ASSETS_ENABLED: 'true',
      ASSET_STORAGE_PROVIDER: 'local',
      ASSET_RECYCLE_DAYS: '31',
    },
    repository: {} as AssetRepository,
  }), /ASSET_RECYCLE_DAYS.*30/);
});
