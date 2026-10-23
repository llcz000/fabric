import {ActionIcon} from '../product-master-v2/ActionIcon';
import React,{useEffect,useMemo,useState} from 'react';
import {loadDocumentStats,type DocumentStatsData,type DocumentStatsTotals} from './documentStatsModel';
import {computeTrend,formatTrend,previousRange,quickRanges,type DateRange,type QuickRangeKey,type Trend} from './documentStatsTrend';
import {SwatchBook,Truck,Wallet,TrendingUp,Clock3,ArrowUpRight,ArrowDownRight,Minus} from 'lucide-react';

const fmt=(number:number)=>number.toFixed(2);
const todayISO=()=>new Date().toISOString().slice(0,10);

/** 环比徽标。无基期时不渲染，避免把「无数据」误读成「零增长」。 */
function TrendBadge({trend,label}:{trend:Trend;label:string}){
 if(trend.ratio===null&&trend.delta===null)return null;
 const text=formatTrend(trend);
 if(!text)return null;
 const tone=trend.direction==='up'?'v2-trend-up':trend.direction==='down'?'v2-trend-down':'v2-trend-flat';
 const Icon=trend.direction==='up'?ArrowUpRight:trend.direction==='down'?ArrowDownRight:Minus;
 return <span className={'v2-trend '+tone}>
  <Icon size={13} aria-hidden="true"/>
  <span className="v2-trend-value">{text}</span>
  <span className="v2-trend-label">{label}</span>
 </span>;
}

/** 每米均价：米数为 0 时不臆造单价。 */
function unitPrice(amount:number,meters:number):string|null{
 if(!Number.isFinite(amount)||!Number.isFinite(meters)||meters<=0)return null;
 return (amount/meters).toFixed(2);
}

export function DocumentStatsResults({data,onProduct,onDocument}:{
 data:DocumentStatsData;onProduct:(name:string)=>void;onDocument:(id:string)=>void;
}){
 const compare=data.compare;
 const trendOf=(current:number,previous:number|undefined)=>
  computeTrend(current,compare?previous??null:null);

 // 三类单据统一口径：单据数 / 出库米数 / 每米均价。定金单不计入营收金额，
 // 因此其「每米均价」按合同额折算，仅作参考并在卡片上单独标注。
 const types=[
  {name:'样布码单',count:data.byType.sample.count,meters:data.byType.sample.meters,
   price:unitPrice(data.byType.sample.amount,data.byType.sample.meters),
   note:data.byType.sample.amount,Icon:SwatchBook,kind:'sample' as const},
  {name:'销售发货码单',count:data.byType.bulk.count,meters:data.byType.bulk.meters,
   price:unitPrice(data.byType.bulk.amount,data.byType.bulk.meters),
   note:data.byType.bulk.amount,Icon:Truck,kind:'bulk' as const},
  {name:'定金单',count:data.byType.deposit.count,meters:data.byType.deposit.meters,
   price:unitPrice(data.byType.deposit.contractAmount,data.byType.deposit.meters),
   note:data.byType.deposit.contractAmount,Icon:Wallet,kind:'deposit' as const}
 ];
 const maxMeters=Math.max(1,...types.map(item=>item.meters));
 const topTotal=data.topProducts.reduce((sum,row)=>sum+row.meters,0);

 return <div className="space-y-4">
  <section aria-label="核心经营指标" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
   <article className="v2-stats-card v2-stats-kpi">
    <h3>单据总数</h3>
    <p className="v2-stat-amount">{data.orderCount}<span className="v2-stat-unit">单</span></p>
    <div className="v2-stat-meta"><span>{data.metersTotal.toFixed(2)} 米</span></div>
    <TrendBadge trend={trendOf(data.orderCount,compare?.orderCount)} label="较上期"/>
   </article>
   <article className="v2-stats-card v2-stats-kpi">
    <h3>出库金额</h3>
    <p className="v2-stat-amount"><span className="v2-stat-unit">¥</span>{fmt(data.amountTotal)}</p>
    <div className="v2-stat-meta"><span>不含定金合同额</span></div>
    <TrendBadge trend={trendOf(data.amountTotal,compare?.amountTotal)} label="较上期"/>
   </article>
   <article className="v2-stats-card v2-stats-kpi">
    <h3>待收尾款</h3>
    <p className="v2-stat-amount"><span className="v2-stat-unit">¥</span>{fmt(data.pendingAmount)}</p>
    <div className="v2-stat-meta"><span>{data.pendingCount} 单未结清</span></div>
    <TrendBadge trend={trendOf(data.pendingAmount,compare?.pendingAmount)} label="较上期"/>
   </article>
   <article className="v2-stats-card v2-stats-kpi">
    <h3>出库米数</h3>
    <p className="v2-stat-amount">{fmt(data.metersTotal)}<span className="v2-stat-unit">米</span></p>
    <div className="v2-stat-meta">
     <span>均价 {unitPrice(data.amountTotal,data.metersTotal)??'—'} 元/米</span>
    </div>
    <TrendBadge trend={trendOf(data.metersTotal,compare?.metersTotal)} label="较上期"/>
   </article>
  </section>

  <section aria-label="三类单据统计" className="grid gap-4 sm:grid-cols-3">
   {types.map(({name,count,meters,price,note,Icon,kind})=>
    <article key={name} className="v2-stats-card">
     <h3 className="flex items-center justify-between">{name}
      <span className="v2-stat-icon"><Icon size={19} aria-hidden="true"/></span></h3>
     <p className="v2-stat-amount">{count}<span className="v2-stat-unit">单</span></p>
     <div className="v2-stat-meta">
      <span>{fmt(meters)} 米</span>
      <span>{price===null?'每米均价 —':`每米均价 ¥${price}`}</span>
     </div>
     <div className="v2-stat-bar" aria-hidden="true">
      <span style={{width:Math.min(100,Math.round(meters/maxMeters*100))+'%'}}/>
     </div>
     <p className="v2-stat-foot">
      {kind==='deposit'?`合同额 ¥${fmt(note)}（不计入营收）`:`金额 ¥${fmt(note)}`}
     </p>
     <TrendBadge trend={trendOf(count,compare?.byType[kind].count)} label="单量较上期"/>
    </article>)}
  </section>

  <div className="grid gap-4 lg:grid-cols-2">
   <section className="v2-stats-panel rounded-xl border bg-white p-4" aria-label="品名米数排名">
    <h3 className="flex items-center gap-2 font-semibold"><TrendingUp size={18} aria-hidden="true" className="text-blue-600"/>品名米数 Top 5</h3>
    {!data.topProducts.length&&<p className="mt-3 text-sm text-slate-500">暂无排行数据</p>}
    <ol className="mt-3 space-y-2">{data.topProducts.map((row,i)=>{
     const share=topTotal>0?row.meters/topTotal:0;
     return <li key={i}>
      <button type="button" className="v2-rank-row w-full text-left"
       onClick={()=>onProduct(row.productName)} aria-label={'筛选品名 '+row.productName}>
       <span className="v2-rank-index">{i+1}</span>
       <span className="v2-rank-name">{row.productName}</span>
       <span className="v2-rank-bar" aria-hidden="true">
        <span style={{width:Math.min(100,Math.round(share*100))+'%'}}/>
       </span>
       <span className="v2-rank-value">{fmt(row.meters)} 米</span>
       <span className="v2-rank-share">{(share*100).toFixed(1)}%</span>
      </button></li>;
    })}</ol>
   </section>
   <section className="v2-stats-panel rounded-xl border bg-white p-4" aria-label="最近四单">
    <h3 className="flex items-center gap-2 font-semibold"><Clock3 size={18} aria-hidden="true" className="text-blue-600"/>最近 4 张单据</h3>
    {!data.recentOrders.length&&<p className="mt-3 text-sm text-slate-500">暂无单据</p>}
    <ol className="mt-3 space-y-2">{data.recentOrders.map(row=><li key={row.id}>
     <button type="button" className="flex w-full justify-between gap-2 rounded-lg p-2 text-left text-sm text-blue-700 hover:bg-blue-50"
      onClick={()=>onDocument(row.id)} aria-label={'查看单据 '+row.orderNo}>
      <span>{row.orderNo} · {row.receivingUnit||'未填写客户'}</span><span>{row.date}</span>
     </button></li>)}</ol>
   </section>
  </div>
 </div>;
}

export function V2DocumentStats({apiFetch,onProduct,onDocument}:{
 apiFetch:typeof fetch;onProduct:(name:string)=>void;onDocument:(id:string)=>void;
}){
 const [from,setFrom]=useState(''),[to,setTo]=useState('');
 const [range,setRange]=useState<DateRange>({from:'',to:''});
 const [quick,setQuick]=useState<QuickRangeKey>('all');
 const [data,setData]=useState<DocumentStatsData|null>(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState('');
 const ranges=useMemo(()=>quickRanges(todayISO()),[]);
 // 环比基期：只有当用户明确选择了有限区间时才有可比基期。
 const compare=useMemo(()=>previousRange(range),[range]);
 useEffect(()=>{
  const abort=new AbortController();
  setData(null);setLoading(true);setError('');
  loadDocumentStats(apiFetch,range.from,range.to,abort.signal,compare?.from??'',compare?.to??'')
   .then(value=>{if(!abort.signal.aborted)setData(value);})
   .catch(cause=>{if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:'统计查询失败');})
   .finally(()=>{if(!abort.signal.aborted)setLoading(false);});
  return ()=>abort.abort();
 },[apiFetch,range,compare]);
 const applyQuick=(key:QuickRangeKey)=>{
  const option=ranges.find(item=>item.key===key);
  if(!option)return;
  setQuick(key);setFrom(option.range.from);setTo(option.range.to);setRange(option.range);
 };
 return <section className="space-y-4 p-3 text-slate-900 sm:p-6" aria-label="V2经营统计">
  <header className="v2-stats-header"><h2 className="text-xl font-semibold">经营大盘</h2><p className="mt-1 text-xs text-slate-500">按开单日期统计当前账号可查看的单据</p></header>
  <div className="v2-stats-filters rounded-xl border bg-white p-4">
   <div className="v2-stats-quick" role="group" aria-label="快捷时间区间">
    {ranges.map(option=>
     <button key={option.key} type="button" aria-pressed={quick===option.key}
      className={'v2-quick-button'+(quick===option.key?' v2-quick-active':'')}
      onClick={()=>applyQuick(option.key)}>{option.label}</button>)}
   </div>
   <form className="v2-stats-range" onSubmit={event=>{event.preventDefault();setQuick('all');setRange({from,to});}}>
    <label className="text-xs">起始日期<input className="ml-2 rounded border p-2" type="date" value={from} onChange={event=>{setFrom(event.target.value);setQuick('all');}}/></label>
    <label className="text-xs">截止日期<input className="ml-2 rounded border p-2" type="date" value={to} onChange={event=>{setTo(event.target.value);setQuick('all');}}/></label>
    <button type="submit" className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white"><ActionIcon name="search"/>查询统计</button>
    <button type="button" className="rounded border px-4 py-2 text-sm" onClick={()=>applyQuick('all')}><ActionIcon name="reset"/>重置</button>
   </form>
  </div>
  {loading&&<p role="status">正在获取当前账号统计…</p>}
  {error&&<p role="alert" className="text-rose-700">{error}</p>}
  {data&&!loading&&!error&&<DocumentStatsResults data={data} onProduct={onProduct} onDocument={onDocument}/>}
 </section>;
}
