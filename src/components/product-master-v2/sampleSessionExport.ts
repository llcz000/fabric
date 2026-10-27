import type {SampleSessionSummary} from './sampleOperationsModel';
import {SelectionHttpError} from './sampleSelectionClient';
export function formatSampleSessionDate(session:{createdAt?:string;createdOn?:string}):string{
 if(!session.createdAt)return session.createdOn??'日期未记录';
 const date=new Date(session.createdAt);if(!Number.isFinite(date.getTime()))return session.createdOn??'日期未记录';
 const parts=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
 const get=(key:string)=>parts.find(p=>p.type===key)?.value??'';
 return get('year')+'-'+get('month')+'-'+get('day');
}
export async function downloadSessionCards(apiFetch:typeof fetch,session:SampleSessionSummary,signal?:AbortSignal){
 if(!/^[1-9]\d{0,19}$/.test(session.id))throw Error('选样单无效');
 const response=await apiFetch('/api/v2/customer-samples/sessions/'+session.id+'/cards/export.xlsx',{cache:'no-store',signal,headers:{Accept:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
 if(!response.ok)throw new SelectionHttpError(response.status);
 if(!response.headers.get('Content-Type')?.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))throw Error('导出文件格式错误，请重试');
 const blob=await response.blob();if(!blob.size)throw Error('导出文件为空，请重试');
 const name=session.customerReference.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,80)||'客户';
 const stamp=formatSampleSessionDate(session).replaceAll('-','').replace(' ','_').replace(':','');
 return {blob,filename:name+'_'+stamp+'_色卡.xlsx'};
}
