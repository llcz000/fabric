import {useV2LeaveProtection} from './useV2LeaveProtection';
import {CatalogExportButton} from './CatalogExportButton';
import {ActionIcon} from './ActionIcon';
import React,{useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Plus,Search,X} from 'lucide-react';
import {
 emptyFabricFilters,reduceFabricFilters,fetchFabricCatalog,buildFabricCatalogUrl,
 fabricToDraft,validateFabricDraft,createFabric,updateFabric,deleteFabric,emptyFabricDraft,
 type FabricFilters,type FabricDraft,type FabricPayload,
 type FabricCatalogItem,type FabricCatalogPage
} from './fabricModel';
import {createLatestRequestGuard} from './catalogModel';
import {useConfirm} from '../ui/ConfirmDialog';
import {buildColumnVisibility,nextSortState,readColumnVisibility,sortRows,toggleColumnVisibility,
 visibleColumns,writeColumnVisibility,type LibraryColumn,type SortState} from './libraryTableChromeModel';
import {ColumnSettingsMenu,SortableHeader} from './LibraryTableChrome';

const columns=['品号','品名','成分','克重','门幅 / cm','备注','关联产品','操作'] as const;
/** 逐列列宽（px）。加宽成分并固定较窄备注；品名分配剩余空间。 */
const columnWidths=[118,0,210,110,96,112,104,132] as const;
/** P1-8 列定义：顺序与 columnWidths 下标一一对应。 */
const fabricColumns:LibraryColumn<FabricCatalogItem>[]=[
 {key:'fabricNo',label:'品号',sortable:true,value:row=>row.fabricNo},
 {key:'fabricName',label:'品名',sortable:true,value:row=>row.fabricName??''},
 {key:'composition',label:'成分',sortable:true,value:row=>row.composition??''},
 {key:'weight',label:'克重',sortable:true,value:row=>row.weightValue},
 {key:'width',label:'门幅 / cm',sortable:true,value:row=>row.widthValue},
 {key:'remark',label:'备注',sortable:true,value:row=>row.remark??''},
 {key:'products',label:'关联产品',sortable:true,value:row=>row.productCount},
 {key:'actions',label:'操作',locked:true},
];
const FABRIC_COLUMN_KEY='fabric.v2.library.columns.fabric';
const border='rounded-lg border border-[#c3c6d7] bg-white';
const nullText=(value:string|null)=>value===null||value===''?'—':value;
const formInput='w-full min-w-0 rounded border border-[#c3c6d7] bg-white px-2 py-1 text-xs text-[#191b24] focus-visible:outline-2 focus-visible:outline-[#346ef6]';
// Unlike full-width text fields, the weight value/unit controls must keep independent widths.
const weightControl='min-w-0 shrink-0 rounded border border-[#c3c6d7] bg-white px-2 py-1 text-xs text-[#191b24] focus-visible:outline-2 focus-visible:outline-[#346ef6]';
const editText='text-xs text-[#0053da] hover:underline disabled:text-slate-400';
export interface FabricV2InlineDraftProps{
 original:FabricCatalogItem|null;mode:'create'|'update';busy?:boolean;
 onCancel():void;onSave(payload:FabricPayload):Promise<void>;
}
export function FabricV2InlineDraft({original,mode,busy=false,onCancel,onSave}:FabricV2InlineDraftProps){
 const confirm=useConfirm();
 const initial=original?fabricToDraft(original):emptyFabricDraft;
 const [draft,setDraft]=useState<FabricDraft>(initial);
 const [saving,setSaving]=useState(false),[error,setError]=useState('');
 const waiting=busy||saving;
 useV2LeaveProtection(JSON.stringify(draft)!==JSON.stringify(initial),waiting);
 const change=<K extends keyof FabricDraft>(key:K,value:FabricDraft[K])=>setDraft(d=>({...d,[key]:value}));
 const cancel=async()=>{
  if(waiting)return;
  if(JSON.stringify(draft)!==JSON.stringify(initial)){
   const ok=await confirm({title:'放弃尚未保存的面料编辑？',message:'当前修改尚未保存，放弃后无法恢复。',confirmText:'放弃编辑',danger:true});
   if(!ok)return;
  }
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
   <div className="flex min-w-0 flex-nowrap items-center gap-2">
    <input aria-label="克重数值" inputMode="decimal" placeholder="数值" value={draft.weightValue}
     onChange={e=>change('weightValue',e.target.value)} className={weightControl+' w-[72px]'}/>
    <select aria-label="克重单位" value={draft.weightUnit} onChange={e=>change('weightUnit',e.target.value as FabricDraft['weightUnit'])}
     className={weightControl+' w-[90px]'}><option value="">—</option><option value="gsm">gsm</option><option value="mm">mm</option></select>
   </div>
  </td>
  <td className="px-2 py-2"><input aria-label="门幅" inputMode="decimal" placeholder="可留空" value={draft.widthValue}
   onChange={e=>change('widthValue',e.target.value)} className={formInput}/></td>
  <td className="px-2 py-2"><input aria-label="备注" placeholder="可留空" maxLength={5000}
   value={draft.remark} onChange={e=>change('remark',e.target.value)} className={formInput}/></td>
  
  <td className="px-2 py-2 text-center text-slate-500">{original?.productCount??0}</td>
  <td className="col-actions px-2 py-2 text-right">
   <div className="flex items-center justify-end gap-2 whitespace-nowrap">
    <button type="button" disabled={waiting} onClick={submit}
     className="rounded bg-[#346ef6] px-2 py-1 text-xs text-white disabled:opacity-60"><ActionIcon name="save"/>
     {waiting?'保存中…':'保存'}</button>
    <button type="button" disabled={waiting} onClick={cancel} className={editText}><ActionIcon name="close"/>取消</button>
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
 const [sort,setSort]=useState<SortState|null>(null);
 const [visibility,setVisibility]=useState(()=>readColumnVisibility(fabricColumns,FABRIC_COLUMN_KEY));
 const editing=creating||editingId!==null;
 const shown=editing?fabricColumns:visibleColumns(fabricColumns,visibility);
 const rows=sortRows(page.items,sort,fabricColumns);
 const widthOf=(key:string)=>{
  const index=fabricColumns.findIndex(c=>c.key===key);
  const width=editing&&key==='weight'?192:index>=0?columnWidths[index]:0;
  return width?{width:width+'px'}:undefined;
 };
 const toggleSort=(key:string)=>setSort(current=>nextSortState(current,key));
 const toggleVisibility=(key:string)=>setVisibility(current=>{
  const next=toggleColumnVisibility(fabricColumns,current,key);
  writeColumnVisibility(FABRIC_COLUMN_KEY,next);
  return next;
 });
 const resetVisibility=()=>{
  const next=buildColumnVisibility(fabricColumns);
  writeColumnVisibility(FABRIC_COLUMN_KEY,next);
  setVisibility(next);
 };
 const renderCell=(item:FabricCatalogItem,key:string)=>{
  switch(key){
   case 'fabricNo':return <td className="px-3 py-3 font-semibold">{item.fabricNo}</td>;
   case 'fabricName':return <td className="px-3 py-3"><span title={item.fabricName} className="block max-w-[220px] truncate">{item.fabricName}</span></td>;
   case 'composition':return <td className="min-w-0 px-3 py-3">
    <span title={item.composition??undefined} className="block min-w-0 truncate">{nullText(item.composition)}</span></td>;
   case 'weight':return <td className="whitespace-nowrap px-3 py-3">{item.weightValue===null?'—':item.weightValue+' '+item.weightUnit}</td>;
   case 'width':return <td className="px-3 py-3">{item.widthValue??'—'}</td>;
   case 'remark':return <td className="min-w-0 px-3 py-3">
    <span title={item.remark??undefined} className="block min-w-0 truncate">{nullText(item.remark)}</span></td>;
   case 'products':return <td className="px-3 py-3 text-center">
    {onViewProducts?
     <button type="button" className={editText+' rounded px-2 py-1 focus-visible:outline-2 focus-visible:outline-[#346ef6]'} aria-label={'查看 '+item.fabricNo+' 关联产品 '+item.productCount+' 个'} onClick={()=>onViewProducts(item)}>
     {item.productCount}</button>:
     <span title="关联产品数量由服务器统计">{item.productCount}</span>}</td>;
   case 'actions':return <td className="col-actions px-3 py-3 text-right">
    {canManage?<div className="inline-flex gap-2">
     {onEdit?<button type="button" className="v2-icon-button" aria-label="编辑" title="编辑面料" onClick={()=>onEdit(item)}><ActionIcon name="edit"/></button>:null}
     {onDelete?<button type="button" className="v2-icon-button v2-icon-danger" aria-label="删除"
      title={item.productCount>0?'已有产品引用，不可删除':'删除面料'}
      disabled={item.productCount>0} onClick={()=>onDelete(item)}><ActionIcon name="delete"/></button>:null}
    </div>:<span className="text-slate-400">只读</span>}
   </td>;
   default:return null;
  }
 };
 return <div className={border+' flex min-w-0 flex-1 flex-col overflow-hidden'}>
  <div className="v2-library-toolbar">
   {editing?<span className="v2-library-toolbar-hint">编辑时临时显示全部字段</span>:null}
   {!editing&&<ColumnSettingsMenu columns={fabricColumns} visibility={visibility}
    onToggle={toggleVisibility} onReset={resetVisibility}/>}
  </div>
  <div className="overflow-x-auto">
   <table className={'v2-library-table w-full border-collapse text-left text-xs text-[#191b24] '+(editing?'min-w-[1300px]':'min-w-[1200px]')}>
    <colgroup>{shown.map(column=><col key={column.key} style={widthOf(column.key)}/>)}</colgroup>
    <thead><tr className="border-b border-[#c3c6d7] bg-[#f8fafc] text-[#475569]">
     {shown.map(column=><SortableHeader key={column.key} column={column} sort={sort} onSort={toggleSort}
      className={'px-3 py-3 font-semibold '+(['status','products'].includes(column.key)?'text-center ':'')+(column.key==='actions'?'col-actions':'')}/>)}
    </tr></thead>
    <tbody>
     {creating&&canManage&&onCancelDraft&&onSaveDraft?
      <FabricV2InlineDraft key="new" original={null} mode="create"
       onCancel={onCancelDraft} onSave={value=>onSaveDraft(null,value)}/>:null}
     {rows.map(item=>editingId===item.id&&canManage&&onCancelDraft&&onSaveDraft?
      <FabricV2InlineDraft key={item.id} original={item} mode="update"
       onCancel={onCancelDraft} onSave={payload=>onSaveDraft(item,payload)}/>:
      <tr key={item.id} className="v2-library-row border-b border-[#e2e8f0] last:border-0 hover:bg-[#f8fafc]">
       {shown.map(column=><React.Fragment key={column.key}>{renderCell(item,column.key)}</React.Fragment>)}
      </tr>)}
    </tbody>
   </table>
   {!rows.length&&!creating?<p className="py-16 text-center text-sm text-[#64748b]">没有匹配的面料，请调整或清空筛选条件。</p>:null}
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
   <p className="mt-2 text-xs text-slate-600">当前关联产品 {item.productCount} 条。有产品引用时不可删除；无产品引用时可删除，关联色卡同时作废，保留选样历史。
    服务器会在执行时再次检查引用，不会删除关联产品。</p>
   <div className="mt-5 flex justify-end gap-2">
    <button ref={ref} type="button" disabled={busy} onClick={onCancel}
     className="rounded border px-3 py-1.5 text-xs"><ActionIcon name="close"/>取消</button>
    <button type="button" disabled={busy||item.productCount>0} onClick={onConfirm}
     className="rounded bg-rose-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">
     <ActionIcon name="delete"/>{busy?'正在删除…':'确认删除'}</button>
   </div>
  </div>
 </div>;
}
export interface FabricLibraryV2Props{
 apiFetch:typeof fetch;canManage?:boolean;allowExport?:boolean;onViewProducts?(item:FabricCatalogItem):void;onImport?():void;
}
export function FabricLibraryV2({apiFetch,canManage=false,allowExport=true,onViewProducts,onImport}:FabricLibraryV2Props){
 const confirm=useConfirm();
 const [filters,setFilters]=useState<FabricFilters>({...emptyFabricFilters});
 const [page,setPage]=useState<FabricCatalogPage|null>(null);
 const [loading,setLoading]=useState(false),[failure,setFailure]=useState('');
 const [reload,setReload]=useState(0),[editingId,setEditingId]=useState<string|null>(null);
 const [creating,setCreating]=useState(false),[deleting,setDeleting]=useState<FabricCatalogItem|null>(null);
 const [deletingBusy,setDeletingBusy]=useState(false),[deleteError,setDeleteError]=useState('');
 const latest=useRef(createLatestRequestGuard());
 const isEditing=creating||editingId!==null;
 const dispatch=async(a:Parameters<typeof reduceFabricFilters>[1])=>{
  if(isEditing){
   const ok=await confirm({title:'切换筛选将取消当前面料编辑？',message:'当前行尚未保存的修改会丢失。',confirmText:'继续切换',danger:true});
   if(!ok)return;
  }
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
  },filters.query||filters.fabricNo||filters.fabricName||filters.composition?200:0);
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
 return <section className="v2-fabric v2-fabric-page flex min-h-[520px] flex-col gap-3 bg-transparent p-3 text-[#202b36] sm:p-5" aria-label="V2 面料库">
  <header className="v2-fabric-pagehead">
   <h1>面料库</h1>
   <div className="v2-page-actions">
   {allowExport?<CatalogExportButton apiFetch={apiFetch} listUrl={buildFabricCatalogUrl(filters)} filename="面料资料.xlsx"/>:null}
   {canManage&&onImport?<button type="button" onClick={onImport} disabled={isEditing||deletingBusy} title={isEditing?'请先保存或取消面料编辑':undefined} className="v2-card-secondary disabled:opacity-40"><ActionIcon name="excel"/>从Excel导入</button>:null}
   {canManage?<button type="button" className="v2-card-primary disabled:opacity-50"
    disabled={creating||editingId!==null} onClick={()=>{setEditingId(null);setCreating(true);}}>
    <Plus size={15}/>新增面料</button>:null}
   </div>
  </header>
  <div className={border+' v2-fabric-filterbar v2-library-filters flex flex-wrap items-center gap-3 p-3'}>
   {([['fabricNo','品号'],['fabricName','品名'],['composition','成分']] as const).map(([key,label])=><label key={key} className="flex items-center gap-2 text-xs">
    <Search size={15} className="text-slate-500"/>
    <input aria-label={'搜索'+label} maxLength={100}
     placeholder={label} className="v2-fabric-filterinput"
     value={filters[key]??''} onChange={e=>dispatch({type:key,value:e.target.value})}/>
   </label>)}
   
   {(filters.fabricNo||filters.fabricName||filters.composition||filters.query)?<button type="button" className="v2-fabric-reset" onClick={()=>dispatch({type:'reset'})}><ActionIcon name="reset"/>清空筛选</button>:null}
  </div>
  {loading?<p role="status" className="rounded border bg-white p-3 text-sm text-slate-500">正在查找面料…</p>:null}
  {failure?<p role="alert" className="rounded border border-rose-200 bg-white p-3 text-sm text-rose-700">
   {failure}<button type="button" onClick={refresh} className="ml-3 underline"><ActionIcon name="refresh"/>重试</button></p>:null}
  {!loading&&!failure&&page?<FabricV2Table page={page} canManage={canManage}
   creating={creating} editingId={editingId}
   onEdit={async item=>{
    if(creating)return;
    if(editingId&&editingId!==item.id){
     const ok=await confirm({title:'切换编辑行将放弃当前修改？',message:'当前行尚未保存的修改会丢失。',confirmText:'继续切换',danger:true});
     if(!ok)return;
    }
    setEditingId(item.id);
   }}
   onDelete={async item=>{
    if(isEditing){
     const ok=await confirm({title:'删除操作将放弃当前修改？',message:'当前行尚未保存的修改会丢失。',confirmText:'继续删除',danger:true});
     if(!ok)return;
    }
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
