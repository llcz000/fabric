import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {FabricSearchSelect} from './FabricSearchSelect';
import {ProductFabricChoiceRow,ProductFabricChoiceContent} from './ProductChoiceDialog';
import type {FabricCatalogItem} from './fabricModel';
const fabric:FabricCatalogItem={
 id:'21',fabricNo:'10151-8',fabricName:'超轻薄雪纺面料',
 composition:'75%聚酯纤维、20%粘胶、5%氨纶（复杂成分）',weightValue:88,weightUnit:'gsm',
 widthValue:145,remark:null,isActive:true,productCount:0
};
test('single product fabric search uses shared full fabric content from batch chooser',()=>{
 const details=renderToStaticMarkup(React.createElement(ProductFabricChoiceContent,{item:fabric}));
 const bulk=renderToStaticMarkup(React.createElement(ProductFabricChoiceRow,{item:fabric,onChoose:()=>{}}));
 for(const term of ['10151-8','超轻薄雪纺面料','75%聚酯纤维','88 gsm','145 cm','成分','克重','门幅'])
  assert(details.includes(term),term);
 assert(bulk.includes(details));
 assert(bulk.includes('text-[#174c9b]')&&bulk.includes('text-slate-500'));
 const shell=renderToStaticMarkup(React.createElement(FabricSearchSelect,{
  apiFetch:fetch,fabric:null,onSelect:()=>{}
 }));
 assert(shell.includes('输入面料品号或品名')&&shell.includes('展开面料选项'));
});
test('shared fabric choice rendering handles missing specs consistently',()=>{
 const output=renderToStaticMarkup(React.createElement(ProductFabricChoiceContent,{
  item:{...fabric,composition:null,weightValue:null,weightUnit:null,widthValue:null}
 }));
 assert.equal((output.match(/未填写/g)||[]).length,3);
});
