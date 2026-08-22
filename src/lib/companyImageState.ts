import type { CompanyImageRole, CompanyProfile } from '../types';

export type CompanyImageMutation =
  | { role: CompanyImageRole; action: 'replace'; assetId: string }
  | { role: CompanyImageRole; action: 'remove' };

export interface PendingCompanyImage {
  assetId?: string;
  previewUrl?: string;
  dirty: boolean;
  uploading: boolean;
  error?: string;
}

export type CompanyImageState = Record<CompanyImageRole, PendingCompanyImage>;
export type CompanyImageObjectUrls = Partial<Record<CompanyImageRole, string>>;

export const COMPANY_IMAGE_ROLES: CompanyImageRole[] = ['brand_logo', 'wechat_qr', 'alipay_qr'];

export function createCompanyImageState(profile: CompanyProfile): CompanyImageState {
  return COMPANY_IMAGE_ROLES.reduce<Partial<CompanyImageState>>((result, role) => {
    const image = profile.companyImages?.[role];
    result[role] = {
      ...(image?.assetId ? { assetId: image.assetId } : {}),
      ...(image?.displayUrl || legacyPreviewUrl(profile, role) ? { previewUrl: image?.displayUrl ?? legacyPreviewUrl(profile, role) } : {}),
      dirty: false,
      uploading: false,
    };
    return result;
  }, {}) as CompanyImageState;
}

export function buildCompanyImageMutations(
  state: CompanyImageState,
  imageAssetsEnabled: boolean,
): CompanyImageMutation[] {
  if (!imageAssetsEnabled) return [];
  return COMPANY_IMAGE_ROLES.flatMap((role): CompanyImageMutation[] => {
    const value = state[role];
    if (!value.dirty) return [];
    return value.assetId
      ? [{ role, action: 'replace', assetId: value.assetId }]
      : [{ role, action: 'remove' }];
  });
}

export function replaceCompanyImagePreview(
  state: CompanyImageState,
  role: CompanyImageRole,
  value: PendingCompanyImage,
): CompanyImageState {
  return { ...state, [role]: value };
}

export function releaseCompanyImageObjectUrls(
  objectUrls: CompanyImageObjectUrls,
  revokeObjectUrl: (url: string) => void,
): void {
  for (const role of COMPANY_IMAGE_ROLES) releaseCompanyImageObjectUrl(objectUrls, role, revokeObjectUrl);
}

export function releaseCompanyImageObjectUrl(
  objectUrls: CompanyImageObjectUrls,
  role: CompanyImageRole,
  revokeObjectUrl: (url: string) => void,
): void {
  const objectUrl = objectUrls[role];
  if (!objectUrl) return;
  delete objectUrls[role];
  revokeObjectUrl(objectUrl);
}

function legacyPreviewUrl(profile: CompanyProfile, role: CompanyImageRole): string | undefined {
  switch (role) {
    case 'brand_logo': return profile.logoUrl;
    case 'wechat_qr': return profile.weChatPayUrl;
    case 'alipay_qr': return profile.aliPayUrl;
  }
}
