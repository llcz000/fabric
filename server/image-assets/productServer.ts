import { randomUUID } from 'node:crypto';

import type express from 'express';

import { ImageAssetError } from './errors';
import { createPatternTagRouter, createProductRouter, type ProductRouteRuntime } from '../products/routes';
import { isProductImageRequest } from './productRouteScope';

const SAFE_REQUEST_ID = /^[a-zA-Z0-9_-]{1,128}$/;

export interface ProductImageServerMountOptions {
  runtime: ProductRouteRuntime;
  authenticate(req: express.Request): boolean;
  globalAuth: express.RequestHandler;
}

export function mountProductImageServerRoutes(app: express.Express, options: ProductImageServerMountOptions): void {
  app.use('/api/products', createProductImageAuthMiddleware(options.runtime, options.authenticate, isProductImageRequest));
  app.use('/api/products', createProductRouter(options.runtime));
  app.use('/api/products', options.globalAuth);
  app.use('/api/product-pattern-tags', createProductImageAuthMiddleware(options.runtime, options.authenticate, () => true));
  app.use('/api/product-pattern-tags', createPatternTagRouter(options.runtime));
  app.use('/api/product-pattern-tags', options.globalAuth);
}

function createProductImageAuthMiddleware(
  runtime: ProductRouteRuntime,
  authenticate: (req: express.Request) => boolean,
  ownsRequest: (req: express.Request) => boolean,
): express.RequestHandler {
  return (req, res, next) => {
    if (!runtime.enabled || !runtime.service || !ownsRequest(req)) return next();
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
