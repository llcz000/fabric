import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { AddressInfo } from 'node:net';

import express from 'express';

import {
  createCompanyImageAuthMiddleware,
  createCompanyImageRouter,
  describeCompanyImages,
  omitCompanyLegacyImageValues,
  type CompanyImageRuntime,
} from './companyImages';
import { CosStorageAdapter, type CosSdkBoundary } from './cosStorage';
import { ImageAssetError } from './errors';
import { readLegacyImage } from './legacySource';
import type { AssetContent } from './service';
import type { AssetDescriptor } from './types';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+QqJZ6QAAAABJRU5ErkJggg==', 'base64');
const RAW_COS_URL = 'https://assets-1250000000.cos.ap-beijing.myqcloud.com/legacy/logo.png';

function descriptor(id: string, status: AssetDescriptor['status'] = 'ready'): AssetDescriptor {
  return {
    id,
    status,
    purpose: 'company_logo',
    detectedMime: 'image/png',
    byteSize: PNG.length,
    width: 1,
    height: 1,
    variants: { original: { width: 1, height: 1, byteSize: PNG.length }, display: { width: 1, height: 1, byteSize: PNG.length } },
  };
}

interface MemoryState {
  company: Record<string, unknown>;
  links: Partial<Record<'brand_logo' | 'wechat_qr' | 'alipay_qr', string>>;
  descriptors: Record<string, AssetDescriptor>;
  legacyReads: unknown[];
}

function runtime(state: MemoryState, options: { enabled?: boolean; content?: AssetContent; rejectAssetId?: string } = {}): CompanyImageRuntime {
  return {
    enabled: options.enabled ?? true,
    service: {
      async getDescriptor(assetId) {
        return state.descriptors[assetId] ?? descriptor(assetId, 'processing');
      },
      async readContent(assetId) {
        const found = state.descriptors[assetId];
        if (!found || found.status !== 'ready') {
          throw new ImageAssetError('ASSET_NOT_READY', 409, true, 'Asset is not ready');
        }
        return options.content ?? { body: PNG, mime: 'image/png', byteSize: PNG.length, etag: '"asset-etag"' };
      },
      async replaceCompanyImage(_companyId, role, assetId) {
        if (assetId === options.rejectAssetId) {
          throw new ImageAssetError('ASSET_NOT_READY', 409, true, 'Asset is not ready');
        }
        if (assetId) state.links[role] = assetId;
        else delete state.links[role];
      },
    },
    async findAssociation(role) {
      return state.links[role] ?? null;
    },
    async getCompany() {
      return state.company;
    },
    async readLegacy(value) {
      if (typeof value !== 'string' || !value) return null;
      state.legacyReads.push(value);
      return value === RAW_COS_URL || value.startsWith('data:image/png;base64,')
        ? PNG
        : null;
    },
  };
}

async function withHttpServer<T>(value: CompanyImageRuntime, work: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use('/api/company/images', createCompanyImageRouter(value));
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

async function withAuthenticatedHttpServer<T>(value: CompanyImageRuntime, work: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use('/api/company/images', createCompanyImageAuthMiddleware((req) => req.get('Authorization') === 'Bearer company-test-token'));
  app.use('/api/company/images', createCompanyImageRouter(value));
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

function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

test('company descriptors prefer ready associations and never expose a raw legacy COS URL', async () => {
  const state: MemoryState = {
    company: { brand_logo: RAW_COS_URL, wechat_qr: 'data:image/png;base64,AA==', alipay_qr: '' },
    links: { brand_logo: 'asset-1' },
    descriptors: { 'asset-1': descriptor('asset-1') },
    legacyReads: [],
  };

  const images = await describeCompanyImages(state.company, runtime(state));

  assert.deepEqual(images, {
    brand_logo: {
      role: 'brand_logo',
      source: 'asset',
      assetId: 'asset-1',
      displayUrl: '/api/company/images/brand_logo/content',
    },
    wechat_qr: {
      role: 'wechat_qr',
      source: 'legacy',
      displayUrl: '/api/company/images/wechat_qr/content',
    },
  });
  assert.equal(JSON.stringify(images).includes(RAW_COS_URL), false);
  assert.deepEqual(state.legacyReads, ['data:image/png;base64,AA==']);
});

test('company descriptors use a valid legacy image when the linked asset is not ready', async () => {
  const state: MemoryState = {
    company: { brand_logo: 'data:image/png;base64,AA==' },
    links: { brand_logo: 'processing-asset' },
    descriptors: { 'processing-asset': descriptor('processing-asset', 'processing') },
    legacyReads: [],
  };

  const images = await describeCompanyImages(state.company, runtime(state));

  assert.deepEqual(images, {
    brand_logo: { role: 'brand_logo', source: 'legacy', displayUrl: '/api/company/images/brand_logo/content' },
  });
});

test('PUT replacement and DELETE preserve company text while changing only the selected association', async () => {
  const state: MemoryState = {
    company: { company_name: 'Dream Weave', phone: '0575-81234567', brand_logo: RAW_COS_URL },
    links: { brand_logo: 'old-asset' },
    descriptors: { 'old-asset': descriptor('old-asset'), 'new-asset': descriptor('new-asset') },
    legacyReads: [],
  };

  await withHttpServer(runtime(state), async (baseUrl) => {
    const replace = await fetch(`${baseUrl}/api/company/images/brand_logo`, json('PUT', { assetId: 'new-asset' }));
    assert.equal(replace.status, 200);
    assert.deepEqual(await replace.json(), { success: true });
    assert.deepEqual(state.links, { brand_logo: 'new-asset' });

    const remove = await fetch(`${baseUrl}/api/company/images/brand_logo`, json('DELETE', {}));
    assert.equal(remove.status, 200);
    assert.deepEqual(await remove.json(), { success: true });
  });

  assert.deepEqual(state.links, {});
  assert.deepEqual(state.company, { company_name: 'Dream Weave', phone: '0575-81234567', brand_logo: RAW_COS_URL });
});

test('company image role routes reject unknown roles, malformed or extra input, and assets still processing', async () => {
  const state: MemoryState = {
    company: {},
    links: {},
    descriptors: {},
    legacyReads: [],
  };

  await withHttpServer(runtime(state, { rejectAssetId: 'processing-asset' }), async (baseUrl) => {
    const unknown = await fetch(`${baseUrl}/api/company/images/unknown`, json('PUT', { assetId: 'asset-1' }));
    assert.equal(unknown.status, 400);

    const malformed = await fetch(`${baseUrl}/api/company/images/brand_logo`, json('PUT', { assetId: 1 }));
    assert.equal(malformed.status, 422);

    const urlencoded = await fetch(`${baseUrl}/api/company/images/brand_logo`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'assetId=asset-1',
    });
    assert.equal(urlencoded.status, 422);

    const extra = await fetch(`${baseUrl}/api/company/images/brand_logo`, json('PUT', { assetId: 'asset-1', url: 'https://attacker.example/image.png' }));
    assert.equal(extra.status, 422);

    const processing = await fetch(`${baseUrl}/api/company/images/brand_logo`, json('PUT', { assetId: 'processing-asset' }));
    assert.equal(processing.status, 409);
    assert.deepEqual(state.links, {});
  });
});

test('company image parser maps malformed and oversized JSON or urlencoded bodies to safe request-ID errors', async () => {
  const state: MemoryState = { company: {}, links: {}, descriptors: {}, legacyReads: [] };
  const cases = [
    { name: 'malformed JSON', contentType: 'application/json', body: '{"secret":"must-not-leak"', status: 422 },
    { name: 'oversized JSON', contentType: 'application/json', body: JSON.stringify({ padding: 'a'.repeat(5_000) }), status: 413 },
    { name: 'malformed urlencoded', contentType: 'application/x-www-form-urlencoded', body: `root${'[child]'.repeat(40)}=must-not-leak`, status: 422 },
    { name: 'oversized urlencoded', contentType: 'application/x-www-form-urlencoded', body: `padding=${'a'.repeat(5_000)}`, status: 413 },
    { name: 'too many urlencoded parameters', contentType: 'application/x-www-form-urlencoded', body: Array.from({ length: 25 }, (_, index) => `key${index}=value`).join('&'), status: 413 },
  ];

  await withHttpServer(runtime(state), async (baseUrl) => {
    for (const [index, fixture] of cases.entries()) {
      const requestId = `company-parser-${index}`;
      const response = await fetch(`${baseUrl}/api/company/images/brand_logo`, {
        method: 'PUT',
        headers: { 'Content-Type': fixture.contentType, 'X-Request-Id': requestId },
        body: fixture.body,
      });
      const text = await response.text();
      const body = JSON.parse(text);
      assert.equal(response.status, fixture.status, fixture.name);
      assert.equal(response.headers.get('x-request-id'), requestId, fixture.name);
      assert.equal(body.error.requestId, requestId, fixture.name);
      assert.doesNotMatch(text, /SyntaxError|RangeError|must-not-leak|aaaaa|secret/i, fixture.name);
    }
  });
});

test('legacy content falls back to valid managed COS, local, and data URL values with detected private headers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'company-image-legacy-'));
  const localFile = path.join(root, 'legacy.png');
  await writeFile(localFile, PNG);
  const cosReads: string[] = [];
  const sdk: CosSdkBoundary = {
    getObjectUrl() { return ''; },
    async headObject(request) { cosReads.push(`head:${request.Key}`); return { headers: { 'content-length': String(PNG.length) } }; },
    async getObject(request) { cosReads.push(`get:${request.Key}`); return { Body: PNG }; },
    async putObject() { return undefined; },
    async deleteObject() { return undefined; },
  };
  const cos = new CosStorageAdapter({ bucket: 'assets-1250000000', region: 'ap-beijing' }, sdk);
  const state: MemoryState = { company: { brand_logo: RAW_COS_URL }, links: {}, descriptors: {}, legacyReads: [] };
  const appRuntime = runtime(state);
  appRuntime.readLegacy = async (value) => readLegacyImage(value, {
    cos: { config: { bucket: 'assets-1250000000', region: 'ap-beijing' }, storage: cos },
    localRoot: root,
    maxBytes: 2 * 1024 * 1024,
  });

  try {
    await withHttpServer(appRuntime, async (baseUrl) => {
      for (const source of [RAW_COS_URL, localFile, `data:image/png;base64,${PNG.toString('base64')}`]) {
        state.company.brand_logo = source;
        const response = await fetch(`${baseUrl}/api/company/images/brand_logo/content`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'image/png');
        assert.equal(response.headers.get('content-length'), String(PNG.length));
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(response.headers.get('etag'), `"${createHash('sha256').update(PNG).digest('hex')}"`);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG);
      }
    });
    assert.deepEqual(cosReads, ['head:legacy/logo.png', 'get:legacy/logo.png']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('corrupt legacy COS, local, and data URL content returns IMAGE_CONTENT_INVALID instead of a generic error', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'company-image-corrupt-'));
  const localFile = path.join(root, 'corrupt.png');
  const corrupt = Buffer.from('not an image');
  await writeFile(localFile, corrupt);
  const sdk: CosSdkBoundary = {
    getObjectUrl() { return ''; },
    async headObject() { return { headers: { 'content-length': String(corrupt.length) } }; },
    async getObject() { return { Body: corrupt }; },
    async putObject() { return undefined; },
    async deleteObject() { return undefined; },
  };
  const cos = new CosStorageAdapter({ bucket: 'assets-1250000000', region: 'ap-beijing' }, sdk);
  const state: MemoryState = { company: { brand_logo: RAW_COS_URL }, links: {}, descriptors: {}, legacyReads: [] };
  const appRuntime = runtime(state);
  appRuntime.readLegacy = async (value) => readLegacyImage(value, {
    cos: { config: { bucket: 'assets-1250000000', region: 'ap-beijing' }, storage: cos },
    localRoot: root,
    maxBytes: 2 * 1024 * 1024,
  });

  try {
    await withHttpServer(appRuntime, async (baseUrl) => {
      for (const source of [RAW_COS_URL, localFile, `data:image/png;base64,${corrupt.toString('base64')}`]) {
        state.company.brand_logo = source;
        const response = await fetch(`${baseUrl}/api/company/images/brand_logo/content`);
        assert.equal(response.status, 422);
        assert.equal((await response.json()).error.code, 'IMAGE_CONTENT_INVALID');
      }
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('company content rejects arbitrary URLs and request URL parameters', async () => {
  const state: MemoryState = {
    company: { brand_logo: 'https://attacker.example/image.png' },
    links: {},
    descriptors: {},
    legacyReads: [],
  };

  await withHttpServer(runtime(state), async (baseUrl) => {
    const arbitraryStoredUrl = await fetch(`${baseUrl}/api/company/images/brand_logo/content`);
    assert.equal(arbitraryStoredUrl.status, 404);

    const queryUrl = await fetch(`${baseUrl}/api/company/images/brand_logo/content?url=https://attacker.example/image.png`);
    assert.equal(queryUrl.status, 422);
  });
});

test('feature-off compatibility keeps legacy GET/POST image fields untouched', () => {
  const original = {
    company_name: 'Dream Weave',
    brand_logo: RAW_COS_URL,
    wechat_qr: 'legacy-wechat',
    alipay_qr: 'legacy-alipay',
  };

  assert.deepEqual(omitCompanyLegacyImageValues(original, false), original);
  assert.deepEqual(omitCompanyLegacyImageValues(original, true), { company_name: 'Dream Weave' });
});

test('feature-off content route reads all legacy company roles without exposing or fetching raw URLs in the browser', async () => {
  const fixtures = {
    brand_logo: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQYlWMQbbD9jw8zjAwFAKYddEEY9FwlAAAAAElFTkSuQmCC', 'base64'),
    wechat_qr: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQYlWNgzlz4Hx9mGBkKACt1gwFdjghsAAAAAElFTkSuQmCC', 'base64'),
    alipay_qr: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQYlWO4Wc72Hx9mGBkKAPpclUGMJRtgAAAAAElFTkSuQmCC', 'base64'),
  };
  const state: MemoryState = {
    company: {
      brand_logo: RAW_COS_URL,
      wechat_qr: 'http://assets-1250000000.cos.ap-beijing.myqcloud.com/legacy/wechat.png',
      alipay_qr: `data:image/png;base64,${fixtures.alipay_qr.toString('base64')}`,
    },
    links: {},
    descriptors: {},
    legacyReads: [],
  };
  const featureOffRuntime: CompanyImageRuntime = {
    ...runtime(state, { enabled: false }),
    service: null,
    async readLegacy(source) {
      if (source === state.company.brand_logo) return fixtures.brand_logo;
      if (source === state.company.wechat_qr) return fixtures.wechat_qr;
      if (source === state.company.alipay_qr) return fixtures.alipay_qr;
      return null;
    },
  };

  await withHttpServer(featureOffRuntime, async (baseUrl) => {
    for (const role of ['brand_logo', 'wechat_qr', 'alipay_qr'] as const) {
      const response = await fetch(`${baseUrl}/api/company/images/${role}/content`);
      assert.equal(response.status, 200, role);
      assert.equal(response.headers.get('content-type'), 'image/png', role);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), fixtures[role], role);
    }
    const mutation = await fetch(`${baseUrl}/api/company/images/brand_logo`, json('PUT', { assetId: 'asset-1' }));
    assert.equal(mutation.status, 404);
  });
});

test('unauthorized company image responses expose one safe request ID in header and body', async () => {
  const state: MemoryState = { company: {}, links: {}, descriptors: {}, legacyReads: [] };
  await withAuthenticatedHttpServer(runtime(state), async (baseUrl) => {
    const supplied = await fetch(`${baseUrl}/api/company/images/brand_logo/content`, {
      headers: { 'X-Request-Id': 'company-auth-denied' },
    });
    assert.equal(supplied.status, 401);
    assert.equal(supplied.headers.get('x-request-id'), 'company-auth-denied');
    assert.deepEqual(await supplied.json(), {
      error: {
        code: 'ASSET_ACCESS_DENIED',
        message: 'Asset access is denied',
        requestId: 'company-auth-denied',
        retryable: false,
      },
    });

    const generated = await fetch(`${baseUrl}/api/company/images/wechat_qr/content`);
    const requestId = generated.headers.get('x-request-id');
    assert.match(requestId ?? '', /^req_[a-f0-9]{32}$/);
    assert.equal((await generated.json()).error.requestId, requestId);
  });
});
