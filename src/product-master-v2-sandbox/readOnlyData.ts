/** Read-only V2 sandbox catalog adapters. No DB driver, mock data or mutation.
 * These models are used ONLY by the separate localhost sandbox, not legacy App.
 */
import {fetchSampleCardPage,type SampleCardPage} from '../components/product-master-v2/sampleCardModel';

const record=(x:unknown):x is Record<string,unknown>=>typeof x==='object'&&x!==null&&!Array.isArray(x);
const ident=(x:unknown):x is string=>typeof x==='string'&&/^[1-9][0-9]{0,19}$/.test(x)&&BigInt(x)<=18446744073709551615n;
const count=(x:unknown,max=1000000):x is number=>Number.isSafeInteger(x)&&Number(x)>=0&&Number(x)<=max;
const text=(x:unknown,max=160):x is string=>typeof x==='string'&&x.length<=max;
const err=()=>new Error('V2 sandbox selection data format invalid');
export interface SandboxSampleSessionPage {
 session:{id:string;customerReference:string;status:'open'|'closed'};
 total:number;selectedCardCount:number;limit:number;offset:number;
 items:{id:string;productId:string;current:{
  productNo:string;patternNo:string;colorwayNo:number;fabricNo:string;fabricName:string;
  composition:string|null;weightValue:string|null;weightUnit:'gsm'|'mm'|null;widthCm:string|null;
 };sources:{cardId:string;cardNo:string;retired:boolean;firstScanEventId:string|null;firstManualEventId?:string}[]}[];
}
function numberText(x:unknown):x is string {
 return typeof x==='string'&&/^(?:[0-9]+)(?:\.[0-9]+)?$/.test(x)&&x.length<28&&Number.isFinite(Number(x));
}
export function parseSandboxSampleSession(raw:unknown,expectedId:string):SandboxSampleSessionPage {
 if(!ident(expectedId)||!record(raw)||!record(raw.session)||
   raw.session.id!==expectedId||!text(raw.session.customerReference)||
   !['open','closed'].includes(String(raw.session.status))||
   !count(raw.total)||!count(raw.selectedCardCount)||
   !count(raw.limit,100)||Number(raw.limit)<1||!count(raw.offset)||!Array.isArray(raw.items)||
   raw.items.length>Number(raw.limit)||raw.items.length>Number(raw.total)-Number(raw.offset))throw err();
 const items=raw.items;
 const seen=new Set<string>();
 for(const value of items){
  if(!record(value)||!ident(value.id)||seen.has(value.id)||!ident(value.productId)||
    !record(value.current)||!Array.isArray(value.sources)||value.sources.length>100)throw err();
  seen.add(value.id);
  const cur=value.current;
  if(!text(cur.productNo)||!cur.productNo||!text(cur.patternNo)||!cur.patternNo||
    !count(cur.colorwayNo,4294967295)||Number(cur.colorwayNo)<1||
    !text(cur.fabricNo)||!cur.fabricNo||!text(cur.fabricName)||!cur.fabricName||
    !(cur.composition===null||text(cur.composition))||
    !(cur.weightValue===null||numberText(cur.weightValue))||
    !(cur.widthCm===null||numberText(cur.widthCm))||
    !(cur.weightUnit===null||cur.weightUnit==='gsm'||cur.weightUnit==='mm')||
    ((cur.weightValue===null)!==(cur.weightUnit===null)))throw err();
  const sources=new Set<string>();
  for(const entry of value.sources){
   if(!record(entry)||!ident(entry.cardId)||sources.has(entry.cardId)||
     !text(entry.cardNo)||!entry.cardNo||typeof entry.retired!=='boolean'||
     !(entry.firstScanEventId===null||ident(entry.firstScanEventId))||
     !(entry.firstManualEventId===undefined||ident(entry.firstManualEventId)))throw err();
   sources.add(entry.cardId);
  }
 }
 return raw as unknown as SandboxSampleSessionPage;
}
export function loadSandboxCards(apiFetch:typeof fetch,query='',offset=0,signal?:AbortSignal):Promise<SampleCardPage>{
 return fetchSampleCardPage(apiFetch,query,offset,50,signal);
}
export async function loadSandboxSampleSession(apiFetch:typeof fetch,sessionId:string,
 offset=0,signal?:AbortSignal):Promise<SandboxSampleSessionPage>{
 if(!ident(sessionId)||!count(offset))throw err();
 const res=await apiFetch('/api/v2/customer-samples/sessions/'+sessionId+'?limit=50&offset='+offset,
  {signal,headers:{Accept:'application/json'},cache:'no-store'});
 if(!res.ok)throw Error('选样清单暂不可用或无查看权限');
 return parseSandboxSampleSession(await res.json(),sessionId);
}
