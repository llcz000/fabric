import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {V2DocumentBrowser,DocumentSearchResults} from './V2DocumentBrowser';
import {documentResourceUrl,type DocumentSearchState} from './documentSearchModel';
import type {CompanyProfile} from '../../types';
test('query workspace renders distinct labeled filters, server paging and role scope',()=>{
 const html=renderToStaticMarkup(React.createElement(V2DocumentBrowser,{apiFetch:fetch,role:'sales',companyProfile:{} as CompanyProfile}));
 for(const label of ['单据查询','客户','货号','色号','品名','单据类型','起始日期','截止日期','结清状态','查询','清除筛选','仅查看本人单据'])assert(html.includes(label),label);
 assert(!html.includes('ownerId'));
});
test('STATS-01 ranking hands off product name into query filter without client owner',()=>{
 const html=renderToStaticMarkup(React.createElement(V2DocumentBrowser,{
  apiFetch:fetch,role:'sales',companyProfile:{} as CompanyProfile,initialFilters:{productName:'棉麻布'}
 }));
 assert.match(html,/name="productName"[^>]*value="棉麻布"/);
 assert(!html.includes('ownerId'));
});
const ready:DocumentSearchState={loading:false,error:'',page:{total:1,limit:20,offset:0,items:[{
 id:'47',orderNo:'XS047',date:'2026-10-16',receivingUnit:'测试客户',type:'bulk',totalMeters:30,totalPieces:3,totalAmount:600,settled:false
}]},totals:{matchingLineCount:1,metersTotal:10,piecesTotal:1,amountTotal:200}};
const noop=()=>{};
test('query results distinguish matching totals from whole-order fields and expose existing edit/preview',()=>{
 const html=renderToStaticMarkup(React.createElement(DocumentSearchResults,{state:ready,expanded:null,onToggle:noop,onEdit:noop,onPreview:noop}));
 for(const label of ['命中明细合计','10.00','200.00','整单金额','600.00','展开命中明细','编辑单据','预览 / Excel','XS047'])assert(html.includes(label),label);
 assert(!html.includes('平均单价'));
});
test('query failure/loading clears private results; empty response has explicit no-match feedback',()=>{
 for(const state of [{...ready,loading:true,page:null,totals:null},{...ready,error:'登录已失效',page:null,totals:null},
  {...ready,page:{...ready.page!,total:0,items:[]}}]){
  const html=renderToStaticMarkup(React.createElement(DocumentSearchResults,{state,expanded:null,onToggle:noop,onEdit:noop,onPreview:noop}));
  assert(!html.includes('XS047'));assert(!html.includes('测试客户'));
  if(state.error)assert(html.includes('role="alert"'));
  if(state.page?.total===0)assert(html.includes('没有符合条件的单据'));
 }
});
test('editing and printing share the actual V2 collection route without duplicate documents segments',()=>{
 assert.equal(documentResourceUrl(),'/api/v2/documents');
 assert.equal(documentResourceUrl('47'),'/api/v2/documents/47');
 assert.throws(()=>documentResourceUrl('../47'));
});

test('user layout correction keeps date first, splits type, uses named icon actions and shows saved sales deduction',()=>{
 const state=structuredClone(ready);(state.page!.items[0] as any).deductionMeters=1.25;
 const html=renderToStaticMarkup(React.createElement(DocumentSearchResults,{state,expanded:'47',onToggle:noop,onEdit:noop,onPreview:noop,onCopy:noop,onDelete:noop}));
 const headings=[...html.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map(m=>m[1].replace(/<[^>]*>/g,''));
 assert.deepEqual(headings.slice(0,4),['','开单日期','单据编号','类型']);
 assert(html.includes('扣损 1.25'));assert(html.includes('colSpan="10"')||html.includes('colspan="10"'));
 for(const name of ['收起命中明细','编辑单据','预览 / Excel','复制为新单','确认删除'])assert(html.includes('aria-label="'+name+'"'));
 assert(!html.includes('>编辑单据</button>'));assert(!html.includes('单据编号 / 类型'));
});
