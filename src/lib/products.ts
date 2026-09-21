import type {
  PatternTagSummary,
  ProductCategoryCounts,
  ProductDetail,
  ProductImageDescriptor,
  ProductImageRole,
  ProductIssue,
  ProductLibraryItem,
  ProductPage,
  ProductReviewStatus,
} from '../types';
import { ImageAssetClientError } from './imageAssets';

const FORMAL_IMAGE_ROLES = new Set<ProductImageRole>([
  'pattern_original', 'fabric_display', 'detail', 'ai_effect', 'unclassified',
]);

export interface ProductListOptions {
  q?: string;
  tagIds?: number[];
  reviewStatus?: ProductReviewStatus;
  issueCodes?: string[];
  imageState?: 'missing_pattern' | 'has_unclassified' | 'complete';
  batchId?: number;
  duplicateItemNo?: boolean;
  limit?: number;
  offset?: number;
}

export interface ProductImageLayoutInput {
  assetId: string;
  role: Exclude<ProductImageRole, 'legacy'>;
  sortOrder: number;
}

export interface ProductWriteInput {
  id?: string;
  itemNo: string;
  productName: string;
  composition: string;
  weight: string;
  width: string;
  patternTagIds: number[];
  images: ProductImageLayoutInput[];
}

export interface PatternTagBatchInput {
  productIds: number[];
  operation: 'add' | 'remove';
  tagIds: number[];
}

export interface PatternTagListOptions {
  q?: string;
  status?: 'active' | 'archived';
}

type ServerRow = Record<string, unknown> & { id?: unknown; images?: unknown; issues?: unknown; patternTags?: unknown };

export async function listProducts(apiFetch: typeof fetch, options: ProductListOptions = {}): Promise<ProductPage> {
  const query = new URLSearchParams();
  if (options.q?.trim()) query.set('q', options.q.trim());
  if (options.tagIds?.length) {
    query.set('tagIds', options.tagIds.join(','));
    query.set('tagMode', 'all');
  }
  if (options.reviewStatus) query.set('reviewStatus', options.reviewStatus);
  if (options.issueCodes?.length) query.set('issueCodes', options.issueCodes.join(','));
  if (options.imageState) query.set('imageState', options.imageState);
  if (options.batchId !== undefined) query.set('batchId', String(options.batchId));
  if (options.duplicateItemNo !== undefined) query.set('duplicateItemNo', String(options.duplicateItemNo));
  query.set('limit', String(clamp(options.limit ?? 50, 1, 100)));
  query.set('offset', String(clamp(options.offset ?? 0, 0, 1_000_000)));

  const page = await requestJson<{ items?: unknown; total?: unknown; limit?: unknown; offset?: unknown }>(
    apiFetch,
    `/api/products?${query.toString()}`,
  );
  return {
    items: Array.isArray(page.items) ? page.items.map((item) => mapProduct(item as ServerRow)) : [],
    total: number(page.total),
    limit: number(page.limit, 50),
    offset: number(page.offset),
  };
}

export async function getProduct(apiFetch: typeof fetch, productId: string): Promise<ProductDetail> {
  return mapProductDetail(await requestJson<ServerRow>(apiFetch, `/api/products/${encodeURIComponent(productId)}`));
}

export async function saveProduct(apiFetch: typeof fetch, input: ProductWriteInput): Promise<ProductLibraryItem> {
  const editing = input.id !== undefined && /^\d+$/.test(input.id);
  const row = await requestJson<ServerRow>(apiFetch, editing ? `/api/products/${input.id}` : '/api/products', {
    method: editing ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(writeBody(input)),
  });
  return mapProduct(row);
}

export async function attachProductImages(
  apiFetch: typeof fetch,
  productId: string,
  role: Exclude<ProductImageRole, 'legacy'>,
  assetIds: string[],
): Promise<ProductDetail> {
  const row = await requestJson<ServerRow>(apiFetch, `/api/products/${encodeURIComponent(productId)}/images`, json('POST', { role, assetIds }));
  return mapProductDetail(row);
}

export async function patchImageLayout(
  apiFetch: typeof fetch,
  productId: string,
  images: ProductImageLayoutInput[],
): Promise<ProductDetail> {
  const row = await requestJson<ServerRow>(apiFetch, `/api/products/${encodeURIComponent(productId)}/image-layout`, json('PATCH', { images }));
  return mapProductDetail(row);
}

export async function deleteProductImage(apiFetch: typeof fetch, productId: string, assetId: string): Promise<ProductDetail> {
  const row = await requestJson<ServerRow>(
    apiFetch,
    `/api/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(assetId)}`,
    { method: 'DELETE' },
  );
  return mapProductDetail(row);
}

export async function deleteProduct(apiFetch: typeof fetch, productId: string): Promise<void> {
  await requestJson(apiFetch, `/api/products/${encodeURIComponent(productId)}`, { method: 'DELETE' });
}

export async function ignoreProductIssue(apiFetch: typeof fetch, productId: string, issueId: number, note?: string): Promise<void> {
  await requestJson(apiFetch, `/api/products/${encodeURIComponent(productId)}/issues/${issueId}/ignore`, json('POST', note ? { note } : {}));
}

export async function reopenProductIssue(apiFetch: typeof fetch, productId: string, issueId: number): Promise<void> {
  await requestJson(apiFetch, `/api/products/${encodeURIComponent(productId)}/issues/${issueId}/reopen`, json('POST', {}));
}

export async function applyPatternTagBatch(apiFetch: typeof fetch, input: PatternTagBatchInput): Promise<void> {
  await requestJson(apiFetch, '/api/products/batch-pattern-tags', json('POST', input));
}

export async function listPatternTags(apiFetch: typeof fetch, options: PatternTagListOptions = {}): Promise<PatternTagSummary[]> {
  const query = new URLSearchParams();
  if (options.q?.trim()) query.set('q', options.q.trim());
  query.set('status', options.status ?? 'active');
  const body = await requestJson<{ items?: unknown }>(apiFetch, `/api/product-pattern-tags?${query.toString()}`);
  return mapTags(body.items);
}

export function createPatternTag(apiFetch: typeof fetch, name: string): Promise<PatternTagSummary> {
  return requestJson(apiFetch, '/api/product-pattern-tags', json('POST', { name }));
}

export function updatePatternTag(
  apiFetch: typeof fetch,
  tagId: number,
  update: { name?: string; status?: 'active' | 'archived' },
): Promise<PatternTagSummary> {
  return requestJson(apiFetch, `/api/product-pattern-tags/${tagId}`, json('PATCH', update));
}

function mapProduct(row: ServerRow): ProductLibraryItem {
  const images = Array.isArray(row.images) ? row.images.map(mapImage) : [];
  return {
    id: String(row.id ?? ''),
    itemNo: text(row.itemNo ?? row.item_no),
    productName: text(row.productName ?? row.product_name),
    composition: text(row.composition),
    weight: text(row.weight),
    width: text(row.width),
    imageCount: number(row.imageCount ?? row.image_count, images.length),
    createdAt: text(row.createdAt ?? row.created_at),
    updatedAt: text(row.updatedAt ?? row.updated_at),
    images,
    patternTags: mapTags(row.patternTags),
    reviewStatus: row.reviewStatus === 'needs_attention' ? 'needs_attention' : 'reviewed',
    openIssueCount: number(row.openIssueCount),
    categoryCounts: mapCategoryCounts(row.categoryCounts),
  };
}

function mapProductDetail(row: ServerRow): ProductDetail {
  return { ...mapProduct(row), issues: Array.isArray(row.issues) ? row.issues.map(mapIssue) : [] };
}

function mapImage(value: unknown): ProductImageDescriptor {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const role = mapRole(row.role);
  if (role === 'legacy' || typeof row.assetId !== 'string') {
    const legacyImageId = number(row.legacyImageId ?? row.id);
    return {
      source: 'legacy', role: 'legacy', sortOrder: number(row.sortOrder ?? row.sort_order),
      isPrimary: row.isPrimary === true, legacyImageId,
      contentUrl: typeof row.contentUrl === 'string' ? row.contentUrl : undefined,
    };
  }
  return {
    source: 'asset', role, sortOrder: number(row.sortOrder), isPrimary: row.isPrimary === true,
    assetId: row.assetId, thumbnailUrl: safeUrl(row.thumbnailUrl), displayUrl: safeUrl(row.displayUrl),
    expiresAt: typeof row.expiresAt === 'string' ? row.expiresAt : undefined,
  };
}

function mapRole(value: unknown): ProductImageRole {
  if (value === 'legacy') return 'legacy';
  return FORMAL_IMAGE_ROLES.has(value as ProductImageRole) ? value as ProductImageRole : 'unclassified';
}

function mapTags(value: unknown): PatternTagSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const id = number(row.id);
    if (id <= 0) return [];
    return [{
      id,
      name: text(row.name),
      status: row.status === 'archived' ? 'archived' as const : 'active' as const,
    }];
  });
}

function mapIssue(value: unknown): ProductIssue {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    id: number(row.id), productId: number(row.productId), code: text(row.code),
    severity: row.severity === 'error' ? 'error' : row.severity === 'info' ? 'info' : 'warning',
    fieldName: text(row.fieldName), message: text(row.message), sourceRef: text(row.sourceRef),
    status: row.status === 'ignored' ? 'ignored' : row.status === 'resolved' ? 'resolved' : 'open',
    resolutionNote: typeof row.resolutionNote === 'string' ? row.resolutionNote : undefined,
    createdAt: text(row.createdAt), updatedAt: text(row.updatedAt),
  };
}

function mapCategoryCounts(value: unknown): ProductCategoryCounts {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    patternOriginal: number(row.patternOriginal), fabricDisplay: number(row.fabricDisplay),
    detail: number(row.detail), aiEffect: number(row.aiEffect), unclassified: number(row.unclassified),
  };
}

function writeBody(input: ProductWriteInput) {
  return {
    itemNo: input.itemNo,
    productName: input.productName,
    composition: input.composition,
    weight: input.weight,
    width: input.width,
    patternTagIds: input.patternTagIds,
    images: input.images,
  };
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.startsWith('data:')) return undefined;
  if (value.startsWith('/')) return value;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? value : undefined;
  } catch {
    return undefined;
  }
}

async function requestJson<T>(apiFetch: typeof fetch, input: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(input, init);
  if (!response.ok) throw await clientError(response);
  return response.json() as Promise<T>;
}

async function clientError(response: Response): Promise<ImageAssetClientError> {
  let body: { error?: { code?: unknown; message?: unknown; requestId?: unknown; retryable?: unknown } } | undefined;
  try { body = await response.json() as typeof body; } catch { body = undefined; }
  return new ImageAssetClientError({
    code: typeof body?.error?.code === 'string' ? body.error.code : 'PRODUCT_FAILED',
    message: typeof body?.error?.message === 'string' ? body.error.message : '产品请求失败，请稍后重试。',
    requestId: typeof body?.error?.requestId === 'string' ? body.error.requestId : response.headers.get('X-Request-Id') ?? undefined,
    retryable: body?.error?.retryable === true,
  });
}
