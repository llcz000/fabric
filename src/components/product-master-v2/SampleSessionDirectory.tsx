import React,{useEffect,useMemo,useRef,useState} from 'react';
import {customerButton as button,customerPrimaryButton as primaryButton} from '../customers/CustomerProfileForm';
import {useConfirm} from '../ui/ConfirmDialog';
import {ActionIcon} from './ActionIcon';
import {SampleScanCustomerStep} from './SampleScanCustomerStep';
import {Session,type RegisterSampleLeaveGuard} from './SampleBusinessWorkspaceV2';
import {createSampleOperationsClient,type SampleSessionSummary,type SampleSessionDirectory} from './sampleOperationsModel';
import {selectionAccessRevoked} from './sampleSelectionClient';
import {downloadSessionCards,formatSampleSessionDate} from './sampleSessionExport';
import type {CatalogImageResolver} from './ProductImageTabs';
const field='min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base';
const touch='inline-flex min-h-11 items-center justify-center gap-1 rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600';
export function SampleSessionDirectory({apiFetch,onRegisterLeaveGuard,resolveImages,recentlyCompletedId}:{apiFetch:typeof fetch;onRegisterLeaveGuard?:RegisterSampleLeaveGuard;resolveImages?:CatalogImageResolver;recentlyCompletedId?:string}){
 const api=useMemo(()=>createSampleOperationsClient(apiFetch),[apiFetch]),confirm=useConfirm();
 const [creating,setCreating]=useState(false),[enabled,setEnabled]=useState<boolean|null>(null),[legacyName,setLegacyName]=useState('');
 const [active,setActive]=useState<SampleSessionSummary|null>(null),[activeMode,setActiveMode]=useState<'scan'|'details'>('scan');
 const [data,setData]=useState<SampleSessionDirectory|null>(null),[draft,setDraft]=useState(''),[query,setQuery]=useState(''),[searching,setSearching]=useState(false);
 const [offset,setOffset]=useState(0),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(recentlyCompletedId?'已保存':'');
 const [recentId,setRecentId]=useState(recentlyCompletedId);
 const [openMenu,setOpenMenu]=useState<string|null>(null),menu=useRef<HTMLDivElement>(null);
 const pending=useRef(false),scope=useRef<AbortController|null>(null),start=useRef<HTMLButtonElement>(null),searchButton=useRef<HTMLButtonElement>(null),searchInput=useRef<HTMLInputElement>(null);
 useEffect(()=>{const c=new AbortController();void apiFetch('/api/v2/customers/capability',{cache:'no-store',signal:c.signal}).then(async r=>{if(!r.ok)throw Error();const v=await r.json();if(!c.signal.aborted)setEnabled(v.enabled===true);}).catch(()=>{if(!c.signal.aborted)setError('客户功能读取失败，请重试');});return()=>c.abort();},[apiFetch,revision]);
 useEffect(()=>{const timer=setTimeout(()=>{setQuery(draft.trim());setOffset(0);},250);return()=>clearTimeout(timer);},[draft]);
 useEffect(()=>{if(searching)searchInput.current?.focus();},[searching]);
 useEffect(()=>{setOpenMenu(null);},[active,creating,query,offset,revision]);
 useEffect(()=>{
  if(openMenu===null)return;
  function outside(e:PointerEvent){if(e.target instanceof Node&&!menu.current?.contains(e.target))setOpenMenu(null);}
  function escape(e:KeyboardEvent){if(e.key==='Escape'){e.preventDefault();menu.current?.querySelector('button')?.focus();setOpenMenu(null);}}
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[openMenu]);
 useEffect(()=>{if(active||creating&&enabled===true)return;onRegisterLeaveGuard?.(()=>!pending.current);return()=>onRegisterLeaveGuard?.(null);},[active,creating,enabled,onRegisterLeaveGuard]);
 useEffect(()=>{const c=new AbortController();scope.current=c;if(active||creating)return()=>c.abort();setLoading(true);setError('');
  void api.directory(query,offset,c.signal).then(v=>{if(!c.signal.aborted)setData(v);}).catch(e=>{if(!c.signal.aborted){setData(null);setError(selectionAccessRevoked(e)?'访问权限已失效，请重新登录':'选样单读取失败，请重试');}}).finally(()=>{if(!c.signal.aborted)setLoading(false);});return()=>c.abort();
 },[api,query,offset,revision,active,creating]);
 function cancel(){setCreating(false);setLegacyName('');requestAnimationFrame(()=>start.current?.focus());}
 function selected(value:SampleSessionSummary){setCreating(false);setLegacyName('');setActiveMode('scan');setActive(value);setNotice('');}
 function finish(){setSearching(false);setRecentId(active?.id);setActive(null);setDraft('');setQuery('');setOffset(0);setNotice(activeMode==='scan'?'已保存':'');setRevision(n=>n+1);}
 function refresh(){setRevision(n=>n+1);}
 async function createLegacy(e:React.FormEvent){e.preventDefault();if(pending.current||!legacyName.trim())return;pending.current=true;setBusy(true);setError('');try{selected(await api.create(legacyName.trim(),scope.current?.signal));}catch{setError('新建未确认，请重试前核对客户记录');}finally{pending.current=false;setBusy(false);}}
 async function remove(item:SampleSessionSummary){
  if(pending.current||!await confirm({title:'删除选样单？',message:item.customerReference+' · '+formatSampleSessionDate(item),confirmText:'确认删除',danger:true}))return;
  pending.current=true;setBusy(true);setError('');try{await api.retire(item.id,scope.current?.signal);setOffset(n=>data?.items.length===1&&n>0?Math.max(0,n-20):n);setRevision(n=>n+1);}catch{setError('删除未确认，请刷新核对后重试');}finally{pending.current=false;setBusy(false);}
 }
 async function exportCards(item:SampleSessionSummary){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');setNotice('');
  try{const {blob,filename}=await downloadSessionCards(apiFetch,item,scope.current?.signal);if(scope.current?.signal.aborted)return;const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000);setNotice('Excel 已导出');}
  catch(e){if(!scope.current?.signal.aborted){const status=(e as {status?:number}).status;if(selectionAccessRevoked(e)){setData(null);setError('访问权限已失效，请重新登录');}else setError(status===409?'暂无可导出的色卡，或部分色卡已失效，请继续选样核对后重试':'导出失败，请重试');}}
  finally{pending.current=false;setBusy(false);}
 }
 if(active)return <Session key={active.id} session={active} mode={activeMode} resolveImages={resolveImages} apiFetch={apiFetch} readOnly={active.canManage===false} onStatusChanged={setActive} onBack={finish} onRegisterLeaveGuard={onRegisterLeaveGuard}/>;
 if(creating&&enabled)return <SampleScanCustomerStep apiFetch={apiFetch} onSelected={selected} onCancel={cancel} onRegisterLeaveGuard={onRegisterLeaveGuard}/>;
 if(creating)return <section className="mx-auto max-w-xl space-y-3 p-4" aria-label="新建选样单"><div className="flex items-center justify-between"><h2 className="font-semibold">选择客户</h2><button className={touch} disabled={busy} onClick={cancel}>取消</button></div><form className="space-y-3" onSubmit={createLegacy}><input autoFocus required aria-label="客户名称" placeholder="输入客户名称" className={field} disabled={busy} value={legacyName} onChange={e=>setLegacyName(e.target.value)} maxLength={160}/>{error&&<p role="alert">{error}</p>}<button className={primaryButton} disabled={busy||!legacyName.trim()}>新建选样</button></form></section>;
 return <section aria-label="客户选样" className="mx-auto max-w-5xl space-y-2 p-3 sm:p-5">
  <header className="flex items-center gap-1">
   <h2 className="mr-auto whitespace-nowrap text-base font-semibold">客户选样</h2>
   <button ref={start} type="button" className={primaryButton+' min-h-11 whitespace-nowrap !px-3'} disabled={busy||enabled===null} onClick={()=>{setError('');setCreating(true);}}><ActionIcon name="add"/>新建选样单</button>
   <button ref={searchButton} className={touch+' !px-2'} type="button" aria-label="搜索选样单" aria-expanded={searching} onClick={()=>setSearching(v=>!v)}><ActionIcon name="search"/></button>
  </header>
  {searching&&<form role="search" onSubmit={e=>{e.preventDefault();setQuery(draft.trim());setOffset(0);setRevision(n=>n+1);}} className="flex items-center gap-1"><input ref={searchInput} type="search" aria-label="搜索选样单客户" placeholder="搜索客户名称" value={draft} maxLength={160} className={field} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setSearching(false);setDraft('');searchButton.current?.focus();}}}/><button type="button" className={touch+' whitespace-nowrap'} onClick={()=>{setSearching(false);setDraft('');searchButton.current?.focus();}}>取消</button></form>}
  {!searching&&query&&<button className="min-h-11 text-sm text-blue-700" onClick={()=>{setDraft('');setQuery('');}}>清除“{query}”筛选</button>}
  {notice&&<p role="status" className="text-xs text-emerald-700">{notice}</p>}
  {error&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error} <button type="button" className="min-h-11 underline" disabled={busy} onClick={refresh}>重试</button></p>}
  {loading&&<p role="status" className="py-3 text-sm text-slate-500">正在读取选样单…</p>}
  {data&&!loading&&<><div className="divide-y rounded-xl border border-slate-200 bg-white">{data.items.map(item=><article key={item.id} aria-label={item.customerReference+' '+formatSampleSessionDate(item)} data-sample-session-row className={'flex min-w-0 items-center gap-1 px-2 py-1 sm:px-3 '+(item.id===recentId?'bg-blue-50/40':'')}>
   <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1">
    <h3 className="min-w-0 text-xs font-medium sm:text-sm"><button type="button" aria-label={'选样明细 '+item.customerReference} title={item.customerReference} className="min-h-11 w-full min-w-11 truncate rounded text-left text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900 focus-visible:outline-2 focus-visible:outline-blue-600" disabled={busy} onClick={()=>{setOpenMenu(null);setActiveMode('details');setActive(item);setNotice('');}}>{item.customerReference}</button></h3>
    <time dateTime={item.createdAt??item.createdOn} className="shrink-0 whitespace-nowrap text-[10px] text-slate-500 sm:text-xs">{formatSampleSessionDate(item)}</time>
    <span className="shrink-0 whitespace-nowrap text-[10px] text-slate-500 sm:text-xs">{item.selectedProductCount===undefined?'—':item.selectedProductCount} 款 · {item.selectedCardCount===undefined?'—':item.selectedCardCount} 张色卡</span>
   </div>
   <div className="flex shrink-0 items-center gap-0.5">
    <button type="button" aria-label={'导出 Excel '+item.customerReference} title="导出 Excel" className={touch+' !px-1.5 text-xs'} disabled={busy||item.selectedCardCount===undefined||item.selectedCardCount===0} onClick={()=>void exportCards(item)}><ActionIcon name="excel"/>导出</button>
    {item.canManage!==false&&<div ref={openMenu===item.id?menu:null} className="relative shrink-0"><button type="button" aria-label={'选样单更多操作 '+item.customerReference} aria-expanded={openMenu===item.id} aria-controls={openMenu===item.id?'sample-session-menu-'+item.id:undefined} className={touch+' min-w-11 !px-1.5'} disabled={busy} onClick={()=>setOpenMenu(current=>current===item.id?null:item.id)}>⋯</button>{openMenu===item.id&&<div id={'sample-session-menu-'+item.id} className="absolute right-full top-1/2 z-10 mr-1 w-32 -translate-y-1/2 rounded-lg border bg-white p-1 shadow-lg"><button type="button" className={touch+' w-full'} disabled={busy} onClick={()=>{menu.current?.querySelector('button')?.focus();setOpenMenu(null);void remove(item);}}>删除选样单</button></div>}</div>}
   </div>
  </article>)}</div>{!data.items.length&&<p className="py-8 text-center text-sm text-slate-500">{query?'没有匹配的选样单':'暂无选样单，点击新建开始选样'}</p>}{data.total>20&&<footer className="flex items-center justify-between text-sm"><span className="text-slate-500 whitespace-nowrap">第 {Math.floor(offset/20)+1}/{Math.ceil(data.total/20)} 页 · 共 {data.total} 单</span><div className="flex gap-2"><button className={button+' min-h-11'} disabled={busy||offset===0} onClick={()=>setOffset(n=>Math.max(0,n-20))}>上一页</button><button className={button+' min-h-11'} disabled={busy||offset+20>=data.total} onClick={()=>setOffset(n=>n+20)}>下一页</button></div></footer>}</>}
 </section>;
}
