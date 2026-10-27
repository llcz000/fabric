import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createCustomerClient,emptyCustomerProfile,customerError,type CustomerDTO} from '../customers/customerModel';
import type {SampleSessionSummary} from './sampleOperationsModel';
import type {RegisterSampleLeaveGuard} from './SampleBusinessWorkspaceV2';
import {selectionAccessRevoked} from './sampleSelectionClient';
import {useV2LeaveProtection} from './useV2LeaveProtection';
const field='min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-blue-600';
export function SampleScanCustomerStep({apiFetch,disabled=false,onSelected,onCancel,onRegisterLeaveGuard}:{apiFetch:typeof fetch;disabled?:boolean;onSelected(session:SampleSessionSummary):void;onCancel():void;onRegisterLeaveGuard?:RegisterSampleLeaveGuard}){
 const api=useMemo(()=>createCustomerClient(apiFetch),[apiFetch]),pending=useRef(false),scope=useRef(new AbortController());
 const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[offset,setOffset]=useState(0),[customers,setCustomers]=useState<CustomerDTO[]>([]),[total,setTotal]=useState(0),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0),[enabled,setEnabled]=useState<boolean|null>(null);
 useV2LeaveProtection(false,busy);
 useEffect(()=>{const c=new AbortController();scope.current=c;return()=>c.abort();},[]);
 useEffect(()=>{onRegisterLeaveGuard?.(()=>!pending.current);return()=>onRegisterLeaveGuard?.(null);},[onRegisterLeaveGuard]);
 useEffect(()=>{const cancel=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!pending.current){event.preventDefault();onCancel();}};document.addEventListener('keydown',cancel);return()=>document.removeEventListener('keydown',cancel);},[onCancel]);
 useEffect(()=>{const timer=setTimeout(()=>{setSearch(query.trim());setOffset(0);},250);return()=>clearTimeout(timer);},[query]);
 useEffect(()=>{const c=new AbortController();setEnabled(null);void api.capability(c.signal).then(v=>{if(!c.signal.aborted)setEnabled(v.enabled);}).catch(e=>{if(!c.signal.aborted)setError(customerError(e));});return()=>c.abort();},[api,retry]);
 useEffect(()=>{if(enabled!==true){setLoading(false);return;}const c=new AbortController();setLoading(true);setCustomers([]);setError('');
  void api.list({query:search,offset},c.signal).then(v=>{if(!c.signal.aborted){setCustomers(v.items);setTotal(v.total);}}).catch(e=>{if(!c.signal.aborted)setError(customerError(e));}).finally(()=>{if(!c.signal.aborted)setLoading(false);});return()=>c.abort();
 },[api,enabled,search,offset,retry]);
 const waiting=loading||query.trim()!==search;
 async function choose(customer?:CustomerDTO){
  if(pending.current||disabled||enabled!==true||waiting||error||(!customer&&!query.trim()))return;
  pending.current=true;setBusy(true);setError('');
  try{const result=await api.createSession(customer?{customerId:customer.id}:{profile:{...emptyCustomerProfile(),displayName:query.trim()}},scope.current.signal);if(!scope.current.signal.aborted)onSelected(result.session);}
  catch(e){if(!scope.current.signal.aborted){if(selectionAccessRevoked(e)){setCustomers([]);setEnabled(null);}setError(customerError(e));}}finally{pending.current=false;if(!scope.current.signal.aborted)setBusy(false);}
 }
 return <section className="mx-auto max-w-xl space-y-3 p-3 sm:p-5" aria-label="扫码选样客户确认">
  <header className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">先选择客户</h2><button type="button" className="min-h-11 rounded-lg px-3 text-sm text-slate-600" disabled={busy} onClick={onCancel}>取消</button></header>
  <input autoFocus type="search" aria-label="搜索选样客户" placeholder="搜索客户或输入新客户名称" className={field} maxLength={160} disabled={busy||disabled} value={query} onChange={e=>{setQuery(e.target.value);setOffset(0);}}/>
  {error&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error} <button type="button" className="min-h-11 underline" onClick={()=>setRetry(n=>n+1)}>重试</button></p>}
  {enabled===false&&<p role="alert">客户档案尚未启用，请先启用后再扫码选样。</p>}
  {(waiting||enabled===null)&&!error&&<p role="status" className="text-sm text-slate-500">正在读取客户…</p>}
  {!waiting&&enabled&&!error&&<div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><ul className="divide-y divide-slate-100">{customers.map(c=><li key={c.id}><button type="button" className="flex min-h-14 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-40" disabled={busy||disabled||!c.canEdit||c.archived||c.deleted} onClick={()=>void choose(c)}><span className="min-w-0"><span className="block break-words font-medium">{c.profile.displayName}</span>{(c.profile.brands.length>0||c.profile.contacts.length>0)&&<span className="block truncate text-xs text-slate-500">{[...c.profile.brands,...c.profile.contacts.map(x=>x.name)].filter(Boolean).join(' · ')}</span>}</span><span className="shrink-0 text-sm text-blue-700">选择</span></button></li>)}</ul>
   {!customers.length&&!query.trim()&&<p className="p-3 text-sm text-slate-500">暂无客户，输入名称开始选样</p>}
   {!!query.trim()&&<button type="button" disabled={busy||disabled} onClick={()=>void choose()} className="min-h-11 w-full break-words border-t border-slate-100 bg-blue-50/50 px-3 py-3 text-left text-sm text-blue-700">新建客户“{query.trim()}”并选样</button>}
  </div>}
  {!waiting&&!error&&total>20&&<div className="flex justify-between text-sm"><button type="button" className="min-h-11 px-2" disabled={busy||offset===0} onClick={()=>setOffset(n=>n-20)}>上一页</button><button type="button" className="min-h-11 px-2" disabled={busy||offset+20>=total} onClick={()=>setOffset(n=>n+20)}>下一页</button></div>}
  {!waiting&&customers.some(c=>c.profile.displayName===query.trim())&&<p className="text-xs text-amber-800">已有同名客户；仍选择新建会创建独立客户。</p>}
  {busy&&<p role="status" className="text-sm text-slate-500">正在准备选样…</p>}
 </section>;
}
