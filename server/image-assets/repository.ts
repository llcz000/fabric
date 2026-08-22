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
  finalizeUploadSession(input: FinalizedUpload): Promise<{ assetId: string; jobCreated: boolean }>;
  getAsset(id: string): Promise<ImageAssetRecord | null>;
  getVariants(assetId: string): Promise<AssetVariantRecord[]>;
  claimNextJob(now: Date): Promise<ProcessingJob | null>;
  completeProcessing(assetId: string, variants: AssetVariantRecord[]): Promise<void>;
  failJob(jobId: number, code: string, retryAt: Date | null): Promise<void>;
  markAssetDegraded(assetId: string, code: string): Promise<void>;
  listExpiredUploadSessions(now: Date, limit: number): Promise<UploadSessionRecord[]>;
  expireUploadSession(sessionId: string): Promise<void>;
  replaceCompanyImage(companyId: number, role: CompanyImageRole, assetId: string | null): Promise<void>;
  attachProductImages(productId: number, assetIds: string[]): Promise<void>;
  detachProductImage(productId: number, assetId: string): Promise<void>;
  recycleExpiredUnlinkedAssets(now: Date, limit: number): Promise<number>;
  listPurgeCandidates(now: Date, limit: number): Promise<ImageAssetRecord[]>;
  markPurged(assetId: string, at: Date): Promise<void>;
  reconcileReferenceCounts(): Promise<number>;
}

export type { AssetPurpose, AssetStatus };
