import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyCompanyImageContentFixtureEndpoints } from './companyImageContentFixture.mjs';

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
  return await Promise.race([
    new Promise((resolve) => child.once('exit', (code) => resolve(code))),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Process did not exit in time')), timeoutMs)),
  ]);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-image-assets-smoke-'));
const port = await getFreePort();
const password = 'test-only-image-assets-password';
const child = spawn(process.execPath, [serverEntry], {
  cwd: tempDir,
  env: {
    ...process.env,
    ADMIN_PASSWORD: password,
    HOST: '127.0.0.1',
    PORT: String(port),
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
    ASSET_STORAGE_PROVIDER: 'cos',
    ASSET_SIGNED_URL_TTL_SECONDS: '300',
    ASSET_UPLOAD_GRANT_TTL_SECONDS: '900',
    ASSET_UPLOAD_SESSION_TTL_SECONDS: '86400',
    ASSET_RECYCLE_DAYS: '30',
  },
  stdio: 'ignore',
});

try {
  const baseUrl = `http://127.0.0.1:${port}`;
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

  await verifyCompanyImageContentFixtureEndpoints();

  child.kill('SIGTERM');
  await waitForExit(child, 5_000);
  console.log('Image asset smoke tests passed.');
} finally {
  if (child.exitCode === null) {
    child.kill();
    await waitForExit(child, 5_000).catch(() => {});
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
}
