import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

import express from 'express';

import {
  createCompanyImageAuthMiddleware,
  createCompanyImageRouter,
  type CompanyImageRuntime,
} from '../server/image-assets/companyImages';

const TOKEN = 'test-only-company-image-smoke-token';
const ROLES = ['brand_logo', 'wechat_qr', 'alipay_qr'] as const;
const FIXTURES = {
  brand_logo: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQYlWMQbbD9jw8zjAwFAKYddEEY9FwlAAAAAElFTkSuQmCC', 'base64'),
  wechat_qr: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQYlWNgzlz4Hx9mGBkKACt1gwFdjghsAAAAAElFTkSuQmCC', 'base64'),
  alipay_qr: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQYlWO4Wc72Hx9mGBkKAPpclUGMJRtgAAAAAElFTkSuQmCC', 'base64'),
};
const LEGACY_VALUES = {
  brand_logo: 'https://assets.example.invalid/legacy-logo.png',
  wechat_qr: 'https://assets.example.invalid/legacy-wechat.png',
  alipay_qr: 'data:image/png;base64,legacy-alipay',
};

function featureOffRuntime(): CompanyImageRuntime {
  return {
    enabled: false,
    service: null,
    async findAssociation() {
      throw new Error('feature-off compatibility must not query asset associations');
    },
    async getCompany() {
      return LEGACY_VALUES;
    },
    async readLegacy(source) {
      for (const role of ROLES) {
        if (source === LEGACY_VALUES[role]) return FIXTURES[role];
      }
      return null;
    },
  };
}

function assertPng8x8(body: Buffer): void {
  assert.deepEqual([...body.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(body.toString('ascii', 12, 16), 'IHDR');
  assert.deepEqual([body.readUInt32BE(16), body.readUInt32BE(20)], [8, 8]);
}

export async function verifyCompanyImageContentRoutes(): Promise<void> {
  const app = express();
  app.use('/api/company/images', createCompanyImageAuthMiddleware((req) => req.get('Authorization') === `Bearer ${TOKEN}`));
  app.use('/api/company/images', createCompanyImageRouter(featureOffRuntime()));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const unauthorized = await fetch(`${baseUrl}/api/company/images/brand_logo/content`, {
      headers: { 'X-Request-Id': 'company-smoke-unauthorized' },
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get('x-request-id'), 'company-smoke-unauthorized');
    assert.equal((await unauthorized.json()).error.requestId, 'company-smoke-unauthorized');

    const responses = await Promise.all(ROLES.map((role) => fetch(
      `${baseUrl}/api/company/images/${role}/content`,
      { headers: { Authorization: `Bearer ${TOKEN}`, 'X-Request-Id': `company-smoke-${role}` } },
    )));
    const bodies = await Promise.all(responses.map(async (response) => Buffer.from(await response.arrayBuffer())));
    assert.deepEqual(responses.map((response) => response.status), [200, 200, 200]);
    assert.ok(responses.every((response) => response.headers.get('content-type') === 'image/png'));
    assert.equal(new Set(bodies.map((body) => body.toString('hex'))).size, 3);
    bodies.forEach(assertPng8x8);

    const mutation = await fetch(`${baseUrl}/api/company/images/brand_logo`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetId: 'must-not-attach' }),
    });
    assert.equal(mutation.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
