import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import DocumentPreview from './DocumentPreview';
import { DocType, type CompanyProfile, type DocumentData } from '../types';

test('feature-off legacy company fields render strict export role markers without descriptors', () => {
  const companyProfile: CompanyProfile = {
    name: 'Legacy Fabric',
    logoText: 'Legacy Fabric',
    logoType: 'image',
    logoUrl: 'https://fabric-images-1448065940.cos.ap-shanghai.myqcloud.com/legacy-logo.png',
    address: 'Shaoxing',
    phone: '0575-00000000',
    defaultTerms: 'Terms',
    depositTerms: '',
    issuerLabel: 'Issuer',
    receiverLabel: 'Receiver',
    weChatPayUrl: 'http://fabric-images-1448065940.cos.ap-shanghai.myqcloud.com/legacy-wechat.png',
    aliPayUrl: 'data:image/png;base64,bGVnYWN5LWFsaXBheQ==',
  };
  const document: DocumentData = {
    id: 'legacy-doc',
    docNo: 'YB-LEGACY-001',
    type: DocType.SAMPLE,
    date: '2026-08-22',
    customerName: 'Legacy Customer',
    items: [],
    companyName: companyProfile.name,
    companyAddress: companyProfile.address,
    companyPhone: companyProfile.phone,
    terms: companyProfile.defaultTerms,
    issuer: '',
    receiver: '',
    receiverAddress: '',
    bottomPhone: companyProfile.phone,
    totalMeters: 0,
    totalRolls: 0,
    totalAmount: 0,
    receivableAmount: 0,
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
  };

  const markup = renderToStaticMarkup(React.createElement(DocumentPreview, {
    document,
    companyProfile,
    onEdit() {},
    onBack() {},
  }));

  assert.match(markup, /src="https:\/\/fabric-images-1448065940\.cos\.ap-shanghai\.myqcloud\.com\/legacy-logo\.png"[^>]*data-company-image-role="brand_logo"/);
  assert.match(markup, /src="http:\/\/fabric-images-1448065940\.cos\.ap-shanghai\.myqcloud\.com\/legacy-wechat\.png"[^>]*data-company-image-role="wechat_qr"/);
  assert.match(markup, /src="data:image\/png;base64,bGVnYWN5LWFsaXBheQ=="[^>]*data-company-image-role="alipay_qr"/);
  assert.doesNotMatch(markup, /companyImages/);
});
