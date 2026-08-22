import assert from 'node:assert/strict';
import test from 'node:test';

import * as imageAssets from './imageAssets';

interface RecordedRequest {
  input: string;
  method: string;
  authorization: string | null;
}

const READY_ASSET = {
  id: 'asset-ready',
  status: 'ready',
  purpose: 'company_logo',
  detectedMime: 'image/png',
  byteSize: 4,
  width: 1,
  height: 1,
  variants: { display: { width: 1, height: 1, byteSize: 4 } },
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function testFile(): File {
  return new File([new Uint8Array([1, 2, 3, 4])], 'logo.png', { type: 'image/png' });
}

test('uploads through the API, direct PUT, finalize, and status polling without leaking the bearer token', async () => {
  assert.equal(typeof imageAssets.uploadImageAsset, 'function');
  const requests: RecordedRequest[] = [];
  const apiFetch: typeof fetch = async (input, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    requests.push({
      input: String(input),
      method: init.method ?? 'GET',
      authorization: headers.get('Authorization'),
    });
    if (String(input) === '/api/image-assets/upload-sessions') {
      return response({
        sessionId: 'session-1',
        uploadUrl: 'https://fabric-images.example.test/quarantine/session-1',
        method: 'PUT',
        headers: { 'Content-Type': 'image/png', 'X-COS-Meta-Upload': 'session-1' },
        expiresAt: '2026-08-22T01:05:00.000Z',
      }, 201);
    }
    if (String(input) === '/api/image-assets/upload-sessions/session-1/finalize') {
      return response({ ...READY_ASSET, status: 'processing' });
    }
    if (String(input) === '/api/image-assets/asset-ready') return response(READY_ASSET);
    throw new Error(`unexpected API request ${String(input)}`);
  };
  const directFetch: typeof fetch = async (input, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    requests.push({
      input: String(input),
      method: init.method ?? 'GET',
      authorization: headers.get('Authorization'),
    });
    return new Response(null, { status: 200 });
  };

  const result = await imageAssets.uploadImageAsset(testFile(), 'company_logo', {
    apiFetch: async (input, init) => apiFetch(input, {
      ...init,
      headers: { Authorization: 'Bearer admin-token', ...(init?.headers ?? {}) },
    }),
    directFetch,
    pollIntervalMs: 0,
  });

  assert.equal(result.status, 'ready');
  assert.deepEqual(requests.map((request) => request.method), ['POST', 'PUT', 'POST', 'GET']);
  assert.deepEqual(requests.map((request) => request.authorization), ['Bearer admin-token', null, 'Bearer admin-token', 'Bearer admin-token']);
  assert.equal(requests[1].input, 'https://fabric-images.example.test/quarantine/session-1');
});

test('strips accidental authorization headers from a COS upload grant', async () => {
  let directAuthorization: string | null = 'not-called';
  const apiFetch: typeof fetch = async (input) => {
    if (String(input) === '/api/image-assets/upload-sessions') {
      return response({
        sessionId: 'session-header-safety',
        uploadUrl: 'https://fabric-images.example.test/quarantine/session-header-safety',
        method: 'PUT',
        headers: { Authorization: 'Bearer should-not-reach-cos', 'X-COS-Meta-Upload': 'session-header-safety' },
        expiresAt: '2026-08-22T01:05:00.000Z',
      }, 201);
    }
    if (String(input).endsWith('/finalize')) return response(READY_ASSET);
    throw new Error(`unexpected API request ${String(input)}`);
  };

  await imageAssets.uploadImageAsset(testFile(), 'company_logo', {
    apiFetch,
    directFetch: async (_input, init: RequestInit = {}) => {
      directAuthorization = new Headers(init.headers).get('Authorization');
      return new Response(null, { status: 200 });
    },
  });

  assert.equal(directAuthorization, null);
});

test('stops polling when a server error is not retryable', async () => {
  assert.equal(typeof imageAssets.waitForReadyAsset, 'function');
  let calls = 0;
  const apiFetch: typeof fetch = async () => {
    calls += 1;
    return response({ error: { code: 'ASSET_ACCESS_DENIED', message: 'Access denied', requestId: 'req-denied', retryable: false } }, 403);
  };

  await assert.rejects(
    () => imageAssets.waitForReadyAsset('asset-denied', { apiFetch, pollIntervalMs: 0 }),
    (error: unknown) => error instanceof imageAssets.ImageAssetClientError
      && error.code === 'ASSET_ACCESS_DENIED'
      && error.requestId === 'req-denied'
      && error.retryable === false,
  );
  assert.equal(calls, 1);
});

test('reads display bytes only from a same-origin content URL through authenticated API fetch', async () => {
  assert.equal(typeof imageAssets.fetchAssetBlob, 'function');
  const requests: RecordedRequest[] = [];
  const apiFetch: typeof fetch = async (input, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    requests.push({ input: String(input), method: init.method ?? 'GET', authorization: headers.get('Authorization') });
    return new Response(new Blob(['image-bytes'], { type: 'image/webp' }), { status: 200 });
  };

  const blob = await imageAssets.fetchAssetBlob('/api/company/images/brand_logo/content', {
    apiFetch: async (input, init) => apiFetch(input, {
      ...init,
      headers: { Authorization: 'Bearer admin-token', ...(init?.headers ?? {}) },
    }),
  });

  assert.equal(await blob.text(), 'image-bytes');
  assert.deepEqual(requests, [{
    input: '/api/company/images/brand_logo/content', method: 'GET', authorization: 'Bearer admin-token',
  }]);
  await assert.rejects(
    () => imageAssets.fetchAssetBlob('https://fabric-images.example.test/private/logo.webp', { apiFetch }),
    (error: unknown) => error instanceof imageAssets.ImageAssetClientError
      && error.code === 'ASSET_ACCESS_DENIED'
      && error.retryable === false,
  );
});
