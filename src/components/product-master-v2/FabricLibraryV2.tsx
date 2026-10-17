import {CatalogExportButton} from './CatalogExportButton';
import React,{useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Plus,Search,X} from 'lucide-react';
import {
 emptyFabricFilters,reduceFabricFilters,fetchFabricCatalog,buildFabricCatalogUrl,
 fabricToDraft,validateFabricDraft,createFabric,updateFabric,deleteFabric,emptyFabricDraft,
 type FabricFilters,type FabricDraft,type FabricPayload,
 type FabricCatalogItem,type FabricCatalogPage
} from './fabricModel';
import {createLatestRequestGuard} from './catalogModel';

const columns=['品号','品名','成分','克重','门幅 / cm','备注','启用状态','关联产品','操作'] as const;
const border='rounded-lg border border-[#c3c6d7] bg-white';
const nullText=(value:string|null)=>value===null||value===''?'—':value;
const formInput='w-full min-w-0 rounded border border-[#c3c6d7] bg-white px-2 py-1 text-xs text-[#191b24] focus-visible:outline-2 focus-visible:outline-[#346ef6]';
const editText='text-xs text-[#0053da] hover:underline disabled:text-slate-400';
export interface FabricV2InlineDraftProps{
 original:FabricCatalogItem|null;mode:'create'|'update';busy?:boolean;
 onCancel():void;onSave(payload:FabricPayload):Promise<void>;
}
export function FabricV2InlineDraft({original,mode,busy=false,onCancel,onSave}:FabricV2InlineDraftProps){
 const initial=original?fabricToDraft(original):emptyFabricDraft;
 const [draft,setDraft]=useState<FabricDraft>(initial);
 const [saving,setSaving]=useState(false),[error,setError]=useState('');
 const waiting=busy||saving;
 const change=<K extends keyof FabricDraft>(key:K,value:FabricDraft[K])=>setDraft(d=>({...d,[key]:value}));
 const cancel=()=>{
  if(waiting)return;
  if(JSON.stringify(draft)!==JSON.stringify(initial)&&typeof window!=='undefined'&&
   !window.confirm('放弃尚未保存的面料编辑吗？'))return;
  onCancel();
 };
 const submit=async()=>{
  if(waiting)return;
  setError('');
  try{
   const payload=validateFabricDraft(draft,mode);
   // Fabric identity conflict is ALWAYS rechecked in the server transaction.
   // An outdated productCount in this page cannot override server reference protection.
   setSaving(true);
   await onSave(payload);
  }catch(e){
   setError(e instanceof Error?e.message:'保存失败，请检查资料后重试。');
  }finally{setSaving(false);}
 };
 return <tr className="border-y border-[#93b5f9] bg-[#f0f5ff] align-middle text-xs">
  <td className="px-2 py-2">
   <label className="sr-only" htmlFor={'fabric-no-'+(original?.id??'new')}>品号</label>
   <input id={'fabric-no-'+(original?.id??'new')} aria-label="品号" value={draft.fabricNo}
    readOnly={Boolean(original?.productCount)}
    title={original?.productCount?'品号已被产品引用，不可修改品号':undefined}
    maxLength={64} onChange={e=>change('fabricNo',e.target.value)}
    className={formInput+(original?.productCount?' bg-slate-100 cursor-not-allowed':'')}/>
  </td>
  <td className="px-2 py-2"><input aria-label="品名" value={draft.fabricName} required maxLength={255}
   onChange={e=>change('fabricName',e.target.value)} className={formInput}/></td>
  <td className="px-2 py-2"><input aria-label="成分" placeholder="可留空" maxLength={500} value={draft.composition}
   onChange={e=>change('composition',e.target.value)} className={formInput}/></td>
  <td className="px-2 py-2">
   <div className="flex items-center gap-1">
    <input aria-label="克重数值" inputMode="decimal" placeholder="可留空" value={draft.weightValue}
     onChange={e=>change('weightValue',e.target.value)} className={formInput+' w-20'}/>
    <select aria-label="克重单位" value={draft.weightUnit} onChange={e=>change('weightUnit',e.target.value as FabricDraft['weightUnit'])}
     className={formInput+' w-20'}><option value="">—</option><option value="gsm">gsm</option><option value="mm">mm</option></select>
   </div>
  </td>
  <td className="px-2 py-2"><input aria-label="门幅" inputMode="decimal" placeholder="可留空" value={draft.widthValue}
   onChange={e=>change('widthValue',e.target.value)} className={formInput}/></td>
  <td className="px-2 py-2"><input aria-label="备注" placeholder="可留空" maxLength={5000}
   value={draft.remark} onChange={e=>change('remark',e.target.value)} className={formInput}/></td>
  <td className="px-2 py-2 text-center">
   <label className="inline-flex items-center gap-1 whitespace-nowrap">
    <input aria-label="启用状态" type="checkbox" checked={draft.isActive}
     disabled={mode==='create'} onChange={e=>change('isActive',e.target.checked)}/>
    {draft.isActive?'启用':'停用'}</label>
  </td>
  <td className="px-2 py-2 text-center text-slate-500">{original?.productCount??0}</td>
  <td className="px-2 py-2 text-right">
   <div className="flex items-center justify-end gap-2 whitespace-nowrap">
    <button type="button" disabled={waiting} onClick={submit}
     className="rounded bg-[#346ef6] px-2 py-1 text-xs text-white disabled:opacity-60">
     {waiting?'保存中…':'保存'}</button>
    <button type="button" disabled={waiting} onClick={cancel} className={editText}>取消</button>
   </div>
   {error?<div role="alert" className="mt-1 max-w-48 break-words text-left text-[11px] text-rose-700">{error}</div>:null}
  </td>
 </tr>;
}
export interface FabricV2TableProps{
 page:FabricCatalogPage;onPage(offset:number):void;
 canManage?:boolean;onEdit?(item:FabricCatalogItem):void;
 onDelete?(item:FabricCatalogItem):void;
 onViewProducts?(item:FabricCatalogItem):void;
 editingId?:string|null;creating?:boolean;onCancelDraft?():void;
 onSaveDraft?(item:FabricCatalogItem|null,payload:FabricPayload):Promise<void>;
}
export function FabricV2Table({
 page,onPage,canManage=false,onEdit,onDelete,onViewProducts,
 editingId=null,creating=false,onCancelDraft,onSaveDraft
}:FabricV2TableProps){
 return <div className={border+' flex min-w-0 flex-1 flex-col overflow-hidden'}>
  <div className="overflow-x-auto">
   <table className="w-full min-w-[1050px] border-collapse text-left text-xs text-[#191b24]">
    <thead><tr className="border-b border-[#c3c6d7] bg-[#f8fafc] text-[#475569]">
     {columns.map((c,i)=><th scope="col" key={c}
      className={'px-3 py-3 font-semibold '+(i>=6?'text-center':'')}>{c}</th>)}
    </tr></thead>
    <tbody>
     {creating&&canManage&&onCancelDraft&&onSaveDraft?
      <FabricV2InlineDraft key="new" original={null} mode="create"
       onCancel={onCancelDraft} onSave={value=>onSaveDraft(null,value)}/>:null}
     {page.items.map(item=>editingId===item.id&&canManage&&onCancelDraft&&onSaveDraft?
      <FabricV2InlineDraft key={item.id} original={item} mode="update"
       onCancel={onCancelDraft} onSave={payload=>onSaveDraft(item,payload)}/>:
      <tr key={item.id} className="border-b border-[#e2e8f0] last:border-0 hover:bg-[#f8fafc]">
       <td className="px-3 py-3 font-semibold">{item.fabricNo}</td>
       <td className="px-3 py-3">{item.fabricName}</td>
       <td className="px-3 py-3">{nullText(item.composition)}</td>
       <td className="whitespace-nowrap px-3 py-3">{item.weightValue===null?'—':item.weightValue+' '+item.weightUnit}</td>
       <td className="px-3 py-3">{item.widthValue??'—'}</td>
       <td className="max-w-48 px-3 py-3">
        <span title={item.remark??undefined} className="block max-w-40 truncate">{nullText(item.remark)}</span>
       </td>
       <td className="px-3 py-3 text-center">
        <span className={'rounded-full px-2 py-0.5 text-[11px] '+(item.isActive?
         'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-500')}>{item.isActive?'已启用':'已停用'}</span>
       </td>
       <td className="px-3 py-3 text-center">
        {item.productCount>0&&onViewProducts?
         <button type="button" className={editText} onClick={()=>onViewProducts(item)}>
          已关联 {item.productCount}</button>:
         <span title="关联产品数量由服务器统计">{item.productCount>0?'已关联 '+item.productCount:'—'}</span>}
       </td>
       <td className="px-3 py-3 text-right">
        {canManage?<div className="inline-flex gap-2">
         {onEdit?<button type="button" className={editText} onClick={()=>onEdit(item)}>编辑</button>:null}
         {onDelete?<button type="button" className={editText+' text-rose-600'}
          title={item.productCount>0?'已有产品引用，不可删除；可停用':undefined}
          disabled={item.productCount>0} onClick={()=>onDelete(item)}>删除</button>:null}
        </div>:<span className="text-slate-400">只读</span>}
       </td>
      </tr>)}
    </tbody>
   </table>
   {!page.items.length&&!creating?<p className="py-16 text-center text-sm text-[#64748b]">没有匹配的面料，请调整或清空筛选条件。</p>:null}
  </div>
  <footer className="mt-auto flex items-center justify-between gap-2 border-t border-slate-200 p-3 text-xs text-slate-500">
   <span>共 {page.total} 条面料 · 每页 {page.limit} 条 · 第 {Math.floor(page.offset/page.limit)+1} 页</span>
   <div className="flex gap-2">
    <button type="button" aria-label="上一页" disabled={page.offset===0}
     className="rounded border px-2 py-1 disabled:opacity-40"
     onClick={()=>onPage(Math.max(0,page.offset-page.limit))}><ChevronLeft size={16}/></button>
    <button type="button" aria-label="下一页" disabled={page.offset+page.limit>=page.total}
     className="rounded border px-2 py-1 disabled:opacity-40"
     onClick={()=>onPage(page.offset+page.limit)}><ChevronRight size={16}/></button>
   </div>
  </footer>
 </div>;
}
export function ConfirmFabricDelete({item,onCancel,onConfirm,busy=false}:{
 item:FabricCatalogItem;onCancel():void;onConfirm():void;busy?:boolean;
}){
 const ref=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  const original=document.activeElement instanceof HTMLElement?document.activeElement:null;
  ref.current?.focus();
  const key=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();onCancel();}
   if(event.key==='Tab'){
    const controls=Array.from(document.querySelectorAll<HTMLElement>('[data-fabric-delete-dialog] button:not([disabled])'));
    if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls.at(-1)?.focus();}
    else if(!event.shiftKey&&document.activeElement===controls.at(-1)){event.preventDefault();controls[0]?.focus();}
   }
  };
  document.addEventListener('keydown',key);
  return ()=>{document.removeEventListener('keydown',key);original?.focus();};
 },[onCancel]);
 return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="presentation">
  <div data-fabric-delete-dialog role="alertdialog" aria-modal="true"
   aria-label={'确认删除面料 '+item.fabricNo} className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
   <h2 className="text-base font-semibold">确认删除面料？</h2>
   <p className="mt-3 text-sm">品号：<strong>{item.fabricNo}</strong></p>
   <p className="mt-2 text-xs text-slate-600">当前关联产品 {item.productCount} 条。已关联产品的面料不可删除，可停用。
    服务器会在执行时再次检查引用，不会删除关联产品。</p>
   <div className="mt-5 flex justify-end gap-2">
    <button ref={ref} type="button" disabled={busy} onClick={onCancel}
     className="rounded border px-3 py-1.5 text-xs">取消</button>
    <button type="button" disabled={busy||item.productCount>0} onClick={onConfirm}
     className="rounded bg-rose-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">
     {busy?'正在删除…':'确认删除'}</button>
   </div>
  </div>
 </div>;
}
export interface FabricLibraryV2Props{
 apiFetch:typeof fetch;canManage?:boolean;onViewProducts?(item:FabricCatalogItem):void;
}
export function FabricLibraryV2({apiFetch,canManage=false,onViewProducts}:FabricLibraryV2Props){
 const [filters,setFilters]=useState<FabricFilters>({...emptyFabricFilters});
 const [page,setPage]=useState<FabricCatalogPage|null>(null);
 const [loading,setLoading]=useState(false),[failure,setFailure]=useState('');
 const [reload,setReload]=useState(0),[editingId,setEditingId]=useState<string|null>(null);
 const [creating,setCreating]=useState(false),[deleting,setDeleting]=useState<FabricCatalogItem|null>(null);
 const [deletingBusy,setDeletingBusy]=useState(false),[deleteError,setDeleteError]=useState('');
 const latest=useRef(createLatestRequestGuard());
 const isEditing=creating||editingId!==null;
 const dispatch=(a:Parameters<typeof reduceFabricFilters>[1])=>{
  if(isEditing&&typeof window!=='undefined'&&!window.confirm('切换筛选将取消尚未保存的面料编辑，继续吗？'))return;
  setCreating(false);setEditingId(null);
  setFilters(current=>reduceFabricFilters(current,a));
 };
 const refresh=()=>setReload(x=>x+1);
 useEffect(()=>{
  const ctrl=new AbortController(),rev=latest.current.next();
  setLoading(true);setFailure('');
  const timer=setTimeout(async()=>{
   try{
    const result=await fetchFabricCatalog(apiFetch,filters,ctrl.signal);
    if(ctrl.signal.aborted||!latest.current.isCurrent(rev))return;
    setPage(result);setLoading(false);
   }catch{
    if(ctrl.signal.aborted||!latest.current.isCurrent(rev))return;
    setFailure('面料列表加载失败，请重试。');setLoading(false);
   }
  },filters.query?200:0);
  return ()=>{clearTimeout(timer);ctrl.abort();latest.current.cancel();};
 },[filters,reload,apiFetch]);
 const save=async(original:FabricCatalogItem|null,payload:FabricPayload)=>{
  // Authenticated V2 server owns uniqueness, reference locking and validation.
  if(original)await updateFabric(apiFetch,original.id,payload);
  else await createFabric(apiFetch,payload);
  setCreating(false);setEditingId(null);refresh();
 };
 const confirmDelete=async()=>{
  if(!deleting||deletingBusy)return;
  setDeletingBusy(true);setDeleteError('');
  try{await deleteFabric(apiFetch,deleting.id);setDeleting(null);refresh();}
  catch(e){setDeleteError(e instanceof Error?e.message:'删除失败，请重试。');}
  finally{setDeletingBusy(false);}
 };
 return <section className="flex min-h-[520px] flex-col gap-3 bg-[#faf8ff] p-3 text-[#191b24] sm:p-5" aria-label="V2 面料库">
  <header className="flex flex-wrap items-center justify-between gap-2">
   <div><h1 className="text-xl font-semibold">面料库</h1>
    <p className="mt-1 text-xs text-slate-500">面料品号、品名、成分与规格统一管理</p></div>
   {canManage?<button type="button" className="inline-flex items-center gap-1 rounded-lg bg-[#346ef6] px-3 py-2 text-xs text-white disabled:opacity-50"
    disabled={creating||editingId!==null} onClick={()=>{setEditingId(null);setCreating(true);}}>
    <Plus size={15}/>新增面料</button>:null}
  </header>
  <div className={border+' flex flex-wrap items-center gap-3 p-3'}>
   <label className="flex items-center gap-2 text-xs">
    <Search size={15} className="text-slate-500"/>
    <input aria-label="搜索品号 / 品名 / 成分"
     placeholder="搜索品号 / 品名 / 成分" className="min-w-48 rounded border px-2 py-1.5 outline-[#346ef6]"
     value={filters.query} onChange={e=>dispatch({type:'query',value:e.target.value})}/>
   </label>
   <label className="inline-flex items-center gap-1 text-xs text-slate-600">
    <input type="checkbox" aria-label="包含停用" checked={filters.includeInactive}
     onChange={e=>dispatch({type:'inactive',value:e.target.checked})}/>包含停用</label>
   <button type="button" className="text-xs text-[#0053da] hover:underline"
    onClick={()=>dispatch({type:'reset'})}>清空筛选</button>
  </div>
  <CatalogExportButton apiFetch={apiFetch} listUrl={buildFabricCatalogUrl(filters)} filename="面料资料.xlsx"/>
  {loading?<p role="status" className="rounded border bg-white p-3 text-sm text-slate-500">正在查找面料…</p>:null}
  {failure?<p role="alert" className="rounded border border-rose-200 bg-white p-3 text-sm text-rose-700">
   {failure}<button type="button" onClick={refresh} className="ml-3 underline">重试</button></p>:null}
  {!loading&&!failure&&page?<FabricV2Table page={page} canManage={canManage}
   creating={creating} editingId={editingId}
   onEdit={item=>{
    if(creating)return;
    if(editingId&&editingId!==item.id&&typeof window!=='undefined'&&
     !window.confirm('切换编辑行将放弃当前未保存的修改，继续吗？'))return;
    setEditingId(item.id);
   }}
   onDelete={item=>{
    if(isEditing&&typeof window!=='undefined'&&
     !window.confirm('删除操作将放弃当前未保存的修改，继续吗？'))return;
    setCreating(false);setEditingId(null);setDeleteError('');setDeleting(item);
   }}
   onViewProducts={onViewProducts}
   onSaveDraft={save}
   onCancelDraft={()=>{setCreating(false);setEditingId(null);}}
   onPage={offset=>dispatch({type:'page',offset})}/>:null}
  {deleting?<><ConfirmFabricDelete item={deleting} busy={deletingBusy}
   onCancel={()=>{if(!deletingBusy){setDeleting(null);setDeleteError('');}}}
   onConfirm={confirmDelete}/>
   {deleteError?<p role="alert" className="fixed bottom-3 left-3 z-[60] max-w-sm rounded bg-white p-3 text-xs text-rose-700 shadow-lg">
    {deleteError}</p>:null}</>:null}
 </section>;
}
export default FabricLibraryV2;