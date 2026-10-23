import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {BatchGeneratedProductDetails} from './BatchGeneratedProductDetails';
import type {FabricCatalogItem} from './fabricModel';

const fabric:FabricCatalogItem={
 id:'21',fabricNo:'10151-8',fabricName:'轻薄雪纺面料',
 composition:'75%聚酯纤维+20%粘胶+5%氨纶 / 复杂成分配比详情，不能隐藏',
 weightValue:88,weightUnit:'gsm',widthValue:145,
 remark:'面料表面需保持透明感\n不要破坏原有织造特征',
 isActive:true,productCount:0
};
const rows=[
 {patternColorwayId:'12',productNo:'G0008-1-10151-8',existing:false},
 {patternColorwayId:'13',productNo:'G0008-2-10151-8',existing:true,id:'92'}
];
test('batch generated product detail shows all fabric specs and preserves existing status',()=>{
 const markup=renderToStaticMarkup(React.createElement(BatchGeneratedProductDetails,{items:rows,fabric}));
 for(const text of ['G0008-1-10151-8','G0008-2-10151-8','10151-8','轻薄雪纺面料',
  fabric.composition,'88 gsm','145 cm','面料备注','面料表面需保持透明感','待创建','已存在，跳过']){
  assert(markup.includes(text),text);
 }
 assert.equal((markup.match(/面料品号/g)||[]).length,2);
 assert.equal((markup.match(/75%聚酯纤维/g)||[]).length,2);
 assert(!markup.includes('truncate'));
 assert(markup.includes('whitespace-pre-wrap')&&markup.includes('break-words'));
});
test('empty fabric metadata displays clear placeholders, without invented specs',()=>{
 const markup=renderToStaticMarkup(React.createElement(BatchGeneratedProductDetails,{
  items:rows.slice(0,1),
  fabric:{...fabric,composition:null,weightValue:null,weightUnit:null,widthValue:null,remark:null}
 }));
 assert.equal((markup.match(/未填写/g)||[]).length,3);
 assert(!markup.includes('面料备注'));
 assert(markup.includes('G0008-1-10151-8'));
});
