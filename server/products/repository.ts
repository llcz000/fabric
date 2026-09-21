import type { ProductImageLayoutItem, ProductWriteInput } from './types';

export interface ProductRecord {
  id: number;
  itemNo: string;
  productName: string;
  composition: string;
  weight: string;
  width: string;
  imageCount: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface ProductRepository {
  createProduct(input: ProductWriteInput, principalId: string): Promise<ProductRecord>;
  updateProduct(productId: number, input: ProductWriteInput, principalId: string): Promise<ProductRecord | null>;
  replaceImageLayout(productId: number, layout: ProductImageLayoutItem[]): Promise<void>;
  deleteProductImage(productId: number, assetId: string): Promise<void>;
  deleteProduct(productId: number): Promise<boolean>;
}
