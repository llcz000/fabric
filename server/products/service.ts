import type { ProductRecord, ProductRepository } from './repository';
import type {
  PatternTag,
  PatternTagBatchInput,
  PatternTagStatus,
  PatternTagUpdate,
  ProductImageLayoutItem,
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

  replaceImageLayout(productId: number, layout: ProductImageLayoutItem[]): Promise<void> {
    return this.products.replaceImageLayout(productId, validateImageLayout(layout));
  }

  deleteProductImage(productId: number, assetId: string): Promise<void> {
    return this.products.deleteProductImage(productId, assetId);
  }

  deleteProduct(productId: number): Promise<boolean> {
    return this.products.deleteProduct(productId);
  }

  searchPatternTags(query = '', status: PatternTagStatus = 'active'): Promise<PatternTag[]> {
    if (status !== 'active' && status !== 'archived') throw new Error('Invalid pattern tag status');
    const trimmed = query.trim();
    if (trimmed.length > 32) throw new Error('Pattern tag search must contain at most 32 characters');
    return this.products.searchPatternTags(trimmed, status);
  }

  async createPatternTag(name: string, principalId: string): Promise<PatternTag> {
    const displayName = patternTagDisplayName(name);
    return await this.products.createPatternTag(displayName, normalizePatternTagName(displayName), principalId);
  }

  async updatePatternTag(tagId: number, update: PatternTagUpdate, principalId: string): Promise<PatternTag | null> {
    if (!Number.isSafeInteger(tagId) || tagId <= 0) throw new Error('Invalid pattern tag ID');
    if (update.name === undefined && update.status === undefined) throw new Error('Pattern tag update is empty');
    if (update.status !== undefined && update.status !== 'active' && update.status !== 'archived') {
      throw new Error('Invalid pattern tag status');
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
    if (input.operation !== 'add' && input.operation !== 'remove') throw new Error('Invalid pattern tag batch operation');
    if (productIds.length === 0 || tagIds.length === 0) throw new Error('Pattern tag batch selections must not be empty');
    await this.products.applyPatternTagBatch({ productIds, tagIds, operation: input.operation }, principalId);
  }
}

export function validateProductWrite(input: ProductWriteInput): ProductWriteInput {
  const itemNo = boundedText(input.itemNo, 'itemNo', 1, 255);
  const productName = boundedText(input.productName, 'productName', 0, 255);
  const composition = boundedText(input.composition, 'composition', 0, 2_000);
  const weight = boundedText(input.weight, 'weight', 0, 255);
  const width = boundedText(input.width, 'width', 0, 255);
  if (!Array.isArray(input.patternTagIds)) throw new Error('patternTagIds must be an array');
  const patternTagIds = [...new Set(input.patternTagIds)];
  if (patternTagIds.length !== input.patternTagIds.length) throw new Error('patternTagIds must not contain duplicates');
  if (patternTagIds.length > MAX_PRODUCT_PATTERN_TAGS) {
    throw new Error(`A product may have at most ${MAX_PRODUCT_PATTERN_TAGS} pattern tags`);
  }
  if (patternTagIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('patternTagIds contains an invalid tag ID');
  }
  patternTagIds.sort((left, right) => left - right);
  const images = validateImageLayout(input.images).map(({ isPrimary: _isPrimary, ...image }) => image);
  return { itemNo, productName, composition, weight, width, patternTagIds, images };
}

function boundedText(value: string, field: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < minimum || trimmed.length > maximum) {
    throw new Error(`${field} must contain ${minimum}-${maximum} characters`);
  }
  return trimmed;
}

function patternTagDisplayName(value: string): string {
  if (typeof value !== 'string') throw new Error('Pattern tag name must be a string');
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 32) throw new Error('Pattern tag name must contain 1-32 characters');
  return trimmed;
}

function uniquePositiveIds(values: number[], field: string, maximum: number): number[] {
  if (!Array.isArray(values)) throw new Error(`${field} must be an array`);
  if (values.length > maximum) throw new Error(`${field} may contain at most ${maximum} IDs`);
  if (values.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error(`${field} contains an invalid ID`);
  const unique = [...new Set(values)];
  if (unique.length !== values.length) throw new Error(`${field} must not contain duplicate IDs`);
  return unique.sort((left, right) => left - right);
}
