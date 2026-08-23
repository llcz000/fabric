import type express from 'express';

const SAFE_ASSET_ID = /^[a-zA-Z0-9_-]{1,128}$/;

export function isProductImageRequest(req: express.Request): boolean {
  return isProductImageRoute(req.method, req.path);
}

export function isProductImageApiRequest(req: express.Request): boolean {
  const prefix = '/api/products';
  if (req.path !== prefix && !req.path.startsWith(`${prefix}/`)) return false;
  return isProductImageRoute(req.method, req.path.slice(prefix.length) || '/');
}

function isProductImageRoute(method: string, requestPath: string): boolean {
  if (requestPath === '/') return method === 'GET' || method === 'POST';
  if (requestPath === '/batch-delete') return method === 'POST';
  if (/^\/[1-9]\d{0,14}$/.test(requestPath)) return method === 'GET' || method === 'PUT' || method === 'DELETE';
  if (/^\/[1-9]\d{0,14}\/thumbnails$/.test(requestPath)) return method === 'GET';
  const image = /^\/([1-9]\d{0,14})\/images\/([^/]+)$/.exec(requestPath);
  return method === 'DELETE' && Boolean(image && !/^\d+$/.test(image[2]) && SAFE_ASSET_ID.test(image[2]));
}
