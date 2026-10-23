export interface DocumentSearchFilters{
 customer:string;productNo:string;colorNo:string;productName:string;
 type:''|'sample'|'bulk'|'deposit';from:string;to:string;settled:''|'true'|'false';
}
export const emptySearchFilters=():DocumentSearchFilters=>({customer:'',productNo:'',colorNo:'',productName:'',type:'',from:'',to:'',settled:''});
export interface DocumentSummary{
 id:string;orderNo:string;date:string;receivingUnit:string;type:'sample'|'bulk'|'deposit';
 totalMeters:number;totalPieces:number;totalAmount:number;settled:boolean;
}
export interface DocumentPage{total:number;limit:number;offset:number;items:DocumentSummary[]}
export interface MatchingTotals{matchingLineCount:number;metersTotal:number;amountTotal:number;piecesTotal:number}
export interface MatchingItem{id:string;productNo:string;colorNo:string;productName:string;meters:number;pieces:number;amount:number}
export interface MatchingPage{orderId:string;total:number;limit:number;offset:number;items:MatchingItem[]}
export interface DocumentSearchState{loading:boolean;error:string;page:DocumentPage|null;totals:MatchingTotals|null}
export class DocumentQueryError extends Error{constructor(message:string,readonly status=0){super(message);}}
export function documentResourceUrl(documentId?:string):string{
 if(documentId!==undefined&&!/^[1-9]\d{0,19}$/.test(documentId))throw Error('单据标识不正确');
 return '/api/v2/documents'+(documentId?'/'+documentId:'');
}
export function documentSearchParams(filters:DocumentSearchFilters,offset=0,limit=20):URLSearchParams{
 if(!Number.isSafeInteger(offset)||offset<0||offset>1000000||![20,50].includes(limit))throw Error('分页参数不正确');
 const params=new URLSearchParams();
 for(const key of ['customer','productNo','colorNo','productName'] as const){
  const value=filters[key].trim();
  if([...value].length>100||/[\p{Cc}\p{Cf}]/u.test(value))throw Error('筛选内容过长或含非法字符');
  if(value)params.set(key,value);
 }
 if(filters.type){if(!['sample','bulk','deposit'].includes(filters.type))throw Error('单据类型不正确');params.set('type',filters.type);}
 for(const key of ['from','to'] as const){
  const value=filters[key];if(!value)continue;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)
   throw Error('请填写有效日期');
  params.set(key,value);
 }
 if(filters.from&&filters.to&&filters.from>filters.to)throw Error('起始日期不能晚于截止日期');
 if(filters.type!=='deposit'&&filters.settled){
  if(!['true','false'].includes(filters.settled))throw Error('结清状态不正确');params.set('settled',filters.settled);
 }
 params.set('limit',String(limit));params.set('offset',String(offset));return params;
}
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const id=(value:unknown):value is string=>typeof value==='string'&&/^[1-9]\d{0,19}$/.test(value);
const row=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
const pageShape=(v:unknown):v is Record<string,unknown>&{total:number;limit:number;offset:number;items:unknown[]}=>
 row(v)&&Number.isSafeInteger(v.total)&&Number(v.total)>=0&&Number.isSafeInteger(v.limit)&&Number(v.limit)>0&&Number(v.limit)<=50&&
 Number.isSafeInteger(v.offset)&&Number(v.offset)>=0&&Array.isArray(v.items)&&v.items.length<=Number(v.limit);
function parsePage(value:unknown):DocumentPage{
 if(!pageShape(value)||value.items.some(v=>!row(v)||!id(v.id)||typeof v.orderNo!=='string'||typeof v.date!=='string'||
  typeof v.receivingUnit!=='string'||!['sample','bulk','deposit'].includes(String(v.type))||
  !finite(v.totalMeters)||!finite(v.totalPieces)||!finite(v.totalAmount)||typeof v.settled!=='boolean'))throw Error('单据列表数据不完整，请重试');
 return value as unknown as DocumentPage;
}
function parseTotals(value:unknown):MatchingTotals{
 if(!row(value)||['matchingLineCount','metersTotal','amountTotal','piecesTotal'].some(k=>!finite(value[k])))throw Error('命中明细合计数据不完整，请重试');
 return value as unknown as MatchingTotals;
}
async function readJson(apiFetch:typeof fetch,url:string,signal:AbortSignal):Promise<unknown>{
 const response=await apiFetch(url,{signal,headers:{Accept:'application/json'},cache:'no-store'});
 if(!response.ok)throw new DocumentQueryError(response.status===401?'登录已失效，请重新登录':
  response.status===403?'当前账号没有查看权限':response.status===404?'单据不存在或已不符合当前筛选':'查询失败，请重试',response.status);
 return response.json();
}
export function createDocumentSearchController(apiFetch:typeof fetch,onState:(state:DocumentSearchState)=>void){
 let generation=0,disposed=false,abort:AbortController|null=null;
 const clear=(error='',loading=false)=>onState({loading,error,page:null,totals:null});
 return {
  async search(filters:DocumentSearchFilters,offset=0,limit=20){
   if(disposed)return;
   const ticket=++generation;abort?.abort();const controller=new AbortController();abort=controller;clear('',true);
   try{
    const query=documentSearchParams(filters,offset,limit).toString();
    const [page,totals]=await Promise.all([
     readJson(apiFetch,'/api/v2/documents?'+query,controller.signal).then(parsePage),
     readJson(apiFetch,'/api/v2/documents/matching-totals?'+query,controller.signal).then(parseTotals)
    ]);
    if(!disposed&&ticket===generation)onState({loading:false,error:'',page,totals});
   }catch(error){
    if(!disposed&&ticket===generation){controller.abort();clear(error instanceof Error?error.message:'查询失败，请重试');}
   }
  },
  revoke(message:string){++generation;abort?.abort();if(!disposed)clear(message);},
  dispose(){disposed=true;++generation;abort?.abort();}
 };
}
export async function loadMatchingItems(apiFetch:typeof fetch,orderId:string,filters:DocumentSearchFilters,offset:number,signal:AbortSignal):Promise<MatchingPage>{
 if(!id(orderId))throw Error('单据标识不正确');
 const result=await readJson(apiFetch,'/api/v2/documents/'+orderId+'/matching-items?'+documentSearchParams(filters,offset),signal);
 if(!pageShape(result)||result.orderId!==orderId||result.items.some(v=>!row(v)||!id(v.id)||
  ['productNo','colorNo','productName'].some(k=>typeof v[k]!=='string')||
  ['meters','pieces','amount'].some(k=>!finite(v[k]))))throw Error('命中明细数据不完整，请重试');
 return result as unknown as MatchingPage;
}
