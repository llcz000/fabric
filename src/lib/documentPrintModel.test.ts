import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDocumentPrintModel, normalizeDocumentPrintType, type DocumentPrintInput } from './documentPrintModel';
import {buildDocumentWorkbookFromModel} from '../../server/documentExcel';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {DocumentPrintTable} from '../components/document-product-selector/V2DocumentPrintView';

const base: DocumentPrintInput = {
  type: 'sample', docNo: 'YB-1', date: '2026-09-08', customerName: '花花服饰',
  companyName: '歌朗纺织', companyAddress: '杭州地址', companyPhone: '123456',
  defaultTerms: '默认条款', depositTerms: '定金条款', terms: '', issuer: '', receiver: '',
  receiverPhone: '', receiverAddress: '', totalMeters: 3, totalPieces: 1,
  totalAmount: 180, receivableAmount: 180, deposit: 0, deductionMeters: 0,
  items: [{ itemNo: 'G0531', colorNo: '米黄', productName: '剪花布', composition: '人丝', weight: '65', width: '128', meters: 3, unitPrice: 60, amount: 180, remark: '备注', rollValues: [] }],
};

test('15 rolls stay one logical line with vertical merges in HTML and Excel, adjacent identical products stay separate',()=>{
 const item={...base.items[0],rollValues:Array.from({length:15},(_,i)=>i+1)};
 const model=buildDocumentPrintModel({...base,type:'sales',items:[item,item]});
 assert.deepEqual(model.rowGroups,[{start:0,rowCount:2},{start:2,rowCount:2}]);
 const html=renderToStaticMarkup(React.createElement(DocumentPrintTable,{model}));
 assert.equal((html.match(/rowSpan="2"/g)??[]).length,14);
 assert.equal((html.match(/>G0531</g)??[]).length,2);
 assert.equal((html.match(/>15.0</g)??[]).length,2);
 const sheet=buildDocumentWorkbookFromModel(model).worksheets[0];
 assert.equal(sheet.getCell('A8').master.address,'A7');
 assert.equal(sheet.getCell('A10').master.address,'A9');
 assert.equal(sheet.getCell('D8').isMerged,false);
 assert.equal(sheet.getCell('H8').value,'15.0');
});

test('normalizes persisted bulk orders as sales documents', () => {
  assert.equal(normalizeDocumentPrintType('bulk'), 'sales');
  assert.equal(normalizeDocumentPrintType('sales'), 'sales');
});

test('builds sample content once with literal columns, rows, totals and signature fields', () => {
  const model = buildDocumentPrintModel(base);
  assert.equal(model.title, '样布码单');
  assert.deepEqual(model.companyLines, ['地址：杭州地址', '电话：123456']);
  assert.deepEqual(model.columns.map((column) => column.label), ['货号', '色号', '品名', '成分', '克重', '门幅(cm)', '米数(米)', '单价(元)', '金额(元)', '备注']);
  assert.deepEqual(model.rows[0], ['G0531', '米黄', '剪花布', '人丝', '65', '128', '3.00', '¥60.00', '¥180.00', '备注']);
  assert.deepEqual(model.summaries.map((row) => [row.left, row.right]), [
    ['总计数（米）：3.00', '合计金额：¥180.00（大写：壹佰捌拾元整）'],
    ['实发总匹数：1 匹', '应收金额：¥180.00（大写：壹佰捌拾元整）'],
  ]);
  assert.deepEqual(model.signature, { issuer: '', receiver: '', phone: '', receiverAddress: '' });
});

test('builds deposit and sales structures from their real persisted type values', () => {
  const deposit = buildDocumentPrintModel({ ...base, type: 'deposit', deposit: 20, receivableAmount: 144 });
  assert.equal(deposit.title, '定金单');
  assert.deepEqual(deposit.columns.map((column) => column.label), ['货号', '色号', '品名', '米数(米)', '单价(元)', '金额(元)']);
  assert.equal(deposit.terms, '定金条款');
  assert.equal(deposit.summaries[1].left, '定金金额：20%  ¥36.00（大写：叁拾陆元整）');

  const sales = buildDocumentPrintModel({
    ...base, type: 'bulk', deposit: 20, receivableAmount: 160, deductionMeters: 1,
    items: [{ ...base.items[0], rollValues: [1,2,3,4,5,6,7,8,9,10,11], deductionMeters: 1 }],
  });
  assert.equal(sales.title, '销售发货码单');
  assert.equal(sales.columns.length, 18);
  assert.deepEqual(sales.columns.slice(3, 13).map((column) => column.label), ['1','2','3','4','5','6','7','8','9','10']);
  assert.equal(sales.rows.length, 2);
  assert.deepEqual(sales.rows[1].slice(3, 5), ['11.0', '']);
  assert.match(sales.summaries[0].left, /扣损合计：1.00 米/);
  assert.equal(sales.summaries[1].right, '应付款：¥160.00（大写：壹佰陆拾元整）');
});

test('preserves jiao and fen in shared uppercase currency text', () => {
  const model = buildDocumentPrintModel({ ...base, totalAmount: 180.25, receivableAmount: 180.25 });
  assert.equal(model.summaries[0].right, '合计金额：¥180.25（大写：壹佰捌拾元贰角伍分）');
});

 test('deposit preview and workbook have only contract/deposit totals and one full-width deposit row',async()=>{
 const model=buildDocumentPrintModel({...base,type:'deposit',deposit:25});
 assert.equal(model.summaries[1].right,undefined);
 assert(!JSON.stringify(model).includes('应收'));assert(!JSON.stringify(model).includes('应付'));
 const html=renderToStaticMarkup(React.createElement(DocumentPrintTable,{model}));
 assert.match(html,/<td colSpan="6"[^>]*>定金金额：25%  ¥45.00/);
 const sheet=buildDocumentWorkbookFromModel(model).worksheets[0];
 assert.equal(sheet.getCell('F9').master.address,'A9');
 const cells:string[]=[];sheet.eachRow(row=>row.eachCell(c=>{if(typeof c.value==='string')cells.push(c.value);}));
 assert(!cells.some(x=>/应收|应付|匹数|结清/.test(x)));
 });

test('deposit workbook retains a full-width receiving address row for filled and blank addresses',()=>{
 for(const receiverAddress of ['','浙江绍兴收货仓库8号']){
 const sheet=buildDocumentWorkbookFromModel(buildDocumentPrintModel({...base,type:'deposit',receiverAddress})).worksheets[0];let found:any;sheet.eachRow(row=>row.eachCell(cell=>{if(Number(cell.col)===1&&cell.value==='收货地址：'+receiverAddress)found=cell;}));assert(found,'address label must exist even when blank');assert(found.isMerged);assert.equal(sheet.getCell(found.row,6).master.address,found.address);assert(Number(sheet.pageSetup.printArea?.match(/(\d+)$/)?.[1])>=Number(found.row));
 }
});

test('deposit workbook address height accounts for explicit line breaks',()=>{
 const sheet=buildDocumentWorkbookFromModel(buildDocumentPrintModel({...base,type:'deposit',receiverAddress:'一楼\n二楼\n三楼\n四楼'})).worksheets[0];let addressRow=0;sheet.eachRow(row=>{if(String(row.getCell(1).value).startsWith('收货地址：'))addressRow=row.number;});assert(addressRow);assert(sheet.getRow(addressRow).height>=64);
});
