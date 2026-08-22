import assert from 'node:assert/strict';
import test from 'node:test';

import { startCompanyImageContentFixtureServer } from './companyImageContentFixture.mjs';

function pngDimensions(body: Buffer): [number, number] {
  assert.deepEqual([...body.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(body.toString('ascii', 12, 16), 'IHDR');
  return [body.readUInt32BE(16), body.readUInt32BE(20)];
}

test('serves distinct decodable 8x8 PNGs from every company image content endpoint', async () => {
  const fixture = await startCompanyImageContentFixtureServer();
  try {
    const paths = [
      '/api/company/images/brand_logo/content',
      '/api/company/images/wechat_qr/content',
      '/api/company/images/alipay_qr/content',
    ];
    const responses = await Promise.all(paths.map((path) => fetch(`${fixture.baseUrl}${path}`)));
    const bytes = await Promise.all(responses.map(async (response) => Buffer.from(await response.arrayBuffer())));

    assert.deepEqual(responses.map((response) => response.status), [200, 200, 200]);
    assert.ok(responses.every((response) => response.headers.get('content-type') === 'image/png'));
    assert.equal(new Set(bytes.map((body) => body.toString('hex'))).size, 3);
    assert.deepEqual(bytes.map(pngDimensions), [[8, 8], [8, 8], [8, 8]]);
  } finally {
    await fixture.stop();
  }
});
