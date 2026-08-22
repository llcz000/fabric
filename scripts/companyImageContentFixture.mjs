import assert from 'node:assert/strict';
import http from 'node:http';

const COMPANY_IMAGE_CONTENT_PATHS = [
  '/api/company/images/brand_logo/content',
  '/api/company/images/wechat_qr/content',
  '/api/company/images/alipay_qr/content',
];

const FIXTURE_PNGS = [
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQYlWMQbbD9jw8zjAwFAKYddEEY9FwlAAAAAElFTkSuQmCC',
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQYlWNgzlz4Hx9mGBkKACt1gwFdjghsAAAAAElFTkSuQmCC',
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQYlWO4Wc72Hx9mGBkKAPpclUGMJRtgAAAAAElFTkSuQmCC',
];

function assertPng8x8(body) {
  assert.deepEqual([...body.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(body.toString('ascii', 12, 16), 'IHDR');
  assert.deepEqual([body.readUInt32BE(16), body.readUInt32BE(20)], [8, 8]);
}

export async function startCompanyImageContentFixtureServer() {
  const bodies = FIXTURE_PNGS.map((fixture) => Buffer.from(fixture, 'base64'));
  const fixtureByPath = new Map(COMPANY_IMAGE_CONTENT_PATHS.map((path, index) => [path, bodies[index]]));
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const body = fixtureByPath.get(pathname);
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': String(body.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    }).end(body);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Company image fixture server did not bind a TCP port');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    stop: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve(undefined))),
  };
}

export async function verifyCompanyImageContentFixtureEndpoints() {
  const fixture = await startCompanyImageContentFixtureServer();
  try {
    const responses = await Promise.all(COMPANY_IMAGE_CONTENT_PATHS.map((path) => fetch(`${fixture.baseUrl}${path}`)));
    const bodies = await Promise.all(responses.map(async (response) => Buffer.from(await response.arrayBuffer())));
    assert.deepEqual(responses.map((response) => response.status), [200, 200, 200]);
    assert.ok(responses.every((response) => response.headers.get('content-type') === 'image/png'));
    assert.equal(new Set(bodies.map((body) => body.toString('hex'))).size, 3);
    bodies.forEach(assertPng8x8);
  } finally {
    await fixture.stop();
  }
}
