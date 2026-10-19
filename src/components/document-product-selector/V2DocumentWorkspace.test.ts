import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import V2DocumentWorkspace,{DocumentTotalsSummary} from './V2DocumentWorkspace';
import {DocType} from '../../types';
import type {CompanyProfile} from '../../types';
const profile={name:'公司A',address:'地址A',phone:'0575',defaultTerms:'标准备注',
 depositTerms:'定金备注'} as CompanyProfile;
test('P6 V2 workspace exposes actual create header and safe V2-only product entry',()=>{
 const html=renderToStaticMarkup(React.createElement(V2DocumentWorkspace,{
  apiFetch:fetch,role:'sales',companyProfile:profile,onSaved:()=>{},onCancel:()=>{}
 }));
 for(const label of ['V2单据编辑工作区','公司名称','公司地址','公司电话','单据展示条款','开单人','收货人','收货联系电话','收货地址','已结清','从产品库添加','创建单据'])
  assert(html.includes(label),label);
 assert(html.includes('会保留原产品资料'));
 assert(!html.includes('/api/orders'));
 assert(!html.includes('预收定金'),'sample does not offer a deposit input');
});
test('P6 V2 workspace loading for stored doc requires V2 get and does not pretend legacy local document loaded',()=>{
 const html=renderToStaticMarkup(React.createElement(V2DocumentWorkspace,{
  apiFetch:fetch,role:'admin',documentId:'27',companyProfile:profile,onSaved:()=>{},onCancel:()=>{}
 }));
 assert(html.includes('正在读取V2单据'));
 assert(!html.includes('创建单据'));
});

test('editor restores published hierarchy with collapsed optional contacts and no invented style number',()=>{
 const html=renderToStaticMarkup(React.createElement(V2DocumentWorkspace,{apiFetch:fetch,role:'admin',companyProfile:profile,onSaved:()=>{},onCancel:()=>{}}));
 assert(!html.includes('款式号'));assert(!html.includes('name="styleNo"'));
 assert.match(html,/<details[^>]*><summary[^>]*>单据签署与联系信息/);
 assert(!/<details[^>]*\sopen/.test(html));assert(html.includes('合计金额'));assert(html.includes('总计米数'));
});

test('deposit editor totals show contract and computed deposit without receivable, pieces or settlement',()=>{
 const html=renderToStaticMarkup(React.createElement(DocumentTotalsSummary,{type:DocType.DEPOSIT,totals:{totalMeters:10,totalPieces:0,totalAmount:300,totalDeductionMeters:0,depositAmount:75,receivableAmount:0},error:''}));
 for(const value of ['总计米数','合计金额','定金金额','75.00'])assert(html.includes(value));
 assert(!/应收|应付|匹数|扣损|结清/.test(html));
});

test('new document type order is sample, sales, deposit',()=>{const html=renderToStaticMarkup(React.createElement(V2DocumentWorkspace,{apiFetch:fetch,role:'admin',companyProfile:profile,onSaved(){},onCancel(){}}));assert.deepEqual([...html.matchAll(/<option value="(sample|sales|deposit)"[^>]*>/g)].map(m=>m[1]),['sample','sales','deposit']);});
