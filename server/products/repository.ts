import type {
  PatternTag,
  PatternTagBatchInput,
  PatternTagStatus,
  PatternTagUpdate,
  ProductImageLayoutItem,
  ProductDetail,
  ProductListFilter,
  ProductPage,
  ProductWriteInput,
} from './types';

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
  searchPatternTags(query: string, status: PatternTagStatus): Promise<PatternTag[]>;
  createPatternTag(name: string, normalizedName: string, principalId: string): Promise<PatternTag>;
  updatePatternTag(tagId: number, update: PatternTagUpdate, principalId: string): Promise<PatternTag | null>;
  applyPatternTagBatch(input: PatternTagBatchInput, principalId: string): Promise<void>;
  listProducts(filter: ProductListFilter): Promise<ProductPage>;
  getProductDetail(productId: number): Promise<ProductDetail | null>;
  ignoreIssue(productId: number, issueId: number, principalId: string, note?: string): Promise<boolean>;
  reopenIssue(productId: number, issueId: number, principalId: string): Promise<boolean>;
}
