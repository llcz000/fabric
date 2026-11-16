import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import V2DocumentPrintView from './V2DocumentPrintView';
import {DocumentPrintTable} from './V2DocumentPrintView';
import type {DocumentPrintModel} from '../../lib/documentPrintModel';

test('P6-4 independent V2 preview only loads authorized endpoint, never legacy Excel route',()=>{
 const html=renderToStaticMarkup(React.createElement(V2DocumentPrintView,{
  apiFetch:fetch,documentId:'37',onBack:()=>{}
 }));
 assert(html.includes('V2单据打印预览'));
 assert(html.includes('正在读取打印资料'));
 assert(html.includes('下载 Excel'));
 assert(html.includes('浏览器打印'));
 assert(!html.includes('/api/export_template'));
});
test('OUTPUT-01 browser print is primary alongside PNG and Excel downloads',()=>{
 const html=renderToStaticMarkup(React.createElement(V2DocumentPrintView,{apiFetch:fetch,documentId:'37',onBack:()=>{}}));
 assert.match(html,/<button[^>]*bg-emerald-700[^>]*>(?:(?!<\/button>).)*浏览器打印<\/button>/s);
 assert.match(html,/<button[^>]*>(?:(?!<\/button>).)*下载 PNG<\/button>/s);
 assert.match(html,/<button[^>]*>(?:(?!<\/button>).)*下载 Excel<\/button>/s);
 assert.doesNotMatch(html,/下载打印 JSON|下载打印Excel|横向打印补偿/);
});

test('all three previews keep totals inside the detail table with full-width merged summary rows',()=>{
 for(const count of [10,7,16]){
  const model={columns:Array.from({length:count},(_,i)=>({key:String(i),label:'列'+i,webFraction:1,excelWidth:10})),rows:[Array(count).fill('明细')],summaries:[{left:'总计米数：10.00',right:'应收金额：20.00'}]} as DocumentPrintModel;
  const html=renderToStaticMarkup(React.createElement(DocumentPrintTable,{model}));
  assert.match(html,/<tfoot[^>]*>.*总计米数：10.00.*应收金额：20.00.*<\/tfoot>/s);
  const spans=[...html.matchAll(/colSpan="(\d+)"/g)].map(m=>Number(m[1]));assert.equal(spans.reduce((a,b)=>a+b,0),count);
  assert(!html.includes('flex justify-between'));
 }
});

test('OUTPUT-01 sample preview places the exact colorway thumbnail before the product number with a missing-image placeholder',()=>{
 const model={
  type:'sample',columns:[{key:'itemNo',label:'货号',webFraction:1,excelWidth:11}],
  rows:[['G0008-1-F1'],['G0008-2-F1']],summaries:[{left:'合计'}]
 } as DocumentPrintModel;
 const image='https://signed.example/colorway-1.webp';
 const preview=renderToStaticMarkup(React.createElement(DocumentPrintTable,{model,previewThumbnailUrls:[image,null]}));
 assert.match(preview,/<th[^>]*>花型<\/th><th[^>]*>货号<\/th>/);
 assert.match(preview,/<img[^>]*colorway-1\.webp[^>]*>.*G0008-1-F1/s);
 assert.match(preview,/—<\/span>.*G0008-2-F1/s);
 assert.match(preview,/colSpan="2"/);
 const output=renderToStaticMarkup(React.createElement(DocumentPrintTable,{model}));
 assert.doesNotMatch(output,/花型|colorway-1\.webp/);
 assert.match(output,/colSpan="1"/);
});
