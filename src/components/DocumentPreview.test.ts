import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import DocumentPreview, { applyDocumentCaptureLayout } from './DocumentPreview';
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

test('header company info block is shrinkable so its right edge aligns with the data table', () => {
  const companyProfile: CompanyProfile = {
    name: '一个名称特别长的纺织印染有限公司',
    logoText: 'Logo',
    logoType: 'image',
    logoUrl: '',
    address: '浙江省绍兴市柯桥区某个非常长的街道地址用于验证换行',
    phone: '0575-00000000',
    defaultTerms: '',
    depositTerms: '',
    issuerLabel: 'Issuer',
    receiverLabel: 'Receiver',
    weChatPayUrl: '',
    aliPayUrl: '',
  };
  const document: DocumentData = {
    id: 'align-doc',
    docNo: 'YB-ALIGN-001',
    type: DocType.SAMPLE,
    date: '2026-08-22',
    customerName: 'Customer',
    items: [],
    companyName: companyProfile.name,
    companyAddress: companyProfile.address,
    companyPhone: companyProfile.phone,
    terms: '',
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

  assert.match(markup, /space-y-1 flex-1 text-right min-w-0/);
  assert.match(markup, /min-width:0/);
});

test('document paper layout stays fixed and keeps the date on the right at every viewport width', () => {
  const companyProfile: CompanyProfile = {
    name: '杭州歌朗纺织服饰有限公司',
    logoText: 'Logo',
    logoType: 'image',
    logoUrl: '',
    address: '杭州市萧山区北干街道',
    phone: '18658899589',
    defaultTerms: '',
    depositTerms: '',
    issuerLabel: 'Issuer',
    receiverLabel: 'Receiver',
    weChatPayUrl: '',
    aliPayUrl: '',
  };
  const document: DocumentData = {
    id: 'metadata-layout-doc',
    docNo: 'YB-20260820-003-EXTRA-LONG-DOCUMENT-NUMBER',
    type: DocType.SAMPLE,
    date: '2026-08-20',
    customerName: 'GINLEE STUDIO WITH A VERY LONG RECEIVING COMPANY NAME',
    items: [],
    companyName: companyProfile.name,
    companyAddress: companyProfile.address,
    companyPhone: companyProfile.phone,
    terms: '',
    issuer: '',
    receiver: '',
    receiverAddress: '',
    bottomPhone: companyProfile.phone,
    totalMeters: 0,
    totalRolls: 0,
    totalAmount: 0,
    receivableAmount: 0,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  };

  const markup = renderToStaticMarkup(React.createElement(DocumentPreview, {
    document,
    companyProfile,
    onEdit() {},
    onBack() {},
  }));

  assert.match(markup, /data-document-metadata="true"[^>]*style="[^"]*display:flex[^"]*flex-direction:row[^"]*justify-content:space-between[^"]*align-items:flex-end/);
  assert.doesNotMatch(markup, /data-document-metadata="true"[^>]*class="[^"]*flex-col/);
  assert.match(markup, /data-document-metadata-primary="true"[^>]*style="[^"]*min-width:0[^"]*word-break:break-all/);
  assert.match(markup, /data-document-date="true"[^>]*style="[^"]*white-space:nowrap[^"]*flex-shrink:0/);
  assert.match(markup, /data-document-sheet="true"[^>]*class="[^"]*\bp-6\b/);
  assert.doesNotMatch(markup, /data-document-sheet="true"[^>]*class="[^"]*sm:/);
  assert.match(markup, /data-preview-scroll="true"[^>]*class="[^"]*overflow-x-auto/);
  assert.match(markup, /data-company-heading="true"[^>]*class="[^"]*\btext-xl\b/);
  assert.match(markup, /data-document-heading="true"[^>]*class="[^"]*\btext-base\b/);
  assert.match(markup, /data-signature-contacts="true"[^>]*class="[^"]*\bgap-x-5\b/);
  assert.match(markup, />日期：<\/span><span>2026年8月20日<\/span>/);
});

test('image capture preserves the table-sized document layout without a second layout pass', () => {
  let layoutQueries = 0;
  const captureContainer = { style: {} } as HTMLElement;
  const captureClone = {
    style: {},
    querySelector() {
      layoutQueries += 1;
      return null;
    },
  } as unknown as HTMLElement;

  applyDocumentCaptureLayout(captureContainer, captureClone);

  assert.equal(captureContainer.style.width, 'fit-content');
  assert.equal(captureClone.style.width, 'min-content');
  assert.equal(captureClone.style.maxWidth, 'none');
  assert.equal(layoutQueries, 0);
});
