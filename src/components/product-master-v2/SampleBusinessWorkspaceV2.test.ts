import assert from 'node:assert/strict';import test from 'node:test';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {SampleBusinessWorkspaceV2,Session} from './SampleBusinessWorkspaceV2';
test('sample workspace offers customer search/new selection and uses no browser requests or grant administration on render',()=>{
 const html=renderToStaticMarkup(React.createElement(SampleBusinessWorkspaceV2,{apiFetch:async()=>{throw Error('No SSR requests');}}));
 for(const word of ['客户选样','新建选样单','搜索选样单'])assert(html.includes(word),word);
 assert(!html.includes('管理授权'));assert(!html.includes('按货号补选'));
});

test('mobile scan waits for authorized selection data before enabling the camera',()=>{
 const html=renderToStaticMarkup(React.createElement(Session,{session:{id:'7',customerReference:'客户'},apiFetch:fetch,onBack(){},onStatusChanged(){}}));
 const start=html.match(/<button[^>]*data-live-scan[^>]*>/)?.[0];assert(start,'scan entry must open capture before a token exists');assert(/\sdisabled(?:=|\s|>)/.test(start),'camera must wait for authorized session read');assert(!html.includes('>确认加入</button>'),'no grey submit presented as the scan entry');
});

test('saved selection details are compact and never offer reassigning a customer or a second scan form',()=>{
 const html=renderToStaticMarkup(React.createElement(Session,{mode:'details',session:{id:'7',customerReference:'客户甲'},apiFetch:fetch,onBack(){},onStatusChanged(){}}));
 assert(html.includes('继续扫码'));assert(html.includes('选样明细'));assert(html.includes('产品反馈'));
 for(const label of ['更改客户关联','关联客户档案','修改客户','扫码加入选样','扫描或输入色卡编码','加入此色卡'])assert(!html.includes(label),label);
 assert.equal((html.match(/继续扫码/g)??[]).length,1);
});
test('customer directory keeps customer entry inside the new selection dialog',()=>{const html=renderToStaticMarkup(React.createElement(SampleBusinessWorkspaceV2,{apiFetch:fetch}));assert(!html.includes('aria-label="新建选样单"'),'create form should open on demand');assert(!html.includes('maxLength="160" class="rounded border border-slate-300 px-3 py-2 text-sm" value=""'),'no inline customer editor');assert(!html.includes('手机扫码请先'));assert(!html.includes('>查询</button>'));});

test('a scanned link focuses on customer confirmation without management directory or card preview',()=>{
 const html=renderToStaticMarkup(React.createElement(SampleBusinessWorkspaceV2,{apiFetch:fetch,initialCardToken:'longStablePhysicalCardToken_123456789'}));
 assert(html.includes('先选择客户'));
 for(const word of ['新建选样单','查询','刷新列表','查看色卡花型','已识别色卡'])assert(!html.includes(word),word);
});
