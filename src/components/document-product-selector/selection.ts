import {DocType,type DocItem,type SampleItem,type SalesItem} from '../../types';

export interface PickerProduct{
 id:string;productNo:string;fabricName:string;masterNo:string;colorwayNo:number;
 composition:string|null;weight:number|null;weightUnit:'gsm'|'mm'|null;widthCm:number|null;
 patternImageAssetId:string|null;thumbnailUrl:string|null;
}
export interface PickerPage{items:PickerProduct[];total:number;limit:number;offset:number}
export interface ProductSelectorFilters{productNo:string;fabricName:string;limit:number;offset:number}
export type PickerDraftItem=DocItem&{v2ProductId:string;v2SourceKind:'catalog';v2SelectionChanged:true};
/**
 * Draft-only selection; never writes a document or alters its business inputs.
 * V2 save DTO must serialize v2ProductId as selection.productId; legacy
 * mapDocToBackendPayload explicitly does NOT know this association yet.
 */
export function applySelectedProductToDraft(type:DocType,old:DocItem,product:PickerProduct):PickerDraftItem{
 const common={...old,itemNo:product.productNo,colorNo:String(product.colorwayNo),
  productName:product.fabricName,v2ProductId:product.id,v2SourceKind:'catalog' as const,v2SelectionChanged:true as const};
 if(type===DocType.SAMPLE)return {...common,
   composition:product.composition??'',weight:product.weight==null?'':`${product.weight} ${product.weightUnit??''}`.trim(),
   width:product.widthCm==null?'':String(product.widthCm)} as SampleItem&PickerDraftItem;
 if(type===DocType.SALES)return {...common,
   width:product.widthCm==null?'':String(product.widthCm)} as SalesItem&PickerDraftItem;
 if(type===DocType.DEPOSIT)return common;
 throw Error('Unsupported document category');
}
export function buildProductSelectorUrl(base:string,filters:ProductSelectorFilters):string{
 const params=new URLSearchParams();
 if(filters.productNo.trim())params.set('productNo',filters.productNo.trim());
 if(filters.fabricName.trim())params.set('fabricName',filters.fabricName.trim());
 params.set('limit',String(filters.limit));params.set('offset',String(filters.offset));
 return base+'?'+params.toString();
}
function asRecord(v:unknown):Record<string,unknown>{
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid selector response');
 return v as Record<string,unknown>;
}
function str(v:unknown):v is string{return typeof v==='string';}
function nOrNull(v:unknown):boolean{return v===null || typeof v==='number'&&Number.isFinite(v);}
export function validateProductSelectorPage(value:unknown):PickerPage {
 const v=asRecord(value);
 if(!Array.isArray(v.items)||!Number.isSafeInteger(v.total)||Number(v.total)<0||
 !Number.isSafeInteger(v.limit)||Number(v.limit)<1||Number(v.limit)>50||
 !Number.isSafeInteger(v.offset)||Number(v.offset)<0||v.items.length>Number(v.limit))
  throw Error('Invalid product selector page');
 for(const raw of v.items){
  const p=asRecord(raw);
  if(!str(p.id)||!/^[1-9][0-9]*$/.test(p.id)||
   !str(p.productNo)||!str(p.fabricName)||!str(p.masterNo)||
   !Number.isSafeInteger(p.colorwayNo)||Number(p.colorwayNo)<1||
   !(p.composition===null||str(p.composition))||!nOrNull(p.weight)||
   ![null,'gsm','mm'].includes(p.weightUnit as string|null)||
   !nOrNull(p.widthCm)||!(p.patternImageAssetId===null||str(p.patternImageAssetId))||
   !(p.thumbnailUrl===null||(str(p.thumbnailUrl)&&/^https:\/\/[^\s]+$/.test(p.thumbnailUrl)))){
    throw Error('Invalid selectable product');
   }
 }
 return v as unknown as PickerPage;
}
