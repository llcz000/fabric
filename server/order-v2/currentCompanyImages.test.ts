import assert from 'node:assert/strict';
import test from 'node:test';
import {buildV2DocumentPrintModel} from './print';
import {buildDocumentWorkbookFromModel} from '../documentExcel';
const doc={id:'1',ownerId:'1',orderNo:'YB-1',date:'2026-10-17',type:'sample',receivingUnit:'测试客户',issuer:'甲',receiver:'乙',receiverPhone:'',receiverAddress:'',deposit:0,totalMeters:1,totalPieces:1,totalAmount:5,deductionMeters:0,items:[],displaySnapshot:{companyName:'旧公司',companyAddress:'旧地址',companyPhone:'旧电话',terms:'旧条款'}} as any;
const company={company_name:'当前公司',address:'当前地址',phone:'电话',default_terms:'当前条款',deposit_terms:'当前定金条款',issuer_label:'开票人签名',receiver_label:'客户签名'};
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPWsAAAAASUVORK5CYII=';
test('current unified signature captions override historical presentation without changing product/trade data',()=>{
 const model=buildV2DocumentPrintModel(doc,company);assert.deepEqual(model.signatureLabels,{issuer:'开票人签名',receiver:'客户签名'});assert.equal(model.companyName,'当前公司');assert.equal(doc.displaySnapshot.companyName,'旧公司');
});
test('actual XLSX embeds the same authorized raster image and signature labels carried by print JSON',()=>{
 const model={...buildV2DocumentPrintModel(doc,company),companyImages:{brand_logo:png},signatureLabels:{issuer:'开票人签名',receiver:'客户签名'}};
 const workbook=buildDocumentWorkbookFromModel(model);assert(workbook.getImage(0));
 const strings:string[]=[];workbook.worksheets[0].eachRow(row=>row.eachCell(cell=>{if(typeof cell.value==='string')strings.push(cell.value);}));
 for(const label of ['开票人签名','客户签名'])assert(strings.some(x=>x.includes(label)));
 assert.throws(()=>buildDocumentWorkbookFromModel({...model,companyImages:{brand_logo:'https://outside.invalid/image.png'}}));
});
