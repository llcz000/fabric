import React,{useEffect,useRef,useState} from 'react';
import {ActionIcon} from '../product-master-v2/ActionIcon';
import {CustomerChoice,type CustomerChoiceValue} from './CustomerChoice';

/**
 * Document-only compact customer entry. The shared customer search and quick
 * draft form live inside a dialog; cancelling never mutates the saved draft.
 */
export function CompactCustomerChoice({apiFetch,value,onChange,disabled=false}:{
 apiFetch:typeof fetch;
 value:CustomerChoiceValue|null;
 onChange(value:CustomerChoiceValue|null):void;
 disabled?:boolean;
}){
 const [open,setOpen]=useState(false);
 const [pending,setPending]=useState<CustomerChoiceValue|null>(null);
 const [validation,setValidation]=useState('');
 const trigger=useRef<HTMLButtonElement>(null);
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  if(!open)return;
  const node=dialog.current;
  node?.showModal();
  node?.querySelector<HTMLInputElement>('input')?.focus();
  return()=>{if(node?.open)node.close();trigger.current?.focus();};
 },[open]);
 const begin=()=>{setPending(value);setValidation('');setOpen(true);};
 const close=()=>{setOpen(false);setValidation('');};
 const useChoice=()=>{
  if(!pending){setValidation('请选择已有客户或快速建档');return;}
  if('profile' in pending&&!pending.profile.displayName.trim()){setValidation('请填写客户名称');return;}
  onChange(pending);close();
 };
 const display=value?('customerId' in value?value.name:value.profile.displayName.trim()):'';
 return <>
  <div className="min-w-0 space-y-1.5" role="group" aria-label="客户/收货单位">
   <span className="block text-xs font-semibold text-slate-700">客户/收货单位 <span className="text-rose-600">*</span></span>
   <button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={open} disabled={disabled}
    onClick={begin} title={display||"选择客户 / 快速建档"} className="flex h-[38px] w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-left text-sm font-medium text-slate-800 transition-colors hover:border-sky-400 hover:bg-sky-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600 disabled:cursor-not-allowed disabled:opacity-50">
    <span className={'min-w-0 flex-1 truncate '+(!display?'text-slate-500':'')}>{display||'选择客户 / 快速建档'}</span>
    <span className="shrink-0 text-sky-700"><ActionIcon name="edit"/></span>
   </button>
  </div>
  {open&&<dialog ref={dialog} aria-label="选择客户/收货单位"
    onCancel={e=>{if(e.target!==e.currentTarget)return;e.preventDefault();close();}}
    className="m-auto max-h-[min(88vh,760px)] w-[min(94vw,680px)] overflow-y-auto rounded-2xl border-0 bg-white p-0 text-slate-800 shadow-2xl backdrop:bg-slate-950/45">
    <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-100 bg-white px-4 py-3 sm:px-5">
     <h2 className="text-base font-semibold">选择客户/收货单位</h2>
     <button type="button" aria-label="关闭客户选择窗口" onClick={close}
      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600"><ActionIcon name="close"/></button>
    </header>
    <div className="space-y-3 px-4 py-4 sm:px-5">
     <CustomerChoice embedded apiFetch={apiFetch} value={pending} onChange={next=>{setPending(next);setValidation('');}}/>
     {validation&&<p role="alert" className="text-sm text-rose-700">{validation}</p>}
    </div>
    <footer className="sticky bottom-0 flex flex-col gap-3 border-t border-slate-100 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
     <span className="text-xs text-slate-500">新客户在保存单据时同步建档</span>
     <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
      <button type="button" onClick={close} className="inline-flex min-h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600">取消</button>
      <button type="button" onClick={useChoice} disabled={!pending||('profile' in pending&&!pending.profile.displayName.trim())}
       className="inline-flex min-h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600 disabled:cursor-not-allowed disabled:opacity-40">确认使用</button>
     </div>
    </footer>
   </dialog>}
 </>;
}
