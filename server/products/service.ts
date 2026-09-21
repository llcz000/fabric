import type { ProductRecord, ProductRepository } from './repository';
import type { ProductImageLayoutItem, ProductWriteInput } from './types';
import { MAX_PRODUCT_PATTERN_TAGS, validateImageLayout } from './validation';

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
