import {ActionIcon} from '../product-master-v2/ActionIcon';
import React,{useEffect,useRef,useState} from 'react';
import type {PickerPage,PickerProduct,ProductSelectorFilters} from './selection';
import {buildProductSelectorUrl,validateProductSelectorPage} from './selection';

const PAGE_SIZE=20;
export interface ProductSelectorDialogProps{
 open:boolean;
 mode:'add'|'replace';
 role:'admin'|'sales';
 apiFetch:typeof fetch;
 onSelect(product:PickerProduct):void;
 onCancel():void;
 onRequestManual?():void;
 endpoint?:string;
}
export function ProductSelectorTable({items,onChoose}:{
 items:PickerProduct[];onChoose(product:PickerProduct):void;
}){
 return <div className="overflow-x-auto rounded-xl border border-slate-200">
  <table className="min-w-[930px] w-full text-xs text-slate-700">
   <thead className="bg-slate-50 text-left text-slate-500"><tr>
    {['花型缩略图','货号','品名','配色','成分','克重','门幅/cm','操作'].map(s=><th key={s} className="px-3 py-2 font-semibold">{s}</th>)}
   </tr></thead>
   <tbody>{items.map(item=><tr key={item.id} className="border-t border-slate-100 hover:bg-sky-50/40">
    <td className="px-3 py-2">{item.thumbnailUrl?
     <img src={item.thumbnailUrl} alt={`花型 ${item.masterNo} 的配色 ${item.colorwayNo}`}
       width={56} height={56} className="h-14 w-14 rounded-md object-cover border border-slate-100" loading="lazy"/>:
     <span className="inline-flex h-14 w-20 items-center justify-center rounded-md bg-slate-100 text-center text-[10px] text-slate-500">待上传花型图</span>}</td>
    <td className="px-3 py-2 font-semibold break-all">{item.productNo}</td>
    <td className="px-3 py-2 max-w-[160px] break-words">{item.fabricName}</td>
    <td className="px-3 py-2">{item.colorwayNo}</td>
    <td className="px-3 py-2 max-w-[175px] break-words">{item.composition??'—'}</td>
    <td className="px-3 py-2">{item.weight==null?'—':`${item.weight} ${item.weightUnit??''}`}</td>
    <td className="px-3 py-2">{item.widthCm??'—'}</td>
    <td className="px-3 py-2"><button type="button" onClick={()=>onChoose(item)}
      className="rounded-lg bg-sky-600 px-3 py-2 font-semibold text-white hover:bg-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-700"
      aria-label={`选用产品 ${item.productNo}`}><ActionIcon name="check"/>选用</button></td>
   </tr>)}</tbody>
  </table>
 </div>;
}
/**
 * A single reusable draft-only picker. It requires the caller's authenticated
 * V2 fetch and intentionally does not write to legacy /api/orders.
 */
export default function ProductSelectorDialog({
 open,mode,role,apiFetch,onSelect,onCancel,onRequestManual,
 endpoint='/api/v2/document-products/selector'
}:ProductSelectorDialogProps){
 const [inputNo,setInputNo]=useState('');
 const [inputName,setInputName]=useState('');
 const [filters,setFilters]=useState<Omit<ProductSelectorFilters,'limit'|'offset'>>({productNo:'',fabricName:''});
 const [offset,setOffset]=useState(0);
 const [reload,setReload]=useState(0);
 const [page,setPage]=useState<PickerPage|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const firstInput=useRef<HTMLInputElement>(null);
 const dialog=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!open)return;
  const previouslyFocused=document.activeElement instanceof HTMLElement?document.activeElement:null;
  firstInput.current?.focus();
  const keydown=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();onCancel();return;}
   if(e.key!=='Tab'||!dialog.current)return;
   const all=Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),a[href]'));
   if(all.length===0)return;
   if(e.shiftKey&&document.activeElement===all[0]){e.preventDefault();all[all.length-1].focus();}
   else if(!e.shiftKey&&document.activeElement===all[all.length-1]){e.preventDefault();all[0].focus();}
  };
  document.addEventListener('keydown',keydown);
  return ()=>{document.removeEventListener('keydown',keydown);previouslyFocused?.focus();};
 },[open,onCancel]);
 useEffect(()=>{
  if(!open)return;
  const controller=new AbortController();setBusy(true);setError('');
  (async()=>{
   try{
    const url=buildProductSelectorUrl(endpoint,{...filters,limit:PAGE_SIZE,offset});
    const response=await apiFetch(url,{signal:controller.signal,headers:{Accept:'application/json'}});
    if(!response.ok)throw Error(response.status===403?'当前账号没有开单选品权限':'产品检索失败，请重试');
    const result=validateProductSelectorPage(await response.json());
    if(!controller.signal.aborted)setPage(result);
   }catch(e){
    if(!controller.signal.aborted){setPage(null);setError(e instanceof Error?e.message:'产品检索失败');}
   }finally{if(!controller.signal.aborted)setBusy(false);}
  })();
  return ()=>controller.abort();
 },[open,filters,offset,endpoint,apiFetch,reload]);
 if(!open)return null;
 const applySearch=()=>{setPage(null);setOffset(0);setFilters({productNo:inputNo.trim(),fabricName:inputName.trim()});setReload(n=>n+1);};
 return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-3 sm:p-6">
  <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="fabric-product-selector-title"
   className="w-full max-w-6xl max-h-[88vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
   <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-100 bg-white px-4 py-3 sm:px-6">
    <div><h2 id="fabric-product-selector-title" className="text-base font-semibold text-slate-900">
     {mode==='replace'?'更换产品':'选择产品添加'}</h2>
     <p className="text-xs text-slate-500">产品带出资料为只读；选择后仅更改单行草稿，不自动保存单据</p></div>
    <button type="button" onClick={onCancel} aria-label="关闭产品选择窗口"
      className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline"><ActionIcon name="close"/></button>
   </header>
   <form onSubmit={e=>{e.preventDefault();applySearch();}}
     className="flex flex-wrap items-end gap-3 p-4 sm:px-6">
    <label className="min-w-[165px] flex-1 text-xs font-semibold text-slate-600">货号
     <input ref={firstInput} value={inputNo} maxLength={160} onChange={e=>setInputNo(e.target.value)}
       placeholder="输入完整或部分货号" className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-sky-500"/></label>
    <label className="min-w-[165px] flex-1 text-xs font-semibold text-slate-600">品名
     <input value={inputName} maxLength={255} onChange={e=>setInputName(e.target.value)}
       placeholder="输入完整或部分品名" className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-sky-500"/></label>
    <button type="submit" disabled={busy} className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"><ActionIcon name="search"/>搜索</button>
   </form>
   <div className="px-4 pb-4 sm:px-6">
    {error&&<div role="alert" className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    {busy&&<p role="status" className="mb-3 text-sm text-slate-500">正在查询产品…</p>}
    {!busy&&page?.items.length===0&&<p className="rounded-lg bg-slate-50 p-8 text-center text-sm text-slate-600">没有找到符合条件的启用产品</p>}
    {!busy&&page&&page.items.length>0&&<ProductSelectorTable items={page.items} onChoose={item=>{onSelect(item);onCancel();}}/>}
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
     <span>共 {page?.total??0} 条 · 第 {Math.floor(offset/PAGE_SIZE)+1} 页</span>
     <div className="flex items-center gap-2">
      <button type="button" disabled={busy||offset===0} onClick={()=>setOffset(Math.max(0,offset-PAGE_SIZE))}
       className="rounded border border-slate-200 px-3 py-2 disabled:opacity-40"><ActionIcon name="back"/>上一页</button>
      <button type="button" disabled={busy||!page||offset+PAGE_SIZE>=page.total}
       onClick={()=>setOffset(offset+PAGE_SIZE)}
       className="rounded border border-slate-200 px-3 py-2 disabled:opacity-40"><ActionIcon name="next"/>下一页</button>
     </div>
    </div>
    {role==='admin'&&onRequestManual&&<button type="button"
     onClick={()=>{if(window.confirm('切换为管理员手工录入？该行将不再关联产品库。')){onRequestManual();onCancel();}}}
     className="mt-3 text-xs font-semibold text-amber-700 underline"><ActionIcon name="edit"/>改为手工录入（仅管理员）</button>}
   </div>
  </div>
 </div>;
}
