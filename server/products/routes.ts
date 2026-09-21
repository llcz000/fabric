import { randomUUID } from 'node:crypto';

import express from 'express';
import { z } from 'zod';

import { ImageAssetError } from '../image-assets/errors';
import { isProductImageRequest } from '../image-assets/productRouteScope';
import type { AccessUrlRequest, AccessUrlResult } from '../image-assets/service';
import { ProductError } from './errors';
import type { ProductRecord } from './repository';
import type { ProductService } from './service';
import { PRODUCT_IMAGE_ROLES, type ProductDetail, type ProductPage } from './types';

export { ProductError } from './errors';

const MAX_PRODUCT_MUTATION_BYTES = 64 * 1024;
const SAFE_REQUEST_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const safeId = z.coerce.number().int().positive().safe();
const assetId = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const imageRole = z.enum(PRODUCT_IMAGE_ROLES);
const layoutItem = z.object({
  assetId,
  role: imageRole,
  sortOrder: z.number().int().nonnegative(),
}).strict();
const productWrite = z.object({
  itemNo: z.string().max(255),
  productName: z.string().max(255),
  composition: z.string().max(2_000),
  weight: z.string().max(255),
  width: z.string().max(255),
  patternTagIds: z.array(z.number().int().positive().safe()).max(12),
  images: z.array(layoutItem).max(20),
}).strict();
const layoutWrite = z.object({ images: z.array(layoutItem).max(20) }).strict();
const attachImages = z.object({
  role: imageRole,
  assetIds: z.array(assetId).min(1).max(20),
}).strict();
const batchTags = z.object({
  productIds: z.array(z.number().int().positive().safe()).min(1).max(100),
  operation: z.enum(['add', 'remove']),
  tagIds: z.array(z.number().int().positive().safe()).min(1).max(12),
}).strict();
const issueAction = z.object({ note: z.string().max(1_000).optional() }).strict();
const strictEmpty = z.object({}).strict();
const tagCreate = z.object({ name: z.string().min(1).max(32) }).strict();
const tagUpdate = z.object({
  name: z.string().min(1).max(32).optional(),
  status: z.enum(['active', 'archived']).optional(),
}).strict().refine((value) => value.name !== undefined || value.status !== undefined);
const tagQuery = z.object({
  q: z.string().max(32).optional().default(''),
  status: z.enum(['active', 'archived']).optional().default('active'),
}).strict();
const productListQuery = z.object({
  q: z.string().max(255).optional(),
  tagIds: csvPositiveIds(12).optional().default([]),
  tagMode: z.literal('all').optional().default('all'),
  reviewStatus: z.enum(['reviewed', 'needs_attention']).optional(),
  issueCodes: z.string().transform((value) => value === '' ? [] : value.split(',')).pipe(z.array(z.enum([
    'MISSING_PRODUCT_NAME', 'MISSING_COMPOSITION', 'MISSING_WEIGHT', 'MISSING_WIDTH',
    'DUPLICATE_ITEM_NO', 'CONFLICTING_PRODUCT_DATA', 'MISSING_PATTERN_ORIGINAL',
    'IMAGE_UNCLASSIFIED', 'IMAGE_REFERENCE_MISSING', 'IMAGE_FORMAT_CONVERTED',
    'IMAGE_RESIZED', 'IMAGE_LIMIT_EXCEEDED', 'UNMAPPED_SOURCE_DATA',
  ])).max(13)).optional().default([]),
  imageState: z.enum(['missing_pattern', 'has_unclassified', 'complete']).optional(),
  batchId: optionalPositiveInteger(),
  duplicateItemNo: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(100)).optional().default(50),
  offset: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(1_000_000)).optional().default(0),
}).strict();

export type ProductRouteService = Pick<ProductService,
  | 'saveProduct'
  | 'attachProductImages'
  | 'replaceImageLayout'
  | 'deleteProductImage'
  | 'deleteProduct'
  | 'searchPatternTags'
  | 'createPatternTag'
  | 'updatePatternTag'
  | 'applyPatternTagBatch'
  | 'listProducts'
  | 'getProductDetail'
  | 'ignoreIssue'
  | 'reopenIssue'
>;

export interface ProductRouteRuntime {
  readonly enabled: boolean;
  readonly service: ProductRouteService | null;
  readonly assetAccess?: ProductAssetAccessService;
  readonly principalId: string;
}

export interface ProductAssetAccessService {
  getAccessUrls(requests: AccessUrlRequest[], principalId: string): Promise<AccessUrlResult[]>;
}

type ProductRequest = express.Request & { productRequestId?: string };

export function createProductRouter(runtime: ProductRouteRuntime): express.Router {
  const router = baseRouter(runtime, isProductImageRequest);

  router.get('/', asyncRoute(async (req, res, next) => {
    if (!available(runtime)) return next();
    const page = await runtime.service.listProducts(parse(productListQuery, req.query)) satisfies ProductPage;
    res.json(await productPageResponse(page, runtime));
  }));

  router.post('/batch-pattern-tags', asyncRoute(async (req, res, next) => {
    if (!available(runtime)) return next();
    requireJson(req);
    parse(strictEmpty, req.query);
    await runtime.service.applyPatternTagBatch(parse(batchTags, req.body), runtime.principalId);
    res.json({ success: true });
  }));

  router.post('/', asyncRoute(async (req, res, next) => {
    if (!available(runtime)) return next();
    requireJson(req);
    parse(strictEmpty, req.query);
    const created = await runtime.service.saveProduct(null, parse(productWrite, req.body), runtime.principalId);
    res.status(201).json(created satisfies ProductRecord | null);
  }));

  router.get('/:id', asyncRoute(async (req, res, next) => {
    if (!available(runtime)) return next();
    parse(strictEmpty, req.query);
    const product = await runtime.service.getProductDetail(parseId(req.params.id));
    res.json(await productDetailResponse(requireFound(product), runtime));
  }));

  router.put('/:id', asyncRoute(async (req, res, next) => {
    if (!available(runtime)) return next();
    requireJson(req);
    parse(strictEmpty, req.query);
    const product = await runtime.service.saveProduct(parseId(req.params.id), parse(productWrite, req.body), runtime.principalId);
    res.json(requireFound(product));
  }));

  router.delete('/:id', asyncRoute(async (req, res, next) => {
    if (!available(runtime)) return next();
    parseEmptyBody(req.body);
    parse(strictEmpty, req.query);
    if (!await runtime.service.deleteProduct(parseId(req.params.id))) throw notFound();
    res.json({ success: true });
  }));

  router.post('/:id/images', asyncRoute(async (req, res, next) => {
    if (!available(runtime)) return next();
    requireJson(req);
    parse(strictEmpty, req.query);
    const input = parse(attachImages, req.body);
    const product = await runtime.service.attachProductImages(
      parseId(req.params.id), input.role, input.assetIds, runtime.principalId,
    );
    res.status(201).json(await productDetailResponse(requireFound(product), runtime));
  }));

  router.patch('/:id/image-layout', asyncRoute(async (req, res, next) => {
    if (!available(runtime)) return next();
    requireJson(req);
    parse(strictEmpty, req.query);
    const productId = parseId(req.params.id);
    await runtime.service.replaceImageLayout(productId, parse(layoutWrite, req.body).images);
    res.json(await productDetailResponse(requireFound(await runtime.service.getProductDetail(productId)), runtime));
  }));

  router.delete('/:id/images/:assetId', asyncRoute(async (req, res, next) => {
    if (!available(runtime)) return next();
    parseEmptyBody(req.body);
    parse(strictEmpty, req.query);
    const productId = parseId(req.params.id);
    await runtime.service.deleteProductImage(productId, parse(assetId, req.params.assetId));
    res.json(await productDetailResponse(requireFound(await runtime.service.getProductDetail(productId)), runtime));
  }));

  router.post('/:id/issues/:issueId/ignore', asyncRoute(async (req, res, next) => {
    if (!available(runtime)) return next();
    requireJson(req);
    parse(strictEmpty, req.query);
    const input = parse(issueAction, req.body);
    if (!await runtime.service.ignoreIssue(parseId(req.params.id), parseId(req.params.issueId), runtime.principalId, input.note)) {
      throw notFound();
    }
    res.json({ success: true });
  }));

  router.post('/:id/issues/:issueId/reopen', asyncRoute(async (req, res, next) => {
    if (!available(runtime)) return next();
    requireJson(req);
    parse(strictEmpty, req.query);
    parse(strictEmpty, req.body);
    if (!await runtime.service.reopenIssue(parseId(req.params.id), parseId(req.params.issueId), runtime.principalId)) {
      throw notFound();
    }
    res.json({ success: true });
  }));

  installErrorHandler(router);
  return router;
}

export function createPatternTagRouter(runtime: ProductRouteRuntime): express.Router {
  const router = baseRouter(runtime, () => true);

  router.get('/', asyncRoute(async (req, res, next) => {
    if (!available(runtime)) return next();
    const input = parse(tagQuery, req.query);
    res.json({ items: await runtime.service.searchPatternTags(input.q, input.status) });
  }));

  router.post('/', asyncRoute(async (req, res, next) => {
    if (!available(runtime)) return next();
    requireJson(req);
    parse(strictEmpty, req.query);
    res.status(201).json(await runtime.service.createPatternTag(parse(tagCreate, req.body).name, runtime.principalId));
  }));

  router.patch('/:id', asyncRoute(async (req, res, next) => {
    if (!available(runtime)) return next();
    requireJson(req);
    parse(strictEmpty, req.query);
    const tag = await runtime.service.updatePatternTag(parseId(req.params.id), parse(tagUpdate, req.body), runtime.principalId);
    res.json(requireFound(tag));
  }));

  installErrorHandler(router);
  return router;
}

function baseRouter(
  runtime: ProductRouteRuntime,
  ownsRequest: (req: express.Request) => boolean,
): express.Router {
  const router = express.Router();
  router.use((req: ProductRequest, res, next) => {
    if (!available(runtime) || !ownsRequest(req)) return next('router');
    const supplied = req.get('X-Request-Id');
    req.productRequestId = supplied && SAFE_REQUEST_ID.test(supplied)
      ? supplied
      : `req_${randomUUID().replace(/-/g, '')}`;
    res.set('X-Request-Id', req.productRequestId);
    next();
  });
  router.use((req, res, next) => {
    express.json({ limit: MAX_PRODUCT_MUTATION_BYTES, strict: true })(req, res, next);
  });
  router.use(express.raw({ type: () => true, limit: MAX_PRODUCT_MUTATION_BYTES }));
  return router;
}

function installErrorHandler(router: express.Router): void {
  router.use((error: unknown, req: ProductRequest, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(error);
    const normalized = normalizeError(error);
    const requestId = req.productRequestId ?? `req_${randomUUID().replace(/-/g, '')}`;
    res.set('X-Request-Id', requestId);
    res.status(normalized.statusCode).json(normalized.toResponse(requestId));
  });
}

function available(runtime: ProductRouteRuntime): runtime is ProductRouteRuntime & { service: ProductRouteService } {
  return runtime.enabled && runtime.service !== null;
}

async function productPageResponse(page: ProductPage, runtime: ProductRouteRuntime): Promise<ProductPage | Record<string, unknown>> {
  if (!runtime.assetAccess) return page;
  const assetIds = [...new Set(page.items.flatMap((item) => item.primaryAssetId ? [item.primaryAssetId] : []))];
  const requests = assetIds.map((primaryAssetId) => ({ assetId: primaryAssetId, variant: 'thumbnail' as const }));
  const signed = await runtime.assetAccess.getAccessUrls(requests, runtime.principalId);
  const byAsset = new Map(signed.map((entry) => [entry.assetId, entry]));
  return {
    ...page,
    items: page.items.map((item) => {
      if (!item.primaryAssetId) return { ...item, images: [] };
      const thumbnail = byAsset.get(item.primaryAssetId);
      if (!thumbnail) throw new ImageAssetError('ASSET_NOT_READY', 409, true, 'Product thumbnail is not ready');
      return {
        ...item,
        images: [{
          assetId: item.primaryAssetId,
          role: 'pattern_original',
          sortOrder: 0,
          isPrimary: true,
          thumbnailUrl: thumbnail.url,
          expiresAt: thumbnail.expiresAt,
        }],
      };
    }),
  };
}

async function productDetailResponse(detail: ProductDetail, runtime: ProductRouteRuntime): Promise<ProductDetail | Record<string, unknown>> {
  if (!runtime.assetAccess || detail.images.length === 0) return detail;
  const requests = detail.images.flatMap((image) => [
    { assetId: image.assetId, variant: 'thumbnail' as const },
    { assetId: image.assetId, variant: 'display' as const },
  ]);
  const signed = await runtime.assetAccess.getAccessUrls(requests, runtime.principalId);
  const byAssetVariant = new Map(signed.map((entry) => [`${entry.assetId}:${entry.variant}`, entry]));
  return {
    ...detail,
    images: detail.images.map((image) => {
      const thumbnail = byAssetVariant.get(`${image.assetId}:thumbnail`);
      const display = byAssetVariant.get(`${image.assetId}:display`);
      if (!thumbnail || !display) throw new ImageAssetError('ASSET_NOT_READY', 409, true, 'Product image is not ready');
      return {
        ...image,
        thumbnailUrl: thumbnail.url,
        displayUrl: display.url,
        expiresAt: display.expiresAt,
      };
    }),
  };
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalidRequest();
  return parsed.data;
}

function parseId(value: string): number {
  return parse(safeId, value);
}

function requireJson(req: express.Request): void {
  if (!req.is('application/json') || Buffer.isBuffer(req.body)) throw invalidRequest();
}

function parseEmptyBody(body: unknown): void {
  if (Buffer.isBuffer(body)) {
    if (body.length === 0) return;
    throw invalidRequest();
  }
  parse(strictEmpty, body === undefined ? {} : body);
}

function requireFound<T>(value: T | null): T {
  if (value === null) throw notFound();
  return value;
}

function invalidRequest(): ProductError {
  return new ProductError('PRODUCT_INVALID', 422, false, 'Product request is invalid');
}

function notFound(): ProductError {
  return new ProductError('PRODUCT_NOT_FOUND', 404, false, 'Product was not found');
}

function normalizeError(error: unknown): ProductError | ImageAssetError {
  if (error instanceof ProductError) return error;
  if (error instanceof ImageAssetError) return error;
  if (isBodyLimitError(error)) return new ProductError('PRODUCT_INVALID', 413, false, 'Product request exceeds the limit');
  if (isBodyParserClientError(error)) return invalidRequest();
  return new ProductError('PRODUCT_FAILED', 500, true, 'Product request failed');
}

function isBodyLimitError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { type?: unknown }).type === 'entity.too.large');
}

function isBodyParserClientError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = Number((error as { status?: unknown; statusCode?: unknown }).status
    ?? (error as { statusCode?: unknown }).statusCode);
  return Number.isInteger(status) && status >= 400 && status < 500;
}

function csvPositiveIds(maximum: number) {
  return z.string().transform((value, context) => {
    if (value === '') return [];
    const parts = value.split(',');
    const values = parts.map(Number);
    if (parts.length > maximum || values.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      context.addIssue({ code: 'custom', message: 'Invalid ID list' });
      return z.NEVER;
    }
    return values;
  });
}

function optionalPositiveInteger() {
  return z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive().safe()).optional();
}

function asyncRoute(handler: (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => Promise<void>): express.RequestHandler {
  return (req, res, next) => void handler(req, res, next).catch(next);
}
