import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SampleSelectionPanel,type SampleSelectionPanelProps} from './SampleSelectionPanel';
import {SampleSelectionWorkspaceV2} from './SampleSelectionWorkspaceV2';
import type {SampleSessionPage} from '../../../server/customer-samples/sessionRead';

const page:SampleSessionPage={
 session:{id:'51',customerReference:'客户A'},
 total:1,selectedCardCount:1,limit:20,offset:0,
 items:[{id:'61',productId:'81',
  current:{productNo:'0012-1-F018',patternNo:'0012',colorwayNo:1,fabricNo:'F018',
   fabricName:'最新丝绸',composition:'真丝100%',weightValue:'18',weightUnit:'gsm',widthCm:'145'},
  sources:[{cardId:'12',cardNo:'0012-F018',retired:false,firstScanEventId:'42'},
   {cardId:'13',cardNo:'0012-F019',retired:true,firstScanEventId:'43'}]}]
};
const props:SampleSelectionPanelProps={sessionId:'51',initialPage:page,
 load:async()=>page,remove:async()=>{},removeItems:async()=>({removedCount:1}),onRescan:()=>{}};

test('each selected product has one independently keyed checkbox and only one removal entry',()=>{
 const rows={...page,total:2,items:[page.items[0],{...page.items[0],id:'62',productId:'82',current:{...page.items[0].current,productNo:'0012-2-F018',colorwayNo:2}}]};
 const html=renderToStaticMarkup(React.createElement(SampleSelectionPanel,{...props,initialPage:rows,removeItems:async()=>({removedCount:1})}));
 assert(html.includes('勾选配色 0012-1，色卡 0012-F018'));assert(html.includes('勾选配色 0012-2，色卡 0012-F018'));assert(html.includes('全选当前页配色'));
 assert.equal((html.match(/data-selection-item=/g)??[]).length,2);
 assert(!html.includes('移除该款'));assert(!html.includes('移除所选色卡'));assert(html.includes('移除所选'));assert(!html.includes('>操作<'));
 const view=renderToStaticMarkup(React.createElement(SampleSelectionPanel,{...props,readOnly:true,removeItems:async()=>({removedCount:1})}));assert(!view.includes('移除所选'));assert(!view.includes('type="checkbox"'));
});
test('B3 selected items display current master data and card source first without valid badge',()=>{
 const html=renderToStaticMarkup(React.createElement(SampleSelectionPanel,props));
 assert(html.includes('最新丝绸'));assert(html.includes('真丝100%'));
 assert(html.includes('0012-F018'));assert(html.includes('已失效'));
 assert(html.includes('18 gsm'));assert(html.includes('145'));
 assert(html.indexOf('0012-F018')<html.indexOf('0012-1'));assert(!html.includes('0012-1-F018'));
 assert(!html.includes('>有效<'));
 assert(html.includes('移除'));
});
test('legacy closed session remains editable when the caller has write permission',()=>{
 const legacyPage={...page,session:{...page.session,status:'closed'}};
 const html=renderToStaticMarkup(React.createElement(SampleSelectionPanel,{...props,initialPage:legacyPage}));
 assert(!html.includes('已结束'));assert(html.includes('移除所选'));assert(html.includes('勾选配色'));
});
test('B3 empty response does not fabricate selection records or reveal customer name from another page',()=>{
 const html=renderToStaticMarkup(React.createElement(SampleSelectionPanel,{...props,initialPage:{...page,items:[],total:0,selectedCardCount:0}}));
 assert(html.includes('暂无已选产品'));assert(!html.includes('最新丝绸'));
});
test('B3 authenticated workspace composes the real client adapter and current selection data',()=>{
 const html=renderToStaticMarkup(React.createElement(SampleSelectionWorkspaceV2,{sessionId:'51',apiFetch:async()=>new Response('{}'),initialPage:page}));
 assert(html.includes('最新丝绸'));assert(html.includes('色卡编号'));
});

test('selected details display one card row with direct colorway tiles and preserve source history',()=>{const rows={...page,total:2,items:[page.items[0],{...page.items[0],id:'62',productId:'82',current:{...page.items[0].current,productNo:'0012-2-F018',colorwayNo:2}}]};const html=renderToStaticMarkup(React.createElement(SampleSelectionPanel,{...props,initialPage:rows}));assert.equal((html.match(/data-selected-card=/g)??[]).length,1);assert(html.includes('暂无图片'));assert.equal((html.match(/data-selection-item=/g)??[]).length,2);assert(html.includes('0012-F019'));assert(html.includes('已失效'));});

test('details show only pattern-colorway numbers and expose a read-only compatible whole-session Excel export',()=>{
 const html=renderToStaticMarkup(React.createElement(SampleSelectionPanel,{...props,onExport:async()=>{}}));
 assert(!html.includes('0012-1-F018'));assert(html.includes('0012-1'));assert(html.includes('导出 Excel'));
 const read=renderToStaticMarkup(React.createElement(SampleSelectionPanel,{...props,readOnly:true,onExport:async()=>{}}));assert(read.includes('导出 Excel'));assert(!read.includes('移除所选'));
 const empty=renderToStaticMarkup(React.createElement(SampleSelectionPanel,{...props,onExport:async()=>{},initialPage:{...page,total:0,selectedCardCount:0,items:[]}}));assert.match(empty,/<button[^>]*aria-label="导出 Excel"[^>]*disabled/);
});
