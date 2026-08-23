import type {
  AssetPurpose,
  AssetStatus,
  AssetVariantName,
  CompanyImageRole,
  ImageAssetRecord,
  UploadSessionRecord,
} from './types';

export interface AssetVariantRecord {
  assetId: string;
  variant: AssetVariantName;
  objectKey: string;
  mime: string;
  byteSize: number;
  width: number;
  height: number;
  createdAt: Date;
}

export interface ProcessingJob {
  id: number;
  assetId: string;
  jobType: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  attempts: number;
  availableAt: Date;
  lockedAt?: Date;
  lastErrorCode?: string;
}

export interface PurgeClaim {
  assetId: string;
  variants: AssetVariantRecord[];
}

export interface ReconciliationCandidate {
  asset: ImageAssetRecord;
  variants: AssetVariantRecord[];
}

export interface ReconciliationCursor {
  createdAt: Date;
  id: string;
}

export interface ProductWriteRecord {
  itemNo: string;
  productName: string;
  composition: string;
  weight: string;
  width: string;
}

export interface ProductRecord extends Record<string, unknown> {
  id: number;
  item_no: string;
  product_name: string;
}

export interface ProductAssetAssociationRecord {
  productId: number;
  assetId: string;
  sortOrder: number;
  role: 'pattern_original' | 'gallery' | 'swatch';
  isPrimary: boolean;
}

export interface LegacyProductImageRecord {
  productId: number;
  id: number;
  sortOrder: number;
}

export interface NewUploadSession {
  id: string;
  purpose: AssetPurpose;
  quarantineKey: string;
  declaredByteSize: number;
  declaredMime: string;
  createdBy: string;
  expiresAt: Date;
}

export interface FinalizedUpload {
  sessionId: string;
  principalId: string;
  assetId?: string;
  sha256: string;
  originalFilename: string;
  detectedMime: string;
  detectedExtension: string;
  storageProvider: 'cos' | 'local';
  byteSize: number;
  width: number;
  height: number;
  metadata?: Record<string, unknown>;
}

export interface FinalizedUploadResult {
  assetId: string;
  jobCreated: boolean;
  processingRequired: boolean;
}

export interface AssetTransaction {
  query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

export interface AssetRepository {
  createUploadSession(input: NewUploadSession): Promise<UploadSessionRecord>;
  getUploadSession(id: string): Promise<UploadSessionRecord | null>;
  finalizeUploadSession(input: FinalizedUpload): Promise<FinalizedUploadResult>;
  getAsset(id: string): Promise<ImageAssetRecord | null>;
  getVariants(assetId: string): Promise<AssetVariantRecord[]>;
  claimNextJob(now: Date): Promise<ProcessingJob | null>;
  completeProcessing(assetId: string, variants: AssetVariantRecord[]): Promise<void>;
  failJob(jobId: number, code: string, retryAt: Date | null): Promise<boolean>;
  markAssetDegraded(assetId: string, code: string): Promise<boolean>;
  listExpiredUploadSessions(now: Date, limit: number): Promise<UploadSessionRecord[]>;
  expireUploadSession(sessionId: string): Promise<void>;
  completeExpiredUploadCleanup(sessionId: string, cleanedAt: Date): Promise<boolean>;
  listPendingAssetUploadSessions(assetId: string): Promise<UploadSessionRecord[]>;
  markUploadSessionQuarantineCleaned(sessionId: string, cleanedAt: Date): Promise<boolean>;
  replaceCompanyImage(companyId: number, role: CompanyImageRole, assetId: string | null): Promise<void>;
  attachProductImages(productId: number, assetIds: string[]): Promise<void>;
  createProductWithImages(input: ProductWriteRecord, assetIds: string[]): Promise<ProductRecord>;
  updateProductWithImages(productId: number, input: ProductWriteRecord, assetIds: string[]): Promise<ProductRecord | null>;
  listProductsPage(limit: number, offset: number): Promise<ProductRecord[]>;
  findProductIdsByItemNos(itemNos: string[]): Promise<number[]>;
  getProductRecord(productId: number): Promise<ProductRecord | null>;
  listProductImageAssociations(productIds: number[], primaryOnly: boolean): Promise<ProductAssetAssociationRecord[]>;
  listLegacyProductImages(productIds: number[], primaryOnly: boolean): Promise<LegacyProductImageRecord[]>;
  detachProductImage(productId: number, assetId: string): Promise<void>;
  detachAllProductImages(productId: number): Promise<void>;
  deleteProductWithAssets(productId: number): Promise<boolean>;
  recycleExpiredUnlinkedAssets(now: Date, limit: number): Promise<number>;
  listPurgeCandidates(now: Date, limit: number): Promise<ImageAssetRecord[]>;
  claimNextPurgeCandidate(now: Date): Promise<PurgeClaim | null>;
  /** A failed purge releases its claim; recovery of stale purging claims after crashes is deferred to Task 12. */
  releasePurgeClaim(assetId: string): Promise<boolean>;
  /** Worker precondition: call only for a purging claim after every retained variant object is confirmed absent. */
  markPurged(assetId: string, at: Date): Promise<void>;
  reconcileReferenceCounts(): Promise<number>;
  recoverStaleJobs(now: Date): Promise<number>;
  listOrphanCandidates(now: Date, limit: number): Promise<ImageAssetRecord[]>;
  listReconciliationCandidates(after: ReconciliationCursor | null, limit: number): Promise<ReconciliationCandidate[]>;
  markAssetObjectMissing(assetId: string, code: string): Promise<boolean>;
}

export type { AssetPurpose, AssetStatus };
