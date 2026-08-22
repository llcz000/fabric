import { randomUUID } from 'node:crypto';

import express from 'express';
import { z } from 'zod';

import { ImageAssetError, type ImageAssetErrorCode } from './errors';
import { getAssetPolicy } from './policy';
import type {
  AccessUrlRequest,
  AccessUrlResult,
  AssetContent,
  CreateUploadSessionInput,
  UploadGrantResponse,
} from './service';
import type { AssetDescriptor, AssetVariantName } from './types';
import type { LocalUploadInput } from './runtime';

const PRINCIPAL_ID = 'admin';
const MAX_PRODUCT_UPLOAD_BYTES = getAssetPolicy('product_image').maxBytes;
const MAX_RAW_BODY_BYTES = MAX_PRODUCT_UPLOAD_BYTES + 1;
const SAFE_REQUEST_ID = /^[a-zA-Z0-9_-]{1,128}$/;

const uploadSessionSchema = z.object({
  purpose: z.enum(['company_logo', 'company_qr', 'product_image']),
  originalFilename: z.string().min(1).max(1_024),
  declaredMime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  declaredByteSize: z.number().int().positive(),
}).strict();

const strictEmptyObjectSchema = z.object({}).strict();
const assetIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const variantSchema = z.enum(['original', 'display', 'thumbnail']);
const accessUrlsSchema = z.object({
  requests: z.array(z.object({
    assetId: assetIdSchema,
    variant: variantSchema,
  }).strict()).max(100),
}).strict();
const contentQuerySchema = z.object({ variant: variantSchema }).strict();

export interface ImageAssetRouteService {
  createUploadSession(input: CreateUploadSessionInput): Promise<UploadGrantResponse>;
  finalizeUploadSession(sessionId: string, principalId: string): Promise<AssetDescriptor>;
  getDescriptor(assetId: string, principalId: string): Promise<AssetDescriptor>;
  getAccessUrls(requests: AccessUrlRequest[], principalId: string): Promise<AccessUrlResult[]>;
  readContent(assetId: string, variant: AssetVariantName, principalId: string): Promise<AssetContent>;
}

export interface ImageAssetRouteRuntime {
  readonly enabled: boolean;
  readonly storageProvider: 'cos' | 'local';
  readonly service: ImageAssetRouteService | null;
  uploadLocalContent?(sessionId: string, input: LocalUploadInput): Promise<void>;
}

type AssetRequest = express.Request & { imageAssetRequestId?: string };

export function createImageAssetRouter(runtime: ImageAssetRouteRuntime): express.Router {
  const router = express.Router();

  router.use((req: AssetRequest, res, next) => {
    const supplied = req.get('X-Request-Id');
    req.imageAssetRequestId = supplied && SAFE_REQUEST_ID.test(supplied)
      ? supplied
      : `req_${randomUUID().replace(/-/g, '')}`;
    res.set('X-Request-Id', req.imageAssetRequestId);
    next();
  });

  router.use((_req, _res, next) => {
    if (!runtime.enabled || !runtime.service) {
      return next(new ImageAssetError('STORAGE_UNAVAILABLE', 503, true, 'Image asset storage is unavailable'));
    }
    next();
  });

  router.use(express.json({ limit: MAX_RAW_BODY_BYTES, strict: false }));
  router.use(express.urlencoded({ extended: true, limit: MAX_RAW_BODY_BYTES }));
  router.use(express.raw({ type: () => true, limit: MAX_RAW_BODY_BYTES }));
  router.use((req, _res, next) => {
    if (Buffer.isBuffer(req.body) && req.body.length > MAX_PRODUCT_UPLOAD_BYTES) {
      return next(new ImageAssetError('IMAGE_LIMIT_EXCEEDED', 413, false, 'Image asset request exceeds the limit'));
    }
    next();
  });

  router.post('/upload-sessions', asyncRoute(async (req, res) => {
    parse(strictEmptyObjectSchema, req.query);
    const input = parseDeclaredJsonBody(uploadSessionSchema, req);
    const grant = await requireService(runtime).createUploadSession({ ...input, principalId: PRINCIPAL_ID });
    res.status(201).json({
      sessionId: grant.sessionId,
      uploadUrl: grant.uploadUrl,
      method: grant.method,
      headers: grant.headers,
      expiresAt: grant.expiresAt,
    });
  }));

  router.post('/upload-sessions/:id/finalize', asyncRoute(async (req, res) => {
    parseEmptyBody(req.body);
    parse(strictEmptyObjectSchema, req.query);
    const sessionId = parse(assetIdSchema, req.params.id);
    const descriptor = await requireService(runtime).finalizeUploadSession(sessionId, PRINCIPAL_ID);
    res.json({ assetId: descriptor.id, ...descriptor });
  }));

  router.post('/access-urls', asyncRoute(async (req, res) => {
    parse(strictEmptyObjectSchema, req.query);
    const input = parseDeclaredJsonBody(accessUrlsSchema, req);
    const results = await requireService(runtime).getAccessUrls(input.requests, PRINCIPAL_ID);
    res.json({ results });
  }));

  router.get('/:id/content', asyncRoute(async (req, res) => {
    parseEmptyBody(req.body);
    const assetId = parse(assetIdSchema, req.params.id);
    const query = parse(contentQuerySchema, req.query);
    const content = await requireService(runtime).readContent(assetId, query.variant, PRINCIPAL_ID);
    res.set('Content-Type', content.mime);
    res.set('Content-Length', String(content.byteSize));
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'private, no-store');
    res.set('ETag', content.etag);
    res.send(content.body);
  }));

  router.get('/:id', asyncRoute(async (req, res) => {
    parse(strictEmptyObjectSchema, req.query);
    parseEmptyBody(req.body);
    const assetId = parse(assetIdSchema, req.params.id);
    const descriptor = await requireService(runtime).getDescriptor(assetId, PRINCIPAL_ID);
    if (descriptor.status === 'processing' || descriptor.status === 'quarantine') {
      throw new ImageAssetError('ASSET_NOT_READY', 409, true, 'Asset is not ready');
    }
    res.json(descriptor);
  }));

  if (runtime.storageProvider === 'local' && runtime.uploadLocalContent) {
    router.put(
      '/upload-sessions/:id/content',
      asyncRoute(async (req, res) => {
        parse(strictEmptyObjectSchema, req.query);
        const sessionId = parse(assetIdSchema, req.params.id);
        const contentLength = Number(req.get('Content-Length'));
        const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        await runtime.uploadLocalContent!(sessionId, {
          body,
          contentLength,
          contentType: req.get('Content-Type')?.split(';')[0].trim() ?? '',
          principalId: PRINCIPAL_ID,
        });
        res.status(204).end();
      }),
    );
  }

  router.use((error: unknown, req: AssetRequest, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(error);
    const normalized = normalizeError(error);
    const requestId = req.imageAssetRequestId ?? `req_${randomUUID().replace(/-/g, '')}`;
    res.set('X-Request-Id', requestId);
    res.status(normalized.statusCode).json({
      error: {
        code: normalized.code,
        message: SAFE_ERROR_MESSAGES[normalized.code],
        requestId,
        retryable: normalized.retryable,
      },
    });
  });

  return router;
}

function asyncRoute(
  handler: (req: express.Request, res: express.Response) => Promise<void>,
): express.RequestHandler {
  return (req, res, next) => void handler(req, res).catch(next);
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.code === 'too_big')) {
      throw new ImageAssetError('IMAGE_LIMIT_EXCEEDED', 413, false, 'Image asset request exceeds the limit');
    }
    throw new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'Image asset request is invalid');
  }
  return parsed.data;
}

function parseDeclaredJsonBody<T>(schema: z.ZodType<T>, req: express.Request): T {
  if (!req.is('application/json') || Buffer.isBuffer(req.body)) throw invalidRequest();
  return parse(schema, req.body);
}

function parseEmptyBody(body: unknown): void {
  if (Buffer.isBuffer(body)) {
    if (body.length === 0) return;
    throw invalidRequest();
  }
  parse(strictEmptyObjectSchema, body === undefined ? {} : body);
}

function invalidRequest(): ImageAssetError {
  return new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'Image asset request is invalid');
}

function requireService(runtime: ImageAssetRouteRuntime): ImageAssetRouteService {
  if (!runtime.service) throw new ImageAssetError('STORAGE_UNAVAILABLE', 503, true, 'Image asset storage is unavailable');
  return runtime.service;
}

function normalizeError(error: unknown): ImageAssetError {
  if (error instanceof ImageAssetError) return error;
  if (isBodyLimitError(error)) {
    return new ImageAssetError('IMAGE_LIMIT_EXCEEDED', 413, false, 'Uploaded image exceeds the byte limit');
  }
  if (isBodyParserClientError(error)) return invalidRequest();
  return new ImageAssetError('ASSET_PROCESSING_FAILED', 500, true, 'Image asset request failed');
}

function isBodyLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const type = (error as { type?: unknown }).type;
  return type === 'entity.too.large' || type === 'parameters.too.many';
}

function isBodyParserClientError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || typeof (error as { type?: unknown }).type !== 'string') return false;
  const status = Number((error as { status?: unknown; statusCode?: unknown }).status
    ?? (error as { statusCode?: unknown }).statusCode);
  return Number.isInteger(status) && status >= 400 && status < 500;
}

const SAFE_ERROR_MESSAGES: Record<ImageAssetErrorCode, string> = {
  UPLOAD_SESSION_EXPIRED: 'Upload session has expired',
  IMAGE_CONTENT_INVALID: 'Image content or request is invalid',
  IMAGE_LIMIT_EXCEEDED: 'Image asset limit exceeded',
  ASSET_NOT_READY: 'Asset is not ready',
  ASSET_ACCESS_DENIED: 'Asset access is denied',
  ASSET_NOT_FOUND: 'Asset was not found',
  ASSET_PROCESSING_FAILED: 'Image asset processing failed',
  STORAGE_UNAVAILABLE: 'Image asset storage is unavailable',
};
