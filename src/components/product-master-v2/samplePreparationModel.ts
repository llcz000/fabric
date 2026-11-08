import type {PreparationSummary} from '../../../server/customer-samples/sessionPreparation';
import {SelectionHttpError} from './sampleSelectionClient';
import {SampleBatchBlocked,sampleBatchLimit} from './sampleSessionExport';
const id=(v:unknown):v is string=>typeof v==='string'&&/^[1-9]\d{0,19}$/.test(v)&&BigInt(v)<=18446744073709551615n;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const label=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
export async function fetchPreparationSummary(apiFetch:typeof fetch,sessionIds:string[],signal:AbortSignal):Promise<PreparationSummary>{
 if(!sessionIds.length||sessionIds.length>sampleBatchLimit||!sessionIds.every(id)||new Set(sessionIds).size!==sessionIds.length)throw Error('请选择有效选样单');
 const response=await apiFetch('/api/v2/customer-samples/sessions/preparation',{method:'POST',cache:'no-store',signal,headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({sessionIds})});
 if(response.status===409){const data=await response.json().catch(()=>null);if(data?.error==='BATCH_SELECTION_BLOCKED'&&sessionIds.includes(data.sessionId)&&['empty','review'].includes(data.reason))throw new SampleBatchBlocked(data.sessionId,data.reason);}
 if(!response.ok)throw new SelectionHttpError(response.status);
 const data:unknown=await response.json(),keys=new Set<string>();
 if(!record(data)||!Array.isArray(data.rows))throw Error('汇总数据异常');
 for(const row of data.rows){
  if(!record(row)||!id(row.productId)||!id(row.cardId)||!label(row.cardNo)||!label(row.patternNo)||!(row.patternImageAssetId===null||typeof row.patternImageAssetId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(row.patternImageAssetId))||!Number.isSafeInteger(row.quantity)||Number(row.quantity)<1||!Array.isArray(row.recipients)||row.recipients.length!==row.quantity||row.recipients.some(p=>!record(p)||!label(p.customerName)||!(p.contactName===null||label(p.contactName))))throw Error('汇总数据异常');
  const key=row.cardId+':'+row.productId;if(keys.has(key))throw Error('汇总数据重复');keys.add(key);
 }
 return data as unknown as PreparationSummary;
}
