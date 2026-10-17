import type {DocumentRecord} from './documents';
import {calculateDocumentPayment} from './calculations';
import {buildDocumentPrintModel,type DocumentPrintModel,type DocumentPrintInput} from '../../src/lib/documentPrintModel';
import {buildDocumentWorkbookFromModel} from '../documentExcel';

/**
 * Build preview and XLSX with frozen persisted PRODUCT and trade line items,
 * but ALWAYS with the caller-verified CURRENT unified company configuration.
 * Historical displaySnapshot remains persisted and unchanged; it is not a
 * fallback for new company settings. Missing settings fail closed.
 */
export type CurrentCompany={
 company_name?:unknown;address?:unknown;phone?:unknown;
 default_terms?:unknown;deposit_terms?:unknown;
 brand_name?:unknown;issuer_label?:unknown;receiver_label?:unknown;
};
function currentSettings(company:CurrentCompany){
 if(!company||typeof company!=='object'||Array.isArray(company))throw Error('Current company settings unavailable');
 const keys=['company_name','address','phone','default_terms','deposit_terms'] as const;
 for(const key of keys){
  if(typeof company[key]!=='string')throw Error('Current company settings unavailable');
 }
 if(!(company.company_name as string).trim())throw Error('Current company settings unavailable');
 return company as Required<CurrentCompany>&Record<(typeof keys)[number],string>;
}
export function buildV2DocumentPrintModel(
 document:DocumentRecord,
 currentCompany:CurrentCompany
):DocumentPrintModel{
 const company=currentSettings(currentCompany);
 const gross=document.totalAmount;
 const deposit=document.type==='sample'?0:document.deposit;
 const receivable=calculateDocumentPayment(document.type,gross,deposit).receivableAmount;
 const input:DocumentPrintInput={
  type:document.type,docNo:document.orderNo,date:document.date,
  customerName:document.receivingUnit,
  companyName:company.company_name,
  brandName:typeof company.brand_name==='string'?company.brand_name:'',
  issuerLabel:typeof company.issuer_label==='string'?company.issuer_label:undefined,
  receiverLabel:typeof company.receiver_label==='string'?company.receiver_label:undefined,
  companyAddress:company.address,
  companyPhone:company.phone,
  defaultTerms:company.default_terms,
  depositTerms:company.deposit_terms,
  terms:'',
  issuer:document.issuer,receiver:document.receiver,
  receiverPhone:document.receiverPhone,receiverAddress:document.receiverAddress,
  totalMeters:document.totalMeters,totalPieces:document.totalPieces,
  totalAmount:gross,receivableAmount:receivable,deposit,
  deductionMeters:document.deductionMeters,
  salesRollFallback:false,
  items:document.items.map(item=>{
   const unit=item.snapshot?.weightUnit;
   const weight=item.weight===null?'':unit==='gsm'||unit==='mm'
    ?String(item.weight)+' '+unit:String(item.weight);
   return {
    itemNo:item.productNo,colorNo:item.colorNo,productName:item.productName,
    composition:item.composition,weight,
    width:item.widthCm===null?'':String(item.widthCm),
    meters:item.meters,unitPrice:item.unitPrice,amount:item.amount,
    remark:item.remark,rollValues:item.pieceMeters??[],
    deductionMeters:item.deductionMeters
   };
  })
 };
 return buildDocumentPrintModel(input);
}
/** ExcelJS version retains the existing print dimensions, margins and fonts. */
export function buildV2DocumentWorkbook(
 document:DocumentRecord,currentCompany:CurrentCompany
){
 return buildDocumentWorkbookFromModel(buildV2DocumentPrintModel(document,currentCompany));
}
