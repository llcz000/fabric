import type express from 'express';

import type { ProductImageRouteRuntime } from './image-assets/productImages';
import { isProductImageApiRequest } from './image-assets/productRouteScope';
import { mountProductImageServerRoutes } from './image-assets/productServer';

/**
 * Global body parser ownership for routes that manage their own parsing.
 *
 * Image-asset and company-image routes always own their bodies. Product image
 * routes own their bodies only when `productImageAssetsEnabled` is true;
 * otherwise they fall through to the global parser so legacy product routes
 * keep their exact behavior.
 */
export function exceptImageAssetApi(
  middleware: express.RequestHandler,
  productImageAssetsEnabled: boolean,
): express.RequestHandler {
  return (req, res, next) => {
    const requestPath = req.path.toLowerCase();
    if (
      requestPath === '/api/image-assets'
      || requestPath.startsWith('/api/image-assets/')
      || requestPath === '/api/company/images'
      || requestPath.startsWith('/api/company/images/')
      || (productImageAssetsEnabled && isProductImageApiRequest(req))
    ) return next();
    middleware(req, res, next);
  };
}

/**
 * Global authentication fallback that lets product routes own their own auth.
 *
 * Product routes are already protected by the product mount's own auth
 * middleware, so the general `/api` auth skips `/products` to avoid a second
 * (weaker) auth layer.
 */
export function exceptProductApi(middleware: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => {
    if (req.path === '/products' || req.path.startsWith('/products/')) return next();
    middleware(req, res, next);
  };
}

export interface MountProductRouteAssemblyOptions {
  productImageRuntime: ProductImageRouteRuntime;
  authenticateProduct(req: express.Request): boolean;
  globalAuth: express.RequestHandler;
}

/**
 * Mounts the real product route stack in the exact order server.ts depends on:
 *
 * 1. Product image auth + router + global auth for `/api/products`;
 * 2. General `/api` authentication that skips `/products`;
 *
 * Legacy product routes must be registered by the caller after this call, so
 * feature-on product image routes win and feature-off delegates to legacy
 * handlers unchanged.
 */
export function mountProductRouteAssembly(
  app: express.Express,
  options: MountProductRouteAssemblyOptions,
): void {
  mountProductImageServerRoutes(app, {
    runtime: options.productImageRuntime,
    authenticate: options.authenticateProduct,
    globalAuth: options.globalAuth,
  });
  app.use('/api', exceptProductApi(options.globalAuth));
}
