import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import V2DocumentPrintView from './V2DocumentPrintView';
import {serializeV2PrintJson} from './V2DocumentPrintView';

test('P6-4 independent V2 preview only loads authorized endpoint, never legacy Excel route',()=>{
 const html=renderToStaticMarkup(React.createElement(V2DocumentPrintView,{
  apiFetch:fetch,documentId:'37',onBack:()=>{}
 }));
 assert(html.includes('V2单据打印预览'));
 assert(html.includes('正在读取打印资料'));
 assert(html.includes('下载打印Excel'));
 assert(html.includes('浏览器打印'));
 assert(!html.includes('/api/export_template'));
});
test('OUTPUT-01 isolated V2 print preview exposes printable PNG and print-model JSON alongside Excel',()=>{
 const html=renderToStaticMarkup(React.createElement(V2DocumentPrintView,{apiFetch:fetch,documentId:'37',onBack:()=>{}}));
 for(const label of ['下载 PNG','下载打印 JSON','下载打印Excel','浏览器打印'])assert(html.includes(label),label);
});
test('OUTPUT-01 JSON print export serializes the validated shared print model rather than legacy document data',()=>{
 const model={type:'sample',title:'样布码单',companyName:'当前公司',companyLines:['地址','电话'],docNo:'YB-001',dateText:'2026-10-17',customerName:'客户',columns:[],rows:[],summaries:[],terms:'当前条款',signature:{issuer:'开单人',receiver:'收货人',phone:'',receiverAddress:''}} as const;
 const json=serializeV2PrintJson(model as never);
 const value=JSON.parse(json);
 assert.equal(value.companyName,'当前公司');assert.equal(value.terms,'当前条款');
 assert(!('ownerId' in value));
});
