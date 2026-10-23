import {ActionIcon} from './ActionIcon';
import React,{useEffect,useRef,useState} from 'react';
import {DialogDismissButton} from '../ui/DialogDismissButton';
import {parseCatalogPage,resolveImageUrls,type CatalogPage} from './catalogModel';
import type {SampleCard} from './sampleCardModel';
const button='rounded border px-3 py-1.5 text-sm disabled:opacity-40';
function PatternThumbnail({url,number}:{url?:string;number:string}){
 const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[url]);
 return url&&!failed?<img src={url} alt={'花型 '+number} loading="lazy" width={120} height={120} onError={()=>setFailed(true)} className="h-28 w-full rounded bg-slate-50 object-contain"/>:<div className="flex h-28 items-center justify-center rounded border border-dashed text-xs text-slate-500">{failed?'图片加载失败':'暂无缩略图'}</div>;
}
export function SampleCardPatternsDialog({card,apiFetch,onClose}:{card:Pick<SampleCard,'id'|'masterId'|'fabricId'|'cardNo'>;apiFetch:typeof fetch;onClose():void}){
 const dialog=useRef<HTMLDialogElement>(null),[offset,setOffset]=useState(0),[retry,setRetry]=useState(0),[page,setPage]=useState<CatalogPage|null>(null),[urls,setUrls]=useState(new Map<string,string>()),[error,setError]=useState(''),[imageError,setImageError]=useState(false),[loading,setLoading]=useState(true);
 useEffect(()=>{const before=document.activeElement,node=dialog.current;node?.showModal();return()=>{node?.close();if(before instanceof HTMLElement&&before.isConnected)before.focus();};},[]);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setPage(null);setUrls(new Map());setError('');setImageError(false);
  void (async()=>{
   const query=new URLSearchParams({masterId:card.masterId,fabricId:card.fabricId,status:'all',limit:'20',offset:String(offset)}),response=await apiFetch('/api/v2/products?'+query,{signal:controller.signal,cache:'no-store'});
   if(!response.ok)throw Error('关联花型读取失败，请重试');const result=parseCatalogPage(await response.json());
   if(result.items.some(p=>p.masterId!==card.masterId||p.fabricId!==card.fabricId))throw Error('关联花型资料不匹配，请刷新色卡列表');
    if(result.items.some(p=>p.sampleCard!==undefined&&p.sampleCard?.id!==card.id))throw Error('色卡关联已变化，请刷新列表后重试');
   if(controller.signal.aborted)return;setPage(result);setLoading(false);
   try{const ids=[...new Set(result.items.map(p=>p.patternImageAssetId).filter((id):id is string=>Boolean(id)))],resolved=await resolveImageUrls(apiFetch,ids,'thumbnail',controller.signal);if(!controller.signal.aborted)setUrls(resolved);}
   catch{if(!controller.signal.aborted)setImageError(true);}
  })().catch(cause=>{if(!controller.signal.aborted){setError(cause instanceof Error?cause.message:'关联花型读取失败');setLoading(false);}});
  return()=>controller.abort();
  },[apiFetch,card.id,card.masterId,card.fabricId,offset,retry]);
 return <dialog ref={dialog} aria-label={'色卡关联花型 '+card.cardNo} onCancel={e=>{e.preventDefault();onClose();}} className="m-auto max-h-[88vh] w-[min(94vw,760px)] overflow-y-auto rounded-xl border bg-white p-5 shadow-xl backdrop:bg-black/30">
   <header className="mb-4 flex items-center justify-between gap-3 border-b border-[#edf0f2] pb-3"><div className="min-w-0"><p className="mb-0.5 text-[11px] tracking-wide text-slate-500">色卡 · 花型浏览</p><h2 className="truncate text-[17px] font-semibold text-[#1e293b]">{card.cardNo}</h2></div><DialogDismissButton onClick={onClose} label="关闭花型预览"/></header>
  {loading&&<p role="status">正在读取花型…</p>}{error&&<p role="alert">{error} <button type="button" className={button} onClick={()=>setRetry(n=>n+1)}><ActionIcon name="refresh"/>重试</button></p>}{imageError&&<p role="alert" className="mb-3 text-sm">缩略图暂不可用 <button type="button" className={button} onClick={()=>setRetry(n=>n+1)}><ActionIcon name="refresh"/>重试</button></p>}
  {page&&<><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{page.items.map(p=>{const number=p.masterNo+'-'+p.colorwayNo;return <figure key={p.id} className="min-w-0 rounded border p-2"><PatternThumbnail number={number} url={p.patternImageAssetId?urls.get(p.patternImageAssetId):undefined}/><figcaption className="mt-2 break-all text-center text-sm">{number}</figcaption></figure>;})}</div>{!page.items.length&&<p className="py-6 text-center text-sm text-slate-500">此色卡暂无关联产品花型</p>}<footer className="mt-4 flex items-center justify-between gap-2 text-sm"><span>共 {page.total} 个花型</span><div className="flex gap-2"><button className={button} disabled={offset===0} onClick={()=>setOffset(n=>Math.max(0,n-20))}><ActionIcon name="back"/>上一页</button><button className={button} disabled={offset+page.limit>=page.total} onClick={()=>setOffset(n=>n+20)}><ActionIcon name="next"/>下一页</button></div></footer></>}
 </dialog>;
}
