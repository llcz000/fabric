import { PRODUCT_IMAGE_ROLES, type ProductImageLayoutDraft, type ProductImageLayoutItem, type ProductImageRole } from './types';
import { ProductError } from './errors';

export const MAX_PRODUCT_IMAGES = 20;
export const MAX_PRODUCT_PATTERN_TAGS = 12;

const ROLE_SET = new Set<ProductImageRole>(PRODUCT_IMAGE_ROLES);
const SAFE_ASSET_ID = /^[a-zA-Z0-9_-]{1,128}$/;

export function normalizePatternTagName(name: string): string {
  return name.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
}
export function validateImageLayout(input: readonly ProductImageLayoutDraft[]): ProductImageLayoutItem[] {
  if (!Array.isArray(input)) throw invalidLayout('images must be an array');
  if (input.length > MAX_PRODUCT_IMAGES) throw invalidLayout(`A product may have at most ${MAX_PRODUCT_IMAGES} images`);

  const assetIds = new Set<string>();
  const byRole = new Map<ProductImageRole, number[]>();
  let patternOriginals = 0;

  for (const item of input) {
    if (!SAFE_ASSET_ID.test(item.assetId)) throw invalidLayout('image layout contains an invalid assetId');
    if (assetIds.has(item.assetId)) throw invalidLayout('image layout contains a duplicate assetId');
    assetIds.add(item.assetId);

    if (!ROLE_SET.has(item.role)) throw invalidLayout('image layout contains an invalid role');
    if (!Number.isSafeInteger(item.sortOrder) || item.sortOrder < 0) {
      throw invalidLayout('image layout sortOrder must be a non-negative integer');
    }
    if (item.role === 'pattern_original') patternOriginals += 1;
    const orders = byRole.get(item.role) ?? [];
    orders.push(item.sortOrder);
    byRole.set(item.role, orders);
  }

  if (patternOriginals > 1) throw invalidLayout('A product may have at most one pattern_original');
  for (const orders of byRole.values()) {
    orders.sort((left, right) => left - right);
    if (orders.some((order, index) => order !== index)) {
      throw invalidLayout('image layout sortOrder must be contiguous within each role');
    }
  }

  return input.map((item) => ({ ...item, isPrimary: item.role === 'pattern_original' }));
}

function invalidLayout(message: string): ProductError {
  return new ProductError('PRODUCT_INVALID', 422, false, message);
}
