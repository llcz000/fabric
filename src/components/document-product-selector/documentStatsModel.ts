/** Server-only V2 statistics projection; owner and role are resolved by authenticated middleware. */
export interface DocumentStatsTotals {
 orderCount:number;metersTotal:number;amountTotal:number;
 pendingAmount:number;pendingCount:number;
 byType:{sample:{count:number;meters:number;amount:number};bulk:{count:number;meters:number;amount:number};deposit:{count:number;meters:number;contractAmount:number}};
}
export interface DocumentStatsData extends DocumentStatsTotals{
 topProducts:{productName:string;meters:number}[];
 recentOrders:{id:string;orderNo:string;date:string;receivingUnit:string;type:'sample'|'bulk'|'deposit';totalMeters:number;totalAmount:number}[];
 /** 环比基期（同一口径的上一等长区间）。无基期时为 null。 */
 compare:DocumentStatsTotals|null;
}
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const amount=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const count=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0;
const ident=(value:unknown)=>typeof value==='string'&&/^[1-9]\d{0,19}$/.test(value);
const text=(value:unknown)=>typeof value==='string'&&value.length<=200;
const date=(value:string)=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const time=Date.parse(value);
 return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
};
export function buildStatsUrl(from='',to='',compareFrom='',compareTo=''):string{
 if((from&&!date(from))||(to&&!date(to))||(from&&to&&from>to))throw Error('统计日期范围不正确');
 if((compareFrom&&!date(compareFrom))||(compareTo&&!date(compareTo))||(compareFrom&&compareTo&&compareFrom>compareTo))
  throw Error('统计对比区间不正确');
 const query=new URLSearchParams();
 if(from)query.set('from',from);
 if(to)query.set('to',to);
 if(compareFrom)query.set('compareFrom',compareFrom);
 if(compareTo)query.set('compareTo',compareTo);
 return '/api/v2/documents/stats'+(query.size?'?'+query.toString():'');
}
function parseTotals(value:unknown,label:string):DocumentStatsTotals{
 if(!record(value)||!count(value.orderCount)||!amount(value.metersTotal)||!amount(value.amountTotal)||
  !amount(value.pendingAmount)||!count(value.pendingCount)||!record(value.byType))
  throw Error('统计'+label+'数据不正确');
 for(const type of ['sample','bulk','deposit']){
  const group=value.byType[type];
  if(!record(group)||!count(group.count)||!amount(group.meters)||
   !amount(type==='deposit'?group.contractAmount:group.amount))throw Error('统计'+label+'分类金额不正确');
 }
 return value as unknown as DocumentStatsTotals;
}
export function parseDocumentStats(value:unknown):DocumentStatsData{
 if(!record(value)||!Array.isArray(value.topProducts)||value.topProducts.length>5||
  !Array.isArray(value.recentOrders)||value.recentOrders.length>4)throw Error('统计数据格式不正确');
 const totals=parseTotals(value,'总量');
 for(const item of value.topProducts){
  if(!record(item)||!text(item.productName)||!item.productName||!amount(item.meters))throw Error('统计排名数据不正确');
 }
 for(const item of value.recentOrders){
  if(!record(item)||!ident(item.id)||!text(item.orderNo)||!text(item.receivingUnit)||
   typeof item.date!=='string'||!date(item.date)||!['sample','bulk','deposit'].includes(String(item.type))||
   !amount(item.totalMeters)||!amount(item.totalAmount))throw Error('统计最近单据数据不正确');
 }
 const compare=value.compare===null||value.compare===undefined?null:parseTotals(value.compare,'对比');
 return {...totals,topProducts:value.topProducts as DocumentStatsData['topProducts'],
  recentOrders:value.recentOrders as DocumentStatsData['recentOrders'],compare};
}
export async function loadDocumentStats(apiFetch:typeof fetch,from='',to='',signal?:AbortSignal,compareFrom='',compareTo=''):Promise<DocumentStatsData>{
 const response=await apiFetch(buildStatsUrl(from,to,compareFrom,compareTo),{
  signal,headers:{Accept:'application/json'},cache:'no-store'
 });
 if(!response.ok)throw Error(response.status===401?'登录已失效，请重新登录':
  response.status===403?'当前账号没有统计查看权限':'统计查询失败，请重试');
 return parseDocumentStats(await response.json());
}
