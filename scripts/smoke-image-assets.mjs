import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { withSmokeProcessLifecycle } from './smokeLifecycle.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverEntry = path.join(projectRoot, 'dist', 'server.cjs');

if (!fs.existsSync(serverEntry)) {
  throw new Error('dist/server.cjs is missing. Run npm.cmd run build before test:image-assets:smoke.');
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForLogin(baseUrl, password) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (response.ok) return await response.json();
    } catch { }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Server did not become ready');
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode;
  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('error', onError);
      callback(value);
    };
    const onExit = (code) => finish(resolve, code);
    const onError = (error) => finish(reject, error);
    const timer = setTimeout(() => finish(reject, new Error('Process did not exit in time')), timeoutMs);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  child.kill('SIGTERM');
  try {
    await waitForExit(child, 5_000);
  } catch {
    if (child.exitCode === null && child.signalCode === null && child.pid) child.kill();
    await waitForExit(child, 5_000).catch(() => {});
  }
}

function assertPng8x8(body) {
  assert.deepEqual([...body.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(body.toString('ascii', 12, 16), 'IHDR');
  assert.deepEqual([body.readUInt32BE(16), body.readUInt32BE(20)], [8, 8]);
}

async function assertBuiltServerCompanyImageRoutes(baseUrl, token) {
  const unauthorized = await fetch(`${baseUrl}/api/company/images/brand_logo/content`, {
    headers: { 'X-Request-Id': 'built-company-smoke-unauthorized' },
  });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get('x-request-id'), 'built-company-smoke-unauthorized');
  assert.equal((await unauthorized.json()).error.requestId, 'built-company-smoke-unauthorized');

  const roles = ['brand_logo', 'wechat_qr', 'alipay_qr'];
  const responses = await Promise.all(roles.map((role) => fetch(
    `${baseUrl}/api/company/images/${role}/content`,
    { headers: { Authorization: `Bearer ${token}`, 'X-Request-Id': `built-company-smoke-${role}` } },
  )));
  const bodies = await Promise.all(responses.map(async (response) => Buffer.from(await response.arrayBuffer())));
  assert.deepEqual(responses.map((response) => response.status), [200, 200, 200]);
  assert.ok(responses.every((response) => response.headers.get('content-type') === 'image/png'));
  assert.equal(new Set(bodies.map((body) => body.toString('hex'))).size, 3);
  bodies.forEach(assertPng8x8);

  const mutation = await fetch(`${baseUrl}/api/company/images/brand_logo`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId: 'must-not-attach' }),
  });
  assert.equal(mutation.status, 404);
}

async function seedBuiltServerLegacyCompanyImages(baseUrl, token, sources) {
  const saved = await fetch(`${baseUrl}/api/company`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company_name: 'Built server image smoke',
      brand_name: 'Built server image smoke',
      brand_logo: sources.brand_logo,
      address: 'temporary smoke workspace',
      phone: '000-0000',
      wechat_qr: sources.wechat_qr,
      alipay_qr: sources.alipay_qr,
      default_terms: '',
      deposit_terms: '',
    }),
  });
  assert.equal(saved.status, 200, 'real company API must accept feature-off legacy image fields');
  assert.deepEqual(await saved.json(), { success: true });

  const loaded = await fetch(`${baseUrl}/api/company`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(loaded.status, 200);
  const company = await loaded.json();
  assert.equal(company.brand_logo, sources.brand_logo);
  assert.equal(company.wechat_qr, sources.wechat_qr);
  assert.equal(company.alipay_qr, sources.alipay_qr);
}

const password = 'test-only-image-assets-password';
await withSmokeProcessLifecycle({
  createTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-image-assets-smoke-'));
  },
  async setup(tempDir) {
    const uploadsDir = path.join(tempDir, 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const fixtureSources = {
      brand_logo: path.join(uploadsDir, 'brand-logo.png'),
      wechat_qr: path.join(uploadsDir, 'wechat-qr.png'),
      alipay_qr: path.join(uploadsDir, 'alipay-qr.png'),
    };
    const fixtureBodies = {
      brand_logo: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQYlWMQbbD9jw8zjAwFAKYddEEY9FwlAAAAAElFTkSuQmCC', 'base64'),
      wechat_qr: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQYlWNgzlz4Hx9mGBkKACt1gwFdjghsAAAAAElFTkSuQmCC', 'base64'),
      alipay_qr: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQYlWO4Wc72Hx9mGBkKAPpclUGMJRtgAAAAAElFTkSuQmCC', 'base64'),
    };
    for (const role of Object.keys(fixtureSources)) {
      fs.writeFileSync(fixtureSources[role], fixtureBodies[role]);
    }
    return { port: await getFreePort(), fixtureSources };
  },
  spawnChild({ tempDir, setup }) {
    return spawn(process.execPath, [serverEntry], {
      cwd: tempDir,
      env: {
        ...process.env,
        ADMIN_PASSWORD: password,
        HOST: '127.0.0.1',
        PORT: String(setup.port),
        NODE_ENV: 'production',
        DB_HOST: '',
        DB_USER: '',
        DB_PASSWORD: '',
        DB_DATABASE: '',
        COS_SECRET_ID: '',
        COS_SECRET_KEY: '',
        COS_REGION: '',
        COS_BUCKET: '',
        IMAGE_ASSETS_ENABLED: 'false',
        COMPANY_IMAGE_ASSETS_ENABLED: 'false',
        PRODUCT_IMAGE_ASSETS_ENABLED: 'false',
        ASSET_STORAGE_PROVIDER: 'local',
        ASSET_SIGNED_URL_TTL_SECONDS: '300',
        ASSET_UPLOAD_GRANT_TTL_SECONDS: '900',
        ASSET_UPLOAD_SESSION_TTL_SECONDS: '86400',
        ASSET_RECYCLE_DAYS: '30',
      },
      stdio: 'ignore',
    });
  },
  async run({ setup }) {
    const baseUrl = `http://127.0.0.1:${setup.port}`;
    const login = await waitForLogin(baseUrl, password);
    const unauthenticated = await fetch(`${baseUrl}/api/image-assets/upload-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(unauthenticated.status, 401, 'image asset API must require authentication');

    const disabled = await fetch(`${baseUrl}/api/image-assets/upload-sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${login.token}`,
        'Content-Type': 'application/json',
        'X-Request-Id': 'image-assets-smoke-disabled',
      },
      body: JSON.stringify({
        purpose: 'company_logo',
        originalFilename: 'logo.png',
        declaredMime: 'image/png',
        declaredByteSize: 4,
      }),
    });
    assert.equal(disabled.status, 503, 'disabled image assets must return 503');
    assert.deepEqual(await disabled.json(), {
      error: {
        code: 'STORAGE_UNAVAILABLE',
        message: 'Image asset storage is unavailable',
        requestId: 'image-assets-smoke-disabled',
        retryable: true,
      },
    });

    await seedBuiltServerLegacyCompanyImages(baseUrl, login.token, setup.fixtureSources);
    await assertBuiltServerCompanyImageRoutes(baseUrl, login.token);
  },
  stopChild,
  async removeTempDir(tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  },
});

console.log('Image asset smoke tests passed.');
