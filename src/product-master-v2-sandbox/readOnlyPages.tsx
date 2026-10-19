/** Additional read-only sandbox V2 tabs, backed by already-authenticated APIs.
 * No manual-review fixture imports, write actions, customer mutations or downloads.
 */
import React,{useEffect,useMemo,useState} from 'react';
import {createDocumentSearchController,emptySearchFilters,
 type DocumentSearchState,type DocumentSearchFilters} from '../components/document-product-selector/documentSearchModel';
import {loadDocumentStats,type DocumentStatsData} from '../components/document-product-selector/documentStatsModel';
import {loadSandboxCards,loadSandboxSampleSession,type SandboxSampleSessionPage} from './readOnlyData';
import type {SampleCardPage} from '../components/product-master-v2/sampleCardModel';

const btn='rounded border border-[#c3c6d7] bg-white px-3 py-2 text-sm disabled:opacity-40';
const field='rounded border border-[#c3c6d7] bg-white px-3 py-2 text-sm';
const money=(n:number)=>n.toFixed(2);
export const sandboxPages=Object.freeze([
 {id:'patterns',title:'花型库'},
 {id:'fabrics',title:'面料库'},
 {id:'products',title:'产品库'},
 {id:'cards',title:'色卡库'},
 {id:'sessions',title:'客户选样查询'},
 {id:'documents',title:'单据查询'},
 {id:'stats',title:'经营大盘'},
] as const);
export type SandboxPage=typeof sandboxPages[number]['id'];

export function SandboxCardsReadOnly({apiFetch}:{apiFetch:typeof fetch}){
 const [query,setQuery]=useState(''),[offset,setOffset]=useState(0);
 const [page,setPage]=useState<SampleCardPage|null>(null);
 const [error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{
  const ac=new AbortController();
  setPage(null);setError('');setLoading(true);
  loadSandboxCards(apiFetch,query,offset,ac.signal)
   .then(data=>{if(!ac.signal.aborted)setPage(data);})
   .catch(cause=>{if(!ac.signal.aborted)setError(cause instanceof Error?cause.message:'无法读取色卡');})
   .finally(()=>{if(!ac.signal.aborted)setLoading(false);});
  return ()=>ac.abort();
 },[apiFetch,query,offset]);
 return <section aria-label="V2沙箱色卡只读列表" className="space-y-3 p-4">
  <h2 className="text-lg font-semibold">色卡库 · 只读</h2>
  <p className="text-xs text-amber-800">只能查看当前V2账号获准的色卡编号与状态，不执行制卡、打印确认、删除或导出。</p>
  <input className={field} aria-label="色卡搜索" value={query} maxLength={100} placeholder="色卡号、花型母版号、面料号"
   onChange={event=>{setOffset(0);setQuery(event.target.value);}}/>
  {loading&&<p role="status">读取色卡中…</p>}
  {error&&<p role="alert">{error}</p>}
  {page&&!loading&&<div className="overflow-x-auto rounded border bg-white">
   <table className="w-full text-left text-sm"><thead><tr className="bg-slate-100">
    <th className="p-3">色卡编号</th><th className="p-3">面料</th><th className="p-3">状态</th><th className="p-3">需重印</th>
   </tr></thead><tbody>{page.items.map(item=><tr key={item.id} className="border-t">
    <td className="p-3">{item.cardNo}</td><td className="p-3">{item.description}</td>
    <td className="p-3">{item.isActive?'有效':'已停用'}</td><td className="p-3">{item.needsReprint?'是':'否'}</td>
   </tr>)}</tbody></table>
   {!page.items.length&&<p className="p-4 text-sm text-slate-500">无匹配色卡</p>}
   <div className="flex justify-between border-t p-3 text-sm"><span>共 {page.total} 张</span>
    <div className="flex gap-2"><button className={btn} disabled={page.offset===0} onClick={()=>setOffset(Math.max(0,offset-50))}>上一页</button>
    <button className={btn} disabled={page.offset+page.limit>=page.total} onClick={()=>setOffset(offset+50)}>下一页</button></div></div>
  </div>}
 </section>;
}

export function SandboxSessionsReadOnly({apiFetch}:{apiFetch:typeof fetch}){
 const [entry,setEntry]=useState(''),[id,setId]=useState(''),[offset,setOffset]=useState(0);
 const [page,setPage]=useState<SandboxSampleSessionPage|null>(null);
 const [error,setError]=useState(''),[loading,setLoading]=useState(false);
 useEffect(()=>{
  if(!id){setPage(null);setLoading(false);return;}
  const ac=new AbortController();setPage(null);setLoading(true);setError('');
  loadSandboxSampleSession(apiFetch,id,offset,ac.signal)
   .then(result=>{if(!ac.signal.aborted)setPage(result);})
   .catch(cause=>{if(!ac.signal.aborted)setError(cause instanceof Error?cause.message:'无法读取选样历史');})
   .finally(()=>{if(!ac.signal.aborted)setLoading(false);});
  return ()=>ac.abort();
 },[apiFetch,id,offset]);
 return <section className="space-y-3 p-4" aria-label="客户选样单只读查询">
  <h2 className="text-lg font-semibold">客户选样查询 · 只读</h2>
  <p className="text-xs text-amber-800">请输入已有、被当前账号授权的选样单ID；后端仍会验证账号与该单权限，不能浏览其他人的选样记录。</p>
  <form className="flex flex-wrap items-center gap-2" onSubmit={e=>{e.preventDefault();setOffset(0);setError('');setId(entry);}}>
   <input aria-label="选样单ID" className={field} inputMode="numeric" value={entry}
    onChange={e=>setEntry(e.target.value)} placeholder="正整数选样单ID" maxLength={20}/>
   <button type="submit" className={btn}>查询</button>
  </form>
  {loading&&<p role="status">查询授权选样记录中…</p>}
  {error&&<p role="alert">{error}</p>}
  {page&&<div className="rounded border bg-white p-4">
   <h3 className="font-medium">{page.session.customerReference} · {page.session.status==='closed'?'已结束':'进行中'}</h3>
   <p className="my-2 text-sm">选样明细 {page.total} 条 · 色卡关联 {page.selectedCardCount} 张</p>
   {page.items.map(item=><div key={item.id} className="border-t py-2 text-sm">
    <strong>{item.current.productNo}</strong> · {item.current.fabricName} · 花型{item.current.patternNo}/配色{item.current.colorwayNo}
    <div className="text-xs text-slate-500">来源色卡：{item.sources.length?item.sources.map(s=>s.cardNo+(s.retired?'（已废止）':'')).join('、'):'人工记录'}</div>
   </div>)}
   {!page.items.length&&<p className="text-sm text-slate-500">本页无明细</p>}
   <div className="flex justify-end gap-2">
    <button className={btn} disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-50))}>上一页</button>
    <button className={btn} disabled={offset+page.limit>=page.total} onClick={()=>setOffset(offset+50)}>下一页</button>
   </div>
  </div>}
 </section>;
}

export function SandboxDocumentsReadOnly({apiFetch,productName=''}:{
 apiFetch:typeof fetch;productName?:string;
}){
 const [draft,setDraft]=useState(productName);
 const [submitted,setSubmitted]=useState(productName);
 const [offset,setOffset]=useState(0);
 const [state,setState]=useState<DocumentSearchState>({loading:true,error:'',page:null,totals:null});
 const controller=useMemo(()=>createDocumentSearchController(apiFetch,setState),[apiFetch]);
 useEffect(()=>{
  const filters:DocumentSearchFilters={...emptySearchFilters(),productName:submitted};
  void controller.search(filters,offset,20);
  return ()=>controller.revoke('');
 },[controller,submitted,offset]);
 useEffect(()=>()=>controller.dispose(),[controller]);
 return <section aria-label="V2沙箱单据只读查询" className="space-y-3 p-4">
  <h2 className="text-lg font-semibold">三类单据 · 只读查询</h2>
  <p className="text-xs text-amber-800">仅服务端授权当前账号可读的订单，含样布/定金/销售发货，不提供编辑、删除或导出。</p>
  <form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();setOffset(0);setSubmitted(draft);}}>
   <input className={field} aria-label="单据品名筛选" value={draft} maxLength={100}
    onChange={e=>setDraft(e.target.value)} placeholder="按单据历史品名筛选"/>
   <button type="submit" className={btn}>查询</button>
  </form>
  {state.loading&&<p role="status">查询中…</p>}
  {state.error&&<p role="alert">{state.error}</p>}
  {state.page&&!state.loading&&<div className="rounded border bg-white">
   <div className="p-3 text-sm">匹配单据 {state.page.total} 张 · 明细合计 {state.totals?.matchingLineCount??0} 行 · {money(state.totals?.metersTotal??0)} 米</div>
   <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="bg-slate-100">
    <th className="p-3">单号</th><th className="p-3">日期</th><th className="p-3">类型</th><th className="p-3">客户</th><th className="p-3">金额</th>
   </tr></thead><tbody>{state.page.items.map(item=><tr key={item.id} className="border-t">
    <td className="p-3">{item.orderNo}</td><td className="p-3">{item.date}</td>
    <td className="p-3">{({sample:'样布',deposit:'定金',bulk:'发货'} as const)[item.type]}</td>
    <td className="p-3">{item.receivingUnit}</td><td className="p-3">{money(item.totalAmount)}</td>
   </tr>)}</tbody></table></div>
   {!state.page.items.length&&<p className="p-4 text-sm text-slate-500">无匹配单据</p>}
   <div className="flex justify-end gap-2 border-t p-3">
    <button className={btn} disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>上一页</button>
    <button className={btn} disabled={offset+state.page.limit>=state.page.total} onClick={()=>setOffset(offset+20)}>下一页</button>
   </div>
  </div>}
 </section>;
}

export function SandboxStatsReadOnly({apiFetch,onProduct}:{
 apiFetch:typeof fetch;onProduct:(productName:string)=>void;
}){
 const [data,setData]=useState<DocumentStatsData|null>(null);
 const [error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{
  const ac=new AbortController();setData(null);setError('');setLoading(true);
  loadDocumentStats(apiFetch,'','',ac.signal)
   .then(value=>{if(!ac.signal.aborted)setData(value);})
   .catch(cause=>{if(!ac.signal.aborted)setError(cause instanceof Error?cause.message:'统计查询失败');})
   .finally(()=>{if(!ac.signal.aborted)setLoading(false);});
  return ()=>ac.abort();
 },[apiFetch]);
 return <section aria-label="V2沙箱经营统计只读" className="space-y-3 p-4">
  <h2 className="text-lg font-semibold">经营大盘 · 只读</h2>
  <p className="text-xs text-amber-800">由V2服务端按当前账号身份汇总，不合并旧App缓存，也不模拟管理角色。</p>
  {loading&&<p role="status">读取经营统计中…</p>}
  {error&&<p role="alert">{error}</p>}
  {data&&<><div className="grid gap-3 sm:grid-cols-3">
   <article className="rounded border bg-white p-4">单据 <strong>{data.orderCount}</strong> 张</article>
   <article className="rounded border bg-white p-4">合计 <strong>{money(data.metersTotal)}</strong> 米</article>
   <article className="rounded border bg-white p-4">非定金单金额 <strong>¥{money(data.amountTotal)}</strong></article>
  </div>
  <section className="rounded border bg-white p-4"><h3 className="font-medium">品名用量 Top 5</h3>
   <div className="mt-2 space-y-2">{data.topProducts.map(item=><button key={item.productName}
    className="flex w-full justify-between rounded p-2 text-left text-sm text-blue-700 hover:bg-blue-50"
    onClick={()=>onProduct(item.productName)}>{item.productName}<span>{money(item.meters)} 米</span></button>)}</div>
   {!data.topProducts.length&&<p className="text-sm text-slate-500">暂无排名</p>}
  </section>
  <section className="rounded border bg-white p-4"><h3 className="font-medium">最近四张单据</h3>
   {data.recentOrders.map(item=><p key={item.id} className="border-t py-2 text-sm">{item.orderNo} · {item.date} · {item.receivingUnit}</p>)}
  </section></>}
 </section>;
}
