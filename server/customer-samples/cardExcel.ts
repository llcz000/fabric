import ExcelJS from 'exceljs';
import type {SampleCard} from './cardLibrary';
import {formatSampleCardScanUrl} from '../../src/lib/sampleCardScanLink';

const cardHeaders=['色卡编号','品名','成分','克重','门幅','二维码'];
const cardWidths=[24,32,40,18,18,64];
function cardRow(card:SampleCard,scanOrigin?:string){
 return [card.cardNo,card.description,card.composition??'',
  card.weightValue===null||card.weightUnit===null?'':card.weightValue+' '+card.weightUnit,
  card.widthValue===null?'':card.widthValue+' cm',scanOrigin?formatSampleCardScanUrl(scanOrigin,card.qrPayload):card.qrPayload];
}
function formatSheet(sheet:ExcelJS.Worksheet,widths:number[]){
 sheet.columns.forEach((column,index)=>{column.width=widths[index];column.numFmt='@';});
 sheet.getRow(1).font={bold:true};
 sheet.views=[{state:'frozen',ySplit:1}];
}
/** Exactly six textual business columns, in explicit selection order. Never expand colorways. */
export async function buildSampleCardsWorkbook(cards:readonly SampleCard[],scanOrigin?:string):Promise<Buffer>{
 const workbook=new ExcelJS.Workbook();
 const sheet=workbook.addWorksheet('Sample Cards');
 sheet.addRow(cardHeaders);
 for(const card of cards)sheet.addRow(cardRow(card,scanOrigin));
 formatSheet(sheet,cardWidths);
 return Buffer.from(await workbook.xlsx.writeBuffer());
}
export interface SampleCardExportGroup{
 sessionId:string;customerName:string;contactName:string|null;createdOn:string;cards:readonly SampleCard[];
}
export async function buildSelectionCardsWorkbook(groups:readonly SampleCardExportGroup[],scanOrigin?:string):Promise<Buffer>{
 const workbook=new ExcelJS.Workbook();
 const sheet=workbook.addWorksheet('客户选样汇总');
 sheet.addRow([...cardHeaders,'选样单号','客户','联系人','选样日期']);
 for(const group of groups)for(const card of group.cards){
  sheet.addRow([...cardRow(card,scanOrigin),group.sessionId,group.customerName,group.contactName??'',group.createdOn]);
 }
 formatSheet(sheet,[...cardWidths,24,32,24,18]);
 sheet.autoFilter={from:{row:1,column:1},to:{row:sheet.rowCount,column:10}};
 return Buffer.from(await workbook.xlsx.writeBuffer());
}
