import React,{useEffect,useState} from 'react';
import {loadDocumentStats,type DocumentStatsData} from './documentStatsModel';
const fmt=(number:number)=>number.toFixed(2);
export function DocumentStatsResults({data,onProduct,onDocument}:{
 data:DocumentStatsData;onProduct:(name:string)=>void;onDocument:(id:string)=>void;
}){
 const types=[{name:'样布码单',value:data.byType.sample,amount:data.byType.sample.amount},
  {name:'销售发货码单',value:data.byType.bulk,amount:data.byType.bulk.amount},
  {name:'定金单',value:data.byType.deposit,amount:data.byType.deposit.contractAmount}];
 return <div className="space-y-4">
  <section aria-label="三类单据统计" className="grid gap-4 sm:grid-cols-3">
   {types.map(({name,value,amount})=><article key={name} className="rounded-xl border bg-white p-4">
    <h3 className="font-semibold">{name}</h3>
    <p className="mt-2 text-sm">{value.count} 单 · {fmt(value.meters)} 米</p>
    <p className="mt-2 text-sm">{name==='定金单'?'合同金额':'金额'}：¥ {fmt(amount)}</p>
   </article>)}
  </section>
  <p className="text-sm text-slate-600">非定金单统计金额：¥ {fmt(data.amountTotal)} · 米数：{fmt(data.metersTotal)} · {data.orderCount} 单。定金合同额与预收不计入综合金额。</p>
  <div className="grid gap-4 lg:grid-cols-2">
   <section className="rounded-xl border bg-white p-4" aria-label="品名米数排名">
    <h3 className="font-semibold">品名米数 Top 5</h3>
    {!data.topProducts.length&&<p className="mt-3 text-sm text-slate-500">暂无排行数据</p>}
    <ol className="mt-3 space-y-2">{data.topProducts.map((row,i)=><li key={i}>
     <button type="button" className="flex w-full justify-between rounded-lg p-2 text-left text-sm text-blue-700 hover:bg-blue-50"
      onClick={()=>onProduct(row.productName)} aria-label={'筛选品名 '+row.productName}>
      <span>{i+1}. {row.productName}</span><span>{fmt(row.meters)} 米</span>
     </button></li>)}</ol>
   </section>
   <section className="rounded-xl border bg-white p-4" aria-label="最近四单">
    <h3 className="font-semibold">最近 4 张单据</h3>
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
 const [range,setRange]=useState({from:'',to:''});
 const [data,setData]=useState<DocumentStatsData|null>(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{
  const abort=new AbortController();
  setData(null);setLoading(true);setError('');
  loadDocumentStats(apiFetch,range.from,range.to,abort.signal)
   .then(value=>{if(!abort.signal.aborted)setData(value);})
   .catch(cause=>{if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:'统计查询失败');})
   .finally(()=>{if(!abort.signal.aborted)setLoading(false);});
  return ()=>abort.abort();
 },[apiFetch,range]);
 return <section className="space-y-4 p-3 text-slate-900 sm:p-6" aria-label="V2经营统计">
  <header><h2 className="text-xl font-semibold">经营大盘</h2><p className="mt-1 text-xs text-slate-500">数据来自当前登录账号的 V2 服务端统计接口；不可指定其他账号</p></header>
  <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4" onSubmit={event=>{event.preventDefault();setRange({from,to});}}>
   <label className="text-xs">起始日期<input className="ml-2 rounded border p-2" type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label>
   <label className="text-xs">截止日期<input className="ml-2 rounded border p-2" type="date" value={to} onChange={event=>setTo(event.target.value)}/></label>
   <button type="submit" className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white">查询统计</button>
   <button type="button" className="rounded border px-4 py-2 text-sm" onClick={()=>{setFrom('');setTo('');setRange({from:'',to:''});}}>重置</button>
  </form>
  {loading&&<p role="status">正在获取当前账号统计…</p>}
  {error&&<p role="alert" className="text-rose-700">{error}</p>}
  {data&&!loading&&!error&&<DocumentStatsResults data={data} onProduct={onProduct} onDocument={onDocument}/>}
 </section>;
}
