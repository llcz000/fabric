import type {SampleSessionPage} from '../../../server/customer-samples/sessionRead';
import type {ManualSelectionResult} from '../../../server/customer-samples/sessionManual';

/** Caller must supply the authenticated V2 fetch; never store or append raw bearer tokens. */
export interface SelectionApi {
 load:(sessionId:string,limit:number,offset:number,signal?:AbortSignal)=>Promise<SampleSessionPage>;
 remove:(sessionId:string,itemId:string)=>Promise<void>;
 removeItems?:(sessionId:string,itemIds:string[])=>Promise<{removedCount:number}>;
 removeCards?:(sessionId:string,cardIds:string[])=>Promise<{removedCount:number}>;
 addManual:(sessionId:string,cardId:string,productIds?:string[])=>Promise<ManualSelectionResult>;
}
export class SelectionHttpError extends Error {
 constructor(readonly status:number){super('Selection unavailable');this.name='SelectionHttpError';}
}
/** Optional wiring adapter for a caller-owned V2 login session. Reads the current
 * token per request; never reads legacy storage, creates accounts or stores credentials.
 * Accepts root-relative V2 paths only, so the session cannot accompany a public URL.
 */
export function createV2SelectionFetch(transport:typeof fetch,readSession:()=>string|null):typeof fetch{
 return async(input,init)=>{
  if(typeof input!=='string'||!input.startsWith('/api/v2/')||/[\\\u0000-\u0020\u007f]/u.test(input)||
   !new URL(input,'http://v2.local').pathname.startsWith('/api/v2/'))throw Error('Expected private V2 path');
  const token=readSession();
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw new SelectionHttpError(401);
  const headers=new Headers(init?.headers);headers.set('Authorization','Bearer '+token);
  return transport(input,{...init,headers,cache:'no-store',credentials:'omit',redirect:'error'});
 };
}
/** Never retain cached customer records after login, grant or session loss. */
export function selectionAccessRevoked(error:unknown):boolean{
 const status=(error as {status?:unknown})?.status;
 return status===401||status===403||status===404;
}
const validId=(id:string)=>/^[1-9]\d{0,19}$/.test(id)&&BigInt(id)<=18446744073709551615n;
const requireId=(id:string)=>{if(!validId(id))throw Error('Invalid selection identity');return id;};
function pageOf(raw:unknown,sessionId:string):SampleSessionPage{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid selection response');
 const o=raw as Partial<SampleSessionPage>,session=o.session;
 if(!session||session.id!==sessionId||(session.status!=='open'&&session.status!=='closed')||
  typeof session.customerReference!=='string'||!Array.isArray(o.items)||
  !Number.isSafeInteger(o.total)||Number(o.total)<0||
  !Number.isSafeInteger(o.offset)||!Number.isSafeInteger(o.limit)||
  !Number.isSafeInteger(o.selectedCardCount))throw Error('Invalid selection response');
 for(const item of o.items){
  if(!item||typeof item.id!=='string'||!validId(item.id)||!validId(item.productId)||
   !item.current||typeof item.current.productNo!=='string'||typeof item.current.fabricName!=='string'||
   !Array.isArray(item.sources)||item.sources.some(s=>!s||!validId(s.cardId)||typeof s.cardNo!=='string'||
    typeof s.retired!=='boolean'||(s.firstScanEventId===null?!s.firstManualEventId||!validId(s.firstManualEventId):!validId(s.firstScanEventId))))
   throw Error('Invalid selection item');
 }
 return o as SampleSessionPage;
}
export function createSampleSelectionClient(
 authenticatedFetch:(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>,
 base='/api/v2/customer-samples'
):SelectionApi{
 if(!base.startsWith('/')||base.startsWith('//'))throw Error('Invalid private API base');
 const endpoint=(sessionId:string)=>base+'/sessions/'+requireId(sessionId);
 return {
  async removeItems(sessionId,itemIds){
   if(!Array.isArray(itemIds)||!itemIds.length||itemIds.length>1000||!itemIds.every(validId)||new Set(itemIds).size!==itemIds.length)throw Error('Invalid item selection');
   const response=await authenticatedFetch(endpoint(sessionId)+'/items/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({itemIds}),cache:'no-store'});
   if(!response.ok)throw new SelectionHttpError(response.status);const result=await response.json();
   if(result.sessionId!==sessionId||result.removedCount!==itemIds.length)throw Error('Invalid removal response');return result;
  },
  async removeCards(sessionId,cardIds){
   if(!Array.isArray(cardIds)||!cardIds.length||cardIds.length>1000||!cardIds.every(validId)||new Set(cardIds).size!==cardIds.length)throw Error('Invalid card selection');
   const response=await authenticatedFetch(endpoint(sessionId)+'/cards/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cardIds}),cache:'no-store'});
   if(!response.ok)throw new SelectionHttpError(response.status);const result=await response.json();
   if(result.sessionId!==sessionId||!Number.isSafeInteger(result.removedCount)||result.removedCount<0)throw Error('Invalid removal response');return result;
  },
  async load(sessionId,limit,offset,signal){
   if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid pagination');
   const url=endpoint(sessionId)+'?limit='+limit+'&offset='+offset;
   const response=await authenticatedFetch(url,{method:'GET',headers:{Accept:'application/json'},cache:'no-store',signal});
   if(!response.ok)throw new SelectionHttpError(response.status);
   return pageOf(await response.json(),sessionId);
  },
  async remove(sessionId,itemId){
   const url=endpoint(sessionId)+'/items/'+requireId(itemId);
   const response=await authenticatedFetch(url,{method:'DELETE',headers:{Accept:'application/json'},cache:'no-store'});
   if(!response.ok)throw new SelectionHttpError(response.status);
  },
  async addManual(sessionId,cardId,productIds){
   const url=endpoint(sessionId)+'/items/manual',id=requireId(cardId);
   if(productIds!==undefined&&(!Array.isArray(productIds)||!productIds.length||productIds.some(p=>!validId(p))||new Set(productIds).size!==productIds.length))throw Error('Invalid card subset');
   const response=await authenticatedFetch(url,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},
    cache:'no-store',body:JSON.stringify({cardId:id,...(productIds===undefined?{}:{productIds})})});
   if(!response.ok)throw new SelectionHttpError(response.status);
   const value:unknown=await response.json();
   if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid manual selection response');
   const item=value as Partial<ManualSelectionResult>;
   if(item.sessionId!==sessionId||item.cardId!==id||!Array.isArray(item.items)||!item.items.length||
    new Set(item.items.map(x=>x.productId)).size!==item.items.length||
    item.items.some(x=>!validId(x.productId)||!validId(x.itemId)||!['added','restored','already_selected'].includes(x.action))||
    productIds!==undefined&&(item.items.length!==productIds.length||item.items.some(x=>!productIds.includes(x.productId))))throw Error('Invalid manual selection response');
   return item as ManualSelectionResult;
  }
 };
}
