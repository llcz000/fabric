import assert from 'node:assert/strict';
import test from 'node:test';

import { parseExternalImageUrl } from './externalImageUrl';
import { shouldProxyImageForCapture, waitForCaptureImages } from './imageCapture';

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
