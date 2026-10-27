import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SampleOperationsPanel} from './SampleOperationsPanel';
const page={session:{id:'41',customerReference:'客户甲',status:'open' as const},total:1,selectedCardCount:1,limit:20,offset:0,items:[{id:'61',productId:'8',current:{productNo:'1234-1-F018',patternNo:'1234',colorwayNo:1,fabricNo:'F018',fabricName:'真丝',composition:null,weightValue:null,weightUnit:null,widthCm:null},sources:[]}]};
const initial={selection:page,progress:{sessionId:'41',selectedProducts:35,shippedProducts:12,pendingProducts:23,shippedQuantity:50},history:{sessionId:'41',total:0,limit:20,offset:0,items:[]}};
const transport=async()=>{throw Error('No SSR requests');};
test('retired shipment UI exposes no registration, quantities or network calls',()=>{
 const html=renderToStaticMarkup(React.createElement(SampleOperationsPanel,{apiFetch:transport,sessionId:'41',kind:'shipments',initial}));assert.match(html,/寄样流程已停用/);assert.doesNotMatch(html,/保存寄样|寄样数量|待寄/);
});
test('FOLLOW UI records session-level feedback without extra product association controls',()=>{
 const html=renderToStaticMarkup(React.createElement(SampleOperationsPanel,{apiFetch:transport,sessionId:'41',kind:'followups',initial}));
 for(const label of ['客户确认','尚未确认','反馈','反馈结果','保存反馈记录'])assert(html.includes(label),label);for(const label of ['关联产品','上一页产品','下一页产品','1234-1-F018'])assert(!html.includes(label),label);
});
test('legacy closed session still renders editable feedback while mismatched session never exposes customer data',()=>{
 const closed={...initial,selection:{...page,session:{...page.session,status:'closed' as const}}};
 const html=renderToStaticMarkup(React.createElement(SampleOperationsPanel,{apiFetch:transport,sessionId:'41',kind:'followups',initial:closed}));assert(html.includes('保存反馈记录'));assert(!html.includes('已结束'));
 const other=renderToStaticMarkup(React.createElement(SampleOperationsPanel,{apiFetch:transport,sessionId:'42',kind:'shipments',initial}));assert(!other.includes('客户甲'));assert(!other.includes('1234-1-F018'));
});
