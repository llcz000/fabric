import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
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
    RATE_LIMIT_WINDOW_MS: '900000',
    API_RATE_LIMIT_MAX: '1000',
    LOGIN_RATE_LIMIT_MAX: '3',
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
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200, 'health check must be available without authentication');
  const healthBody = await health.json();
  assert.deepEqual(Object.keys(healthBody).sort(), ['status', 'storage', 'uptimeSeconds'],
    'health check must expose only operational status');
  assert.equal(healthBody.status, 'ok');
  assert.equal(healthBody.storage, 'json');
  assert.equal(Number.isInteger(healthBody.uptimeSeconds), true);
  assert.equal(typeof login.body.token, 'string');
  assert.match(login.cookie, /^fabric_asset_token=/);
  const authHeaders = { Authorization: `Bearer ${login.body.token}` };

  const formLogin = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password }),
  });
  assert.equal(formLogin.status, 200, 'non-asset login must retain global urlencoded parsing');
  assert.equal(typeof (await formLogin.json()).token, 'string');

  const unauthenticated = await fetch(`${baseUrl}/api/company`);
  assert.equal(unauthenticated.status, 401, 'protected API must require authentication');

  const unauthenticatedAsset = await fetch(`${baseUrl}/api/image-assets/upload-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      purpose: 'company_logo',
      originalFilename: 'logo.png',
      declaredMime: 'image/png',
      declaredByteSize: 4,
    }),
  });
  assert.equal(unauthenticatedAsset.status, 401, 'image asset API must be mounted behind authentication');

  const disabledAsset = await fetch(`${baseUrl}/api/image-assets/upload-sessions`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json', 'X-Request-Id': 'security-disabled-assets' },
    body: JSON.stringify({
      purpose: 'company_logo',
      originalFilename: 'logo.png',
      declaredMime: 'image/png',
      declaredByteSize: 4,
    }),
  });
  assert.equal(disabledAsset.status, 503, 'disabled image assets on JSON fallback must return 503');
  const disabledAssetBody = await disabledAsset.json();
  assert.equal(disabledAssetBody.error.code, 'STORAGE_UNAVAILABLE');
  assert.equal(disabledAssetBody.error.requestId, 'security-disabled-assets');

  const arbitraryAssetUrl = await fetch(`${baseUrl}/api/image-assets/upload-sessions`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://attacker.example/private.png' }),
  });
  assert.equal(arbitraryAssetUrl.status, 503, 'disabled image asset routes must not accept arbitrary URLs');
  const arbitraryAssetUrlText = await arbitraryAssetUrl.text();
  assert.match(arbitraryAssetUrlText, /STORAGE_UNAVAILABLE/);
  assert.doesNotMatch(arbitraryAssetUrlText, /attacker\.example|Authorization|SecretKey|fabric_asset_token/,
    'asset errors must not reflect URL or credential material');

  const disabledParserCases = [
    {
      name: 'malformed JSON',
      contentType: 'application/json',
      body: '{"secret":"must-not-leak"',
    },
    {
      name: 'oversized JSON',
      contentType: 'application/json',
      body: JSON.stringify({ padding: 'a'.repeat(128 * 1024) }),
    },
    {
      name: 'malformed urlencoded',
      contentType: 'application/x-www-form-urlencoded',
      body: `root${'[child]'.repeat(40)}=must-not-leak`,
    },
    {
      name: 'oversized urlencoded',
      contentType: 'application/x-www-form-urlencoded',
      body: `padding=${'a'.repeat(128 * 1024)}`,
    },
  ];
  for (const [index, fixture] of disabledParserCases.entries()) {
    const requestId = `security-disabled-parser-${index}`;
    const response = await fetch(`${baseUrl}/api/image-assets/upload-sessions`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': fixture.contentType,
        'X-Request-Id': requestId,
      },
      body: fixture.body,
    });
    const text = await response.text();
    const body = JSON.parse(text);
    assert.equal(response.status, 503, `${fixture.name} must reach the disabled asset guard`);
    assert.equal(body.error.code, 'STORAGE_UNAVAILABLE', fixture.name);
    assert.equal(body.error.requestId, requestId, fixture.name);
    assert.doesNotMatch(text, /SyntaxError|RangeError|must-not-leak|aaaaa|secret/i,
      `${fixture.name} must not leak parser input or exception details`);
  }

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

  const validPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  const pngForm = new FormData();
  pngForm.append('file', new Blob([validPng], { type: 'image/png' }), 'test.png');
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

  const uploadsDir = path.join(tempDir, 'uploads');
  const uploadsBeforeInvalidImage = fs.readdirSync(uploadsDir).sort();
  const fakePngForm = new FormData();
  fakePngForm.append('file', new Blob(['not-a-real-image'], { type: 'image/png' }), 'fake.png');
  const fakePngUpload = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: authHeaders,
    body: fakePngForm,
  });
  assert.equal(fakePngUpload.status, 415, 'image content must be decoded and validated');
  assert.deepEqual(fs.readdirSync(uploadsDir).sort(), uploadsBeforeInvalidImage,
    'rejected image must not leave a temporary file');

  const templateDir = path.join(tempDir, 'template');
  const fakeWorkbookForm = new FormData();
  fakeWorkbookForm.append('file', new Blob(['not-a-real-workbook'], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), 'fake.xlsx');
  const fakeWorkbookUpload = await fetch(`${baseUrl}/api/products/import`, {
    method: 'POST',
    headers: authHeaders,
    body: fakeWorkbookForm,
  });
  assert.equal(fakeWorkbookUpload.status, 415, 'Excel content must be parsed and validated');
  assert.deepEqual(fs.readdirSync(templateDir), [], 'rejected workbook must not leave a temporary file');

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Products');
  worksheet.addRow(['货号', '品名', '成分', '克重', '门幅']);
  worksheet.addRow(['TEST-001', '测试面料', '100%棉', '200g/㎡', '150']);
  const workbookBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

  const validWorkbookForm = new FormData();
  validWorkbookForm.append('file', new Blob([workbookBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), 'products.xlsx');
  const validWorkbookUpload = await fetch(`${baseUrl}/api/products/import`, {
    method: 'POST',
    headers: authHeaders,
    body: validWorkbookForm,
  });
  assert.equal(validWorkbookUpload.status, 200, 'valid workbook import must succeed');
  assert.deepEqual(fs.readdirSync(templateDir), [], 'successful import must remove its temporary workbook');

  const templateWorkbookForm = new FormData();
  templateWorkbookForm.append('template_file', new Blob([workbookBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), 'user-controlled.xlsx');
  const templateWorkbookUpload = await fetch(`${baseUrl}/api/template/upload`, {
    method: 'POST',
    headers: authHeaders,
    body: templateWorkbookForm,
  });
  assert.equal(templateWorkbookUpload.status, 200, 'valid template workbook must succeed');
  const templateUploadBody = await templateWorkbookUpload.json();
  assert.match(templateUploadBody.filename, /^template-\d+-[0-9a-f]{12}\.xlsx$/,
    'template must use a server-generated file name');
  assert.deepEqual(fs.readdirSync(templateDir), [templateUploadBody.filename],
    'validated template must be retained for later exports');

  const productImageDir = path.join(tempDir, 'uploads', 'products');
  fs.mkdirSync(productImageDir, { recursive: true });
  const productImagePath = path.join(productImageDir, 'owned.png');
  const outsideImagePath = path.join(tempDir, 'outside.png');
  fs.writeFileSync(productImagePath, 'owned-image');
  fs.writeFileSync(outsideImagePath, 'outside-image');
  fs.writeFileSync(path.join(tempDir, 'database_fallback.json'), JSON.stringify({
    company_config: {},
    orders: [],
    order_items: [],
    products: [{ id: 7 }],
    product_images: [
      { id: 1, product_id: 7, local_path: productImagePath, sort_order: 0 },
      { id: 2, product_id: 7, local_path: outsideImagePath, sort_order: 1 },
    ],
    inventory_entries: [],
  }));

  assert.equal((await fetch(`${baseUrl}/api/products/8/images/1`, { headers: authHeaders })).status, 404,
    'product image must belong to the product in the route');
  assert.equal((await fetch(`${baseUrl}/api/products/7/images/2`, { headers: authHeaders })).status, 404,
    'product image path must stay inside uploads');
  assert.equal((await fetch(`${baseUrl}/api/products/7/images/1`, { headers: authHeaders })).status, 200,
    'owned product image inside uploads must be readable');

  let rateLimited = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.10' },
      body: JSON.stringify({ password: 'wrong-password' }),
    });
    if (response.status === 429) rateLimited = true;
  }
  assert.equal(rateLimited, true, 'repeated failed logins must be rate limited');

  const separateClient = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.11' },
    body: JSON.stringify({ password: 'wrong-password' }),
  });
  assert.equal(separateClient.status, 401,
    'trusted loopback proxy must keep separate client IP rate-limit buckets');

  child.kill('SIGTERM');
  const shutdownCode = await waitForExit(child, 5_000);
  if (process.platform !== 'win32') {
    assert.equal(shutdownCode, 0, 'SIGTERM must exit cleanly');
  }
  child = undefined;

  console.log('Security smoke tests passed.');
} finally {
  if (child && child.exitCode === null) {
    child.kill();
    await waitForExit(child, 5_000).catch(() => {});
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
}
