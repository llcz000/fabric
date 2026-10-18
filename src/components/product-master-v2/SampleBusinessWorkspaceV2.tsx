import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {SampleSelectionWorkspaceV2} from './SampleSelectionWorkspaceV2';
import {SampleOperationsPanel} from './SampleOperationsPanel';
import {CardPhotoInput} from './CardPhotoInput';
import {createSampleOperationsClient,type SampleSessionDirectory,type SampleSessionSummary} from './sampleOperationsModel';
import {selectionAccessRevoked} from './sampleSelectionClient';
const button='rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40';
const field='rounded border border-slate-300 px-3 py-2 text-sm';
export type RegisterSampleLeaveGuard=(guard:(()=>boolean)|null)=>void;
export function SampleBusinessWorkspaceV2({apiFetch,onRegisterLeaveGuard}:{apiFetch:typeof fetch;onRegisterLeaveGuard?:RegisterSampleLeaveGuard}){
 // React must discard private customer state synchronously on adapter/identity change.
 const identity=useRef({fetch:apiFetch,revision:0});if(identity.current.fetch!==apiFetch)identity.current={fetch:apiFetch,revision:identity.current.revision+1};
 return <Directory key={identity.current.revision} apiFetch={apiFetch} onRegisterLeaveGuard={onRegisterLeaveGuard}/>;
}
function Directory({apiFetch,onRegisterLeaveGuard}:{apiFetch:typeof fetch;onRegisterLeaveGuard?:RegisterSampleLeaveGuard}){
 const api=useMemo(()=>createSampleOperationsClient(apiFetch),[apiFetch]);
 const [active,setActive]=useState<SampleSessionSummary|null>(null),[data,setData]=useState<SampleSessionDirectory|null>(null);
 const [draft,setDraft]=useState(''),[query,setQuery]=useState(''),[offset,setOffset]=useState(0),[revision,setRevision]=useState(0),[customer,setCustomer]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const scope=useRef<AbortController|null>(null),pending=useRef(false);
 useEffect(()=>{if(active)return;onRegisterLeaveGuard?.(()=>!pending.current);return()=>onRegisterLeaveGuard?.(null);},[active,onRegisterLeaveGuard]);
 useEffect(()=>{
  const controller=new AbortController();scope.current=controller;if(active)return()=>controller.abort();
  setData(null);setError('');setLoading(true);
  void api.directory(query,offset,controller.signal).then(result=>{if(!controller.signal.aborted)setData(result);})
   .catch(cause=>{if(!controller.signal.aborted){setData(null);setError(selectionAccessRevoked(cause)?'访问权限已失效，请重新登录':'选样单读取失败，请重试');}})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[api,query,offset,revision,active]);
 async function create(event:React.FormEvent){
  event.preventDefault();if(pending.current||!customer.trim())return;const controller=scope.current;if(!controller||controller.signal.aborted)return;
  pending.current=true;setBusy(true);setError('');
  try{const result=await api.create(customer,controller.signal);if(!controller.signal.aborted){setCustomer('');setActive(result);}}
  catch(cause){if(!controller.signal.aborted){setError(selectionAccessRevoked(cause)?'访问权限已失效，请重新登录':'新建未确认，请先搜索客户核对是否已创建');}}
  finally{pending.current=false;setBusy(false);}
 }
 if(active)return <Session key={active.id} session={active} onStatusChanged={setActive} apiFetch={apiFetch} onRegisterLeaveGuard={onRegisterLeaveGuard} onBack={()=>{setActive(null);setRevision(n=>n+1);}}/>;
 return <section aria-label="客户选样" className="space-y-4 p-4 sm:p-6"><header><h2 className="text-xl font-semibold">客户选样</h2><p className="mt-1 text-sm text-slate-500">按客户管理选样、实际寄样和跟进记录。</p></header>
  <form onSubmit={create} className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4" aria-label="新建选样单"><label className="flex flex-col gap-1 text-sm">客户名称<input required maxLength={160} className={field} value={customer} onChange={e=>setCustomer(e.target.value)} disabled={busy}/></label><button disabled={busy||loading||!customer.trim()} className="rounded bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-40">{busy?'正在新建…':'新建选样单'}</button></form>
  <form onSubmit={e=>{e.preventDefault();setOffset(0);setQuery(draft);setRevision(n=>n+1);}} className="flex flex-wrap gap-2"><input aria-label="搜索客户" className={field} maxLength={160} placeholder="搜索客户" value={draft} onChange={e=>setDraft(e.target.value)}/><button className={button} disabled={busy}>查询</button><button type="button" className={button} disabled={busy} onClick={()=>setRevision(n=>n+1)}>刷新列表</button></form>
  {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}{loading&&<p role="status">正在读取选样单…</p>}
  {data&&!loading&&<div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-3">客户</th><th className="p-3">状态</th><th className="p-3">操作</th></tr></thead><tbody>{data.items.map(item=><tr className="border-t" key={item.id}><td className="p-3">{item.customerReference}</td><td className="p-3">{item.status==='open'?'进行中':'已结束'}</td><td className="p-3"><button className="text-blue-700 disabled:opacity-40" disabled={busy} onClick={()=>{if(!pending.current)setActive(item);}}>查看选样</button></td></tr>)}</tbody></table>{!data.items.length&&<p className="p-4 text-sm text-slate-500">{query?'没有匹配的选样单':'暂无选样单，请填写客户名称后新建。'}</p>}<footer className="flex items-center justify-between border-t p-3 text-sm"><span>共 {data.total} 张</span><div className="flex gap-2"><button className={button} disabled={offset===0||busy} onClick={()=>setOffset(n=>Math.max(0,n-20))}>上一页</button><button className={button} disabled={offset+20>=data.total||busy} onClick={()=>setOffset(n=>n+20)}>下一页</button></div></footer></div>}
 </section>;
}
function Session({session,apiFetch,onBack,onRegisterLeaveGuard,onStatusChanged}:{session:SampleSessionSummary;apiFetch:typeof fetch;onBack:()=>void;onRegisterLeaveGuard?:RegisterSampleLeaveGuard;onStatusChanged(value:SampleSessionSummary):void}){
 const api=useMemo(()=>createSampleOperationsClient(apiFetch),[apiFetch]);
 const [tab,setTab]=useState<'selection'|'shipments'|'followups'>('selection'),[revision,setRevision]=useState(0),[token,setToken]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revoked,setRevoked]=useState(false),[photoBusy,setPhotoBusy]=useState(false);
 const accessRevoked=useCallback(()=>setRevoked(true),[]);
 const scope=useRef(new AbortController()),pending=useRef(false),dirty=useRef(false),operationBusy=useRef(false);
 useEffect(()=>{const controller=new AbortController();scope.current=controller;return()=>controller.abort();},[]);
 const canLeave=useCallback(()=>{if(pending.current||operationBusy.current)return false;if(dirty.current&&!window.confirm('有未保存的寄样或跟进资料，确认放弃？'))return false;dirty.current=false;return true;},[]);
 useEffect(()=>{onRegisterLeaveGuard?.(canLeave);return()=>onRegisterLeaveGuard?.(null);},[canLeave,onRegisterLeaveGuard]);
 const leave=(action:()=>void)=>{if(canLeave())action();};
 async function changeStatus(){
  if(photoBusy||pending.current||operationBusy.current)return;
  const next=session.status==='open'?'closed':'open';
  if(!window.confirm(next==='closed'?'结束后选样、寄样和跟进资料将只读，可重新开启。确认结束选样单？':'确认重新开启选样单？'))return;
  const hadDraft=dirty.current;if(!canLeave())return;
  if(hadDraft)setRevision(n=>n+1); // Explicitly discarded drafts must also clear if the status request fails.
  pending.current=true;setBusy(true);setError('');const controller=scope.current;
  try{const value=await api.changeStatus(session.id,session.status,next,controller.signal);if(!controller.signal.aborted){onStatusChanged(value);setRevision(n=>n+1);setNotice(next==='closed'?'选样单已结束':'选样单已重新开启');}}
  catch(cause){if(!controller.signal.aborted){if(selectionAccessRevoked(cause))setRevoked(true);setError('状态变更未确认，请返回列表刷新核对后重试。');}}
  finally{pending.current=false;if(!controller.signal.aborted)setBusy(false);}
 }
 async function scan(event:React.FormEvent){
  event.preventDefault();if(pending.current||photoBusy||session.status!=='open')return;pending.current=true;setBusy(true);setError('');setNotice('');const controller=scope.current;
  try{const result=await api.scan(session.id,token.trim(),controller.signal);if(!controller.signal.aborted){setToken('');setRevision(n=>n+1);setNotice('已加入 '+result.addedProductIds.length+' 款；重复产品保持原选择。');}}
  catch(cause){if(!controller.signal.aborted){if(selectionAccessRevoked(cause))setRevoked(true);setError(selectionAccessRevoked(cause)?'访问权限已失效，请返回列表':(cause as {status?:number}).status?'色卡不可用或当前没有可选产品，请核对后重试':cause instanceof Error?cause.message:'扫码失败');}}
  finally{pending.current=false;if(!controller.signal.aborted)setBusy(false);}
 }
 if(revoked)return <section className="space-y-4 p-6"><p role="alert">访问权限已失效，请返回列表</p><button className={button} onClick={onBack}>返回客户选样</button></section>;
 return <section className="space-y-4 p-4 sm:p-6" aria-label="客户选样业务"><header className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">{session.customerReference} · 选样单</h2><button className={button} disabled={busy} onClick={()=>leave(onBack)}>返回客户选样</button></header><div className="flex flex-wrap items-center gap-3"><span className="text-sm text-slate-600">状态：{session.status==='open'?'进行中':'已结束（只读）'}</span><button className={button} disabled={busy||photoBusy} onClick={()=>void changeStatus()}>{session.status==='open'?'结束选样单':'重新开启'}</button></div>{error&&<p role="alert">{error}</p>}<nav className="flex gap-2" aria-label="选样业务分类">{([['selection','选样明细'],['shipments','寄样记录'],['followups','客户跟进']] as const).map(([id,label])=><button key={id} role="tab" aria-selected={tab===id} className={button+(tab===id?' font-semibold text-blue-700':'')} disabled={busy} onClick={()=>leave(()=>{setTab(id);setError('');setNotice('');})}>{label}</button>)}</nav>
  {tab==='selection'?<>{session.status==='open'&&<form className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-4" onSubmit={scan} aria-label="扫码加入选样"><CardPhotoInput disabled={busy} onBusyChange={setPhotoBusy} onDecoded={value=>{setToken(value);setError('');setNotice('已识别色卡，请点击扫码加入');}}/><label className="flex flex-col gap-1 text-sm">扫描或输入色卡编码<input className={field} autoComplete="off" maxLength={128} value={token} onChange={e=>setToken(e.target.value)} disabled={busy||photoBusy}/></label><button className={button} disabled={busy||photoBusy||!token.trim()}>{busy?'正在加入…':'扫码加入'}</button></form>}{notice&&<p role="status">{notice}</p>}<SampleSelectionWorkspaceV2 key={revision} sessionId={session.id} apiFetch={apiFetch} onAccessRevoked={accessRevoked}/></>:<SampleOperationsPanel key={tab+':'+revision} sessionId={session.id} apiFetch={apiFetch} kind={tab} onDirtyChange={value=>{dirty.current=value;}} onBusyChange={value=>{operationBusy.current=value;}} onAccessRevoked={accessRevoked}/>}
 </section>;
}
