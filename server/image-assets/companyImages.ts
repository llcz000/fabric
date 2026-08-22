import { createHash } from 'node:crypto';

import express from 'express';
import { z } from 'zod';

import { ImageAssetError } from './errors';
import type { AssetContent } from './service';
import type { AssetDescriptor, AssetVariantName, CompanyImageRole } from './types';

const COMPANY_ID = 1;
const PRINCIPAL_ID = 'admin';
const COMPANY_IMAGE_ROLES = ['brand_logo', 'wechat_qr', 'alipay_qr'] as const;
const companyImageRoleSchema = z.enum(COMPANY_IMAGE_ROLES);
const assetIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const replaceSchema = z.object({ assetId: assetIdSchema }).strict();
const emptyObjectSchema = z.object({}).strict();
const SHARP_MODULE: string = 'sharp';
const MAX_RAW_BODY_BYTES = 4 * 1024;
const MAX_URLENCODED_PARAMETERS = 20;
const SAFE_REQUEST_ID = /^[a-zA-Z0-9_-]{1,128}$/;
type SharpFactory = typeof import('sharp')['default'];
type CompanyImageRequest = express.Request & { companyImageRequestId?: string };

export interface CompanyImageDescriptor {
  role: CompanyImageRole;
  source: 'asset' | 'legacy';
  assetId?: string;
  displayUrl: string;
}

export interface CompanyImageRouteService {
  getDescriptor(assetId: string, principalId: string): Promise<AssetDescriptor>;
  readContent(assetId: string, variant: AssetVariantName, principalId: string): Promise<AssetContent>;
  replaceCompanyImage(companyId: number, role: CompanyImageRole, assetId: string | null): Promise<void>;
}

export interface CompanyImageRuntime {
  readonly enabled: boolean;
  readonly service: CompanyImageRouteService | null;
  findAssociation(role: CompanyImageRole): Promise<string | null>;
  getCompany(): Promise<Record<string, unknown>>;
  readLegacy(source: unknown): Promise<Buffer | null>;
}

function roleUrl(role: CompanyImageRole): string {
  return `/api/company/images/${role}/content`;
}

function requireService(runtime: CompanyImageRuntime): CompanyImageRouteService {
  if (!runtime.enabled || !runtime.service) {
    throw new ImageAssetError('STORAGE_UNAVAILABLE', 503, true, 'Company image assets are unavailable');
  }
  return runtime.service;
}

function parseRole(value: unknown): CompanyImageRole {
  const parsed = companyImageRoleSchema.safeParse(value);
  if (!parsed.success) throw new ImageAssetError('IMAGE_CONTENT_INVALID', 400, false, 'Unknown company image role');
  return parsed.data;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'Company image request is invalid');
  return parsed.data;
}

function parseEmptyBody(body: unknown): void {
  parse(emptyObjectSchema, body === undefined ? {} : body);
}

function parseDeclaredJsonBody<T>(schema: z.ZodType<T>, req: express.Request): T {
  if (!req.is('application/json') || Buffer.isBuffer(req.body)) {
    throw new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'Company image request is invalid');
  }
  return parse(schema, req.body);
}

async function readyAssociation(runtime: CompanyImageRuntime, role: CompanyImageRole): Promise<string | null> {
  const assetId = await runtime.findAssociation(role);
  if (!assetId) return null;
  const asset = await requireService(runtime).getDescriptor(assetId, PRINCIPAL_ID);
  return asset.status === 'ready' ? asset.id : null;
}

async function legacyContent(runtime: CompanyImageRuntime, company: Record<string, unknown>, role: CompanyImageRole): Promise<Buffer | null> {
  return runtime.readLegacy(company[role]);
}

export async function describeCompanyImages(
  company: Record<string, unknown>,
  runtime: CompanyImageRuntime,
): Promise<Partial<Record<CompanyImageRole, CompanyImageDescriptor>>> {
  if (!runtime.enabled || !runtime.service) return {};
  const images: Partial<Record<CompanyImageRole, CompanyImageDescriptor>> = {};
  for (const role of COMPANY_IMAGE_ROLES) {
    const assetId = await readyAssociation(runtime, role);
    if (assetId) {
      images[role] = { role, source: 'asset', assetId, displayUrl: roleUrl(role) };
      continue;
    }
    if (await legacyContent(runtime, company, role)) {
      images[role] = { role, source: 'legacy', displayUrl: roleUrl(role) };
    }
  }
  return images;
}

export function omitCompanyLegacyImageValues<T extends Record<string, unknown>>(value: T, enabled: boolean): T {
  if (!enabled) return value;
  const { brand_logo: _brandLogo, wechat_qr: _wechatQr, alipay_qr: _alipayQr, ...text } = value;
  return text as T;
}

export function createCompanyImageRouter(runtime: CompanyImageRuntime): express.Router {
  const router = express.Router();
  router.use((req: CompanyImageRequest, res, next) => {
    const supplied = req.get('X-Request-Id');
    req.companyImageRequestId = supplied && SAFE_REQUEST_ID.test(supplied)
      ? supplied
      : generatedRequestId();
    res.set('X-Request-Id', req.companyImageRequestId);
    next();
  });

  router.use((req, res, next) => {
    if (!runtime.enabled || !runtime.service) return res.status(404).json({ error: 'Not found' });
    next();
  });
  router.use(express.json({ limit: MAX_RAW_BODY_BYTES, strict: true }));
  router.use(express.urlencoded({ extended: true, limit: MAX_RAW_BODY_BYTES, parameterLimit: MAX_URLENCODED_PARAMETERS }));
  router.use(express.raw({ type: () => true, limit: MAX_RAW_BODY_BYTES }));

  router.get('/:role/content', asyncRoute(async (req, res) => {
    parse(emptyObjectSchema, req.query);
    parseEmptyBody(req.body);
    const role = parseRole(req.params.role);
    const company = await runtime.getCompany();
    const assetId = await readyAssociation(runtime, role);
    if (assetId) {
      const content = await requireService(runtime).readContent(assetId, 'display', PRINCIPAL_ID);
      sendContent(res, content);
      return;
    }
    const body = await legacyContent(runtime, company, role);
    if (!body) throw new ImageAssetError('ASSET_NOT_FOUND', 404, false, 'Company image was not found');
    const mime = await detectedMime(body);
    res.set('Content-Type', mime);
    res.set('Content-Length', String(body.length));
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'private, no-store');
    res.set('ETag', `"${createHash('sha256').update(body).digest('hex')}"`);
    res.send(body);
  }));

  router.put('/:role', asyncRoute(async (req, res) => {
    parse(emptyObjectSchema, req.query);
    const role = parseRole(req.params.role);
    const input = parseDeclaredJsonBody(replaceSchema, req);
    await requireService(runtime).replaceCompanyImage(COMPANY_ID, role, input.assetId);
    res.json({ success: true });
  }));

  router.delete('/:role', asyncRoute(async (req, res) => {
    parse(emptyObjectSchema, req.query);
    parseEmptyBody(req.body);
    const role = parseRole(req.params.role);
    await requireService(runtime).replaceCompanyImage(COMPANY_ID, role, null);
    res.json({ success: true });
  }));

  router.use((error: unknown, req: CompanyImageRequest, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(error);
    const normalized = normalizeError(error);
    const requestId = req.companyImageRequestId ?? generatedRequestId();
    res.set('X-Request-Id', requestId);
    res.status(normalized.statusCode).json({
      error: {
        code: normalized.code,
        message: safeErrorMessage(normalized.code),
        requestId,
        retryable: normalized.retryable,
      },
    });
  });

  return router;
}

function asyncRoute(handler: (req: express.Request, res: express.Response) => Promise<void>): express.RequestHandler {
  return (req, res, next) => void handler(req, res).catch(next);
}

function sendContent(res: express.Response, content: AssetContent): void {
  res.set('Content-Type', content.mime);
  res.set('Content-Length', String(content.byteSize));
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'private, no-store');
  res.set('ETag', content.etag);
  res.send(content.body);
}

async function detectedMime(body: Buffer): Promise<string> {
  try {
    const sharp = await loadSharp();
    const format = (await sharp(body, { animated: true }).metadata()).format;
    switch (format) {
      case 'jpeg': return 'image/jpeg';
      case 'png': return 'image/png';
      case 'webp': return 'image/webp';
      case 'gif': return 'image/gif';
      default: throw new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'Legacy image content is invalid');
    }
  } catch (error) {
    if (error instanceof ImageAssetError) throw error;
    throw new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'Legacy image content is invalid');
  }
}

async function loadSharp(): Promise<SharpFactory> {
  return (await import(SHARP_MODULE)).default;
}

function normalizeError(error: unknown): ImageAssetError {
  if (error instanceof ImageAssetError) return error;
  if (isBodyLimitError(error)) {
    return new ImageAssetError('IMAGE_LIMIT_EXCEEDED', 413, false, 'Company image request exceeds the limit');
  }
  if (isBodyParserClientError(error)) {
    return new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'Company image request is invalid');
  }
  return new ImageAssetError('ASSET_PROCESSING_FAILED', 500, true, 'Company image request failed');
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

function generatedRequestId(): string {
  return `req_${createHash('sha256').update(`${Date.now()}:${Math.random()}`).digest('hex').slice(0, 32)}`;
}

function safeErrorMessage(code: ImageAssetError['code']): string {
  switch (code) {
    case 'IMAGE_CONTENT_INVALID': return 'Image content or request is invalid';
    case 'IMAGE_LIMIT_EXCEEDED': return 'Image asset limit exceeded';
    case 'ASSET_NOT_READY': return 'Asset is not ready';
    case 'ASSET_ACCESS_DENIED': return 'Asset access is denied';
    case 'ASSET_NOT_FOUND': return 'Asset was not found';
    case 'STORAGE_UNAVAILABLE': return 'Image asset storage is unavailable';
    case 'UPLOAD_SESSION_EXPIRED': return 'Upload session has expired';
    case 'ASSET_PROCESSING_FAILED': return 'Company image request failed';
  }
}
