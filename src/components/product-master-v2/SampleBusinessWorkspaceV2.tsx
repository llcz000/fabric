import {SampleSessionDirectory as Directory} from './SampleSessionDirectory';
import {customerButton as button} from '../customers/CustomerProfileForm';
import {ActionIcon} from './ActionIcon';
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {SampleSelectionWorkspaceV2} from './SampleSelectionWorkspaceV2';
import {ScannedSampleEntry} from './ScannedSampleEntry';
import type {CatalogImageResolver} from './ProductImageTabs';
import {FocusedSampleSelection} from './FocusedSampleSelection';
import {SampleOperationsPanel} from './SampleOperationsPanel';
import {createSampleOperationsClient,type SampleSessionSummary} from './sampleOperationsModel';
import {selectionAccessRevoked} from './sampleSelectionClient';
import {useConfirm} from '../ui/ConfirmDialog';
export type RegisterSampleLeaveGuard=(guard:(()=>boolean|Promise<boolean>)|null)=>void;
export function SampleBusinessWorkspaceV2({apiFetch,onRegisterLeaveGuard,initialCardToken,resolveImages}:{apiFetch:typeof fetch;onRegisterLeaveGuard?:RegisterSampleLeaveGuard;initialCardToken?:string;resolveImages?:CatalogImageResolver}){
 // React must discard private customer state synchronously on adapter/identity change.
 const identity=useRef({fetch:apiFetch,revision:0});if(identity.current.fetch!==apiFetch)identity.current={fetch:apiFetch,revision:identity.current.revision+1};
 return <ScopedWorkspace key={identity.current.revision} apiFetch={apiFetch} resolveImages={resolveImages} initialCardToken={initialCardToken} onRegisterLeaveGuard={onRegisterLeaveGuard}/>;
}
function ScopedWorkspace(props:{apiFetch:typeof fetch;onRegisterLeaveGuard?:RegisterSampleLeaveGuard;initialCardToken?:string;resolveImages?:CatalogImageResolver}){
 const [scanning,setScanning]=useState(!!props.initialCardToken),[consumed,setConsumed]=useState<string|undefined>(),[finished,setFinished]=useState<string>();
 const newScan=!!props.initialCardToken&&props.initialCardToken!==consumed;
 if(scanning||newScan)return <ScannedSampleEntry apiFetch={props.apiFetch} resolveImages={props.resolveImages} cardToken={props.initialCardToken!} onRegisterLeaveGuard={props.onRegisterLeaveGuard} onFinish={session=>{setFinished(session?.id);setConsumed(props.initialCardToken);setScanning(false);}}/>;
 return <Directory recentlyCompletedId={finished} resolveImages={props.resolveImages} apiFetch={props.apiFetch} onRegisterLeaveGuard={props.onRegisterLeaveGuard}/>;
}
type SessionProps=Parameters<typeof SessionDetails>[0]&{mode?:'scan'|'details'};
export function Session(props:SessionProps){
 const [focused,setFocused]=useState(props.mode!=='details');
 const {mode='scan',...detailProps}=props;
 if(!props.readOnly&&focused)return <FocusedSampleSelection key={props.session.id} session={props.session} apiFetch={props.apiFetch} resolveImages={props.resolveImages} initialCardToken={props.initialCardToken} onFinish={props.onBack} onDetails={()=>setFocused(false)} onRegisterLeaveGuard={props.onRegisterLeaveGuard}/>;
 return <SessionDetails {...detailProps} onScan={()=>setFocused(true)} initialTab={mode==='details'?'selection':'followups'}/>;
}
function SessionDetails({session,apiFetch,onBack,onRegisterLeaveGuard,onScan,readOnly=false,resolveImages,initialTab='selection'}:{session:SampleSessionSummary;apiFetch:typeof fetch;onBack:()=>void;onRegisterLeaveGuard?:RegisterSampleLeaveGuard;onStatusChanged(value:SampleSessionSummary):void;onScan?:()=>void;readOnly?:boolean;initialCardToken?:string;resolveImages?:CatalogImageResolver;initialTab?:'selection'|'followups'}){
 const confirm=useConfirm();
 const api=useMemo(()=>createSampleOperationsClient(apiFetch),[apiFetch]);
 const [tab,setTab]=useState<'selection'|'followups'>(initialTab),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revoked,setRevoked]=useState(false);
 const accessRevoked=useCallback(()=>setRevoked(true),[]);
 const scope=useRef(new AbortController()),pending=useRef(false),dirty=useRef(false),operationBusy=useRef(false);
 useEffect(()=>{const controller=new AbortController();scope.current=controller;return()=>controller.abort();},[]);
 const canLeave=useCallback(async()=>{if(pending.current||operationBusy.current)return false;
  if(dirty.current){
   const ok=await confirm({title:'放弃尚未保存的选样资料？',message:'反馈资料尚未保存，放弃后无法恢复。',confirmText:'放弃修改',danger:true});
   if(!ok)return false;
  }
  dirty.current=false;return true;},[confirm]);
 useEffect(()=>{onRegisterLeaveGuard?.(canLeave);return()=>onRegisterLeaveGuard?.(null);},[canLeave,onRegisterLeaveGuard]);
 const leave=(action:()=>void)=>{void (async()=>{if(await canLeave())action();})();};
 if(revoked)return <section className="space-y-4 p-6"><p role="alert">访问权限已失效，请返回列表</p><button className={button} onClick={onBack}><ActionIcon name="back"/>返回客户选样</button></section>;
 return <section className="space-y-2 p-3 sm:space-y-3 sm:p-6" aria-label="客户选样业务">
   <header className="flex items-center justify-between gap-2">
    <div className="flex min-w-0 items-center gap-2">
     <button className="shrink-0 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm" disabled={busy} onClick={()=>leave(onBack)} aria-label="返回客户选样"><ActionIcon name="back"/></button>
     <h2 className="min-w-0 truncate text-base font-semibold sm:text-xl" title={session.customerReference}>{session.customerReference} · 选样</h2>
    </div>
    {!readOnly&&onScan&&<button className={button+" shrink-0 whitespace-nowrap"} disabled={busy} onClick={()=>leave(onScan)}><ActionIcon name="scan"/>继续扫码</button>}
   </header>
   {readOnly&&<span className="text-xs text-slate-500">查看模式 · 只读</span>}
   {error&&<p role="alert">{error}</p>}
   <nav className="flex gap-2" aria-label="选样业务分类">{([['selection','选样明细'],['followups','产品反馈']] as const).map(([id,label])=><button key={id} role="tab" aria-selected={tab===id} className={button+(tab===id?' font-semibold text-blue-700':'')} disabled={busy} onClick={()=>leave(()=>{setTab(id);setError('');})}>{label}</button>)}</nav>
  {tab==='selection'?<><SampleSelectionWorkspaceV2 readOnly={readOnly} key={revision} sessionId={session.id} apiFetch={apiFetch} resolveImages={resolveImages} onAccessRevoked={accessRevoked}/></>:<SampleOperationsPanel readOnly={readOnly} key={tab+':'+revision} sessionId={session.id} apiFetch={apiFetch} kind={tab} onDirtyChange={value=>{dirty.current=value;}} onBusyChange={value=>{operationBusy.current=value;}} onAccessRevoked={accessRevoked}/>}
 </section>;
}

export function SampleSessionActions({busy,onView,onEdit,onDelete,canManage=true}:{busy:boolean;canManage?:boolean;onView():void;onEdit():void;onDelete():void}){
 return <div className="flex gap-3"><button className="v2-icon-button" aria-label="查看" title="查看选样单" disabled={busy} onClick={onView}><ActionIcon name="view"/></button>{canManage&&<><button className="v2-icon-button" aria-label="编辑" title="编辑选样单" disabled={busy} onClick={onEdit}><ActionIcon name="edit"/></button><button className="v2-icon-button v2-icon-danger" aria-label="删除" title="删除选样单" disabled={busy} onClick={onDelete}><ActionIcon name="delete"/></button></>}</div>;
}

