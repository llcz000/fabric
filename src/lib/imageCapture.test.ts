import assert from 'node:assert/strict';
import test from 'node:test';

import { parseExternalImageUrl } from './externalImageUrl';
import * as imageCaptureModule from './imageCapture';
import { shouldProxyImageForCapture, waitForCaptureImages } from './imageCapture';

test('uses a browser-readable remote image without requiring the server proxy', async () => {
  assert.equal(typeof imageCaptureModule.loadCaptureImageBlob, 'function');
  const requests: string[] = [];
  const fetchImage = async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return new Response(new Blob(['direct-image'], { type: 'image/png' }), {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });
  };

  const blob = await imageCaptureModule.loadCaptureImageBlob(
    'https://images.example.com/logo.png',
    '/api/proxy-image?url=encoded',
    {},
    fetchImage,
  );

  assert.equal(await blob.text(), 'direct-image');
  assert.deepEqual(requests, ['https://images.example.com/logo.png']);
});

test('falls back to the server proxy when direct browser access is blocked', async () => {
  assert.equal(typeof imageCaptureModule.loadCaptureImageBlob, 'function');
  const requests: string[] = [];
  const fetchImage = async (input: RequestInfo | URL) => {
    requests.push(String(input));
    if (requests.length === 1) throw new TypeError('Failed to fetch');
    return new Response(new Blob(['proxied-image'], { type: 'image/png' }), {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });
  };

  const blob = await imageCaptureModule.loadCaptureImageBlob(
    'https://images.example.com/logo.png',
    '/api/proxy-image?url=encoded',
    { Authorization: 'Bearer test-token' },
    fetchImage,
  );

  assert.equal(await blob.text(), 'proxied-image');
  assert.deepEqual(requests, [
    'https://images.example.com/logo.png',
    '/api/proxy-image?url=encoded',
  ]);
});

test('accepts legacy HTTP and current HTTPS external image URLs', () => {
  assert.equal(parseExternalImageUrl('http://images.example.com/logo.png').protocol, 'http:');
  assert.equal(parseExternalImageUrl('https://images.example.com/logo.png').protocol, 'https:');
});

test('rejects non-web image URLs and embedded credentials', () => {
  assert.throws(() => parseExternalImageUrl('file:///tmp/logo.png'), /HTTP or HTTPS/);
  assert.throws(() => parseExternalImageUrl('https://user:pass@example.com/logo.png'), /credentials/);
});

test('proxies only cross-origin web images during capture', () => {
  assert.equal(shouldProxyImageForCapture('http://127.0.0.1:3000/uploads/logo.png', 'http://127.0.0.1:3000'), false);
  assert.equal(shouldProxyImageForCapture('https://images.example.com/logo.png', 'http://127.0.0.1:3000'), true);
  assert.equal(shouldProxyImageForCapture('data:image/png;base64,test', 'http://127.0.0.1:3000'), false);
});

test('waits for pending logo and QR images to decode before capture', async () => {
  let finishDecode!: () => void;
  let complete = false;
  let naturalWidth = 0;

  const image = {
    get complete() {
      return complete;
    },
    get naturalWidth() {
      return naturalWidth;
    },
    src: 'data:image/png;base64,test-image',
    decode: () => new Promise<void>((resolve) => {
      finishDecode = () => {
        complete = true;
        naturalWidth = 120;
        resolve();
      };
    }),
  } as unknown as HTMLImageElement;

  let captureCanStart = false;
  const waiting = waitForCaptureImages([image]).then(() => {
    captureCanStart = true;
  });

  await Promise.resolve();
  assert.equal(captureCanStart, false);

  finishDecode();
  await waiting;
  assert.equal(captureCanStart, true);
});
