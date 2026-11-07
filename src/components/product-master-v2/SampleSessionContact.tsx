import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createCustomerClient,customerError} from '../customers/customerModel';
import type {SampleContactAssignment,SampleContactOptions} from '../../lib/sampleContactChoices';
import {selectionAccessRevoked} from './sampleSelectionClient';

export function SampleSessionContact({sessionId,apiFetch,onClose,onSaved,onBusyChange,onAccessLost}:{
 sessionId:string;apiFetch:typeof fetch;onClose():void;onSaved(value:SampleContactAssignment):void;
 onBusyChange(value:boolean):void;onAccessLost():void;
}){
 const api=useMemo(()=>createCustomerClient(apiFetch),[apiFetch]);
 const dialog=useRef<HTMLDialogElement>(null),scope=useRef(new AbortController()),pending=useRef(false);
 const [options,setOptions]=useState<SampleContactOptions|null>(null),[value,setValue]=useState('current');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0),[stale,setStale]=useState(false);
 useEffect(()=>{
  const element=dialog.current,previous=document.activeElement;
  element?.showModal();
  return()=>{if(element?.open)element.close();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};
 },[]);
 useEffect(()=>{
  const controller=new AbortController();scope.current=controller;
  setOptions(null);setError('');setValue('current');setStale(false);
  void api.sessionContact(sessionId,controller.signal).then(result=>{if(!controller.signal.aborted)setOptions(result);}).catch(cause=>{
   if(controller.signal.aborted)return;
   if(selectionAccessRevoked(cause))onAccessLost();else setError(customerError(cause));
  });
  return()=>controller.abort();
 },[api,sessionId,revision,onAccessLost]);
 async function save(event:React.FormEvent){
  event.preventDefault();if(!options||value==='current'||pending.current||stale)return;
  pending.current=true;setBusy(true);onBusyChange(true);setError('');
  const signal=scope.current.signal;
  try{
   const selected=value==='unassigned'?null:{index:Number(value),customerVersion:options.customerVersion};
   const saved=await api.saveSessionContact(sessionId,options.linkVersion,selected,signal);
   if(!signal.aborted){onSaved(saved);onClose();}
  }catch(cause){
   if(!signal.aborted){
    if(selectionAccessRevoked(cause))onAccessLost();
    else{setError(customerError(cause));setStale((cause as {status?:number}).status===409);}
   }
  }finally{pending.current=false;onBusyChange(false);if(!signal.aborted)setBusy(false);}
 }
 return <dialog ref={dialog} aria-label="编辑本单联系人" className="m-auto w-[min(92vw,420px)] rounded-xl border border-slate-200 p-4 shadow-xl backdrop:bg-black/30" onCancel={e=>{e.preventDefault();if(!pending.current)onClose();}}>
  <form onSubmit={save} className="space-y-3">
   <h3 className="font-semibold">编辑本单联系人</h3>
   {options?<label className="block text-sm">联系人<select aria-label="本单联系人" className="mt-1 block min-h-11 w-full rounded-lg border bg-white px-2 text-base" value={value} disabled={busy||stale} onChange={e=>setValue(e.target.value)}>
    <option value="current">{options.contactName??'未指定'}</option>
    {options.contactName&&<option value="unassigned">未指定</option>}
    {options.choices.filter(choice=>options.selectedIndex===undefined?choice.name!==options.contactName:choice.index!==options.selectedIndex).map(choice=><option key={choice.index} value={choice.index}>{choice.name}</option>)}
   </select></label>:!error&&<p role="status" className="text-sm text-slate-500">正在读取联系人…</p>}
   {error&&<p role="alert" className="text-sm text-rose-700">{error} {(!options||stale)&&<button type="button" className="min-h-11 underline" onClick={()=>setRevision(n=>n+1)}>重新读取</button>}</p>}
   <footer className="flex justify-end gap-2">
    <button type="button" className="min-h-11 rounded-lg border px-3 text-sm" disabled={busy} onClick={onClose}>取消</button>
    <button type="submit" className="min-h-11 rounded-lg bg-blue-700 px-3 text-sm text-white disabled:opacity-40" disabled={busy||stale||!options||value==='current'}>保存</button>
   </footer>
  </form>
 </dialog>;
}
