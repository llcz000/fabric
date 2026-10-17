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
