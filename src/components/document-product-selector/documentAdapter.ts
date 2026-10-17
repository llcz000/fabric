import {DocType,type DocumentData,type DocItem,type CompanyProfile} from '../../types';
import type {DocumentRecord,EditDocument} from '../../../server/order-v2/documents';
import {calculateDocumentPayment} from '../../../server/order-v2/calculations';
export class V2DraftMappingError extends Error {}
/** V2 records are stored as immutable snapshots; readback must not query current products. */
export function fromV2DocumentRecord(record:unknown,profile:CompanyProfile):DocumentData{
 if(!record||typeof record!=='object'||Array.isArray(record))throw new V2DraftMappingError('Invalid V2 document');
 const order=record as DocumentRecord;
 if(!['sample','deposit','bulk'].includes(order.type)||!Array.isArray(order.items))
  throw new V2DraftMappingError('Invalid V2 document type/items');
 const type=order.type==='bulk'?DocType.SALES:order.type=== 'deposit'?DocType.DEPOSIT:DocType.SAMPLE;
 const display=order.displaySnapshot;
 const items:DocItem[]=order.items.map(line=>{
  const common={id:line.id,itemNo:line.productNo,colorNo:line.colorNo,productName:line.productName,
   meters:line.meters,price:line.unitPrice,amount:line.amount,remark:line.remark,
   composition:line.composition??'',weight:line.weight==null?'':`${line.weight}${line.snapshot?.weightUnit?' '+line.snapshot.weightUnit:''}`,width:line.widthCm==null?'':String(line.widthCm),
   v2ProductId:line.productId??undefined,v2SourceKind:line.source,v2SelectionChanged:false};
  if(type===DocType.SAMPLE)return {...common,composition:line.composition,
   weight:line.weight==null?'':`${line.weight}${line.snapshot?.weightUnit?' '+line.snapshot.weightUnit:''}`,
   width:line.widthCm==null?'':String(line.widthCm)};
  if(type===DocType.SALES)return {...common,rollNo:line.pieceMeters?.join(', ')??'',
   width:line.widthCm==null?'':String(line.widthCm),deductionMeters:line.deductionMeters};
  return common;
 });
 const deposit=type===DocType.SAMPLE?0:order.deposit??0,total=order.totalAmount??0;
 return {id:order.id,docNo:order.orderNo,type,date:order.date,customerName:order.receivingUnit,
  items,styleNo:order.styleNo??'',issuer:order.issuer??'',receiver:order.receiver??'',
  receiverAddress:order.receiverAddress??'',bottomPhone:order.receiverPhone??'',settled:type===DocType.DEPOSIT?false:order.settled??false,
  companyName:profile.name,companyAddress:profile.address,
  companyPhone:profile.phone,terms:type===DocType.DEPOSIT?profile.depositTerms:profile.defaultTerms,
  deposit,totalMeters:order.totalMeters,totalRolls:type===DocType.DEPOSIT?0:type===DocType.SAMPLE?items.length:order.totalPieces,totalAmount:total,
  receivableAmount:calculateDocumentPayment(order.type,total,deposit).receivableAmount,
  deductionMeters:order.deductionMeters,createdAt:'',updatedAt:''};
}

type DraftItem=DocItem &{
 v2ProductId?:string;v2SourceKind?:'catalog'|'manual'|null;v2SelectionChanged?:boolean;
};
type Fields={meters:number;unitPrice:number;remark:string;deductionMeters?:number;pieceMeters?:number[]|null};
type Source={selection?:{productId:string};manual?:{
 productNo:string;productName:string;composition?:string;weight?:number;width?:number;colorNo?:string
}};
type LinePayload={id?:string;fields:Fields}&Source;
type Role='admin'|'sales';
const isId=(v:unknown):v is string=>typeof v==='string'&&/^[1-9][0-9]*$/.test(v);
const stableLineId=(v:unknown):v is string=>isId(v)&&Number(v)<=2147483647;
function rollValues(text:string):number[]|null {
 if(!text.trim())return null;
 const tokens=text.trim().split(/[,，\s]+/);
 if(tokens.some(token=>!/^(0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(token)||
  !Number.isFinite(Number(token))||Number(token)<=0))
  throw new V2DraftMappingError('各匹米数须大于0，最多两位小数');
 return tokens.map(Number);
}
function numericMeasurement(raw:string):number|undefined{
 if(!raw.trim())return undefined;
 const match=/^(\d+(?:\.\d{1,2})?)(?:\s*(?:gsm|mm))?$/i.exec(raw.trim());
 if(!match)throw new V2DraftMappingError('Invalid manual measurement');
 return Number(match[1]);
}
function lineBody(docType:DocType,item:DocItem,role:Role,create:boolean):LinePayload{
 const draft=item as DraftItem;
 const existing=stableLineId(item.id);
 const isNew=create||!existing;
 const fields:Fields={meters:item.meters,unitPrice:item.price,remark:item.remark??''};
 if(docType===DocType.SALES){
  const sale=item as Extract<DocItem,{rollNo:string}>;
  fields.deductionMeters=sale.deductionMeters??0;
  fields.pieceMeters=rollValues(sale.rollNo??'');
 }
 const result:LinePayload={...(isNew?{}:{id:item.id}),fields};
 const shouldSelect=isNew||draft.v2SelectionChanged===true;
 if(shouldSelect){
  if(draft.v2SourceKind==='catalog'&&isId(draft.v2ProductId)){
   result.selection={productId:draft.v2ProductId};
  }else if(draft.v2SourceKind==='manual'&&role==='admin'){
   const sample=item as DocItem & {composition?:string;weight?:string;width?:string};
   result.manual={productNo:item.itemNo,productName:item.productName,
    composition:sample.composition??'',colorNo:item.colorNo??'',
    ...(sample.weight?{weight:numericMeasurement(sample.weight)}:{}),
    ...(sample.width?{width:numericMeasurement(sample.width)}:{})};
  }else {
   throw new V2DraftMappingError('New or replaced line needs a valid catalog selection or explicit admin manual mode');
  }
 }
 // Historical unlinked numeric ID with no selection is preserved untouched.
 return result;
}
function displayHeader(document:DocumentData){
 return {
  styleNo:document.styleNo??'',issuer:document.issuer??'',receiver:document.receiver??'',
  receiverPhone:document.bottomPhone??'',receiverAddress:document.receiverAddress??'',
  settled:document.type===DocType.DEPOSIT?false:document.settled??false,displaySnapshot:{
   companyName:document.companyName??'',companyAddress:document.companyAddress??'',
   companyPhone:document.companyPhone??'',terms:document.terms??''
  }
 };
}

export function toV2CreatePayload(document:DocumentData,role:Role){
 return {
  orderNo:document.docNo,date:document.date,receivingUnit:document.customerName,
  type:document.type===DocType.SALES?'bulk':document.type,
  deposit:document.type===DocType.SAMPLE?0:document.deposit??0,...displayHeader(document),
  items:document.items.map(i=>lineBody(document.type,i,role,true))
 };
}
export function toV2EditPayload(document:DocumentData,role:Role,removeIds:string[]):EditDocument{
 if(!Array.isArray(removeIds)||removeIds.some(id=>!stableLineId(id)))
  throw new V2DraftMappingError('Invalid removal IDs');
 const {displaySnapshot:_historicalDisplay,...header}=displayHeader(document),{settled,...withoutSettlement}=header;
 return {
  ...(document.type===DocType.SAMPLE?{}:{deposit:document.deposit??0}),
  ...(document.type===DocType.DEPOSIT?withoutSettlement:header),
  orderNo:document.docNo,date:document.date,receivingUnit:document.customerName,
  items:document.items.map(i=>lineBody(document.type,i,role,false)),
  removeIds
 };
}
