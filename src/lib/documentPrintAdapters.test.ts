import assert from 'node:assert/strict';
import test from 'node:test';

import { DocType, type CompanyProfile, type DocumentData } from '../types';
import { buildFrontendDocumentPrintModel } from './documentPrintAdapters';

test('frontend adapter preserves per-document terms and signature contacts', () => {
  const document = {
    id: '1', docNo: 'YB-1', type: DocType.SAMPLE, date: '2026-09-08', customerName: '客户',
    items: [], companyName: '', companyAddress: '', companyPhone: '', terms: '单据条款',
    issuer: '张三', receiver: '李四', receiverAddress: '', bottomPhone: '13800000000',
    totalMeters: 0, totalRolls: 0, totalAmount: 0, receivableAmount: 0,
    createdAt: '', updatedAt: '',
  } satisfies DocumentData;
  const company = {
    name: '公司', logoText: '', logoType: 'text', address: '地址', phone: '电话',
    defaultTerms: '默认', depositTerms: '定金', issuerLabel: '开单人', receiverLabel: '收货人',
  } satisfies CompanyProfile;
  const model = buildFrontendDocumentPrintModel(document, company);
  assert.equal(model.terms, '单据条款');
  assert.deepEqual(model.signature, { issuer: '张三', receiver: '李四', phone: '13800000000', receiverAddress: '' });
});
