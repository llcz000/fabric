import { randomUUID } from 'node:crypto';

import type express from 'express';

import { ImageAssetError } from './errors';
import { createProductImageRouter, type ProductImageRouteRuntime } from './productImages';
import { isProductImageRequest } from './productRouteScope';

const SAFE_REQUEST_ID = /^[a-zA-Z0-9_-]{1,128}$/;

export interface ProductImageServerMountOptions {
  runtime: ProductImageRouteRuntime;
  authenticate(req: express.Request): boolean;
  globalAuth: express.RequestHandler;
}

export function mountProductImageServerRoutes(app: express.Express, options: ProductImageServerMountOptions): void {
  app.use('/api/products', createProductImageAuthMiddleware(options.runtime, options.authenticate));
  app.use('/api/products', createProductImageRouter(options.runtime));
  app.use('/api/products', options.globalAuth);
}

function createProductImageAuthMiddleware(
  runtime: ProductImageRouteRuntime,
  authenticate: (req: express.Request) => boolean,
): express.RequestHandler {
  return (req, res, next) => {
    if (!runtime.enabled || !runtime.service || !isProductImageRequest(req)) return next();
    const supplied = req.get('X-Request-Id');
    const requestId = supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : `req_${randomUUID().replace(/-/g, '')}`;
    res.set('X-Request-Id', requestId);
    if (!authenticate(req)) {
      const error = new ImageAssetError('ASSET_ACCESS_DENIED', 401, false, 'Asset access is denied');
      return res.status(error.statusCode).json(error.toResponse(requestId));
    }
    next();
  };
}
