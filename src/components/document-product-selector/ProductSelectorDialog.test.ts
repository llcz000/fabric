import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import {renderToStaticMarkup} from 'react-dom/server';
import ProductSelectorDialog,{ProductSelectorTable} from './ProductSelectorDialog';
import type {PickerProduct} from './selection';
const row:PickerProduct={id:'7',productNo:'P007',fabricName:'亲肤棉',masterNo:'G077',colorwayNo:3,
 composition:'100% Cotton',weight:125,weightUnit:'gsm',widthCm:150,
 patternImageAssetId:'asset-7',thumbnailUrl:'https://signed.example/7'};
test('P6-1 eight columns, signed thumbnail, unique choose action, nullable specs placeholder',()=>{
 const html=renderToStaticMarkup(React.createElement(ProductSelectorTable,{items:[row,{...row,id:'8',productNo:'P008',composition:null,weight:null,weightUnit:null,widthCm:null,patternImageAssetId:null,thumbnailUrl:null}],onChoose:()=>{}}));
 for(const col of ['花型缩略图','货号','品名','配色','成分','克重','门幅/cm','操作']) assert(html.includes(col),col);
 assert(html.includes('aria-label="选用产品 P007"'));
 assert(html.includes('https://signed.example/7'));
 assert(html.includes('待上传花型图'));
 assert.equal((html.match(/>选用<\/button>/g)||[]).length,2);
});
test('P6-1 modal exposes filters, accessible dialog and admin-only manual escape hatch',()=>{
 const common={open:true,mode:'replace' as const,apiFetch:fetch,onSelect:()=>{},onCancel:()=>{},onRequestManual:()=>{}};
 const admin=renderToStaticMarkup(React.createElement(ProductSelectorDialog,{...common,role:'admin'}));
 const sales=renderToStaticMarkup(React.createElement(ProductSelectorDialog,{...common,role:'sales'}));
 assert(admin.includes('aria-modal="true"'));
 assert(admin.includes('更换产品'));
 assert(admin.includes('货号'));assert(admin.includes('品名'));
 assert(admin.includes('改为手工录入'));
 assert(!sales.includes('改为手工录入'));
 assert.equal(renderToStaticMarkup(React.createElement(ProductSelectorDialog,{...common,role:'admin',open:false})),'');
});
