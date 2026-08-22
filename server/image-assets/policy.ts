import type { AssetPolicy, AssetPurpose } from './types';

const MAX_PIXELS = 40_000_000;
const COMPANY_MAX_BYTES = 2 * 1024 * 1024;
const PRODUCT_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const POLICIES: Record<AssetPurpose, AssetPolicy> = {
  company_logo: {
    maxBytes: COMPANY_MAX_BYTES,
    maxPixels: MAX_PIXELS,
    allowedMimes: ALLOWED_MIMES,
    variants: ['original', 'display'],
  },
  company_qr: {
    maxBytes: COMPANY_MAX_BYTES,
    maxPixels: MAX_PIXELS,
    allowedMimes: ALLOWED_MIMES,
    variants: ['original', 'display'],
  },
  product_image: {
    maxBytes: PRODUCT_MAX_BYTES,
    maxPixels: MAX_PIXELS,
    allowedMimes: ALLOWED_MIMES,
    variants: ['original', 'display', 'thumbnail'],
  },
};

export function getAssetPolicy(purpose: AssetPurpose): AssetPolicy {
  return POLICIES[purpose];
}
