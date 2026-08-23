/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Product image frontend client. Maps server product responses (asset
 * descriptors or legacy rows) to runtime descriptors and drives the
 * authenticated product CRUD API. Reuses the shared client error type from
 * imageAssets.ts so every failure surfaces a stable code and request ID.
 */

import { ImageAssetClientError } from './imageAssets';
import type {
  ProductImageDescriptor,
  ProductImageRole,
  ProductImageSource,
  ProductItem,
} from '../types';

export { ImageAssetClientError };

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
const ASSET_ROLES = new Set<ProductImageRole>(['pattern_original', 'gallery', 'swatch']);

export interface ListProductsOptions {
  limit?: number;
  offset?: number;
}

export interface SaveProductInput {
  id?: string;
  itemNo: string;
  productName: string;
  composition: string;
  weight: string;
  width: string;
  imageAssetIds?: string[];
}

interface ServerProductRow extends Record<string, unknown> {
  id: number;
  item_no?: string;
  product_name?: string;
  composition?: string;
  weight?: string;
  width?: string;
  image_count?: number;
  created_at?: string;
  updated_at?: string;
  images?: unknown[];
}

interface ServerImageRow extends Record<string, unknown> {
  assetId?: string;
  sortOrder?: number;
  role?: string;
  isPrimary?: boolean;
  thumbnailUrl?: string;
  displayUrl?: string;
  expiresAt?: string;
  legacyImageId?: number;
  id?: number;
  sort_order?: number;
  contentUrl?: string;
}

export function listProducts(
  apiFetch: typeof fetch,
  options: ListProductsOptions = {},
): Promise<ProductItem[]> {
  const limit = clampLimit(options.limit);
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  return requestJson<ProductItem[]>(
    apiFetch,
    `/api/products?limit=${limit}&offset=${offset}`,
  ).then((rows) => {
    const source: ServerProductRow[] = Array.isArray(rows) ? rows : [];
    return source.map((row) => mapProductRow(row));
  });
}

export async function describeProduct(apiFetch: typeof fetch, productId: string): Promise<ProductItem> {
  const row = await requestJson<ServerProductRow>(apiFetch, `/api/products/${encodeURIComponent(productId)}`);
  return mapProductRow(row);
}

export async function saveProduct(apiFetch: typeof fetch, input: SaveProductInput): Promise<ProductItem> {
  const isEdit = input.id !== undefined && /^[0-9]+$/.test(input.id);
  const url = isEdit ? `/api/products/${input.id}` : '/api/products';
  const body: Record<string, unknown> = {
    itemNo: input.itemNo,
    productName: input.productName,
    composition: input.composition,
    weight: input.weight,
    width: input.width,
    imageAssetIds: input.imageAssetIds ?? [],
  };
  const row = await requestJson<ServerProductRow>(apiFetch, url, {
    method: isEdit ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return mapProductRow(row);
}

export async function detachProductImage(
  apiFetch: typeof fetch,
  productId: string,
  assetId: string,
): Promise<number> {
  const result = await requestJson<{ image_count?: number }>(
    apiFetch,
    `/api/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(assetId)}`,
    { method: 'DELETE' },
  );
  return result.image_count ?? 0;
}

export async function deleteProductById(apiFetch: typeof fetch, productId: string): Promise<void> {
  await requestJson<{ success: boolean }>(apiFetch, `/api/products/${encodeURIComponent(productId)}`, { method: 'DELETE' });
}

export function isDescriptorExpired(descriptor: Pick<ProductImageDescriptor, 'expiresAt'>, now = Date.now()): boolean {
  if (!descriptor.expiresAt) return false;
  const parsed = Date.parse(descriptor.expiresAt);
  if (Number.isNaN(parsed)) return false;
  return parsed <= now;
}

function mapProductRow(row: ServerProductRow): ProductItem {
  const images = (Array.isArray(row.images) ? row.images : [])
    .map((image) => mapImageRow(row.id, image as ServerImageRow))
    .sort((left, right) => left.sortOrder - right.sortOrder || (left.assetId ?? '').localeCompare(right.assetId ?? ''));
  return {
    id: String(row.id),
    itemNo: String(row.item_no ?? row.itemNo ?? ''),
    productName: String(row.product_name ?? row.productName ?? ''),
    composition: String(row.composition ?? ''),
    weight: String(row.weight ?? ''),
    width: String(row.width ?? ''),
    imageCount: Number(row.image_count ?? images.length ?? 0),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    images,
  };
}

function mapImageRow(productId: number, image: ServerImageRow): ProductImageDescriptor {
  if (typeof image.assetId === 'string') {
    return {
      source: 'asset',
      role: ASSET_ROLES.has(image.role as ProductImageRole) ? (image.role as ProductImageRole) : 'gallery',
      sortOrder: Number(image.sortOrder ?? 0),
      isPrimary: image.isPrimary === true,
      assetId: image.assetId,
      thumbnailUrl: safeImageUrl(image.thumbnailUrl),
      displayUrl: safeImageUrl(image.displayUrl),
      expiresAt: typeof image.expiresAt === 'string' ? image.expiresAt : undefined,
    };
  }
  const legacyImageId = typeof image.legacyImageId === 'number'
    ? image.legacyImageId
    : typeof image.id === 'number' ? image.id : undefined;
  const sortOrder = typeof image.sort_order === 'number' ? image.sort_order : Number(image.sortOrder ?? 0);
  return {
    source: 'legacy',
    role: 'legacy',
    sortOrder,
    isPrimary: image.isPrimary === true,
    legacyImageId,
    contentUrl: legacyImageId === undefined
      ? undefined
      : `/api/products/${productId}/images/${legacyImageId}`,
  };
}

function safeImageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  if (value.startsWith('data:')) return undefined;
  if (value.startsWith('/')) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function clampLimit(limit: number | undefined): number {
  const value = Math.floor(limit ?? DEFAULT_LIST_LIMIT);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_LIST_LIMIT;
  return Math.min(value, MAX_LIST_LIMIT);
}

async function requestJson<T>(apiFetch: typeof fetch, input: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(input, init);
  if (!response.ok) throw await toClientError(response);
  return response.json() as Promise<T>;
}

async function toClientError(response: Response): Promise<ImageAssetClientError> {
  let body: { error?: { code?: unknown; message?: unknown; requestId?: unknown; retryable?: unknown } } | undefined;
  try {
    body = await response.json() as typeof body;
  } catch {
    body = undefined;
  }
  const error = body?.error;
  return new ImageAssetClientError({
    code: typeof error?.code === 'string' ? error.code : 'ASSET_PROCESSING_FAILED',
    message: typeof error?.message === 'string' ? error.message : '图片请求失败，请稍后重试。',
    requestId: typeof error?.requestId === 'string' ? error.requestId : response.headers.get('X-Request-Id') ?? undefined,
    retryable: error?.retryable === true,
  });
}
