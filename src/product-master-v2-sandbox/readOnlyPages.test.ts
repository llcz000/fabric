import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {sandboxPages,SandboxCardsReadOnly,SandboxSessionsReadOnly,
 SandboxDocumentsReadOnly,SandboxStatsReadOnly} from './readOnlyPages';
import {PatternLibraryV2} from '../components/product-master-v2/PatternLibraryV2';
import {FabricWorkspaceV2} from '../components/product-master-v2/FabricImportV2';
import {ProductCatalogV2} from '../components/product-master-v2/ProductCatalogV2';

const neverFetch=(async()=>{throw Error('Must not send HTTP during initial server render')}) as typeof fetch;
test('sandbox has seven unique read-only navigation entries without mock or production shell',()=>{
 assert.deepEqual(sandboxPages.map(x=>x.id),[
  'patterns','fabrics','products','cards','sessions','documents','stats'
 ]);
 assert.equal(new Set(sandboxPages.map(x=>x.id)).size,7);
 assert(Object.isFrozen(sandboxPages));
});
test('fabric/product exports remain opt-in in sandbox; pattern export is temporarily removed',()=>{
 const pattern=renderToStaticMarkup(React.createElement(PatternLibraryV2,{apiFetch:neverFetch,canManage:false}));
 assert.doesNotMatch(pattern,/导出筛选结果/);
 for(const make of [
  (allowExport:boolean)=>React.createElement(FabricWorkspaceV2,{apiFetch:neverFetch,allowExport,canManage:false}),
  (allowExport:boolean)=>React.createElement(ProductCatalogV2,{apiFetch:neverFetch,allowExport,canManage:false})
 ]){
  const sandbox=renderToStaticMarkup(make(false));
  assert.doesNotMatch(sandbox,/导出筛选结果/);
  assert.doesNotMatch(sandbox,/新增产品|新增面料|新增母版|从Excel导入/);
  const normal=renderToStaticMarkup(make(true));
  assert.match(normal,/导出筛选结果/);
 }
});
test('additional four pages render read-only controls without external calls or mutation actions',()=>{
 const views=[
  React.createElement(SandboxCardsReadOnly,{apiFetch:neverFetch}),
  React.createElement(SandboxSessionsReadOnly,{apiFetch:neverFetch}),
  React.createElement(SandboxDocumentsReadOnly,{apiFetch:neverFetch}),
  React.createElement(SandboxStatsReadOnly,{apiFetch:neverFetch,onProduct:()=>{}})
 ];
 for(const view of views){
  const html=renderToStaticMarkup(view);
  assert.match(html,/只读/);
  assert.doesNotMatch(html,/确认删除|保存更改|新增色卡|导出 Excel|重新打印/);
 }
});
