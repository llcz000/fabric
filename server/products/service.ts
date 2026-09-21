import type { ProductRecord, ProductRepository } from './repository';
import { ProductError } from './errors';
import type {
  PatternTag,
  PatternTagBatchInput,
  PatternTagStatus,
  PatternTagUpdate,
  ProductDetail,
  ProductImageLayoutDraft,
  ProductImageRole,
  ProductListFilter,
  ProductPage,
  ProductWriteInput,
} from './types';
import { MAX_PRODUCT_PATTERN_TAGS, normalizePatternTagName, validateImageLayout } from './validation';

export class ProductService {
  constructor(private readonly products: ProductRepository) {}

  async saveProduct(productId: number | null, input: ProductWriteInput, principalId: string): Promise<ProductRecord | null> {
    const validated = validateProductWrite(input);
    return await (productId === null
      ? this.products.createProduct(validated, principalId)
      : this.products.updateProduct(productId, validated, principalId));
  }

  async attachProductImages(
    productId: number,
    role: ProductImageRole,
    assetIds: string[],
    _principalId: string,
  ): Promise<ProductDetail | null> {
    requirePositiveId(productId, 'productId');
    const layout = validateImageLayout(assetIds.map((assetId, sortOrder) => ({ assetId, role, sortOrder })));
    if (!await this.products.attachProductImages(productId, role, layout.map((item) => item.assetId))) return null;
    return await this.products.getProductDetail(productId);
  }

  replaceImageLayout(productId: number, layout: ProductImageLayoutDraft[]): Promise<void> {
    return this.products.replaceImageLayout(productId, validateImageLayout(layout));
  }

  deleteProductImage(productId: number, assetId: string): Promise<void> {
    return this.products.deleteProductImage(productId, assetId);
  }

  deleteProduct(productId: number): Promise<boolean> {
    return this.products.deleteProduct(productId);
  }

  searchPatternTags(query = '', status: PatternTagStatus = 'active'): Promise<PatternTag[]> {
    if (status !== 'active' && status !== 'archived') throw invalidProduct('Invalid pattern tag status');
    const trimmed = query.trim();
    if (trimmed.length > 32) throw invalidProduct('Pattern tag search must contain at most 32 characters');
    return this.products.searchPatternTags(trimmed, status);
  }

  async createPatternTag(name: string, principalId: string): Promise<PatternTag> {
    const displayName = patternTagDisplayName(name);
    return await this.products.createPatternTag(displayName, normalizePatternTagName(displayName), principalId);
  }

  async updatePatternTag(tagId: number, update: PatternTagUpdate, principalId: string): Promise<PatternTag | null> {
    if (!Number.isSafeInteger(tagId) || tagId <= 0) throw invalidProduct('Invalid pattern tag ID');
    if (update.name === undefined && update.status === undefined) throw invalidProduct('Pattern tag update is empty');
    if (update.status !== undefined && update.status !== 'active' && update.status !== 'archived') {
      throw invalidProduct('Invalid pattern tag status');
    }
    const validated: PatternTagUpdate = { status: update.status };
    if (update.name !== undefined) {
      validated.name = patternTagDisplayName(update.name);
      validated.normalizedName = normalizePatternTagName(validated.name);
    }
    return await this.products.updatePatternTag(tagId, validated, principalId);
  }

  async applyPatternTagBatch(input: PatternTagBatchInput, principalId: string): Promise<void> {
    const productIds = uniquePositiveIds(input.productIds, 'productIds', 100);
    const tagIds = uniquePositiveIds(input.tagIds, 'tagIds', MAX_PRODUCT_PATTERN_TAGS);
    if (input.operation !== 'add' && input.operation !== 'remove') throw invalidProduct('Invalid pattern tag batch operation');
    if (productIds.length === 0 || tagIds.length === 0) throw invalidProduct('Pattern tag batch selections must not be empty');
    await this.products.applyPatternTagBatch({ productIds, tagIds, operation: input.operation }, principalId);
  }

  listProducts(filter: ProductListFilter): Promise<ProductPage> {
    return this.products.listProducts(validateProductListFilter(filter));
  }

  getProductDetail(productId: number): Promise<ProductDetail | null> {
    requirePositiveId(productId, 'productId');
    return this.products.getProductDetail(productId);
  }

  ignoreIssue(productId: number, issueId: number, principalId: string, note?: string): Promise<boolean> {
    requirePositiveId(productId, 'productId');
    requirePositiveId(issueId, 'issueId');
    if (note !== undefined && note.length > 1_000) throw invalidProduct('Issue note is too long');
    return this.products.ignoreIssue(productId, issueId, principalId, note?.trim());
  }

  reopenIssue(productId: number, issueId: number, principalId: string): Promise<boolean> {
    requirePositiveId(productId, 'productId');
    requirePositiveId(issueId, 'issueId');
    return this.products.reopenIssue(productId, issueId, principalId);
  }
}

export function validateProductWrite(input: ProductWriteInput): ProductWriteInput {
  const itemNo = boundedText(input.itemNo, 'itemNo', 1, 255);
  const productName = boundedText(input.productName, 'productName', 0, 255);
  const composition = boundedText(input.composition, 'composition', 0, 2_000);
  const weight = boundedText(input.weight, 'weight', 0, 255);
  const width = boundedText(input.width, 'width', 0, 255);
  if (!Array.isArray(input.patternTagIds)) throw invalidProduct('patternTagIds must be an array');
  const patternTagIds = [...new Set(input.patternTagIds)];
  if (patternTagIds.length !== input.patternTagIds.length) throw invalidProduct('patternTagIds must not contain duplicates');
  if (patternTagIds.length > MAX_PRODUCT_PATTERN_TAGS) {
    throw invalidProduct(`A product may have at most ${MAX_PRODUCT_PATTERN_TAGS} pattern tags`);
  }
  if (patternTagIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw invalidProduct('patternTagIds contains an invalid tag ID');
  }
  patternTagIds.sort((left, right) => left - right);
  const images = validateImageLayout(input.images).map(({ isPrimary: _isPrimary, ...image }) => image);
  return { itemNo, productName, composition, weight, width, patternTagIds, images };
}

function boundedText(value: string, field: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string') throw invalidProduct(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < minimum || trimmed.length > maximum) {
    throw invalidProduct(`${field} must contain ${minimum}-${maximum} characters`);
  }
  return trimmed;
}

function patternTagDisplayName(value: string): string {
  if (typeof value !== 'string') throw invalidProduct('Pattern tag name must be a string');
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 32) throw invalidProduct('Pattern tag name must contain 1-32 characters');
  return trimmed;
}

function uniquePositiveIds(values: number[], field: string, maximum: number): number[] {
  if (!Array.isArray(values)) throw invalidProduct(`${field} must be an array`);
  if (values.length > maximum) throw invalidProduct(`${field} may contain at most ${maximum} IDs`);
  if (values.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw invalidProduct(`${field} contains an invalid ID`);
  const unique = [...new Set(values)];
  if (unique.length !== values.length) throw invalidProduct(`${field} must not contain duplicate IDs`);
  return unique.sort((left, right) => left - right);
}

function validateProductListFilter(filter: ProductListFilter): ProductListFilter {
  const limit = Number(filter.limit);
  const offset = Number(filter.offset);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw invalidProduct('limit must be between 1 and 100');
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw invalidProduct('offset is invalid');
  const q = filter.q?.trim();
  if (q && q.length > 255) throw invalidProduct('q is too long');
  return {
    ...filter,
    q: q || undefined,
    tagIds: uniquePositiveIds(filter.tagIds ?? [], 'tagIds', MAX_PRODUCT_PATTERN_TAGS),
    issueCodes: [...new Set(filter.issueCodes ?? [])],
    tagMode: 'all',
    limit,
    offset,
  };
}

function requirePositiveId(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw invalidProduct(`${field} is invalid`);
}

function invalidProduct(message: string): ProductError {
  return new ProductError('PRODUCT_INVALID', 422, false, message);
}
