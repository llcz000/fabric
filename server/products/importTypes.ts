import type { PlannedIssue, PlannedProduct } from '../../scripts/product-import/normalize';

export type ProductImportBatchStatus = 'running' | 'completed' | 'partial' | 'rolled_back';
export interface ProductImportBatch {
  id: number;
  fileSha256: string;
  sheetName: string;
  status: ProductImportBatchStatus;
  createdBy: string;
}
export interface BeginImportBatch { fileSha256: string; sourceFile: string; sheetName: string; createdBy: string; }
export interface ImportSourceResult { productId?: number; status: 'applied' | 'failed'; errorCode?: string; }
export interface ImportedAsset {
  assetId: string;
  role: 'pattern_original' | 'unclassified';
  sortOrder: number;
  sourceRef: string;
  originMetadata?: Record<string, string | number>;
}
export interface AtomicImportedProduct {
  batchId: number;
  planKey: string;
  fields: PlannedProduct['fields'];
  patternTagIds: [];
  sources: PlannedProduct['sources'];
  images: ImportedAsset[];
  issues: PlannedIssue[];
  principalId: string;
}
export interface ImportBatchSummary { succeeded: number; failed: number; skipped: number; status: 'completed' | 'partial'; }
export interface RollbackBlocker { productId: number; reason: 'modified' | 'order_reference' | 'other_batch'; }

export interface ProductImportRepository {
  beginOrResumeBatch(input: BeginImportBatch): Promise<ProductImportBatch>;
  getSourceResult(batchId: number, sheet: string, row: number): Promise<ImportSourceResult | null>;
  applyImportedProduct(input: AtomicImportedProduct): Promise<{ productId: number; updatedAt: Date }>;
  recordProductFailure(batchId: number, planKey: string, code: string): Promise<void>;
  finishBatch(batchId: number, summary: ImportBatchSummary): Promise<void>;
  listRollbackBlockers(batchId: number): Promise<RollbackBlocker[]>;
  markBatchRolledBack(batchId: number): Promise<void>;
}

