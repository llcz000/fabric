import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StatsDashboard from './StatsDashboard';
import { DocType, type DocumentData } from '../types';

function doc(id: string, date: string, createdAt: string, type = DocType.SALES): DocumentData {
  return {
    id, docNo: id, date, createdAt, updatedAt: createdAt, type,
    customerName: '测试客户', items: [],
    companyName: '测试公司', companyAddress: '', companyPhone: '', terms: '',
    issuer: '', receiver: '', receiverAddress: '', bottomPhone: '',
    totalMeters: 10, totalRolls: 1, totalAmount: 100, receivableAmount: 100,
  };
}

test('旧大盘不再展示没有业务批准的平均单价指标', () => {
  const html = renderToStaticMarkup(
    React.createElement(StatsDashboard, {
      documents: [doc('YB-001', '2026-10-15', '2026-10-15', DocType.SAMPLE), doc('XS-001', '2026-10-16', '2026-10-16')],
      onViewDoc: () => {},
    }),
  );
  assert.equal(html.includes('平均单价'), false);
});

test('最近四张单据优先按开单日期而非创建时间选择', () => {
  const documents = [
    doc('STALE-CREATED-LATER', '2026-10-01', '2026-10-17T23:59:00'),
    doc('NEW-1', '2026-10-13', '2026-10-01'),
    doc('NEW-2', '2026-10-14', '2026-10-02'),
    doc('NEW-3', '2026-10-15', '2026-10-03'),
    doc('NEW-4', '2026-10-16', '2026-10-04'),
  ];
  const html = renderToStaticMarkup(React.createElement(StatsDashboard, { documents, onViewDoc: () => {} }));
  assert.equal(html.includes('STALE-CREATED-LATER'), false);
  assert.ok(html.includes('NEW-1'));
  assert.ok(html.indexOf('NEW-4') < html.indexOf('NEW-3'));
});

test('定金合同额单独标注为合同金额，不误称实收定金金额', () => {
  const html = renderToStaticMarkup(React.createElement(StatsDashboard, {
    documents: [doc('DJ-001', '2026-10-16', '2026-10-16', DocType.DEPOSIT)],
    onViewDoc: () => {},
  }));
  assert.ok(html.includes('合同金额'));
  assert.equal(html.includes('>定金金额<'), false);
});
