import {sampleContactChoices,type SampleContactChoice} from '../../lib/sampleContactChoices';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createCustomerClient,emptyCustomerProfile,customerError,CustomerHttpError,type CustomerContact,type CustomerDTO} from '../customers/customerModel';
import type {SampleSessionSummary} from './sampleOperationsModel';
import type {RegisterSampleLeaveGuard} from './SampleBusinessWorkspaceV2';
import {selectionAccessRevoked} from './sampleSelectionClient';
import {useV2LeaveProtection} from './useV2LeaveProtection';
const field='min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-blue-600';
export function SampleScanCustomerStep({apiFetch,disabled=false,onSelected,onCancel,onRegisterLeaveGuard}:{apiFetch:typeof fetch;disabled?:boolean;onSelected(session:SampleSessionSummary):void;onCancel():void;onRegisterLeaveGuard?:RegisterSampleLeaveGuard}){
 const api=useMemo(()=>createCustomerClient(apiFetch),[apiFetch]),pending=useRef(false),scope=useRef(new AbortController());
 const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[offset,setOffset]=useState(0),[customers,setCustomers]=useState<CustomerDTO[]>([]),[total,setTotal]=useState(0),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0),[enabled,setEnabled]=useState<boolean|null>(null);
 const [picked,setPicked]=useState<CustomerDTO|null>(null),customerSearch=useRef<HTMLInputElement>(null),firstContact=useRef<HTMLButtonElement>(null);
 const [exactNameMatch,setExactNameMatch]=useState(false),[loadedKey,setLoadedKey]=useState('');
 const [draft,setDraft]=useState<Omit<CustomerContact,'id'>|null>(null),[needsRefresh,setNeedsRefresh]=useState(false);
 const addContact=useRef<HTMLButtonElement>(null),contactName=useRef<HTMLInputElement>(null),draftOpen=draft!==null;
 const queryKey=JSON.stringify([search,offset,retry]);
 const back=()=>{setPicked(null);setDraft(null);setNeedsRefresh(false);setError('');requestAnimationFrame(()=>customerSearch.current?.focus());};
 const closeDraft=()=>{setDraft(null);setError('');requestAnimationFrame(()=>addContact.current?.focus());};
 useEffect(()=>{if(draftOpen)contactName.current?.focus();else if(picked)(firstContact.current??addContact.current)?.focus();},[picked,draftOpen]);
 useV2LeaveProtection(false,busy);
 useEffect(()=>{const c=new AbortController();scope.current=c;return()=>c.abort();},[]);
 useEffect(()=>{onRegisterLeaveGuard?.(()=>!pending.current);return()=>onRegisterLeaveGuard?.(null);},[onRegisterLeaveGuard]);
 useEffect(()=>{const cancel=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!pending.current){event.preventDefault();if(draftOpen)closeDraft();else if(picked)back();else onCancel();}};document.addEventListener('keydown',cancel);return()=>document.removeEventListener('keydown',cancel);},[onCancel,picked,draftOpen]);
 useEffect(()=>{const timer=setTimeout(()=>{setSearch(query.trim());setOffset(0);},250);return()=>clearTimeout(timer);},[query]);
 useEffect(()=>{const c=new AbortController();setEnabled(null);void api.capability(c.signal).then(v=>{if(!c.signal.aborted)setEnabled(v.enabled);}).catch(e=>{if(!c.signal.aborted)setError(customerError(e));});return()=>c.abort();},[api,retry]);
 useEffect(()=>{if(enabled!==true){setLoading(false);return;}const c=new AbortController();setLoading(true);setCustomers([]);setError('');
  void api.list({query:search,offset,...(search?{preferExactName:'true'}:{})},c.signal).then(v=>{if(!c.signal.aborted){setCustomers(v.items);setTotal(v.total);setExactNameMatch(v.exactNameMatch??v.items.some(customer=>customer.profile.displayName===search));setLoadedKey(queryKey);}}).catch(e=>{if(!c.signal.aborted)setError(customerError(e));}).finally(()=>{if(!c.signal.aborted)setLoading(false);});return()=>c.abort();
 },[api,enabled,search,offset,retry,queryKey]);
 const waiting=loading||query.trim()!==search||loadedKey!==queryKey;
 async function choose(customer?:CustomerDTO,contactChoice?:SampleContactChoice,newContact?:Omit<CustomerContact,'id'>){
  if(pending.current||disabled||enabled!==true||(!picked&&(waiting||error))||(!customer&&(!query.trim()||exactNameMatch))||needsRefresh)return;
  pending.current=true;setBusy(true);setError('');
  try{
   const payload=customer
    ?newContact?{customerId:customer.id,newContact:{customerVersion:customer.rowVersion,contact:newContact}}:{customerId:customer.id,...(contactChoice?{contactChoice}:{})}
    :{profile:{...emptyCustomerProfile(),displayName:query.trim()}};
   const result=await api.createSession(payload,scope.current.signal);
   if(!scope.current.signal.aborted)onSelected(result.session);
  }catch(e){
   if(!scope.current.signal.aborted){
    if(selectionAccessRevoked(e)){setCustomers([]);setPicked(null);setDraft(null);setEnabled(null);}
    if(picked&&e instanceof CustomerHttpError&&e.status===409)setNeedsRefresh(true);
    setError(e instanceof CustomerHttpError&&e.code==='customer_name_taken'?'已有同名客户，请重新搜索后选择已有档案。':customerError(e));
   }
  }finally{pending.current=false;if(!scope.current.signal.aborted)setBusy(false);}
 }
 async function refreshPicked(){
  if(!picked||pending.current)return;
  pending.current=true;setBusy(true);setError('');
  try{
   const customer=await api.detail(picked.id,scope.current.signal);
   if(!scope.current.signal.aborted){
    if(!customer.canEdit||customer.deleted||customer.archived){back();setRetry(n=>n+1);return;}
    setPicked(customer);setNeedsRefresh(false);
   }
  }catch(e){
   if(!scope.current.signal.aborted){
    if(selectionAccessRevoked(e)){setCustomers([]);setPicked(null);setDraft(null);setEnabled(null);}
    setError(customerError(e));
   }
  }finally{pending.current=false;if(!scope.current.signal.aborted)setBusy(false);}
 }
 if(picked){
  const choices=sampleContactChoices(picked.profile.contacts),canAdd=picked.profile.contacts.length<20;
  const changeContact=(key:'name'|'phone'|'wechat'|'address',value:string)=>setDraft(before=>before?{...before,[key]:value}:null);
  return <section className="mx-auto max-w-xl space-y-3 p-3 sm:p-5" aria-label="选择选样联系人">
   <header className="flex items-center justify-between gap-3"><div className="min-w-0"><h2 className="font-semibold">{draft?'新增联系人':'选择联系人'}</h2><p className="break-words text-sm text-slate-600">{picked.profile.displayName}</p></div><button type="button" className="v2-business-button v2-business-touch" disabled={busy} onClick={draft?closeDraft:back}>{draft?'返回联系人':'返回选择客户'}</button></header>
   {(error||needsRefresh)&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error} {needsRefresh&&<button type="button" className="v2-business-button-quiet v2-business-touch" disabled={busy} onClick={()=>void refreshPicked()}>重新读取联系人</button>}</p>}
   {draft? <form className="space-y-3" onSubmit={e=>{e.preventDefault();if(canAdd&&draft.name.trim())void choose(picked,undefined,draft);}}>
    <fieldset disabled={busy||disabled} className="space-y-3">
     <label className="grid gap-1 text-sm">姓名<input ref={contactName} className={field} required maxLength={100} value={draft.name} onChange={e=>changeContact('name',e.target.value)}/></label>
     <div className="grid grid-cols-2 gap-3">
      <label className="grid min-w-0 gap-1 text-sm">电话<input className={field} type="tel" maxLength={100} value={draft.phone??''} onChange={e=>changeContact('phone',e.target.value)}/></label>
      <label className="grid min-w-0 gap-1 text-sm">微信<input className={field} maxLength={100} value={draft.wechat??''} onChange={e=>changeContact('wechat',e.target.value)}/></label>
     </div>
     <details><summary className="w-fit cursor-pointer py-2 text-sm text-blue-700">专用地址（选填）</summary><label className="grid gap-1 text-sm">专用地址<input className={field} maxLength={100} placeholder="留空使用客户详细地址" value={draft.address??''} onChange={e=>changeContact('address',e.target.value)}/></label></details>
    </fieldset>
    {!canAdd&&<p className="text-sm text-slate-600">此客户已达到 20 位联系人上限。</p>}
    <button className="v2-business-button-primary v2-business-touch" disabled={busy||disabled||needsRefresh||!canAdd||!draft.name.trim()}>保存并选样</button>
   </form>:<>
    {choices.length>0&&<ul className="divide-y rounded-xl border bg-white">{choices.map(({index,name},position)=><li key={index}><button ref={position===0?firstContact:undefined} type="button" className="min-h-11 w-full break-words px-3 py-2 text-left hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-40" disabled={busy||disabled||needsRefresh} onClick={()=>void choose(picked,{index,customerVersion:picked.rowVersion})}>{name}</button></li>)}</ul>}
    <div className="flex flex-wrap gap-2">
     {canAdd&&<button ref={addContact} type="button" className="v2-business-button v2-business-touch" disabled={busy||disabled||needsRefresh} onClick={()=>{setError('');setDraft({name:'',phone:null,wechat:null});}}>新增联系人</button>}
     {!choices.length&&<button type="button" className="v2-business-button-quiet v2-business-touch" disabled={busy||disabled||needsRefresh} onClick={()=>void choose(picked)}>暂不指定，继续选样</button>}
    </div>
   </>}
   {busy&&<p role="status" className="text-sm text-slate-500">正在准备选样…</p>}
  </section>;
 }
 return <section className="mx-auto max-w-xl space-y-3 p-3 sm:p-5" aria-label="扫码选样客户确认">
  <header className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">先选择客户</h2><button type="button" className="v2-business-button v2-business-touch" disabled={busy} onClick={onCancel}>取消</button></header>
  <input ref={customerSearch} autoFocus type="search" aria-label="搜索选样客户" placeholder="搜索客户或输入新客户名称" className={field} maxLength={160} disabled={busy||disabled} value={query} onChange={e=>{setQuery(e.target.value);setOffset(0);}}/>
  {error&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error} <button type="button" className="v2-business-button-quiet v2-business-touch" onClick={()=>setRetry(n=>n+1)}>重试</button></p>}
  {enabled===false&&<p role="alert">客户档案尚未启用，请先启用后再扫码选样。</p>}
  {(waiting||enabled===null)&&!error&&<p role="status" className="text-sm text-slate-500">正在读取客户…</p>}
  {!waiting&&enabled&&!error&&<div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><ul className="divide-y divide-slate-100">{customers.map(c=><li key={c.id}><button type="button" className="flex min-h-14 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-40" disabled={busy||disabled||!c.canEdit||c.archived||c.deleted} onClick={()=>{const choices=sampleContactChoices(c.profile.contacts);if(exactNameMatch||choices.length>1){setPicked(c);}else void choose(c,choices[0]?{index:choices[0].index,customerVersion:c.rowVersion}:undefined);}}><span className="min-w-0"><span className="block break-words font-medium">{c.profile.displayName}</span>{(c.profile.brands.length>0||c.profile.contacts.length>0)&&<span className="block truncate text-xs text-slate-500">{[...c.profile.brands,...c.profile.contacts.map(x=>x.name)].filter(Boolean).join(' · ')}</span>}</span><span className="shrink-0 text-sm text-blue-700">选择</span></button></li>)}</ul>
   {!customers.length&&!query.trim()&&<p className="p-3 text-sm text-slate-500">暂无客户，输入名称开始选样</p>}
   {!!query.trim()&&!exactNameMatch&&<button type="button" disabled={busy||disabled} onClick={()=>void choose()} className="v2-business-button-primary v2-business-touch w-full justify-start whitespace-normal break-words text-left">新建客户“{query.trim()}”并选样</button>}
  </div>}
  {!waiting&&!error&&total>20&&<div className="flex justify-between text-sm"><button type="button" className="v2-business-button v2-business-touch" disabled={busy||offset===0} onClick={()=>setOffset(n=>n-20)}>上一页</button><button type="button" className="v2-business-button v2-business-touch" disabled={busy||offset+20>=total} onClick={()=>setOffset(n=>n+20)}>下一页</button></div>}
  {busy&&<p role="status" className="text-sm text-slate-500">正在准备选样…</p>}
 </section>;
}
