import React,{useEffect,useRef,useState} from 'react';
import type {CompanyProfile} from '../../types';
import V2DocumentWorkspace from './V2DocumentWorkspace';
import V2DocumentPrintView from './V2DocumentPrintView';
import {createDocumentSearchController,emptySearchFilters,loadMatchingItems,DocumentQueryError,
 type DocumentSearchFilters,type DocumentSearchState,type MatchingPage} from './documentSearchModel';

const names={sample:'样布码单',bulk:'销售发货码单',deposit:'定金单'};
const money=(n:number)=>n.toFixed(2);
const input='mt-1 w-full rounded-lg border border-[#c3c6d7] bg-white px-3 py-2 text-sm text-[#191b24] focus:outline-[#346ef6]';
const button='rounded-lg border border-[#c3c6d7] px-3 py-2 text-sm disabled:opacity-40';
export function DocumentSearchResults({state,expanded,onToggle,onEdit,onPreview,onCopy,onDelete,renderDetails}: {
 state:DocumentSearchState;expanded:string|null;onToggle(id:string):void;onEdit(id:string):void;onPreview(id:string):void;
 onCopy?:(id:string,no:string)=>void;onDelete?:(id:string,no:string)=>void;
 renderDetails?:(id:string)=>React.ReactNode;
}){
 if(state.loading)return <p role="status" className="rounded-lg bg-white p-5 text-sm text-slate-600">正在查询单据与命中明细合计…</p>;
 if(state.error)return <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{state.error}</p>;
 if(!state.page||!state.totals)return null;
 return <>
  <section aria-label="命中明细合计" className="rounded-xl border border-[#c3c6d7] bg-white p-4">
   <h3 className="text-sm font-semibold">命中明细合计 <span className="font-normal text-slate-500">· 全部符合当前筛选的明细</span></h3>
   <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
    {([['命中行数',String(state.totals.matchingLineCount)],['米数',money(state.totals.metersTotal)+' m'],
     ['匹数',String(state.totals.piecesTotal)+' 匹'],['金额','¥ '+money(state.totals.amountTotal)]]).map(([label,value])=>
     <div key={label}><span className="block text-xs text-slate-500">{label}</span><strong className="mt-1 block text-lg tabular-nums">{value}</strong></div>)}
   </div>
   <p className="mt-3 text-xs text-slate-500">合计包含样布和销售命中明细；定金合同额、定金和预收不计入。下表数值为整单数据。</p>
  </section>
  {state.page.items.length===0?<p className="rounded-lg border bg-white p-6 text-sm text-slate-600">没有符合条件的单据，可清除筛选后重试。</p>:
  <div className="overflow-x-auto rounded-xl border border-[#c3c6d7] bg-white">
   <table className="w-full min-w-[1050px] text-left text-sm">
    <thead className="bg-[#f3f4fa] text-xs text-[#434655]"><tr>{['单据编号 / 类型','开单日期','客户','整单米数','整单匹数','整单金额','结清状态','操作'].map(label=><th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead>
    <tbody>{state.page.items.map(item=><React.Fragment key={item.id}>
     <tr className="border-t border-[#ededf9] align-top hover:bg-[#f8f9ff]">
      <td className="px-4 py-3"><strong className="block font-medium">{item.orderNo}</strong><span className="text-xs text-slate-500">{names[item.type]}</span></td>
      <td className="px-4 py-3 whitespace-nowrap">{item.date}</td><td className="max-w-[200px] break-words px-4 py-3">{item.receivingUnit||'—'}</td>
      <td className="px-4 py-3 tabular-nums">{money(item.totalMeters)}</td><td className="px-4 py-3 tabular-nums">{item.type==='deposit'?'—':item.totalPieces}</td>
      <td className="px-4 py-3 tabular-nums">¥ {money(item.totalAmount)}{item.type==='deposit'&&<span className="block text-xs text-slate-500">合同金额</span>}</td>
      <td className="px-4 py-3">{item.type==='deposit'?'不适用':item.settled?'已结清':'未结清'}</td>
      <td className="px-4 py-3"><div className="flex flex-wrap gap-x-3 gap-y-2 text-xs text-[#0053da]">
       <button type="button" aria-expanded={expanded===item.id} onClick={()=>onToggle(item.id)}>{expanded===item.id?'收起命中明细':'展开命中明细'}</button>
       <button type="button" onClick={()=>onEdit(item.id)}>编辑单据</button><button type="button" onClick={()=>onPreview(item.id)}>预览 / Excel</button>
        {onCopy&&<button type="button" onClick={()=>onCopy(item.id,item.orderNo)}>复制为新单</button>}
        {onDelete&&<button type="button" onClick={()=>onDelete(item.id,item.orderNo)}>确认删除</button>}
      </div></td>
     </tr>
     {expanded===item.id&&<tr><td colSpan={8} className="border-t bg-[#f8f9ff] p-4">{renderDetails?.(item.id)}</td></tr>}
    </React.Fragment>)}</tbody>
   </table>
  </div>}
 </>;
}
function MatchingDetails({apiFetch,orderId,filters,onDenied}:{apiFetch:typeof fetch;orderId:string;filters:DocumentSearchFilters;onDenied(message:string):void}){
 const [page,setPage]=useState<MatchingPage|null>(null),[offset,setOffset]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(true),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const abort=new AbortController();setBusy(true);setError('');setPage(null);
  loadMatchingItems(apiFetch,orderId,filters,offset,abort.signal).then(result=>{
   if(!abort.signal.aborted)setPage(result);
  }).catch(error=>{
   if(abort.signal.aborted)return;
   if(error instanceof DocumentQueryError&&[401,403].includes(error.status))onDenied(error.message);
   else setError(error instanceof Error?error.message:'命中明细读取失败');
  }).finally(()=>{if(!abort.signal.aborted)setBusy(false);});
  return ()=>abort.abort();
 },[apiFetch,orderId,filters,offset,retry,onDenied]);
 if(busy)return <p role="status" className="text-sm">正在读取命中明细…</p>;
 if(error)return <div role="alert" className="text-sm text-rose-800">{error} <button type="button" className={button} onClick={()=>setRetry(v=>v+1)}>重试明细</button></div>;
 if(!page)return null;
 return <section aria-label="命中明细">
  <p className="mb-2 text-xs text-slate-500">仅展示同一条明细同时满足货号、色号、品名条件的记录 · 共 {page.total} 行</p>
  <table className="w-full text-left text-xs"><thead><tr>{['货号','色号','品名','米数','匹数','金额'].map(label=><th key={label} className="p-2">{label}</th>)}</tr></thead>
   <tbody>{page.items.map(item=><tr key={item.id} className="border-t border-slate-200"><td className="p-2">{item.productNo||'—'}</td><td className="p-2">{item.colorNo||'—'}</td><td className="p-2">{item.productName||'—'}</td><td className="p-2">{money(item.meters)}</td><td className="p-2">{item.pieces||'—'}</td><td className="p-2">¥ {money(item.amount)}</td></tr>)}</tbody>
  </table>
  {page.total>20&&<div className="mt-3 flex items-center gap-3 text-xs"><button className={button} disabled={offset===0} onClick={()=>setOffset(v=>v-20)}>上一页明细</button><span>第 {offset/20+1} 页</span><button className={button} disabled={offset+20>=page.total} onClick={()=>setOffset(v=>v+20)}>下一页明细</button></div>}
 </section>;
}
export function V2DocumentBrowser({apiFetch,role,companyProfile,initialFilters}:{apiFetch:typeof fetch;role:'admin'|'sales';companyProfile:CompanyProfile;initialFilters?:Partial<DocumentSearchFilters>}){
 const [filters,setFilters]=useState<DocumentSearchFilters>(()=>({...emptySearchFilters(),...initialFilters})),[applied,setApplied]=useState<DocumentSearchFilters>(()=>({...emptySearchFilters(),...initialFilters}));
 const [state,setState]=useState<DocumentSearchState>({loading:true,error:'',page:null,totals:null});
 const [expanded,setExpanded]=useState<string|null>(null),[limit,setLimit]=useState(20),[offset,setOffset]=useState(0);
 const [selected,setSelected]=useState<{id:string;mode:'edit'|'preview'}|null>(null);
 const [action,setAction]=useState<{id:string;orderNo:string;kind:'copy'|'delete'}|null>(null);
 const [newOrderNo,setNewOrderNo]=useState('');
 const [copyDate,setCopyDate]=useState(new Date().toISOString().slice(0,10));
 const [confirmation,setConfirmation]=useState('');
 const [actionBusy,setActionBusy]=useState(false);
 const [actionError,setActionError]=useState('');
 const act=async()=>{
  if(!action||actionBusy)return;
  if(action.kind==='delete'&&confirmation!==action.orderNo){setActionError('请准确输入原单据编号以确认删除');return;}
  if(action.kind==='copy'&&(!newOrderNo.trim()||newOrderNo===action.orderNo)){setActionError('请输入不同于原单号的新编号');return;}
  setActionBusy(true);setActionError('');
  try{
   const response=await apiFetch('/api/v2/documents/'+encodeURIComponent(action.id)+(action.kind==='copy'?'/copy':''),
    {method:action.kind==='copy'?'POST':'DELETE',headers:{'Content-Type':'application/json'},
     body:JSON.stringify(action.kind==='copy'?{orderNo:newOrderNo.trim(),date:copyDate}:{confirm:true})});
   if(!response.ok)throw Error(response.status===404?'单据不存在或无权限':response.status===409?'单号重复或业务状态变化，请重新检查':'保存失败，请重试');
   if(action.kind==='copy'){
    const result=await response.json() as {id:string};
    setAction(null);setSelected({id:result.id,mode:'edit'});
   }else{setAction(null);search(applied,Math.max(0,offset));}
  }catch(e){setActionError(e instanceof Error?e.message:'操作失败');}
  finally{setActionBusy(false);}
 };

 const controller=useRef<ReturnType<typeof createDocumentSearchController>|null>(null);
 useEffect(()=>{
  const next=createDocumentSearchController(apiFetch,setState);controller.current=next;
  const initial={...emptySearchFilters(),...initialFilters};setFilters(initial);setApplied(initial);setOffset(0);setLimit(20);setExpanded(null);setSelected(null);
  void next.search(initial);return ()=>next.dispose();
 },[apiFetch,role,initialFilters?.customer,initialFilters?.productName,initialFilters?.productNo,initialFilters?.colorNo,initialFilters?.type,initialFilters?.from,initialFilters?.to,initialFilters?.settled]);
 const search=(next:DocumentSearchFilters,nextOffset=0,nextLimit=limit)=>{
  setApplied(next);setOffset(nextOffset);setLimit(nextLimit);setExpanded(null);void controller.current?.search(next,nextOffset,nextLimit);
 };
 // Stable callback: detail effects must not restart when unrelated state changes.
 const onDenied=React.useCallback((message:string)=>{controller.current?.revoke(message);setExpanded(null);},[]);
 if(selected?.mode==='edit')return <V2DocumentWorkspace apiFetch={apiFetch} role={role} companyProfile={companyProfile} documentId={selected.id}
  onCancel={()=>setSelected(null)} onSaved={()=>{setSelected(null);search(applied,offset);}}/>;
 if(selected?.mode==='preview')return <V2DocumentPrintView apiFetch={apiFetch} documentId={selected.id} onBack={()=>setSelected(null)} backLabel="返回查询"/>;
 return <section aria-label="V2单据查询工作区" className="space-y-4 p-3 text-[#191b24] sm:p-6">
  <header><h2 className="text-xl font-semibold">单据查询</h2><p className="mt-1 text-xs text-slate-500">{role==='admin'?'查看全公司单据':'仅查看本人单据'} · 按开单日期倒序</p></header>
  <form className="rounded-xl border border-[#c3c6d7] bg-white p-4" onSubmit={event=>{event.preventDefault();search(filters);}}>
   <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
    {([['customer','客户'],['productNo','货号'],['colorNo','色号'],['productName','品名']] as const).map(([key,label])=><label key={key} className="text-xs font-medium">{label}<input name={key} className={input} maxLength={100} value={filters[key]} onChange={e=>setFilters(v=>({...v,[key]:e.target.value}))}/></label>)}
    <label className="text-xs font-medium">单据类型<select name="type" className={input} value={filters.type} onChange={e=>setFilters(v=>({...v,type:e.target.value as DocumentSearchFilters['type'],settled:e.target.value==='deposit'?'':v.settled}))}>
     <option value="">全部类型</option>{Object.entries(names).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    {([['from','起始日期'],['to','截止日期']] as const).map(([key,label])=><label key={key} className="text-xs font-medium">{label}<input name={key} type="date" className={input} value={filters[key]} onChange={e=>setFilters(v=>({...v,[key]:e.target.value}))}/></label>)}
    <label className="text-xs font-medium">结清状态<select name="settled" className={input} disabled={filters.type==='deposit'} value={filters.settled} onChange={e=>setFilters(v=>({...v,settled:e.target.value as DocumentSearchFilters['settled']}))}>
     <option value="">全部状态</option><option value="false">未结清</option><option value="true">已结清</option></select></label>
   </div>
   <div className="mt-4 flex flex-wrap items-center gap-3"><button type="submit" className="rounded-lg bg-[#0053da] px-5 py-2 text-sm font-semibold text-white">查询</button>
    <button type="button" className={button} onClick={()=>{const next=emptySearchFilters();setFilters(next);search(next);}}>清除筛选</button>
    <p className="text-xs text-slate-500">多个明细条件由同一行同时满足；定金单不参与结清筛选。</p>
   </div>
  </form>
  {action&&<section role="dialog" aria-label={action.kind==='copy'?'复制单据':'确认删除单据'} className="rounded-xl border border-sky-300 bg-sky-50 p-4 space-y-3">
   <h3 className="font-semibold">{action.kind==='copy'?'复制为新单':'删除确认'}：{action.orderNo}</h3>
   {action.kind==='copy'?<div className="flex flex-wrap gap-3">
    <label className="text-sm">新单据编号<input className={input} value={newOrderNo} maxLength={100} onChange={e=>setNewOrderNo(e.target.value)}/></label>
    <label className="text-sm">开单日期<input type="date" className={input} value={copyDate} onChange={e=>setCopyDate(e.target.value)}/></label>
    <p className="w-full text-xs">保留原单的产品资料和金额快照，生成独立新单；不修改原单。</p>
   </div>:<label className="block text-sm">请输入完整原单编号确认永久删除
    <input className={input} value={confirmation} onChange={e=>setConfirmation(e.target.value)}/>
   </label>}
   {actionError&&<p role="alert" className="text-sm text-red-700">{actionError}</p>}
   <div className="flex gap-3"><button type="button" className={button} disabled={actionBusy} onClick={()=>void act()}>{actionBusy?'处理中…':action.kind==='copy'?'确认创建副本':'确认永久删除'}</button>
    <button className={button} type="button" disabled={actionBusy} onClick={()=>{setAction(null);setActionError('');}}>取消</button></div>
  </section>}
  <DocumentSearchResults state={state} expanded={expanded} onToggle={id=>setExpanded(v=>v===id?null:id)}
   onEdit={id=>setSelected({id,mode:'edit'})} onPreview={id=>setSelected({id,mode:'preview'})}
   onCopy={(id,orderNo)=>{setAction({id,orderNo,kind:'copy'});setNewOrderNo('');setActionError('');}} onDelete={(id,orderNo)=>{setAction({id,orderNo,kind:'delete'});setConfirmation('');setActionError('');}}
   renderDetails={id=><MatchingDetails key={id} apiFetch={apiFetch} orderId={id} filters={applied} onDenied={onDenied}/>}/>
  {state.error&&<button type="button" className={button} onClick={()=>search(applied,offset)}>重试查询</button>}
  {state.page&&<footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
   <span>共 {state.page.total} 张单据 · 第 {Math.floor(offset/limit)+1} / {Math.max(1,Math.ceil(state.page.total/limit))} 页</span>
   <div className="flex items-center gap-2"><label>每页 <select aria-label="每页单据数" className="rounded border bg-white p-2" value={limit} onChange={e=>search(applied,0,Number(e.target.value))}><option value={20}>20 张</option><option value={50}>50 张</option></select></label>
    <button type="button" className={button} disabled={offset===0} onClick={()=>search(applied,offset-limit)}>上一页</button>
    <button type="button" className={button} disabled={offset+limit>=state.page.total} onClick={()=>search(applied,offset+limit)}>下一页</button>
   </div>
  </footer>}
 </section>;
}
