import React,{useEffect,useRef,useState} from 'react';
import type {CatalogProduct} from './catalogModel';
import {createSampleCard,type SampleCard} from './sampleCardModel';
import {useV2LeaveProtection} from './useV2LeaveProtection';

/** Confirm the product's fixed master/fabric pair; existing server owns uniqueness and live validity. */
export function ProductCardCreateDialog({product,apiFetch,onClose,onCreated}:{
 product:CatalogProduct;apiFetch:typeof fetch;onClose():void;
 onCreated(result:{card:SampleCard;created:boolean}):void;
}){
 const dialog=useRef<HTMLDialogElement>(null),inFlight=useRef(false),active=useRef(true);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 useV2LeaveProtection(false,busy);
 useEffect(()=>{
  active.current=true;const before=typeof document==='undefined'?null:document.activeElement,node=dialog.current;
  node?.showModal();return()=>{active.current=false;node?.close();if(typeof HTMLElement!=='undefined'&&before instanceof HTMLElement&&before.isConnected)before.focus();};
 },[]);
 const close=()=>{if(!inFlight.current)onClose();};
 const confirm=async()=>{
  if(inFlight.current||product.sampleCard!==null||!product.masterActive||!product.fabricActive)return;
  inFlight.current=true;setBusy(true);setError('');
  try{
   const result=await createSampleCard(apiFetch,{id:product.masterId,isActive:product.masterActive},{id:product.fabricId,isActive:product.fabricActive});
   if(active.current)onCreated(result);
  }catch(cause){if(active.current)setError(cause instanceof Error?cause.message:'建色卡失败，请重试');}
  finally{inFlight.current=false;if(active.current)setBusy(false);}
 };
 return <dialog ref={dialog} aria-label="为产品建色卡" onCancel={event=>{event.preventDefault();close();}} className="m-auto w-[min(94vw,480px)] rounded-xl border bg-white p-5 shadow-xl backdrop:bg-black/30">
  <h2 className="text-lg font-semibold">为产品建色卡</h2>
  <p className="mt-3 text-sm">花型母版：<strong>{product.masterNo}</strong></p>
  <p className="mt-2 text-sm">面料品号：<strong>{product.fabricNo}</strong> · {product.fabricName}</p>
  <p className="mt-3 text-sm text-slate-600">色卡编号：{product.masterNo+'-'+product.fabricNo}。同母版与面料的所有配色共用此卡；若其他人已建卡，将复用现有色卡。</p>
  {error&&<p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
  <footer className="mt-5 flex justify-end gap-2">
   <button type="button" disabled={busy} onClick={close} aria-label="取消建色卡" className="rounded border px-3 py-2 text-sm disabled:opacity-40">取消</button>
   <button type="button" disabled={busy||!product.masterActive||!product.fabricActive} onClick={()=>void confirm()} aria-label="确认生成色卡" className="rounded bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-40">{busy?'正在生成…':'确认生成色卡'}</button>
  </footer>
 </dialog>;
}
