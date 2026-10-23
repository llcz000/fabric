import assert from 'node:assert/strict';
import test from 'node:test';

import { ImageAssetError } from './errors';
import { getAssetPolicy } from './policy';

test('company QR policy keeps original and display only', () => {
  assert.deepEqual(getAssetPolicy('company_qr').variants, ['original', 'display']);
  assert.equal(getAssetPolicy('company_qr').maxBytes, 2 * 1024 * 1024);
});

test('product policy includes a thumbnail and rejects SVG', () => {
  const policy = getAssetPolicy('product_image');
  assert.deepEqual(policy.variants, ['original', 'display', 'thumbnail']);
  assert.equal(policy.allowedMimes.has('image/svg+xml'), false);
});

test('asset policy mutations do not affect later callers', () => {
  const first = getAssetPolicy('product_image');
  first.variants.pop();
  first.allowedMimes.delete('image/png');

  const second = getAssetPolicy('product_image');
  assert.deepEqual(second.variants, ['original', 'display', 'thumbnail']);
  assert.equal(second.allowedMimes.has('image/png'), true);
});

test('asset errors expose stable safe fields', () => {
  const body = new ImageAssetError('ASSET_NOT_READY', 409, false, 'processing').toResponse('req-1');
  assert.deepEqual(body, {
    error: {
      code: 'ASSET_NOT_READY',
      message: 'processing',
      requestId: 'req-1',
      retryable: false,
    },
  });
});

test('product images accept 20 MiB while company images remain limited to 2 MiB',()=>{
 assert.equal(getAssetPolicy('product_image').maxBytes,20*1024*1024);
 assert.equal(getAssetPolicy('company_logo').maxBytes,2*1024*1024);
 assert.equal(getAssetPolicy('company_qr').maxBytes,2*1024*1024);
});

test('high-resolution textile WebP within byte limit validates and generates bounded display/thumbnail',async()=>{
 const sharp=(await import('sharp')).default;
 const {validateImageBuffer}=await import('./validator');
 const {generateImageVariants}=await import('./processor');
 const buffer=await sharp({create:{width:8000,height:8001,channels:3,background:'#8899aa'}}).webp().toBuffer();
 const policy=getAssetPolicy('product_image');
 assert(buffer.length<20*1024*1024);
 const validated=await validateImageBuffer(buffer,{mime:'image/webp',byteSize:buffer.length,extension:'webp'},policy);
 assert.equal(validated.width,8000);assert.equal(validated.height,8001);
 const variants=await generateImageVariants(buffer,validated,policy);
 assert.equal(variants[0].body,buffer);assert(variants[1].width<=1600&&variants[1].height<=1600);
 assert.equal(variants[2].width,320);assert.equal(variants[2].height,320);
 assert.equal(getAssetPolicy('company_logo').maxPixels,40_000_000);
});

test('textile pixel ceiling remains bounded for the production image worker memory budget',()=>{
 assert.equal(getAssetPolicy('product_image').maxPixels,100_000_000);
});
