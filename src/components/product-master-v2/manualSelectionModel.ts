import type {SelectionCard,SelectionCardPage} from '../../../server/customer-samples/sessionCardSearch';
import {SelectionHttpError,selectionAccessRevoked,type SelectionApi} from './sampleSelectionClient';
export type {SelectionCard,SelectionCardPage};
export interface ManualFilters{sessionId:string;query:string;offset:number}
const validId=(x:unknown):x is string=>typeof x==='string'&&/^[1-9]\d{0,19}$/.test(x)&&BigInt(x)<=18446744073709551615n;
/** Search only private session-scoped cards. No product-catalog fallback. */
export async function searchManualCards(apiFetch:typeof fetch,filters:ManualFilters,signal?:AbortSignal):Promise<SelectionCardPage>{
 if(!validId(filters.sessionId)||!Number.isSafeInteger(filters.offset)||filters.offset<0)throw Error('Invalid card search');
 const query=new URLSearchParams({query:filters.query.trim(),limit:'20',offset:String(filters.offset)});
 const response=await apiFetch('/api/v2/customer-samples/sessions/'+filters.sessionId+'/cards?'+query,{signal,cache:'no-store',headers:{Accept:'application/json'}});
 if(!response.ok)throw new SelectionHttpError(response.status);
 const raw=await response.json() as SelectionCardPage;
 if(!raw||!Array.isArray(raw.items)||!Number.isSafeInteger(raw.total)||raw.total<0||raw.limit!==20||raw.offset!==filters.offset||
  new Set(raw.items.map(c=>c?.id)).size!==raw.items.length)throw Error('Invalid card search response');
 for(const card of raw.items){
  if(!card||!validId(card.id)||typeof card.cardNo!=='string'||typeof card.fabricName!=='string'||!Array.isArray(card.products)||!card.products.length||
   new Set(card.products.map(p=>p.id)).size!==card.products.length||card.products.some(p=>!validId(p.id)||typeof p.productNo!=='string'||typeof p.patternNo!=='string'||!p.patternNo||
    !(p.patternImageAssetId===null||typeof p.patternImageAssetId==='string')||!Number.isSafeInteger(p.colorwayNo)||p.colorwayNo<1))throw Error('Invalid card candidate');
 }
 return raw;
}
export function createManualSelectionAction(options:{sessionId:string;isOpen:()=>boolean;addManual:SelectionApi['addManual'];reload:()=>Promise<void>}):
 (card:SelectionCard,productIds?:string[])=>ReturnType<SelectionApi['addManual']>{
 let pending=false;
 return async(card,productIds)=>{
  if(pending)throw Error('正在处理中，请稍候');
  if(!options.isOpen())throw Error('选样单已结束，只能查看');
  if(!validId(card.id)||!card.products.length||productIds!==undefined&&(!productIds.length||new Set(productIds).size!==productIds.length||productIds.some(id=>!card.products.some(p=>p.id===id))))throw Error('请选择该色卡中的有效配色');
  pending=true;
  try{
   const result=await options.addManual(options.sessionId,card.id,productIds);
   try{await options.reload();}catch(error){
    if(selectionAccessRevoked(error))throw error;
    throw Error('补选已处理，但清单刷新失败，请刷新核对');
   }
   return result;
  }finally{pending=false;}
 };
}
