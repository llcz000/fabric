import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CompactCustomerChoice} from './CompactCustomerChoice';

test('compact customer selector shows one field and leaves the long list/form inside a dialog',()=>{
 const html=renderToStaticMarkup(React.createElement(CompactCustomerChoice,{
  apiFetch:fetch,value:null,onChange:()=>{}
 }));
 assert.match(html,/客户\/收货单位/);
 assert.match(html,/选择客户/);
 assert.doesNotMatch(html,/上一页客户|添加联系人|搜索客户名称、联系人或品牌/);
 assert.match(html,/aria-haspopup="dialog"/);
});
test('selected customer remains a compact single-line field',()=>{
 const html=renderToStaticMarkup(React.createElement(CompactCustomerChoice,{
  apiFetch:fetch,value:{customerId:'9',name:'广州客户公司'},onChange:()=>{}
 }));
 assert.match(html,/广州客户公司/);
 assert.doesNotMatch(html,/上一页客户|添加联系人/);
});
test('disabled customer control cannot open picker',()=>{
 const html=renderToStaticMarkup(React.createElement(CompactCustomerChoice,{
  apiFetch:fetch,value:null,onChange:()=>{},disabled:true
 }));
 assert.match(html,/aria-haspopup="dialog"[^>]*disabled/);
});
