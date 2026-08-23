/**
 * Upload product images through the authenticated image asset API.
 *
 * Usage: node scripts/upload-product-images.mjs
 *
 * - Scans PRODUCT_IMAGE_DIR (default D:/jpg) for raster files.
 * - Matches the filename (without extension) to a product item_no.
 * - For each match: creates an upload session, PUTs the file, finalizes,
 *   polls until ready, then attaches the asset to the product via the
 *   product update API (imageAssetIds).
 *
 * Requires the server to be reachable with IMAGE_ASSETS_ENABLED=true and
 * PRODUCT_IMAGE_ASSETS_ENABLED=true. No COS SDK, Sharp, local writes, or
 * direct product_images inserts are used. Credentials and tokens are never
 * written to output.
 */

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const JPG_DIR = process.env.PRODUCT_IMAGE_DIR?.trim() || 'D:/jpg';
const HOST = process.env.HOST?.trim() || '127.0.0.1';
const PORT = process.env.PORT?.trim() || '3000';
const BASE_URL = process.env.PRODUCT_IMAGE_API_BASE_URL?.trim() || ('http://' + HOST + ':' + PORT);
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 60_000;
const PRODUCT_LIST_PAGE_SIZE = 100;

const MIME_BY_EXTENSION = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function mimeFor(filename) {
  return MIME_BY_EXTENSION[path.extname(filename).toLowerCase()] ?? null;
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    let detail = 'HTTP ' + response.status;
    try {
      const body = await response.json();
      if (body?.error?.code) detail += ' ' + body.error.code;
    } catch {
      // Non-JSON error body; keep the HTTP status only.
    }
    throw new Error(detail);
  }
  return response.json();
}

async function login(password) {
  const response = await fetch(BASE_URL + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) throw new Error('Login failed (HTTP ' + response.status + ')');
  const body = await response.json();
  if (typeof body?.token !== 'string') throw new Error('Login returned no token');
  return body.token;
}

async function fetchProducts(token) {
  const products = [];
  let offset = 0;
  for (;;) {
    const page = await requestJson(
      BASE_URL + '/api/products?limit=' + PRODUCT_LIST_PAGE_SIZE + '&offset=' + offset,
      { headers: { Authorization: 'Bearer ' + token } },
    );
    if (!Array.isArray(page) || page.length === 0) break;
    products.push(...page);
    if (page.length < PRODUCT_LIST_PAGE_SIZE) break;
    offset += page.length;
  }
  return products;
}

async function uploadAsset(filePath, filename, token) {
  const mime = mimeFor(filename);
  if (!mime) throw new Error('Unsupported image extension');
  const bytes = fs.readFileSync(filePath);

  const grant = await requestJson(BASE_URL + '/api/image-assets/upload-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      purpose: 'product_image',
      originalFilename: filename,
      declaredMime: mime,
      declaredByteSize: bytes.length,
    }),
  });

  const sameOrigin = typeof grant.uploadUrl === 'string' && grant.uploadUrl.startsWith('/');
  const uploadUrl = sameOrigin ? BASE_URL + grant.uploadUrl : grant.uploadUrl;
  const uploadHeaders = { ...(grant.headers ?? {}) };
  if (!uploadHeaders['Content-Type']) uploadHeaders['Content-Type'] = mime;
  if (sameOrigin) {
    uploadHeaders.Authorization = 'Bearer ' + token;
  } else {
    delete uploadHeaders.Authorization;
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: grant.method || 'PUT',
    headers: uploadHeaders,
    body: bytes,
  });
  if (!uploadResponse.ok) throw new Error('Upload PUT failed (HTTP ' + uploadResponse.status + ')');

  const finalized = await requestJson(
    BASE_URL + '/api/image-assets/upload-sessions/' + encodeURIComponent(grant.sessionId) + '/finalize',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: '{}',
    },
  );
  const assetId = typeof finalized?.id === 'string' ? finalized.id : null;
  if (!assetId) throw new Error('Finalize returned no asset id');
  return pollReady(assetId, token);
}

async function pollReady(assetId, token) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const descriptor = await requestJson(
      BASE_URL + '/api/image-assets/' + encodeURIComponent(assetId),
      { headers: { Authorization: 'Bearer ' + token } },
    );
    if (descriptor?.status === 'ready') return assetId;
    if (descriptor?.status === 'degraded' || descriptor?.status === 'purged' || descriptor?.status === 'recycled') {
      throw new Error('Asset processing failed (' + (descriptor.errorCode ?? descriptor.status) + ')');
    }
    if (Date.now() >= deadline) throw new Error('Asset processing timed out');
    await sleep(POLL_INTERVAL_MS);
  }
}

async function attachToProduct(product, assetId, token) {
  await requestJson(BASE_URL + '/api/products/' + product.id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      itemNo: product.item_no,
      productName: product.product_name,
      composition: product.composition ?? '',
      weight: product.weight ?? '',
      width: product.width ?? '',
      imageAssetIds: [assetId],
    }),
  });
}

async function main() {
  const password = process.env.ADMIN_PASSWORD?.trim();
  if (!password) {
    console.error('ADMIN_PASSWORD is required to log in to the local server.');
    process.exit(1);
  }
  if (!fs.existsSync(JPG_DIR)) {
    console.error('Image directory not found: ' + JPG_DIR);
    process.exit(1);
  }

  const files = fs.readdirSync(JPG_DIR).filter((name) => mimeFor(name) !== null);
  if (files.length === 0) {
    console.log('No supported image files found in ' + JPG_DIR);
    return;
  }

  const token = await login(password);
  const products = await fetchProducts(token);
  const byItemNo = new Map();
  for (const product of products) {
    if (typeof product?.item_no === 'string' && !byItemNo.has(product.item_no)) {
      byItemNo.set(product.item_no, product);
    }
  }

  let uploaded = 0;
  let unmatched = 0;
  let failed = 0;
  const unmatchedList = [];

  for (let index = 0; index < files.length; index += 1) {
    const filename = files[index];
    const itemNo = path.basename(filename, path.extname(filename));
    const product = byItemNo.get(itemNo);
    if (!product) {
      unmatched += 1;
      unmatchedList.push(itemNo);
      process.stdout.write('[' + (index + 1) + '/' + files.length + '] ' + itemNo + ' unmatched\n');
      continue;
    }
    try {
      const assetId = await uploadAsset(path.join(JPG_DIR, filename), filename, token);
      await attachToProduct(product, assetId, token);
      uploaded += 1;
      process.stdout.write('[' + (index + 1) + '/' + files.length + '] ' + itemNo + ' attached asset ' + assetId + '\n');
    } catch (error) {
      failed += 1;
      process.stdout.write('[' + (index + 1) + '/' + files.length + '] ' + itemNo + ' failed: ' + safeMessage(error) + '\n');
    }
  }

  console.log('Done: uploaded=' + uploaded + ' failed=' + failed + ' unmatched=' + unmatched);
  if (unmatchedList.length > 0) {
    console.log('Unmatched item numbers: ' + unmatchedList.join(', '));
  }
}

function safeMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[A-Za-z0-9_-]{20,}/g, '[redacted]');
}

main().catch((error) => {
  console.error(safeMessage(error));
  process.exit(1);
});
