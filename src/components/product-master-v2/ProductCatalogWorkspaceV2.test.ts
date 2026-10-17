import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProductCatalogWorkspaceV2} from './ProductCatalogWorkspaceV2';

test('P4-5 independent list-to-editor shell exposes only real approved V2 actions',()=>{
 const html=renderToStaticMarkup(React.createElement(ProductCatalogWorkspaceV2,{
  apiFetch:fetch,canManage:true
 }));
 assert(html.includes('产品库')&&html.includes('新增产品'));
 assert(!html.includes('删除产品'));
 assert(!html.includes('/api/products/legacy'));
 assert(!html.includes('上传图片'));
});
test('P4-5 independent shell cannot reveal mutators to readonly users',()=>{
 const html=renderToStaticMarkup(React.createElement(ProductCatalogWorkspaceV2,{
  apiFetch:fetch,canManage:false
 }));
 assert(html.includes('产品库'));
 assert(!html.includes('新增产品'));
 assert(!html.includes('删除产品'));
});
