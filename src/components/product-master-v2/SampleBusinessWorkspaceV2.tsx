import {ActionIcon} from './ActionIcon';
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
 const [creating,setCreating]=useState(false);
 const [readOnly,setReadOnly]=useState(false);const [active,setActive]=useState<SampleSessionSummary|null>(null),[data,setData]=useState<SampleSessionDirectory|null>(null);
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
  try{const result=await api.create(customer,controller.signal);if(!controller.signal.aborted){setCustomer('');setCreating(false);setReadOnly(false);setActive(result);}}
  catch(cause){if(!controller.signal.aborted){setError(selectionAccessRevoked(cause)?'访问权限已失效，请重新登录':'新建未确认，请先搜索客户核对是否已创建');}}
  finally{pending.current=false;setBusy(false);}
 }
 async function removeEntry(item:SampleSessionSummary){
  if(pending.current||!window.confirm('删除选样单“'+item.customerReference+'”？此单将从列表移除，选样、寄样和跟进历史保留。'))return;
  pending.current=true;setBusy(true);setError('');const controller=scope.current;
  try{await api.retire(item.id,controller?.signal);if(!controller?.signal.aborted){setOffset(0);setRevision(n=>n+1);}}
  catch(cause){if(!controller?.signal.aborted)setError(selectionAccessRevoked(cause)?'访问权限已失效，请刷新核对':'删除未确认，请刷新列表核对后重试');}
  finally{pending.current=false;setBusy(false);}
 }
 if(active)return <Session key={active.id} session={active} readOnly={readOnly} onStatusChanged={setActive} apiFetch={apiFetch} onRegisterLeaveGuard={onRegisterLeaveGuard} onBack={()=>{setActive(null);setRevision(n=>n+1);}}/>;
 return <section aria-label="客户选样" className="space-y-4 p-4 sm:p-6"><header><h2 className="text-xl font-semibold">客户选样</h2><p className="mt-1 text-sm text-slate-500">手机扫码请先新建或编辑选样单；选样、寄样和跟进按客户管理。</p></header>
  <div><button type="button" aria-haspopup="dialog" disabled={busy||loading} className="rounded bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-40" onClick={()=>{setCustomer('');setError('');setCreating(true);}}><ActionIcon name="add"/>新建选样单</button></div>
  {creating&&<NewSampleSessionDialog customer={customer} onCustomer={setCustomer} busy={busy} error={error} onSubmit={create} onClose={()=>{if(!pending.current){setCreating(false);setError('');setCustomer('');}}}/>}

  <form onSubmit={e=>{e.preventDefault();setOffset(0);setQuery(draft);setRevision(n=>n+1);}} className="flex flex-wrap gap-2"><input aria-label="搜索客户" className={field} maxLength={160} placeholder="搜索客户" value={draft} onChange={e=>setDraft(e.target.value)}/><button className={button} disabled={busy}><ActionIcon name="search"/>查询</button><button type="button" className={button} disabled={busy} onClick={()=>setRevision(n=>n+1)}><ActionIcon name="refresh"/>刷新列表</button></form>
  {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}{loading&&<p role="status">正在读取选样单…</p>}
  {data&&!loading&&<div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-3">客户</th><th className="whitespace-nowrap p-3">创建时间</th><th className="p-3">状态</th><th className="p-3">操作</th></tr></thead><tbody>{data.items.map(item=><tr className="border-t" key={item.id}><td className="p-3">{item.customerReference}</td><td className="whitespace-nowrap p-3">{item.createdOn?<time dateTime={item.createdOn}>{item.createdOn}</time>:"—"}</td><td className="p-3">{item.status==='open'?'进行中':'已结束'}</td><td className="p-3"><SampleSessionActions busy={busy} onView={()=>{if(!pending.current){setReadOnly(true);setActive(item);}}} onEdit={()=>{if(!pending.current){setReadOnly(false);setActive(item);}}} onDelete={()=>void removeEntry(item)}/></td></tr>)}</tbody></table>{!data.items.length&&<p className="p-4 text-sm text-slate-500">{query?'没有匹配的选样单':'暂无选样单，请填写客户名称后新建。'}</p>}<footer className="flex items-center justify-between border-t p-3 text-sm"><span>共 {data.total} 张</span><div className="flex gap-2"><button className={button} disabled={offset===0||busy} onClick={()=>setOffset(n=>Math.max(0,n-20))}><ActionIcon name="back"/>上一页</button><button className={button} disabled={offset+20>=data.total||busy} onClick={()=>setOffset(n=>n+20)}><ActionIcon name="next"/>下一页</button></div></footer></div>}
 </section>;
}
export function Session({session,apiFetch,onBack,onRegisterLeaveGuard,onStatusChanged,readOnly=false}:{session:SampleSessionSummary;apiFetch:typeof fetch;onBack:()=>void;onRegisterLeaveGuard?:RegisterSampleLeaveGuard;onStatusChanged(value:SampleSessionSummary):void;readOnly?:boolean}){
 const api=useMemo(()=>createSampleOperationsClient(apiFetch),[apiFetch]);
 const [tab,setTab]=useState<'selection'|'shipments'|'followups'>('selection'),[revision,setRevision]=useState(0),[token,setToken]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revoked,setRevoked]=useState(false),[photoBusy,setPhotoBusy]=useState(false);
 const [editingCustomer,setEditingCustomer]=useState(false),[customerDraft,setCustomerDraft]=useState(session.customerReference);
 const accessRevoked=useCallback(()=>setRevoked(true),[]);
 const photoBusyChanged=useCallback((value:boolean)=>{setPhotoBusy(value);if(value){setToken('');setError('');setNotice('');}},[]);
 const scope=useRef(new AbortController()),pending=useRef(false),dirty=useRef(false),operationBusy=useRef(false),customerDirty=useRef(false);
 customerDirty.current=editingCustomer&&customerDraft!==session.customerReference;
 useEffect(()=>{const controller=new AbortController();scope.current=controller;return()=>controller.abort();},[]);
 const canLeave=useCallback(()=>{if(pending.current||operationBusy.current)return false;if((dirty.current||customerDirty.current)&&!window.confirm('有未保存的客户、寄样或跟进资料，确认放弃？'))return false;dirty.current=false;customerDirty.current=false;setEditingCustomer(false);return true;},[]);
 useEffect(()=>{onRegisterLeaveGuard?.(canLeave);return()=>onRegisterLeaveGuard?.(null);},[canLeave,onRegisterLeaveGuard]);
 const leave=(action:()=>void)=>{if(canLeave())action();};
 async function changeStatus(){
  if(readOnly||photoBusy||pending.current||operationBusy.current)return;
  const next=session.status==='open'?'closed':'open';
  if(!window.confirm(next==='closed'?'结束后选样、寄样和跟进资料将只读，可重新开启。确认结束选样单？':'确认重新开启选样单？'))return;
  const hadDraft=dirty.current;if(!canLeave())return;
  if(hadDraft)setRevision(n=>n+1); // Explicitly discarded drafts must also clear if the status request fails.
  pending.current=true;setBusy(true);setError('');const controller=scope.current;
  try{const value=await api.changeStatus(session.id,session.status,next,controller.signal);if(!controller.signal.aborted){onStatusChanged(value);setRevision(n=>n+1);setNotice(next==='closed'?'选样单已结束':'选样单已重新开启');}}
  catch(cause){if(!controller.signal.aborted){if(selectionAccessRevoked(cause))setRevoked(true);setError('状态变更未确认，请返回列表刷新核对后重试。');}}
  finally{pending.current=false;if(!controller.signal.aborted)setBusy(false);}
 }
 async function addCard(value:string){
  const controller=scope.current;if(readOnly||revoked||pending.current||operationBusy.current||controller.signal.aborted||!value.trim()||session.status!=='open')return;pending.current=true;setBusy(true);setError('');setNotice('');
  try{const result=await api.scan(session.id,value.trim(),controller.signal);if(!controller.signal.aborted){setToken('');setRevision(n=>n+1);setNotice('已加入 '+result.addedProductIds.length+' 款；重复产品保持原选择。');}}
  catch(cause){if(!controller.signal.aborted){if(selectionAccessRevoked(cause))setRevoked(true);setError(selectionAccessRevoked(cause)?'访问权限已失效，请返回列表':(cause as {status?:number}).status?'色卡不可用或当前没有可选产品，请核对后重试':cause instanceof Error?cause.message:'扫码失败');}}
  finally{pending.current=false;if(!controller.signal.aborted)setBusy(false);}
 }
 function scan(event:React.FormEvent){event.preventDefault();if(!photoBusy)void addCard(token);}
 async function renameCustomer(event:React.FormEvent){
  event.preventDefault();if(readOnly||pending.current||operationBusy.current||session.status!=='open'||!customerDraft.trim())return;
  if(dirty.current&&!window.confirm('保存客户名称将刷新当前记录并放弃未保存的寄样或跟进资料，继续吗？'))return;
  pending.current=true;setBusy(true);setError('');const controller=scope.current;
  try{const value=await api.rename(session.id,customerDraft,session.customerReference,controller.signal);if(!controller.signal.aborted){onStatusChanged(value);setEditingCustomer(false);setRevision(n=>n+1);setNotice('客户名称已更新');}}
  catch(cause){if(!controller.signal.aborted){if(selectionAccessRevoked(cause))setRevoked(true);setError('修改未确认或资料已变更，请返回列表刷新核对。');}}
  finally{pending.current=false;if(!controller.signal.aborted)setBusy(false);}
 }
 if(revoked)return <section className="space-y-4 p-6"><p role="alert">访问权限已失效，请返回列表</p><button className={button} onClick={onBack}><ActionIcon name="back"/>返回客户选样</button></section>;
 return <section className="space-y-4 p-4 sm:p-6" aria-label="客户选样业务"><header className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">{session.customerReference} · 选样单</h2><button className={button} disabled={busy} onClick={()=>leave(onBack)}><ActionIcon name="back"/>返回客户选样</button></header><div className="flex flex-wrap items-center gap-3"><span className="text-sm text-slate-600">状态：{session.status==='open'?'进行中':'已结束（只读）'}</span>{!readOnly&&<><button className={button} disabled={busy||photoBusy} onClick={()=>void changeStatus()}><ActionIcon name="power"/>{session.status==='open'?'结束选样单':'重新开启'}</button>{session.status==='open'&&<button className={button} disabled={busy} onClick={()=>{setCustomerDraft(session.customerReference);setEditingCustomer(true);}}><ActionIcon name="edit"/>修改客户</button>}</>}{readOnly&&<span className="text-sm text-slate-500">查看模式 · 只读</span>}</div>{editingCustomer&&!readOnly&&<form aria-label="修改选样客户" className="flex gap-2" onSubmit={renameCustomer}><input aria-label="客户名称" required maxLength={160} value={customerDraft} disabled={busy} onChange={event=>setCustomerDraft(event.target.value)} className={field}/><button disabled={busy} className={button}><ActionIcon name="save"/>保存客户</button><button type="button" disabled={busy} className={button} onClick={()=>setEditingCustomer(false)}><ActionIcon name="close"/>取消</button></form>}{error&&<p role="alert">{error}</p>}<nav className="flex gap-2" aria-label="选样业务分类">{([['selection','选样明细'],['shipments','寄样记录'],['followups','客户跟进']] as const).map(([id,label])=><button key={id} role="tab" aria-selected={tab===id} className={button+(tab===id?' font-semibold text-blue-700':'')} disabled={busy} onClick={()=>leave(()=>{setTab(id);setError('');setNotice('');})}>{label}</button>)}</nav>
  {tab==='selection'?<>{!readOnly&&session.status==='open'&&<form className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-4 v2-sample-scanner" onSubmit={scan} aria-label="扫码加入选样"><CardPhotoInput disabled={busy} onBusyChange={photoBusyChanged} onDecoded={value=>{setToken(value);void addCard(value);}}/><label className="flex flex-col gap-1 text-sm">扫描或输入色卡编码<input className={field} autoComplete="off" maxLength={128} value={token} onChange={e=>setToken(e.target.value)} disabled={busy||photoBusy}/></label>{token.trim()&&<button className={button} disabled={busy||photoBusy}><ActionIcon name="add"/>{busy?'正在加入…':'加入'}</button>}</form>}{notice&&<p role="status">{notice}</p>}<SampleSelectionWorkspaceV2 readOnly={readOnly} key={revision} sessionId={session.id} apiFetch={apiFetch} onAccessRevoked={accessRevoked}/></>:<SampleOperationsPanel readOnly={readOnly} key={tab+':'+revision} sessionId={session.id} apiFetch={apiFetch} kind={tab} onDirtyChange={value=>{dirty.current=value;}} onBusyChange={value=>{operationBusy.current=value;}} onAccessRevoked={accessRevoked}/>}
 </section>;
}

export function SampleSessionActions({busy,onView,onEdit,onDelete}:{busy:boolean;onView():void;onEdit():void;onDelete():void}){
 return <div className="flex gap-3"><button className="v2-icon-button" aria-label="查看" title="查看选样单" disabled={busy} onClick={onView}><ActionIcon name="view"/></button><button className="v2-icon-button" aria-label="编辑" title="编辑选样单" disabled={busy} onClick={onEdit}><ActionIcon name="edit"/></button><button className="v2-icon-button v2-icon-danger" aria-label="删除" title="删除选样单" disabled={busy} onClick={onDelete}><ActionIcon name="delete"/></button></div>;
}

function NewSampleSessionDialog({customer,onCustomer,busy,error,onSubmit,onClose}:{customer:string;onCustomer(value:string):void;busy:boolean;error:string;onSubmit(event:React.FormEvent):void;onClose():void}){
 const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{const before=document.activeElement,node=ref.current;node?.showModal();return()=>{node?.close();if(before instanceof HTMLElement&&before.isConnected)before.focus();};},[]);
 return <dialog ref={ref} aria-label="新建选样单" onCancel={event=>{event.preventDefault();if(!busy&&(!customer.trim()||window.confirm('放弃已填写的客户名称？')))onClose();}} className="m-auto w-[min(92vw,440px)] rounded-xl border bg-white p-5 shadow-xl backdrop:bg-black/30"><h2 className="mb-4 text-lg font-semibold">新建选样单</h2><form onSubmit={onSubmit} aria-label="新建选样单" className="space-y-4"><label className="flex flex-col gap-2 text-sm">客户名称<input autoFocus required aria-label="客户名称" maxLength={160} className={field} value={customer} onChange={e=>onCustomer(e.target.value)} disabled={busy}/></label>{error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}<footer className="flex justify-end gap-2"><button type="button" disabled={busy} className={button} onClick={onClose}><ActionIcon name="close"/>取消</button><button disabled={busy||!customer.trim()} className="rounded bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-40"><ActionIcon name="add"/>{busy?'正在新建…':'创建选样单'}</button></footer></form></dialog>;
}
