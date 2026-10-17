import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {buildSampleCardsWorkbook} from './cardExcel';
const card={id:'1',masterId:'2',masterNo:'0012',fabricId:'3',fabricNo:'00018',cardNo:'0012-00018',description:'=丝绸',composition:'100%桑蚕丝',weightValue:16.5,weightUnit:'mm' as const,widthValue:140.5,qrPayload:'raw_TOKEN-Case_000',isActive:true};
async function read(cards:any[]){const book=new ExcelJS.Workbook();await book.xlsx.load(await buildSampleCardsWorkbook(cards) as any);return book;}
test('B2-3 actual XLSX has exactly six columns, one card per row, unchanged string payload and leading zero',async()=>{
 const b=await read([card]);const s=b.worksheets[0];
 assert.equal(s.columnCount,6);assert.equal(s.rowCount,2);
 assert.deepEqual(Array.from(s.getRow(1).values as any[]),[undefined,'色卡编号','品名','成分','克重','门幅','二维码']);
 assert.deepEqual(Array.from(s.getRow(2).values as any[]),[undefined,'0012-00018','=丝绸','100%桑蚕丝','16.5 mm','140.5 cm','raw_TOKEN-Case_000']);
 assert.equal(s.getCell('A2').type,ExcelJS.ValueType.String);assert.equal(s.getCell('B2').type,ExcelJS.ValueType.String);
 assert.equal(s.getCell('F2').type,ExcelJS.ValueType.String);assert.equal(s.getImages().length,0);
 for(const row of [1,2])for(let col=1;col<=6;col++)assert.notEqual(s.getCell(row,col).type,ExcelJS.ValueType.Formula);
});
test('B2-3 XLSX preserves selected order, gsm/mm and empty specifications without invented zeros',async()=>{
 const b=await read([{...card,id:'9',cardNo:'0088-F002',weightValue:120,weightUnit:'gsm',widthValue:150}, {...card,id:'8',cardNo:'0012-F019',composition:null,weightValue:null,weightUnit:null,widthValue:null}]);
 const s=b.worksheets[0];assert.equal(s.getCell('A2').value,'0088-F002');assert.equal(s.getCell('D2').value,'120 gsm');
 assert.equal(s.getCell('A3').value,'0012-F019');
 for(const k of ['C3','D3','E3'])assert.equal(s.getCell(k).text,'');
});
test('B2-3 XLSX QRcode does not trim, uppercase, URL-encode or wrap source text',async()=>{
 const payload=' AbC_000-/+?= %中文 ';const b=await read([{...card,qrPayload:payload}]);
 assert.equal(b.worksheets[0].getCell('F2').value,payload);
});
