import { randomUUID } from 'node:crypto';

import express from 'express';
import { z } from 'zod';

import { ImageAssetError } from './errors';
import type { AccessUrlRequest, AccessUrlResult } from './service';

export type ProductImageRole = 'pattern_original' | 'gallery' | 'swatch';

export interface ProductAssetAssociation {
  assetId: string;
  sortOrder: number;
  role: ProductImageRole;
  isPrimary: boolean;
}

export interface LegacyProductImage {
  id: number;
  sortOrder: number;
  /** Internal-only compatibility value. It must never be returned to the browser. */
  rawSource?: string;
}

export interface ProductAssetImageDescriptor extends ProductAssetAssociation {
  thumbnailUrl: string;
  displayUrl: string;
  expiresAt: string;
}

export interface LegacyProductImageDescriptor {
  legacyImageId: number;
  sortOrder: number;
  role: 'legacy';
  isPrimary: boolean;
  contentUrl: string;
}

export type ProductImageDescriptor = ProductAssetImageDescriptor | LegacyProductImageDescriptor;

export interface ProductImageRuntime {
  readonly enabled: boolean;
  readonly service: {
    getAccessUrls(requests: AccessUrlRequest[], principalId: string): Promise<AccessUrlResult[]>;
    attachProductImages(productId: number, assetIds: string[]): Promise<void>;
    detachProductImage(productId: number, assetId: string): Promise<void>;
    detachAllProductImages(productId: number): Promise<void>;
    deleteProductWithAssets(productId: number): Promise<boolean>;
  } | null;
  findAssociations(productId: number): Promise<ProductAssetAssociation[]>;
  findLegacyImages(productId: number): Promise<LegacyProductImage[]>;
}

const MAX_PRODUCT_IMAGE_ASSETS = 20;
const MAX_PRODUCT_MUTATION_BYTES = 32 * 1024;
const MAX_BATCH_DELETE_PRODUCTS = 100;
const SAFE_ASSET_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const SAFE_REQUEST_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const VALID_ROLES = new Set<ProductImageRole>(['pattern_original', 'gallery', 'swatch']);

const productWriteSchema = z.object({
  itemNo: z.string().trim().min(1).max(255),
  productName: z.string().trim().min(1).max(255),
  composition: z.string().max(2_000).optional().default(''),
  weight: z.string().max(255).optional().default(''),
  width: z.string().max(255).optional().default(''),
  imageAssetIds: z.array(z.string()).max(MAX_PRODUCT_IMAGE_ASSETS).optional(),
}).strict();

const batchDeleteSchema = z.object({
  ids: z.array(z.number().int().positive()).max(MAX_BATCH_DELETE_PRODUCTS).optional(),
  itemNos: z.array(z.string().trim().min(1).max(255)).max(MAX_BATCH_DELETE_PRODUCTS).optional(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.ids?.length) === Boolean(value.itemNos?.length)) {
    context.addIssue({ code: 'custom', message: 'Provide exactly one product selection' });
  }
});

export interface ProductWriteInput {
  itemNo: string;
  productName: string;
  composition: string;
  weight: string;
  width: string;
}

export interface ProductRecord extends Record<string, unknown> {
  id: number;
  item_no: string;
  product_name: string;
}

export interface ProductImageRouteRuntime extends ProductImageRuntime {
  readonly principalId: string;
  listProducts(): Promise<ProductRecord[]>;
  getProduct(productId: number): Promise<ProductRecord | null>;
  createProduct(input: ProductWriteInput): Promise<ProductRecord>;
  updateProduct(productId: number, input: ProductWriteInput): Promise<{ product: ProductRecord; previous: ProductRecord } | null>;
  restoreProduct(previous: ProductRecord): Promise<void>;
  deleteCreatedProduct(productId: number): Promise<void>;
}

export function parseProductImageAssetIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'imageAssetIds must be an array');
  if (value.length > MAX_PRODUCT_IMAGE_ASSETS) {
    throw new ImageAssetError('IMAGE_LIMIT_EXCEEDED', 413, false, `At most ${MAX_PRODUCT_IMAGE_ASSETS} product images may be attached`);
  }
  const assetIds = value.map((assetId) => {
    if (typeof assetId !== 'string' || !SAFE_ASSET_ID.test(assetId)) {
      throw new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'imageAssetIds contains an invalid asset ID');
    }
    return assetId;
  });
  if (new Set(assetIds).size !== assetIds.length) {
    throw new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'imageAssetIds must not contain duplicate asset IDs');
  }
  return assetIds;
}

export async function describeProductImages(
  productId: number,
  principalId: string,
  runtime: ProductImageRuntime,
): Promise<ProductImageDescriptor[]> {
  if (!runtime.enabled || !runtime.service) return [];

  const associations = (await runtime.findAssociations(productId))
    .filter((association) => VALID_ROLES.has(association.role))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.assetId.localeCompare(right.assetId));
  if (associations.length === 0) {
    return (await runtime.findLegacyImages(productId))
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id)
      .map((legacy, index): LegacyProductImageDescriptor => ({
        legacyImageId: legacy.id,
        sortOrder: legacy.sortOrder,
        role: 'legacy',
        isPrimary: index === 0,
        contentUrl: `/api/products/${productId}/images/${legacy.id}`,
      }));
  }

  const requests: AccessUrlRequest[] = associations.flatMap((association) => [
    { assetId: association.assetId, variant: 'thumbnail' as const },
    { assetId: association.assetId, variant: 'display' as const },
  ]);
  const accessUrls = await runtime.service.getAccessUrls(requests, principalId);
  const byAssetAndVariant = new Map(accessUrls.map((value) => [`${value.assetId}:${value.variant}`, value]));

  return associations.map((association): ProductAssetImageDescriptor => {
    const thumbnail = byAssetAndVariant.get(`${association.assetId}:thumbnail`);
    const display = byAssetAndVariant.get(`${association.assetId}:display`);
    if (!thumbnail || !display) {
      throw new ImageAssetError('ASSET_NOT_READY', 409, true, 'Product image variants are not ready');
    }
    return {
      ...association,
      thumbnailUrl: thumbnail.url,
      displayUrl: display.url,
      expiresAt: display.expiresAt,
    };
  });
}

export async function attachProductImageAssets(
  productId: number,
  imageAssetIds: unknown,
  runtime: ProductImageRuntime,
): Promise<number> {
  if (!runtime.enabled || !runtime.service) return 0;
  const assetIds = parseProductImageAssetIds(imageAssetIds);
  if (assetIds.length === 0) return 0;
  await runtime.service.attachProductImages(productId, assetIds);
  return (await runtime.findAssociations(productId)).length;
}

export async function detachProductImageAsset(
  productId: number,
  assetId: string,
  runtime: ProductImageRuntime,
): Promise<number> {
  if (!runtime.enabled || !runtime.service || !SAFE_ASSET_ID.test(assetId)) {
    throw new ImageAssetError('ASSET_NOT_FOUND', 404, false, 'Product image not found');
  }
  const current = await runtime.findAssociations(productId);
  if (!current.some((association) => association.assetId === assetId)) {
    throw new ImageAssetError('ASSET_NOT_FOUND', 404, false, 'Product image not found');
  }
  await runtime.service.detachProductImage(productId, assetId);
  return (await runtime.findAssociations(productId)).length;
}

export async function detachAllProductImageAssets(productId: number, runtime: ProductImageRuntime): Promise<void> {
  if (runtime.enabled && runtime.service) await runtime.service.detachAllProductImages(productId);
}

export function createProductImageRouter(runtime: ProductImageRouteRuntime): express.Router {
  const router = express.Router();

  router.use((req, res, next) => {
    if (!runtime.enabled || !runtime.service) return next();
    const supplied = req.get('X-Request-Id');
    res.set('X-Request-Id', supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : `req_${randomUUID().replace(/-/g, '')}`);
    next();
  });
  router.use((req, _res, next) => {
    if (!runtime.enabled || !runtime.service) return next();
    express.json({ limit: MAX_PRODUCT_MUTATION_BYTES, strict: false })(req, _res, next);
  });

  router.get('/', asyncRoute(async (req, res, next) => {
    if (!runtime.enabled || !runtime.service) return next();
    rejectQuery(req);
    const products = await runtime.listProducts();
    res.json(await Promise.all(products.map((product) => productResponse(product, runtime))));
  }));

  router.get('/:id/thumbnails', asyncRoute(async (req, res, next) => {
    if (!runtime.enabled || !runtime.service) return next();
    rejectQuery(req);
    const product = await requireProduct(parseProductId(req.params.id), runtime);
    const images = await describeProductImages(product.id, runtime.principalId, runtime);
    res.json({ images });
  }));

  router.get('/:id', asyncRoute(async (req, res, next) => {
    if (!runtime.enabled || !runtime.service) return next();
    rejectQuery(req);
    res.json(await productResponse(await requireProduct(parseProductId(req.params.id), runtime), runtime));
  }));

  router.post('/batch-delete', asyncRoute(async (req, res, next) => {
    if (!runtime.enabled || !runtime.service) return next();
    rejectMutationTransport(req);
    rejectQuery(req);
    const input = parse(batchDeleteSchema, req.body);
    const ids = input.ids?.length
      ? input.ids
      : (await runtime.listProducts()).filter((product) => input.itemNos!.includes(product.item_no)).map((product) => product.id);
    let deleted = 0;
    for (const productId of ids) {
      if (await runtime.service.deleteProductWithAssets(productId)) deleted += 1;
    }
    res.json({ success: true, deleted });
  }));

  router.post('/', asyncRoute(async (req, res, next) => {
    if (!runtime.enabled || !runtime.service) return next();
    rejectMutationTransport(req);
    rejectQuery(req);
    const parsed = parse(productWriteSchema, req.body);
    const assetIds = parsed.imageAssetIds === undefined ? [] : parseProductImageAssetIds(parsed.imageAssetIds);
    const input = writeInput(parsed);
    let created: ProductRecord | null = null;
    let attached = false;
    try {
      created = await runtime.createProduct(input);
      if (assetIds.length > 0) {
        await runtime.service.attachProductImages(created.id, assetIds);
        attached = true;
      }
      const product = await requireProduct(created.id, runtime);
      res.status(201).json(await productResponse(product, runtime));
    } catch (error) {
      if (created) {
        if (attached) await bestEffort(() => runtime.service!.detachAllProductImages(created!.id));
        await bestEffort(() => runtime.deleteCreatedProduct(created!.id));
      }
      throw error;
    }
  }));

  router.put('/:id', asyncRoute(async (req, res, next) => {
    if (!runtime.enabled || !runtime.service) return next();
    rejectMutationTransport(req);
    rejectQuery(req);
    const productId = parseProductId(req.params.id);
    const parsed = parse(productWriteSchema, req.body);
    const assetIds = parsed.imageAssetIds === undefined ? [] : parseProductImageAssetIds(parsed.imageAssetIds);
    const existingAssetIds = new Set((await runtime.findAssociations(productId)).map((association) => association.assetId));
    if (assetIds.some((assetId) => existingAssetIds.has(assetId))) {
      throw new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'imageAssetIds must contain only new product assets');
    }
    const updated = await runtime.updateProduct(productId, writeInput(parsed));
    if (!updated) throw new ImageAssetError('ASSET_NOT_FOUND', 404, false, 'Product not found');
    let attached = false;
    try {
      if (assetIds.length > 0) {
        await runtime.service.attachProductImages(productId, assetIds);
        attached = true;
      }
      res.json(await productResponse(await requireProduct(productId, runtime), runtime));
    } catch (error) {
      if (attached) {
        for (const assetId of assetIds) await bestEffort(() => runtime.service!.detachProductImage(productId, assetId));
      }
      await bestEffort(() => runtime.restoreProduct(updated.previous));
      throw error;
    }
  }));

  router.delete('/:productId/images/:assetId', asyncRoute(async (req, res, next) => {
    if (!runtime.enabled || !runtime.service || /^\d+$/.test(req.params.assetId)) return next();
    rejectQuery(req);
    const productId = parseProductId(req.params.productId);
    const imageCount = await detachProductImageAsset(productId, req.params.assetId, runtime);
    res.json({ success: true, image_count: imageCount });
  }));

  router.delete('/:id', asyncRoute(async (req, res, next) => {
    if (!runtime.enabled || !runtime.service) return next();
    rejectQuery(req);
    const productId = parseProductId(req.params.id);
    await requireProduct(productId, runtime);
    if (!await runtime.service.deleteProductWithAssets(productId)) {
      throw new ImageAssetError('ASSET_NOT_FOUND', 404, false, 'Product not found');
    }
    res.json({ success: true });
  }));

  router.use((error: unknown, req, res, next) => {
    if (!runtime.enabled || !runtime.service) return next(error);
    const requestId = res.get('X-Request-Id') || `req_${randomUUID().replace(/-/g, '')}`;
    res.set('X-Request-Id', requestId);
    if (error instanceof ImageAssetError) return res.status(error.statusCode).json(error.toResponse(requestId));
    if (error instanceof z.ZodError || isBodyParserError(error)) {
      const status = isTooLarge(error) ? 413 : 422;
      const safe = new ImageAssetError(status === 413 ? 'IMAGE_LIMIT_EXCEEDED' : 'IMAGE_CONTENT_INVALID', status, false, status === 413 ? 'Product request exceeds the limit' : 'Product request is invalid');
      return res.status(status).json(safe.toResponse(requestId));
    }
    const safe = new ImageAssetError('STORAGE_UNAVAILABLE', 503, true, 'Product image storage is unavailable');
    res.status(safe.statusCode).json(safe.toResponse(requestId));
  });
  return router;
}

function writeInput(value: z.infer<typeof productWriteSchema>): ProductWriteInput {
  return { itemNo: value.itemNo, productName: value.productName, composition: value.composition, weight: value.weight, width: value.width };
}

async function productResponse(product: ProductRecord, runtime: ProductImageRouteRuntime): Promise<Record<string, unknown>> {
  const images = await describeProductImages(product.id, runtime.principalId, runtime);
  return { ...product, images, image_count: images.length };
}

async function requireProduct(productId: number, runtime: ProductImageRouteRuntime): Promise<ProductRecord> {
  const product = await runtime.getProduct(productId);
  if (!product) throw new ImageAssetError('ASSET_NOT_FOUND', 404, false, 'Product not found');
  return product;
}

function parseProductId(value: string): number {
  if (!/^[1-9]\d{0,14}$/.test(value)) throw new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'Product ID is invalid');
  const productId = Number(value);
  if (!Number.isSafeInteger(productId)) throw new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'Product ID is invalid');
  return productId;
}

function rejectQuery(req: express.Request): void {
  if (Object.keys(req.query).length > 0) throw new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'Product request contains unsupported query input');
}

function rejectMutationTransport(req: express.Request): void {
  if (req.is('multipart/form-data')) {
    throw new ImageAssetError('IMAGE_CONTENT_INVALID', 400, false, 'Create image assets before attaching product files');
  }
  if (!req.is('application/json')) throw new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'Product requests must use application/json');
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  return schema.parse(body);
}

function isBodyParserError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && ('type' in error || 'status' in error));
}

function isTooLarge(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && ((error as { type?: unknown }).type === 'entity.too.large' || (error as { status?: unknown }).status === 413));
}

async function bestEffort(work: () => Promise<unknown>): Promise<void> {
  try { await work(); } catch { /* Preserve the original failure after compensation is attempted. */ }
}

function asyncRoute(handler: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
