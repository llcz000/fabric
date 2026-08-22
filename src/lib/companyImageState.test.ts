import assert from 'node:assert/strict';
import test from 'node:test';

import type { CompanyProfile } from '../types';
import { applyCompanyImageMutations, ImageAssetClientError } from './imageAssets';
import {
  buildCompanyImageMutations,
  createCompanyImageState,
  releaseCompanyImageObjectUrl,
  releaseCompanyImageObjectUrls,
  replaceCompanyImagePreview,
} from './companyImageState';

const BASE_PROFILE: CompanyProfile = {
  name: 'Dream Weave',
  logoText: 'Dream Weave',
  logoType: 'image',
  logoUrl: '/api/company/images/brand_logo/content',
  address: 'Keqiao',
  phone: '0575-81234567',
  defaultTerms: '',
  depositTerms: '',
  issuerLabel: '开单人：',
  receiverLabel: '收货人：',
  weChatPayUrl: '/api/company/images/wechat_qr/content',
  aliPayUrl: '',
};

test('feature-off company images remain legacy display values and create no asset mutations', () => {
  const state = createCompanyImageState(BASE_PROFILE);

  assert.equal(state.brand_logo.previewUrl, '/api/company/images/brand_logo/content');
  assert.equal(state.wechat_qr.previewUrl, '/api/company/images/wechat_qr/content');
  assert.deepEqual(buildCompanyImageMutations(state, false), []);
});

test('ready replacements and removals produce only the selected company role mutations', () => {
  const initial = createCompanyImageState({
    ...BASE_PROFILE,
    companyImages: {
      brand_logo: {
        role: 'brand_logo', source: 'asset', assetId: 'old-logo', displayUrl: '/api/company/images/brand_logo/content',
      },
      alipay_qr: {
        role: 'alipay_qr', source: 'legacy', displayUrl: '/api/company/images/alipay_qr/content',
      },
    },
  });
  const withReplacement = replaceCompanyImagePreview(initial, 'brand_logo', {
    assetId: 'new-logo', previewUrl: 'blob:logo', dirty: true, uploading: false,
  });
  const withRemoval = replaceCompanyImagePreview(withReplacement, 'alipay_qr', {
    dirty: true, uploading: false,
  });

  assert.deepEqual(buildCompanyImageMutations(withRemoval, true), [
    { role: 'brand_logo', action: 'replace', assetId: 'new-logo' },
    { role: 'alipay_qr', action: 'remove' },
  ]);
});

test('releases replaced and unmounted company image object URLs exactly once', () => {
  const revoked: string[] = [];
  const objectUrls = { brand_logo: 'blob:old-logo', wechat_qr: 'blob:wechat' };

  releaseCompanyImageObjectUrl(objectUrls, 'brand_logo', (url) => revoked.push(url));
  replaceCompanyImagePreview(createCompanyImageState(BASE_PROFILE), 'brand_logo', {
    previewUrl: 'blob:new-logo', dirty: false, uploading: true,
  });
  releaseCompanyImageObjectUrls(objectUrls, (url) => revoked.push(url));

  assert.deepEqual(revoked, ['blob:old-logo', 'blob:wechat']);
  assert.deepEqual(objectUrls, {});
});

test('role association failures reload the company profile and surface the stable error code and request ID', async () => {
  const requests: Array<{ input: string; method: string }> = [];
  let reloads = 0;
  const apiFetch: typeof fetch = async (input, init: RequestInit = {}) => {
    requests.push({ input: String(input), method: init.method ?? 'GET' });
    return new Response(JSON.stringify({
      error: { code: 'ASSET_NOT_READY', message: 'Asset is not ready', requestId: 'req-company-image', retryable: true },
    }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  };

  await assert.rejects(
    () => applyCompanyImageMutations([{ role: 'brand_logo', action: 'replace', assetId: 'asset-pending' }], {
      apiFetch,
      reloadCompanyProfile: async () => { reloads += 1; },
    }),
    (error: unknown) => error instanceof ImageAssetClientError
      && error.code === 'ASSET_NOT_READY'
      && error.requestId === 'req-company-image'
      && error.retryable === true,
  );
  assert.deepEqual(requests, [{ input: '/api/company/images/brand_logo', method: 'PUT' }]);
  assert.equal(reloads, 1);
});
