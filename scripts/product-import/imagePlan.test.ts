import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import sharp from 'sharp';

import { materializeImportImage } from './imagePlan';

test('MPO becomes JPEG and records conversion metadata', async () => {
  const jpeg = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#336699' } }).jpeg().toBuffer();
  const marker = Buffer.from([0xff, 0xe2, 0x00, 0x06, 0x4d, 0x50, 0x46, 0x00]);
  const mpo = Buffer.concat([jpeg.subarray(0, 2), marker, jpeg.subarray(2)]);
  const result = await materializeImportImage(mpo, '新!F2');
  assert.equal(result.mime, 'image/jpeg');
  assert.equal(result.originMetadata.convertedFrom, 'image/mpo');
  assert.equal(result.issues.some((issue) => issue.code === 'IMAGE_FORMAT_CONVERTED'), true);
  assert.equal((await sharp(result.body).metadata()).format, 'jpeg');
});

test('over-limit image is resized without changing source bytes', async () => {
  const source = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#abcdef' } }).png().toBuffer();
  const before = createHash('sha256').update(source).digest('hex');
  const result = await materializeImportImage(source, '新!F2', { maxPixels: 400 });
  assert.equal(result.width * result.height <= 400, true);
  assert.equal(createHash('sha256').update(source).digest('hex'), before);
  assert.equal(result.issues.some((issue) => issue.code === 'IMAGE_RESIZED'), true);
});

test('decode failure produces a stable image error', async () => {
  await assert.rejects(materializeImportImage(Buffer.from('not-an-image'), '新!F2'), /IMAGE_DECODE_FAILED/);
});

