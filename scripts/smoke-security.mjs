import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverEntry = path.join(projectRoot, 'dist', 'server.cjs');

if (!fs.existsSync(serverEntry)) {
  throw new Error('dist/server.cjs is missing. Run npm run build before test:security.');
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

function serverEnv(port, password) {
  return {
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
  };
}

async function waitForExit(child, timeoutMs) {
  return await Promise.race([
    new Promise((resolve) => child.once('exit', (code) => resolve(code))),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Process did not exit in time')), timeoutMs)),
  ]);
}

async function waitForLogin(baseUrl, password) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        return {
          body: await response.json(),
          cookie: response.headers.get('set-cookie')?.split(';')[0] || '',
        };
      }
    } catch { }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Server did not become ready');
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-security-'));
let child;

try {
  const missingPasswordPort = await getFreePort();
  const missingPassword = spawn(process.execPath, [serverEntry], {
    cwd: tempDir,
    env: serverEnv(missingPasswordPort, ' '),
    stdio: 'ignore',
  });
  assert.notEqual(await waitForExit(missingPassword, 5_000), 0, 'missing ADMIN_PASSWORD must fail startup');

  const port = await getFreePort();
  const password = 'test-only-long-random-password';
  child = spawn(process.execPath, [serverEntry], {
    cwd: tempDir,
    env: serverEnv(port, password),
    stdio: 'ignore',
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const login = await waitForLogin(baseUrl, password);
  assert.equal(typeof login.body.token, 'string');
  assert.match(login.cookie, /^fabric_asset_token=/);
  const authHeaders = { Authorization: `Bearer ${login.body.token}` };

  const unauthenticated = await fetch(`${baseUrl}/api/company`);
  assert.equal(unauthenticated.status, 401, 'protected API must require authentication');

  const invalidOrder = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_no: '' }),
  });
  assert.equal(invalidOrder.status, 400, 'invalid order must return 400');

  const privateProxy = await fetch(`${baseUrl}/api/proxy-image?url=${encodeURIComponent('https://127.0.0.1/image.png')}`, {
    headers: authHeaders,
  });
  assert.equal(privateProxy.status, 403, 'image proxy must reject private addresses');

  const svgForm = new FormData();
  svgForm.append('file', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' }), 'test.svg');
  const svgUpload = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: authHeaders,
    body: svgForm,
  });
  assert.equal(svgUpload.status, 415, 'SVG upload must be rejected');

  const pngForm = new FormData();
  pngForm.append('file', new Blob(['not-a-real-image'], { type: 'image/png' }), 'test.png');
  const pngUpload = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: authHeaders,
    body: pngForm,
  });
  assert.equal(pngUpload.status, 200, 'allowed raster upload must succeed');
  const { url: localAssetUrl } = await pngUpload.json();
  assert.equal((await fetch(`${baseUrl}${localAssetUrl}`)).status, 401, 'local uploads must not be public');
  assert.equal((await fetch(`${baseUrl}${localAssetUrl}`, {
    headers: { Cookie: login.cookie },
  })).status, 200, 'authenticated asset cookie must allow local images');

  let rateLimited = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    const response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-password' }),
    });
    if (response.status === 429) rateLimited = true;
  }
  assert.equal(rateLimited, true, 'repeated failed logins must be rate limited');

  console.log('Security smoke tests passed.');
} finally {
  if (child && child.exitCode === null) {
    child.kill();
    await waitForExit(child, 5_000).catch(() => {});
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
}
