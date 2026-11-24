import {useEffect,useRef,useState} from 'react';
import {RelatedProductsDialog} from './RelatedProductsDialog';
import {useV2LeaveProtection} from './useV2LeaveProtection';
import {v2Route} from './v2Navigation';

interface Impact{
 colorwayCount:number;
 productCount:number;
 orderedProductCount:number;
 independentCardCount:number;
}
const fields=['colorwayCount','productCount','orderedProductCount','independentCardCount'] as const;
const secondary='rounded border border-slate-300 px-4 py-2 text-sm';
const primary='rounded bg-[#0053da] px-4 py-2 text-sm text-white';

export function PatternDeleteDialog({apiFetch,kind,id,label,onClose,onDelete}:{
 apiFetch:typeof fetch;kind:'pattern'|'colorway';id:string;label:string;onClose():void;onDelete():Promise<void>;
}){
 const dialog=useRef<HTMLDialogElement>(null),closeButton=useRef<HTMLButtonElement>(null);
 const [impact,setImpact]=useState<Impact|null>(null),[checking,setChecking]=useState(true),[revision,setRevision]=useState(0);
 const [readError,setReadError]=useState(''),[deleteError,setDeleteError]=useState('');
 const [busy,setBusy]=useState(false),[showProducts,setShowProducts]=useState(false);
 const inFlight=useRef(false);
 useV2LeaveProtection(false,busy);
 const refresh=()=>{setChecking(true);setRevision(n=>n+1);};
 useEffect(()=>{
  const before=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const element=dialog.current;element?.showModal();closeButton.current?.focus();
  return()=>{element?.close();before?.focus();};
 },[]);
 useEffect(()=>{
  const onFocus=()=>{if(!inFlight.current)refresh();};
  window.addEventListener('focus',onFocus);
  return()=>window.removeEventListener('focus',onFocus);
 },[]);
 useEffect(()=>{
  const controller=new AbortController();
  const resource=kind==='pattern'?'pattern-masters':'pattern-colorways';
  setReadError('');
  void (async()=>{
   try{
    const res=await apiFetch('/api/v2/'+resource+'/'+id+'/deletion-impact',{signal:controller.signal,cache:'no-store'});
    if(!res.ok)throw Error(res.status===404?'这条记录已不存在。':'关联检查失败，请重试。');
    const value=await res.json() as Impact;
    if(!value||fields.some(field=>!Number.isSafeInteger(value[field])||value[field]<0)||value.orderedProductCount>value.productCount)
     throw Error('关联检查结果不完整，请重试。');
    if(!controller.signal.aborted)setImpact(value);
   }catch(error){
    if(!controller.signal.aborted){setImpact(null);setReadError(error instanceof Error?error.message:'关联检查失败，请重试。');}
   }finally{if(!controller.signal.aborted)setChecking(false);}
  })();
  return()=>controller.abort();
 },[apiFetch,kind,id,revision]);
 const blocked=Boolean(impact&&(impact.productCount||impact.independentCardCount));
 const remove=async()=>{
  if(!impact||checking||blocked||inFlight.current)return;
  inFlight.current=true;setBusy(true);setDeleteError('');
  try{await onDelete();onClose();}
  catch(error){
   setDeleteError(error instanceof Error?error.message:'删除失败，请重试。');
   refresh();
  }finally{inFlight.current=false;setBusy(false);}
 };
 const name=kind==='pattern'?'花型':'配色';
 return <dialog ref={dialog} role="alertdialog" aria-label={'删除'+name+'确认'} aria-modal="true"
  onCancel={event=>{event.preventDefault();if(!inFlight.current)onClose();}}
  className="m-auto w-[min(94vw,480px)] rounded-xl border border-[#c3c6d7] bg-white p-5 text-[#191b24] shadow-xl backdrop:bg-black/40">
  <h2 className="break-words text-base font-semibold">删除{name} {label}？</h2>
  {checking&&<p role="status" className="mt-3 text-sm text-slate-600">正在检查关联资料…</p>}
  {readError&&<p role="alert" className="mt-3 text-sm text-rose-700">{readError}</p>}
  {deleteError&&<p role="alert" className="mt-3 text-sm text-rose-700">{deleteError}</p>}
  {impact&&<div className="mt-3 space-y-2 text-sm">
   {blocked?<><p className="font-medium text-amber-800">当前无法删除</p>
    {impact.productCount>0&&<p>关联 {impact.productCount} 款产品，其中 {impact.orderedProductCount} 款被单据引用。请先核对关联产品。</p>}
    {impact.independentCardCount>0&&<p>另有 {impact.independentCardCount} 张有效色卡没有对应产品，请到色卡库核对。</p>}
   </>:<p className="text-slate-700">{kind==='pattern'
     ?'将删除整个花型及其 '+impact.colorwayCount+' 个配色。'
     :'将删除该配色及其花型图。'}删除后无法恢复。</p>}
  </div>}
  <div className="mt-5 flex flex-wrap justify-end gap-2">
   <button ref={closeButton} type="button" disabled={busy} onClick={onClose} className={secondary}>{blocked?'关闭':'取消'}</button>
   {readError&&<button type="button" className={primary} onClick={refresh}>重试</button>}
   {impact&&impact.independentCardCount>0&&<a href={v2Route('cards',{query:label})} target="_blank" rel="noopener" className={secondary}>去色卡库核对</a>}
   {impact&&impact.productCount>0&&<button type="button" onClick={()=>setShowProducts(true)} className={primary}>查看关联产品</button>}
   {impact&&!blocked&&!checking&&<button type="button" disabled={busy} onClick={()=>void remove()} className="rounded bg-rose-700 px-4 py-2 text-sm text-white">{busy?'正在删除…':'确认删除'}</button>}
  </div>
  {showProducts&&<RelatedProductsDialog apiFetch={apiFetch} source={{kind,id,label}} showActions
   onClose={()=>{setShowProducts(false);refresh();}}/>}
 </dialog>;
}
