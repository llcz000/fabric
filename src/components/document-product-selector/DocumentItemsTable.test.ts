import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {DocumentItemsTable} from './DocumentItemsTable';import {applySelectedProductToDraft} from './selection';import {DocType,type DocumentData,type DocItem} from '../../types';
const product={id:'1',productNo:'P001',masterNo:'001',colorwayNo:2,fabricName:'真丝',composition:'100%真丝',weight:18,weightUnit:'mm' as const,widthCm:145,patternImageAssetId:null,thumbnailUrl:null};
test('all document types expose complete selected specifications without editable library fields',()=>{
 for(const type of [DocType.SAMPLE,DocType.SALES,DocType.DEPOSIT]){
  const item=applySelectedProductToDraft(type,{id:'new',meters:10,price:2,amount:0,remark:''} as DocItem,product);
  const html=renderToStaticMarkup(React.createElement(DocumentItemsTable,{draft:{type,items:[item]} as unknown as DocumentData,role:'admin',disabled:false,onChange:()=>{},onReplace:()=>{},onRemove:()=>{}}));
  for(const value of ['P001','真丝','100%真丝','18 mm','145'])assert(html.includes(value),type+' '+value);
  assert(!html.includes('aria-label="货号"'));assert(!html.includes('aria-label="成分"'));assert(html.includes('data-line-amount'));
 }
});
test('admin manual entries retain specification inputs on all document types',()=>{
 for(const type of [DocType.SAMPLE,DocType.SALES,DocType.DEPOSIT]){
  const html=renderToStaticMarkup(React.createElement(DocumentItemsTable,{draft:{type,items:[{id:'new',meters:0,price:0,amount:0,remark:'',v2SourceKind:'manual'}]} as unknown as DocumentData,role:'admin',disabled:false,onChange:()=>{},onReplace:()=>{},onRemove:()=>{}}));
  for(const value of ['货号','成分','克重','门幅'])assert(html.includes('aria-label="'+value+'"'),type+' '+value);
 }
});

test('three document editors retain only their applicable business fields, including saved remarks',()=>{
 for(const type of [DocType.SAMPLE,DocType.SALES,DocType.DEPOSIT]){
 const html=renderToStaticMarkup(React.createElement(DocumentItemsTable,{draft:{type,items:[{...applySelectedProductToDraft(type,{id:'new',meters:10,price:2,amount:0,remark:'单据行备注'} as DocItem,product)}]} as unknown as DocumentData,role:'sales',disabled:false,onChange:()=>{},onReplace:()=>{},onRemove:()=>{}}));
 for(const label of ['货号','色号','品名','米数','单价','金额','备注'])assert(html.includes(label),type+' '+label);
 assert(html.includes('单据行备注'));
 assert.equal(html.includes('aria-label="扣损米数"'),type===DocType.SALES);
 assert.equal(html.includes('aria-label="第1匹米数"'),type===DocType.SALES);
 assert(!html.includes('款式号'));
 }
});

test('default zero business inputs render empty without losing readonly computed sales meters',()=>{const html=renderToStaticMarkup(React.createElement(DocumentItemsTable,{draft:{type:DocType.SALES,items:[{id:'new',meters:0,price:0,amount:0,remark:''}]} as unknown as DocumentData,role:'sales',disabled:false,onChange(){},onReplace(){},onRemove(){}}));
 for(const label of ['单价','扣损米数']){const input=html.match(new RegExp('<input[^>]*aria-label="'+label+'"[^>]*>'))?.[0];assert(input);assert(input.includes('value=""'),label);}
});
