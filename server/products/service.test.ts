import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProductRecord, ProductRepository } from './repository';
import { ProductService } from './service';
import type { ProductImageLayoutItem, ProductWriteInput } from './types';

class CapturingRepository implements ProductRepository {
  readonly creates: Array<{ input: ProductWriteInput; principalId: string }> = [];
  readonly updates: Array<{ productId: number; input: ProductWriteInput; principalId: string }> = [];
  createdTagNames: string[] = [];

  async createProduct(input: ProductWriteInput, principalId: string): Promise<ProductRecord> {
    this.creates.push({ input, principalId });
    return record(11, input);
  }

  async updateProduct(productId: number, input: ProductWriteInput, principalId: string): Promise<ProductRecord> {
    this.updates.push({ productId, input, principalId });
    return record(productId, input);
  }

  async replaceImageLayout(_productId: number, _layout: ProductImageLayoutItem[]): Promise<void> {}
  async deleteProductImage(_productId: number, _assetId: string): Promise<void> {}
  async deleteProduct(_productId: number): Promise<boolean> { return true; }

  async searchPatternTags() { return []; }
  async createPatternTag(name: string) {
    this.createdTagNames.push(name);
    return {
      id: 3, name: 'Floral', normalizedName: 'floral', status: 'active' as const,
      createdBy: 'admin-1', createdAt: new Date(0), updatedAt: new Date(0),
    };
  }
  async updatePatternTag() { return null; }
  async applyPatternTagBatch() {}
}
const validInput: ProductWriteInput = {
  itemNo: ' G-001 ',
  productName: ' Floral ',
  composition: ' Cotton ',
  weight: ' 120gsm ',
  width: ' 150cm ',
  patternTagIds: [5, 2],
  images: [
    { assetId: 'pattern', role: 'pattern_original', sortOrder: 0 },
    { assetId: 'detail', role: 'detail', sortOrder: 0 },
  ],
};

test('save normalizes fields and tag order before updating the aggregate', async () => {
  const repository = new CapturingRepository();
  const service = new ProductService(repository);

  await service.saveProduct(7, validInput, 'admin-1');

  assert.deepEqual(repository.updates, [{
    productId: 7,
    principalId: 'admin-1',
    input: {
      ...validInput,
      itemNo: 'G-001',
      productName: 'Floral',
      composition: 'Cotton',
      weight: '120gsm',
      width: '150cm',
      patternTagIds: [2, 5],
    },
  }]);
});

test('save rejects invalid layout before opening a repository transaction', async () => {
  const repository = new CapturingRepository();
  const service = new ProductService(repository);

  await assert.rejects(service.saveProduct(null, {
    ...validInput,
    images: [
      { assetId: 'a', role: 'pattern_original', sortOrder: 0 },
      { assetId: 'b', role: 'pattern_original', sortOrder: 1 },
    ],
  }, 'admin-1'), /one pattern_original/);

  assert.equal(repository.creates.length, 0);
});

test('create pattern tag trims the display name before repository creation', async () => {
  const repository = new CapturingRepository();
  const service = new ProductService(repository);

  const created = await service.createPatternTag('  Floral  ', 'admin-1');

  assert.equal(created.normalizedName, 'floral');
  assert.deepEqual(repository.createdTagNames, ['Floral']);
});

test('create pattern tag rejects names that normalize to empty', async () => {
  const repository = new CapturingRepository();
  const service = new ProductService(repository);

  await assert.rejects(service.createPatternTag('　　', 'admin-1'), /1-32/);

  assert.equal(repository.createdTagNames.length, 0);
});

function record(id: number, input: ProductWriteInput): ProductRecord {
  return {
    id,
    itemNo: input.itemNo,
    productName: input.productName,
    composition: input.composition,
    weight: input.weight,
    width: input.width,
    imageCount: input.images.length,
    createdAt: new Date('2026-09-21T00:00:00Z'),
    updatedAt: new Date('2026-09-21T00:00:00Z'),
  };
}
