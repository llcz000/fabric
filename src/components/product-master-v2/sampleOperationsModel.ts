import type {SampleSessionSummary,SampleSessionDirectory,SampleShipmentProgress} from '../../../server/customer-samples/sessionDirectory';
import {prepareShipmentBatch} from '../../../server/customer-samples/shipmentBatch';
import {prepareSampleFollowup} from '../../../server/customer-samples/followupDraft';
import {SelectionHttpError} from './sampleSelectionClient';
export type {SampleSessionSummary,SampleSessionDirectory,SampleShipmentProgress};
export type OperationKind='shipments'|'followups';
export interface ShipmentRecord{id:string;actorUserId:string;shippedAt:string;carrier:string|null;trackingNo:string|null;items:{productId:string;quantity:number}[]}
export interface FollowupRecord{id:string;actorUserId:string;contactedOn:string;customerConfirmed:boolean|null;feedback:string|null;outcome:string;nextAction:string|null;nextFollowupOn:string|null;productIds:string[]}
export interface OperationsHistory{sessionId:string;total:number;limit:number;offset:number;items:(ShipmentRecord|FollowupRecord)[]}
const id=(v:unknown):v is string=>typeof v==='string'&&/^[1-9]\d{0,19}$/.test(v)&&BigInt(v)<=18446744073709551615n;
const row=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const count=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const string=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max;
const nullable=(v:unknown,max:number)=>v===null||string(v,max);
const date=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const bad=()=>new Error('选样资料格式无效，请重新读取');
const requiredId=(v:string)=>{if(!id(v))throw bad();return v;};
function summary(value:unknown):SampleSessionSummary{
 if(!row(value)||!id(value.id)||!string(value.customerReference,160)||!value.customerReference.trim()||!['open','closed'].includes(value.status))throw bad();return value as unknown as SampleSessionSummary;
}
function page(value:unknown,offset:number){
 if(!row(value)||!count(value.total)||value.offset!==offset||value.limit!==20||!Array.isArray(value.items)||value.items.length!==Math.min(20,Math.max(0,value.total-offset)))throw bad();
 return value;
}
function progress(value:unknown,sessionId:string):SampleShipmentProgress{
 if(!row(value)||value.sessionId!==sessionId||!['selectedProducts','shippedProducts','pendingProducts','shippedQuantity'].every(k=>count(value[k]))||value.selectedProducts!==value.shippedProducts+value.pendingProducts)throw bad();
 return value as unknown as SampleShipmentProgress;
}
function history(value:unknown,sessionId:string,kind:OperationKind,offset:number):OperationsHistory{
 const data=page(value,offset);if(data.sessionId!==sessionId)throw bad();
 const seen=new Set<string>();
 for(const item of data.items){
  if(!row(item)||!id(item.id)||seen.has(item.id)||!id(item.actorUserId))throw bad();seen.add(item.id);
  if(kind==='shipments'){
   if(!iso(item.shippedAt)||!nullable(item.carrier,160)||!nullable(item.trackingNo,160)||!Array.isArray(item.items)||!item.items.length||item.items.some((x:unknown)=>!row(x)||!id(x.productId)||!count(x.quantity)||x.quantity===0)||new Set(item.items.map((x:{productId:string})=>x.productId)).size!==item.items.length)throw bad();
  }else{
   if(!date(item.contactedOn)||![null,true,false].includes(item.customerConfirmed)||!nullable(item.feedback,2000)||!string(item.outcome,400)||!item.outcome.trim()||!nullable(item.nextAction,400)||!(item.nextFollowupOn===null||date(item.nextFollowupOn)&&item.nextFollowupOn>=item.contactedOn)||!Array.isArray(item.productIds)||!item.productIds.every(id)||new Set(item.productIds).size!==item.productIds.length)throw bad();
  }
 }
 return data as unknown as OperationsHistory;
}
export function createSampleOperationsClient(apiFetch:typeof fetch){
 const base='/api/v2/customer-samples';
 async function request(path:string,init:RequestInit={}){const response=await apiFetch(path,{...init,cache:'no-store',headers:{Accept:'application/json',...(init.body?{'Content-Type':'application/json'}:{}),...init.headers}});if(!response.ok)throw new SelectionHttpError(response.status);return response.json();}
 const endpoint=(sessionId:string)=>base+'/sessions/'+requiredId(sessionId);
 return {
  async directory(query:string,offset=0,signal?:AbortSignal):Promise<SampleSessionDirectory>{
   if(!string(query,160)||!count(offset)||offset>1000000)throw bad();
   const data=page(await request(base+'/sessions?'+new URLSearchParams({query,limit:'20',offset:String(offset)}),{signal}),offset);
   const items=data.items.map(summary);if(new Set(items.map((x:SampleSessionSummary)=>x.id)).size!==items.length)throw bad();return {...data,items} as SampleSessionDirectory;
  },
  async create(customerReference:string,signal?:AbortSignal){return summary(await request(base+'/sessions',{method:'POST',body:JSON.stringify({customerReference}),signal}));},
  async progress(sessionId:string,signal?:AbortSignal){return progress(await request(endpoint(sessionId)+'/progress',{signal}),sessionId);},
  async history(sessionId:string,kind:OperationKind,offset:number,signal?:AbortSignal){if(!['shipments','followups'].includes(kind)||!count(offset)||offset>1000000)throw bad();return history(await request(endpoint(sessionId)+'/'+kind+'?limit=20&offset='+offset,{signal}),sessionId,kind,offset);},
  async save(sessionId:string,kind:OperationKind,input:unknown,signal?:AbortSignal){
   if(!['shipments','followups'].includes(kind)||!row(input)||input.sessionId!==sessionId)throw bad();
   const data=await request(endpoint(sessionId)+'/'+kind,{method:'POST',body:JSON.stringify(input),signal});
   if(!row(data)||!id(data.id)||data.sessionId!==sessionId)throw bad();return data;
  },
  async scan(sessionId:string,cardToken:string,signal?:AbortSignal){
   requiredId(sessionId);if(!/^[A-Za-z0-9_-]{22,128}$/.test(cardToken))throw Error('请扫描或输入色卡原始编码');
   const data=await request('/api/v2/sample-cards/scan',{method:'POST',body:JSON.stringify({sessionId,cardToken}),signal});
   if(!row(data)||!id(data.cardId)||!Array.isArray(data.addedProductIds)||!data.addedProductIds.every(id))throw bad();return data;
  }
 };
}
const selected=(productIds:string[])=>productIds.map((productId,index)=>({itemId:String(index+1),productId,removedAt:null}));
export function shipmentInput(sessionId:string,time:string,carrier:string,trackingNo:string,quantities:Record<string,string>,productIds:string[]){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(time)||!date(time.slice(0,10))||!Number.isFinite(new Date(time).getTime()))throw Error('请填写有效寄样时间');
 const items=Object.entries(quantities).filter(([,v])=>v!=='').map(([productId,value])=>{
  if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('寄样数量须为正整数');return {productId,quantity:Number(value)};
 });
 const prepared=prepareShipmentBatch({sessionId,shippedAt:new Date(time).toISOString(),carrier:carrier.trim()||null,trackingNo:trackingNo.trim()||null,items},selected(productIds),{sessionId});
 return {...prepared,items:prepared.items.map(({productId,quantity})=>({productId,quantity}))};
}
export interface FollowupForm{contactedOn:string;customerConfirmed:string;feedback:string;outcome:string;nextAction:string;nextFollowupOn:string;productIds:string[]}
export function followupInput(sessionId:string,form:FollowupForm,productIds:string[]){
 if(!['unknown','yes','no'].includes(form.customerConfirmed))throw bad();
 return prepareSampleFollowup({sessionId,contactedOn:form.contactedOn,customerConfirmed:form.customerConfirmed==='unknown'?null:form.customerConfirmed==='yes',feedback:form.feedback.trim()||null,outcome:form.outcome.trim(),nextAction:form.nextAction.trim()||null,nextFollowupOn:form.nextFollowupOn||null,productIds:form.productIds},selected(productIds),{sessionId});
}
