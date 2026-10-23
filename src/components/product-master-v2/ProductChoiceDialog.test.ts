import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProductFabricChoiceRow,ProductPatternChoiceRow} from './ProductChoiceDialog';
import type {ProductPatternChoice} from './productEditorModel';
import type {FabricCatalogItem} from './fabricModel';

const fabric:FabricCatalogItem={id:'21',fabricNo:'10151-8',fabricName:'雪纺',
 composition:'75%聚酯纤维、20%粘胶、5%氨纶',weightValue:88,weightUnit:'gsm',
 widthValue:145,remark:null,isActive:true,productCount:0};
const pattern:ProductPatternChoice={id:'12',masterId:'11',colorwayNo:2,patternNo:'G0008-2',
 patternImageAssetId:'a1111111-1111-4111-8111-111111111111',remark:'',isActive:true,
 colorTags:[{id:'1',name:'蓝色',isArchived:false}],topicTags:[]};

test('fabric options show number, name, complete composition, weight and width with readable hierarchy',()=>{
 const html=renderToStaticMarkup(React.createElement(ProductFabricChoiceRow,{item:fabric,onChoose:()=>{}}));
 for(const text of ['10151-8','雪纺','75%聚酯纤维、20%粘胶、5%氨纶','克重','88 gsm','门幅','145 cm'])assert(html.includes(text),text);
 assert(html.includes('text-slate-500')&&html.includes('font-semibold')&&html.includes('text-[#174c9b]'));
 const empty=renderToStaticMarkup(React.createElement(ProductFabricChoiceRow,{item:{...fabric,composition:null,weightValue:null,weightUnit:null,widthValue:null},onChoose:()=>{}}));
 assert.equal((empty.match(/未填写/g)||[]).length,3);
});

test('pattern option displays its own thumbnail and multi-select check, not shared images',()=>{
 const html=renderToStaticMarkup(React.createElement(ProductPatternChoiceRow,{item:pattern,
  selected:true,showCheckbox:true,url:'https://assets.example.net/thumbnail.webp',onChoose:()=>{}}));
 assert(html.includes('aria-pressed="true"'));
 assert(html.includes('src="https://assets.example.net/thumbnail.webp"'));
 assert(html.includes('花型配色 G0008-2 缩略图')&&html.includes('蓝色'));
 assert(html.includes('✓'));
 const other=renderToStaticMarkup(React.createElement(ProductPatternChoiceRow,{item:{...pattern,patternNo:'G0008-3',patternImageAssetId:null},
  selected:false,showCheckbox:true,onChoose:()=>{}}));
 assert(other.includes('aria-pressed="false"')&&other.includes('待上传'));
 assert(!other.includes('src="https://assets.example.net/thumbnail.webp"'));
 const inaccessible=renderToStaticMarkup(React.createElement(ProductPatternChoiceRow,{item:pattern,selected:false,showCheckbox:false,failed:true,url:'https://assets.example.net/thumbnail.webp',onChoose:()=>{}}));
 assert(inaccessible.includes('图片不可用')&&!inaccessible.includes('src="https://assets.example.net/thumbnail.webp"'));
});
