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
type SharpFactory = typeof import('sharp')['default'];

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
  router.use(express.json({ limit: '4kb', strict: true }));

  router.use((req, res, next) => {
    if (!runtime.enabled || !runtime.service) return res.status(404).json({ error: 'Not found' });
    next();
  });

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

  router.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(error);
    if (error instanceof ImageAssetError) {
      return res.status(error.statusCode).json({ error: { code: error.code, message: error.message, retryable: error.retryable } });
    }
    res.status(500).json({ error: { code: 'ASSET_PROCESSING_FAILED', message: 'Company image request failed', retryable: true } });
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
  const sharp = await loadSharp();
  const format = (await sharp(body, { animated: true }).metadata()).format;
  switch (format) {
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    default: throw new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'Legacy image content is invalid');
  }
}

async function loadSharp(): Promise<SharpFactory> {
  return (await import(SHARP_MODULE)).default;
}
