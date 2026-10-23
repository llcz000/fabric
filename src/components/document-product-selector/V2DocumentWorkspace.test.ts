import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import V2DocumentWorkspace from './V2DocumentWorkspace';
import type {CompanyProfile} from '../../types';
const profile={name:'公司A',address:'地址A',phone:'0575',defaultTerms:'标准备注',
 depositTerms:'定金备注'} as CompanyProfile;
test('P6 V2 workspace exposes actual create header and safe V2-only product entry',()=>{
 const html=renderToStaticMarkup(React.createElement(V2DocumentWorkspace,{
  apiFetch:fetch,role:'sales',companyProfile:profile,onSaved:()=>{},onCancel:()=>{}
 }));
 for(const label of ['V2单据编辑工作区','公司名称','公司地址','公司电话','单据展示条款','开单人','收货人','收货联系电话','收货地址','已结清','从产品库添加','创建单据'])
  assert(html.includes(label),label);
 assert(html.includes('只通过V2认证接口写入'));
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
