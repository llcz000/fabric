export const PRODUCT_IMAGE_ROLES = [
  'pattern_original',
  'fabric_display',
  'detail',
  'ai_effect',
  'unclassified',
] as const;

export type ProductImageRole = typeof PRODUCT_IMAGE_ROLES[number];
export type ProductReviewStatus = 'reviewed' | 'needs_attention';
export type ProductIssueStatus = 'open' | 'resolved' | 'ignored';
export type PatternTagStatus = 'active' | 'archived';
export type ProductImageOriginType = 'upload' | 'excel_import' | 'ai_generated' | 'legacy';

export type ProductIssueCode =
  | 'MISSING_PRODUCT_NAME'
  | 'MISSING_COMPOSITION'
  | 'MISSING_WEIGHT'
  | 'MISSING_WIDTH'
  | 'DUPLICATE_ITEM_NO'
  | 'CONFLICTING_PRODUCT_DATA'
  | 'MISSING_PATTERN_ORIGINAL'
  | 'IMAGE_UNCLASSIFIED'
  | 'IMAGE_REFERENCE_MISSING'
  | 'IMAGE_FORMAT_CONVERTED'
  | 'IMAGE_RESIZED'
  | 'IMAGE_LIMIT_EXCEEDED'
  | 'UNMAPPED_SOURCE_DATA';

export interface ProductImageLayoutDraft {
  assetId: string;
  role: ProductImageRole;
  sortOrder: number;
}
export interface ProductImageLayoutItem extends ProductImageLayoutDraft {
  isPrimary: boolean;
}

export interface ProductWriteInput {
  itemNo: string;
  productName: string;
  composition: string;
  weight: string;
  width: string;
  patternTagIds: number[];
  images: ProductImageLayoutDraft[];
}

export interface PatternTag {
  id: number;
  name: string;
  normalizedName: string;
  status: PatternTagStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductIssue {
  id: number;
  productId: number;
  productImageAssetId?: number;
  code: ProductIssueCode;
  severity: 'info' | 'warning' | 'error';
  fieldName: string;
  message: string;
  sourceRef: string;
  status: ProductIssueStatus;
  resolutionNote?: string;
  resolvedBy?: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductListFilter {
  q?: string;
  tagIds: number[];
  tagMode: 'all';
  reviewStatus?: ProductReviewStatus;
  issueCodes: ProductIssueCode[];
  imageState?: 'missing_pattern' | 'has_unclassified' | 'complete';
  batchId?: number;
  duplicateItemNo?: boolean;
  limit: number;
  offset: number;
}

export interface PatternTagUpdate {
  name?: string;
  normalizedName?: string;
  status?: PatternTagStatus;
}

export interface PatternTagBatchInput {
  productIds: number[];
  operation: 'add' | 'remove';
  tagIds: number[];
}
