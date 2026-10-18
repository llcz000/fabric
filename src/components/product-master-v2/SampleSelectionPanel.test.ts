import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SampleSelectionPanel,type SampleSelectionPanelProps} from './SampleSelectionPanel';
import {SampleSelectionWorkspaceV2} from './SampleSelectionWorkspaceV2';
import type {SampleSessionPage} from '../../../server/customer-samples/sessionRead';

const page:SampleSessionPage={
 session:{id:'51',customerReference:'客户A',status:'open'},
 total:1,selectedCardCount:1,limit:20,offset:0,
 items:[{id:'61',productId:'81',
  current:{productNo:'0012-1-F018',patternNo:'0012',colorwayNo:1,fabricNo:'F018',
   fabricName:'最新丝绸',composition:'真丝100%',weightValue:'18',weightUnit:'gsm',widthCm:'145'},
  sources:[{cardId:'12',cardNo:'0012-F018',retired:false,firstScanEventId:'42'},
   {cardId:'13',cardNo:'0012-F019',retired:true,firstScanEventId:'43'}]}]
};
const props:SampleSelectionPanelProps={sessionId:'51',initialPage:page,
 load:async()=>page,remove:async()=>{},onRescan:()=>{}};

test('selection supports card checkboxes and explicit current-page select all, while view mode has no mutation controls',()=>{
 const html=renderToStaticMarkup(React.createElement(SampleSelectionPanel,{...props,removeCards:async()=>({removedCount:1})}));
 assert(html.includes('勾选色卡 0012-F018'));assert(html.includes('全选当前页色卡'));assert(html.includes('移除所选色卡'));
 const view=renderToStaticMarkup(React.createElement(SampleSelectionPanel,{...props,readOnly:true,removeCards:async()=>({removedCount:1})}));
 assert(!view.includes('移除该款'));assert(!view.includes('移除所选色卡'));assert(!view.includes('type="checkbox"'));
});
test('B3 selected items display current master data and card source first without valid badge',()=>{
 const html=renderToStaticMarkup(React.createElement(SampleSelectionPanel,props));
 assert(html.includes('最新丝绸'));assert(html.includes('真丝100%'));
 assert(html.includes('0012-F018'));assert(html.includes('已失效'));
 assert(html.includes('18 gsm'));assert(html.includes('145'));
 assert(html.indexOf('色卡编号')<html.indexOf('货号'));
 assert(!html.includes('>有效<'));
 assert(html.includes('移除'));
});
test('B3 closed session is strictly read-only and never presents a remove action',()=>{
 const html=renderToStaticMarkup(React.createElement(SampleSelectionPanel,{...props,initialPage:{...page,session:{...page.session,status:'closed'}}}));
 assert(html.includes('已结束'));assert(!html.includes('移除该款'));
});
test('B3 empty response does not fabricate selection records or reveal customer name from another page',()=>{
 const html=renderToStaticMarkup(React.createElement(SampleSelectionPanel,{...props,initialPage:{...page,items:[],total:0,selectedCardCount:0}}));
 assert(html.includes('暂无已选产品'));assert(!html.includes('最新丝绸'));
});
test('B3 authenticated workspace composes the real client adapter and current selection data',()=>{
 const html=renderToStaticMarkup(React.createElement(SampleSelectionWorkspaceV2,{sessionId:'51',apiFetch:async()=>new Response('{}'),initialPage:page}));
 assert(html.includes('最新丝绸'));assert(html.includes('色卡编号'));
});
