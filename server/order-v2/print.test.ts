import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import type {DocumentRecord} from './documents';
import {buildV2DocumentPrintModel,buildV2DocumentWorkbook} from './print';
const base:DocumentRecord={
 id:'99',ownerId:'2',orderNo:'YB-99',date:'2026-10-12',receivingUnit:'客户A',type:'sample',
 deposit:5,styleNo:'ST99',issuer:'业务员',receiver:'收货员',receiverPhone:'138888',receiverAddress:'甲仓',
 settled:false,displaySnapshot:{companyName:'历史公司',companyAddress:'历史地址',companyPhone:'旧电话',terms:'历史条款'},
 totalMeters:2.5,totalPieces:1,totalAmount:25.63,deductionMeters:0,
 items:[{id:'100',productId:'901',source:'catalog',snapshot:{productNo:'G901',weightUnit:'mm'},productNo:'G901',
 productName:'真丝混纺',colorNo:'3',composition:'棉/丝',weight:15.5,widthCm:145,meters:2.5,
 unitPrice:10.25,amount:25.63,remark:'特选',pieceMeters:null,deductionMeters:0}]
};
const now={company_name:'新公司',address:'新地址',phone:'新电话',default_terms:'新条款',deposit_terms:'新定金条款'};
test('P6 current unified company settings override historic saved company, while item fields remain frozen',async()=>{
 const model=buildV2DocumentPrintModel(base,now);
 assert.equal(model.companyName,'新公司');
 assert.deepEqual(model.companyLines,['地址：新地址','电话：新电话']);
 assert.equal(model.terms,'新条款');
 assert.deepEqual(model.rows[0],['G901','3','真丝混纺','棉/丝','15.5 mm','145','2.50','¥10.25','¥25.63','特选']);
 assert.equal(model.summaries[1].right,'应收金额：¥25.63（大写：贰拾伍元陆角叁分）');
 const workbook=buildV2DocumentWorkbook(base,now);
 const reopened=new ExcelJS.Workbook();await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
 const sheet=reopened.worksheets[0];
 assert.equal(sheet.getCell('C1').value,'新公司');
 assert.equal(sheet.getCell('E7').value,'15.5 mm');
 assert.equal(sheet.getCell('A10').value,'备注条款：新条款');
 assert.equal(sheet.getCell('J7').value,'特选');
});
test('P6 reread after editing company config reflects latest without mutating historical product snapshot',()=>{
 const changed={...now,company_name:'再次更新',default_terms:'第二次条款'};
 const initial=buildV2DocumentPrintModel(base,now);
 const later=buildV2DocumentPrintModel(base,changed);
 assert.equal(initial.companyName,'新公司');
 assert.equal(later.companyName,'再次更新');
 assert.equal(later.terms,'第二次条款');
 assert.deepEqual(later.rows,initial.rows);
 assert.equal(base.displaySnapshot?.companyName,'历史公司');
});
test('P6 print refuses missing current settings instead of leaking frozen company',()=>{
 for(const unavailable of [{}, {company_name:'',address:'X',phone:'Y',default_terms:'',deposit_terms:''}])
  assert.throws(()=>buildV2DocumentPrintModel(base,unavailable),/current|setting|company|invalid/i);
});
test('P6-4 nullable spec shows dash without unit fabrication; gsm kept',()=>{
 const doc={...base,items:[{...base.items[0],weight:null,widthCm:null,composition:'',snapshot:{weightUnit:'gsm'}}]};
 const row=buildV2DocumentPrintModel(doc,now).rows[0];
 assert.deepEqual(row.slice(3,6),['-','-','-']);
 assert.equal(buildV2DocumentPrintModel({...doc,items:[{...doc.items[0],weight:120.5}]},now).rows[0][4],'120.5 gsm');
});
test('P6-4 deposit is percent not currency, full gross remains total',()=>{
 const doc:DocumentRecord={...base,type:'deposit',deposit:25,totalMeters:10,totalPieces:1,totalAmount:300,
  items:[{...base.items[0],meters:10,unitPrice:30,amount:300}]};
 const model=buildV2DocumentPrintModel(doc,now);
 assert.equal(model.title,'定金单');
 assert.match(model.summaries[1].left,/定金金额：25%  ¥75.00/);
 assert.match(model.summaries[1].right??'',/应收金额：¥225.00/);
 const workbook=buildV2DocumentWorkbook(doc,now);
 assert.equal(workbook.worksheets[0].getCell('A3').value,'定金单');
});
test('P6 deposit always uses most recent deposit terms, not historical sample default',()=>{
 const d:DocumentRecord={...base,type:'deposit',deposit:10};
 assert.equal(buildV2DocumentPrintModel(d,now).terms,'新定金条款');
});

test('DOC-05/07 actual workbook and print use the same rounded receipt and omit unsupported fields',async()=>{
 const tiny:DocumentRecord={...base,type:'deposit',deposit:50,settled:true,totalPieces:17,totalMeters:0.01,totalAmount:0.01,
  items:[{...base.items[0],meters:0.01,unitPrice:1,amount:0.01}]};
 const model=buildV2DocumentPrintModel(tiny,now);
 assert.equal(model.summaries[1].right,'应收金额：¥0.00（大写：零元整）');
 assert.match(model.summaries[1].left,/¥0.01/);
 assert(!JSON.stringify(model).includes('匹数'));assert(!JSON.stringify(model).includes('结清'));
 const workbook=buildV2DocumentWorkbook(tiny,now),reopened=new ExcelJS.Workbook();
 await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
 const cells:string[]=[];reopened.worksheets[0].eachRow(row=>row.eachCell(cell=>{if(typeof cell.value==='string')cells.push(cell.value);}));
 assert(cells.some(text=>text==='应收金额：¥0.00（大写：零元整）'));
 assert(cells.some(text=>text.includes('50%  ¥0.01')));
 const sample=buildV2DocumentPrintModel(base,now);assert(!JSON.stringify(sample.summaries).includes('预收'));
 assert.equal(buildV2DocumentPrintModel({...base,totalPieces:99},now).summaries[1].left,'实发总匹数：1 匹');
 assert.equal(base.deposit,5,'raw historical object remains untouched');
});
test('P6-4 sales no piece array prints zero, not a fabricated whole-roll; actual two rolls and deduction roundtrip',async()=>{
 const sale:DocumentRecord={...base,type:'bulk',orderNo:'XS-99',deposit:10,totalMeters:7,
 totalPieces:2,totalAmount:81.25,deductionMeters:0.5,items:[{...base.items[0],
  meters:7,unitPrice:12.5,amount:81.25,pieceMeters:[3.5,3.5],deductionMeters:0.5}]};
 const model=buildV2DocumentPrintModel(sale,now);
 assert.equal(model.title,'销售发货码单');
 assert.equal(model.rows[0][3],'3.5');
 assert.equal(model.rows[0][4],'3.5');
 assert.equal(model.rows[0][13],'2');
 assert.match(model.summaries[0].left,/总匹数：2 匹.*扣损合计：0.50 米/);
 const zero={...sale,totalPieces:0,items:[{...sale.items[0],pieceMeters:null}]};
 const printable=buildV2DocumentPrintModel(zero,now);
 assert.equal(printable.rows[0][3],'');
 assert.equal(printable.rows[0][13],'0');
 assert.match(printable.summaries[0].left,/总匹数：0 匹/);
 const wb=buildV2DocumentWorkbook(zero,now);
 const reopened=new ExcelJS.Workbook();await reopened.xlsx.load(await wb.xlsx.writeBuffer());
 assert.equal(reopened.worksheets[0].getCell('N7').value,'0');
 assert.equal(reopened.worksheets[0].getCell('D7').value,'');
});
test('P6-4 nullable historical header falls back explicitly, does not alter original record',()=>{
 const legacy:DocumentRecord={...base,displaySnapshot:null};
 const model=buildV2DocumentPrintModel(legacy,now);
 assert.equal(model.companyName,'新公司');
 assert.equal(model.terms,'新条款');
 assert.equal(legacy.displaySnapshot,null);
});
