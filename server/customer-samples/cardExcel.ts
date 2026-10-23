import ExcelJS from 'exceljs';
import type {SampleCard} from './cardLibrary';
import {formatSampleCardScanUrl} from '../../src/lib/sampleCardScanLink';
/** Exactly six textual business columns, in explicit selection order. Never expand colorways. */
export async function buildSampleCardsWorkbook(cards:readonly SampleCard[],scanOrigin?:string):Promise<Buffer>{
 const workbook=new ExcelJS.Workbook();
 const sheet=workbook.addWorksheet('Sample Cards');
 sheet.addRow(['色卡编号','品名','成分','克重','门幅','二维码']);
 for(const card of cards){
  sheet.addRow([card.cardNo,card.description,card.composition??'',
   card.weightValue===null||card.weightUnit===null?'':card.weightValue+' '+card.weightUnit,
    card.widthValue===null?'':card.widthValue+' cm',scanOrigin?formatSampleCardScanUrl(scanOrigin,card.qrPayload):card.qrPayload]);
 }
 sheet.columns.forEach((column,index)=>{column.width=[24,32,40,18,18,64][index];column.numFmt='@';});
 sheet.getRow(1).font={bold:true};
 sheet.views=[{state:'frozen',ySplit:1}];
 return Buffer.from(await workbook.xlsx.writeBuffer());
}
