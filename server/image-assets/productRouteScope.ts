import type express from 'express';

const SAFE_ASSET_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const LEGACY_PRODUCT_LITERALS = new Set(['import', 'export']);

export type ProductRouteRequest = Pick<express.Request, 'method' | 'path'>;

export function isProductImageRequest(req: ProductRouteRequest): boolean {
  return isProductImageRoute(req.method, req.path);
}

export function isProductImageApiRequest(req: ProductRouteRequest): boolean {
  const prefix = '/api/products';
  if (req.path !== prefix && !req.path.startsWith(`${prefix}/`)) return false;
  return isProductImageRoute(req.method, req.path.slice(prefix.length) || '/');
}

function isProductImageRoute(method: string, requestPath: string): boolean {
  if (requestPath === '/') return method === 'GET' || method === 'POST';
  if (requestPath === '/batch-delete') return method === 'POST';

  const single = /^\/([^/]+)$/.exec(requestPath);
  if (single && (method === 'GET' || method === 'PUT' || method === 'DELETE')) {
    return !LEGACY_PRODUCT_LITERALS.has(single[1]);
  }

  if (/^\/[^/]+\/thumbnails$/.test(requestPath)) return method === 'GET';

  const image = /^\/([^/]+)\/images\/([^/]+)$/.exec(requestPath);
  if (image && method === 'DELETE' && !/^\d+$/.test(image[2]) && SAFE_ASSET_ID.test(image[2])) {
    return true;
  }

  return false;
}
