import type { ImageAssetErrorCode } from './errors';

export type AssetPurpose = 'company_logo' | 'company_qr' | 'product_image';
export type AssetStatus = 'quarantine' | 'processing' | 'ready' | 'recycled' | 'degraded' | 'purged';
export type AssetVariantName = 'original' | 'display' | 'thumbnail';
export type CompanyImageRole = 'brand_logo' | 'wechat_qr' | 'alipay_qr';

export interface ImageAssetRecord {
  id: string;
  sha256: string;
  originalFilename: string;
  detectedMime: string;
  detectedExtension: string;
  byteSize: number;
  width: number;
  height: number;
  status: AssetStatus;
  refCount: number;
  createdBy: number;
  createdAt: Date;
  updatedAt: Date;
  recycledAt?: Date;
  purgeAfter?: Date;
  purgedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface AssetDescriptor {
  id: string;
  status: AssetStatus;
  purpose: AssetPurpose;
  detectedMime: string;
  byteSize: number;
  width: number;
  height: number;
  variants: Partial<Record<AssetVariantName, { width: number; height: number; byteSize: number }>>;
  errorCode?: ImageAssetErrorCode;
}

export interface UploadSessionRecord {
  id: string;
  purpose: AssetPurpose;
  quarantineKey: string;
  declaredByteSize: number;
  declaredMime: string;
  createdBy: number;
  expiresAt: Date;
  status: 'open' | 'finalized' | 'expired';
  assetId?: string;
}

export interface AssetPolicy {
  maxBytes: number;
  maxPixels: number;
  allowedMimes: Set<string>;
  variants: AssetVariantName[];
}
