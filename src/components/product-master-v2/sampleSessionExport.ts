import type {SampleSessionSummary} from './sampleOperationsModel';
import {SelectionHttpError} from './sampleSelectionClient';
const xlsxMime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const sampleBatchLimit=50;
export function formatSampleSessionDate(session:{createdAt?:string;createdOn?:string}):string{
 if(!session.createdAt)return session.createdOn??'日期未记录';
 const date=new Date(session.createdAt);if(!Number.isFinite(date.getTime()))return session.createdOn??'日期未记录';
 const parts=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
 const get=(key:string)=>parts.find(p=>p.type===key)?.value??'';
 return get('year')+'-'+get('month')+'-'+get('day');
}
export async function downloadSessionCards(apiFetch:typeof fetch,session:SampleSessionSummary,signal?:AbortSignal){
 if(!/^[1-9]\d{0,19}$/.test(session.id))throw Error('选样单无效');
 const response=await apiFetch('/api/v2/customer-samples/sessions/'+session.id+'/cards/export.xlsx',{cache:'no-store',signal,headers:{Accept:xlsxMime}});
 if(!response.ok)throw new SelectionHttpError(response.status);
 const blob=await readWorkbook(response);
 const name=session.customerReference.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,80)||'客户';
 const stamp=formatSampleSessionDate(session).replaceAll('-','').replace(' ','_').replace(':','');
 return {blob,filename:name+'_'+stamp+'_色卡.xlsx'};
}

async function readWorkbook(response:Response){
 if(!response.headers.get('Content-Type')?.includes(xlsxMime))throw Error('导出文件格式错误，请重试');
 const blob=await response.blob();if(!blob.size)throw Error('导出文件为空，请重试');
 return blob;
}
export class SampleBatchBlocked extends Error{
 constructor(readonly sessionId:string,readonly reason:'empty'|'review'){super('Selection blocks batch export');}
}
export async function downloadBatchSessionCards(apiFetch:typeof fetch,sessionIds:string[],signal?:AbortSignal){
 const response=await apiFetch('/api/v2/customer-samples/sessions/cards/batch-export.xlsx',{
  method:'POST',cache:'no-store',signal,headers:{Accept:xlsxMime,'Content-Type':'application/json'},body:JSON.stringify({sessionIds}),
 });
 if(response.status===409){
  const data=await response.json().catch(()=>null);
  if(data?.error==='BATCH_SELECTION_BLOCKED'&&sessionIds.includes(data.sessionId)&&(data.reason==='empty'||data.reason==='review'))throw new SampleBatchBlocked(data.sessionId,data.reason);
 }
 if(!response.ok)throw new SelectionHttpError(response.status);
 return {blob:await readWorkbook(response),filename:'客户选样汇总_'+formatSampleSessionDate({createdAt:new Date().toISOString()})+'.xlsx'};
}
