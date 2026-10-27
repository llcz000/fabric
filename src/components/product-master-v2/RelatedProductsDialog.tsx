import React,{useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {parseCatalogPage,type CatalogPage} from './catalogModel';
export type RelatedProductSource={kind:'pattern'|'fabric';id:string;label:string};
const text=(value:string|null|undefined)=>value?.trim()||'未填写';
export function RelatedProductsDialog({apiFetch,source,onClose}:{apiFetch:typeof fetch;source:RelatedProductSource;onClose():void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [offset,setOffset]=useState(0),[retry,setRetry]=useState(0);
 const [data,setData]=useState<CatalogPage|null>(null),[error,setError]=useState('');
 const field=source.kind==='pattern'?'masterId':'fabricId';
 useEffect(()=>{
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const element=dialog.current;element?.showModal();
  return()=>{element?.close();previous?.focus();};
 },[]);
 useEffect(()=>{
  const controller=new AbortController();setData(null);setError('');
  void (async()=>{try{
   const params=new URLSearchParams({[field]:source.id,status:'all',limit:'20',offset:String(offset)});
   const response=await apiFetch('/api/v2/products?'+params,{signal:controller.signal});
   if(!response.ok)throw Error('关联产品读取失败，请重试。');
   const page=parseCatalogPage(await response.json());
   if(page.limit!==20||page.offset!==offset||page.items.some(item=>item[field]!==source.id))throw Error('关联产品资料无效，请重试。');
   if(controller.signal.aborted)return;
   const last=page.total?Math.floor((page.total-1)/20)*20:0;
   if(offset>last){setOffset(last);return;}setData(page);
  }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'关联产品读取失败，请重试。');}})();
  return()=>controller.abort();
 },[apiFetch,field,source.id,offset,retry]);
 const kind=source.kind==='pattern'?'花型':'面料';
 return <dialog ref={dialog} aria-label={kind+'关联产品 '+source.label} onCancel={event=>{event.preventDefault();onClose();}}
  onKeyDown={event=>{
   if(event.key!=='Tab')return;
   const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]'));
   const first=controls[0],last=controls.at(-1);
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }}
  className="m-auto max-h-[90dvh] w-[min(94vw,1000px)] max-w-none overflow-auto rounded-xl border border-[#c3c6d7] bg-white p-4 text-[#191b24] shadow-xl backdrop:bg-black/40 sm:p-5">
  <header className="mb-4 flex items-start justify-between gap-3">
   <div className="min-w-0"><h2 className="text-base font-semibold">关联产品</h2><p className="mt-1 break-words text-sm text-slate-600">{kind} · {source.label}</p></div>
   <button type="button" autoFocus onClick={onClose} aria-label="关闭关联产品" title="关闭" className="v2-icon-button shrink-0"><X size={18} aria-hidden="true"/></button>
  </header>
  {error?<div role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">{error}<button type="button" onClick={()=>setRetry(n=>n+1)} className="ml-3 underline">重试</button></div>:
   !data?<p role="status" className="py-8 text-center text-sm text-slate-500">正在读取关联产品…</p>:<>
   <p role="status" className="mb-3 text-sm text-slate-600">共 {data.total} 个产品</p>
   {!data.items.length?<p className="py-10 text-center text-sm text-slate-500">暂无关联产品</p>:
   <div className="max-h-[58dvh] overflow-auto rounded-lg border border-[#e2e1ee]" tabIndex={0} aria-label="关联产品明细">
    <table className="w-full table-fixed text-left text-sm sm:min-w-[680px]">
     <colgroup className="hidden sm:table-column-group"><col className="w-[24%]"/><col className="w-[18%]"/><col className="w-[58%]"/></colgroup>
     <thead className="sticky top-0 hidden bg-[#f8fafc] text-xs text-slate-600 sm:table-header-group"><tr>{['货号','花型编号','面料详细信息'].map(label=><th key={label} className="border-b p-3 font-medium">{label}</th>)}</tr></thead>
     <tbody className="block sm:table-row-group">{data.items.map(item=>{
      const fabricInfo=[item.fabricNo,item.fabricName,text(item.composition),
       item.weightValue===null?'未填写':item.weightValue+' '+(item.weightUnit??''),
       item.widthCm===null?'未填写':item.widthCm+' cm',text(item.fabricRemark)].join(' · ');
      return <tr key={item.id} className="block border-b border-[#e2e1ee] align-middle last:border-0 sm:table-row">
       <td className="block whitespace-nowrap px-3 pb-0 pt-2 font-semibold sm:table-cell sm:py-2">{item.productNo}</td>
       <td className="block whitespace-nowrap px-3 py-0.5 text-xs text-slate-600 sm:table-cell sm:py-2"><span className="mr-2 sm:hidden">花型</span>{item.masterNo}-{item.colorwayNo}</td>
       <td className="block min-w-0 px-3 pb-2 pt-1 sm:table-cell sm:py-2">
        <div tabIndex={0} aria-label="面料信息，可左右滚动" title={fabricInfo}
         className="overflow-x-auto whitespace-nowrap text-xs leading-5 [scrollbar-width:thin] focus-visible:outline-2 focus-visible:outline-[#346ef6]">{fabricInfo}</div>
       </td>
      </tr>;
     })}</tbody>
    </table>
   </div>}
   <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
    <span>第 {Math.floor(offset/20)+1} / {Math.max(1,Math.ceil(data.total/20))} 页</span>
    <div className="flex gap-2"><button type="button" disabled={!offset} onClick={()=>setOffset(n=>Math.max(0,n-20))} className="rounded-lg border px-3 py-2 disabled:opacity-40">上一页</button>
     <button type="button" disabled={offset+20>=data.total} onClick={()=>setOffset(n=>n+20)} className="rounded-lg border px-3 py-2 disabled:opacity-40">下一页</button></div>
   </footer>
  </>}
 </dialog>;
}
