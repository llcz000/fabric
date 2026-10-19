import {ActionIcon} from './ActionIcon';
import {CatalogExportButton} from './CatalogExportButton';
import {useV2LeaveProtection} from './useV2LeaveProtection';
import {readV2Route,v2Route} from './v2Navigation';
import React,{useEffect,useRef,useState,useCallback} from 'react';
import {Image as ImageIcon,Plus,Search,X,ChevronLeft,ChevronRight,Images,RotateCcw} from 'lucide-react';
import {ProductImageTabs,type CatalogImageResolver} from './ProductImageTabs';
import type {CatalogFilters,CatalogPage,CatalogProduct} from './catalogModel';
import {
 emptyCatalogFilters,reduceCatalogFilters,fetchCatalogPage,buildCatalogUrl,
 resolveImageUrls,getCatalogProductImages,createLatestRequestGuard
} from './catalogModel';

const columns=['花型图','货号','品名','成分','克重','门幅 / cm',
 '图片数量','备注','启用状态','操作'] as const;
const neutral='rounded-lg border border-[#c3c6d7] bg-white text-[#434655]';
const display=(s:string|null|undefined)=>s&&s.trim()?s:'—';
export interface CatalogV2TableProps{
 page:CatalogPage;
 patternUrls:Map<string,string>;
 onPatternPreview(product:CatalogProduct):void;
 onProductImages(product:CatalogProduct):void;
 onPage(offset:number):void;
 canManage?:boolean;
 onEdit?(product:CatalogProduct):void;
 onDeleteRequest?(product:CatalogProduct):void;
 onRemark?(product:CatalogProduct):void;
 updating?:boolean;
}
export function CatalogV2Table({
 page,patternUrls,onPatternPreview,onProductImages,onPage,canManage=false,onEdit,onDeleteRequest,onRemark,updating=false
}:CatalogV2TableProps){
 return <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-[#c3c6d7] bg-white">
  <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="产品列表，可左右滚动查看全部字段">
   <table className="w-full min-w-[1000px] border-collapse text-left text-xs text-[#191b24]">
    <thead><tr className="border-b border-[#c3c6d7] bg-[#f3f4fa] text-[#434655]">
     {columns.map((col,index)=><th key={col} scope="col"
      className={'px-3 py-3 font-medium '+([0,6,8,9].includes(index)?'text-center':'')}>{col}</th>)}
    </tr></thead>
    <tbody>
    {page.items.map(product=>{
     const picture=product.patternImageAssetId?patternUrls.get(product.patternImageAssetId):undefined;
     const imageCount=product.imageCounts;
     return <tr key={product.id} className="border-b border-[#ededf9] hover:bg-[#f8f9ff]">
      <td className="px-3 py-2 text-center">
       {picture?<button type="button" disabled={updating} onClick={()=>onPatternPreview(product)}
        aria-label={'查看花型原图 '+product.productNo}
        className="inline-flex rounded border border-[#e2e1ee] focus-visible:outline-2 focus-visible:outline-[#346ef6]">
        <img src={picture} alt={'花型 '+product.masterNo+' 配色'+product.colorwayNo}
         loading="lazy" className="h-12 w-12 rounded object-cover"/></button>:
        <span className="inline-flex h-12 w-12 items-center justify-center rounded bg-[#f3f2ff] text-[10px] text-[#737686]"
         aria-label={product.patternImageAssetId?'图片暂不可用':'待上传花型图'}>{product.patternImageAssetId?'图片不可用':'待上传'}</span>}
      </td>
      <td className="px-3 py-2 font-semibold text-[#003ea7]">{product.productNo}</td>
      <td className="px-3 py-2">{display(product.fabricName)}</td>
      <td className="px-3 py-2">{display(product.composition)}</td>
      <td className="whitespace-nowrap px-3 py-2">{product.weightValue===null?'—':product.weightValue+' '+(product.weightUnit??'')}</td>
      <td className="px-3 py-2">{product.widthCm??'—'}</td>
      <td className="whitespace-nowrap px-3 py-2 text-center text-[11px] text-[#434655]">
       大图 {imageCount.fabricDisplay} · 细节 {imageCount.detail} · 效果 {imageCount.aiEffect}
      </td>
      <td className="max-w-44 px-3 py-2">
       {product.remark.trim()&&onRemark?<button type="button" disabled={updating} onClick={()=>onRemark(product)}
        title={product.remark}
        aria-label={'查看完整备注 '+product.productNo}
        className="max-w-40 truncate text-left hover:text-[#0053da] focus-visible:underline">{product.remark}</button>:
        product.remark.trim()?<span title={product.remark} className="block max-w-40 truncate">{product.remark}</span>:
        <span className="text-slate-400">—</span>}
      </td>
      <td className="px-3 py-2 text-center">
       <span className={'rounded-full px-2 py-0.5 text-[11px] '+(product.isActive?
        'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-600')}>
        {product.isActive?'已启用':'已停用'}</span>
       {!product.isAvailableForSampling?<span className="mt-1 block text-[11px] text-amber-700">暂不供样</span>:null}
      </td>
      <td className="px-3 py-2 text-center"><div className="inline-flex items-center gap-2 whitespace-nowrap">
       <button type="button" disabled={updating} className="v2-icon-button" title="查看产品图"
        onClick={()=>onProductImages(product)} aria-label={'查看产品图 '+product.productNo}><Images size={17} aria-hidden="true"/></button>
       {canManage&&onEdit?<button type="button" disabled={updating} onClick={()=>onEdit(product)}
        className="v2-icon-button" aria-label="编辑" title="编辑产品"><ActionIcon name="edit"/></button>:null}
       {canManage&&onDeleteRequest?<button type="button" disabled={updating} onClick={()=>onDeleteRequest(product)}
        className="v2-icon-button v2-icon-danger" aria-label="删除" title="删除产品"><ActionIcon name="delete"/></button>:null}
      </div></td>
     </tr>;
    })}
    </tbody>
   </table>
   {!page.items.length?<div className="px-4 py-16 text-center text-sm text-slate-500">没有匹配的产品，请调整或清空筛选条件。</div>:null}
  </div>
  <div className="mt-auto flex items-center justify-between gap-3 border-t border-[#ededf9] px-3 py-2.5 text-xs text-[#737686]">
   <span>共 {page.total} 条产品 · 每页 {page.limit} 条 · 第 {Math.floor(page.offset/page.limit)+1} 页</span>
   <div className="flex items-center gap-2">
    <button type="button" aria-label="上一页" className={neutral+' px-2 py-1.5'}
     disabled={updating||page.offset===0} onClick={()=>onPage(Math.max(0,page.offset-page.limit))}><ChevronLeft size={15}/></button>
    <button type="button" aria-label="下一页" className={neutral+' px-2 py-1.5'}
     disabled={updating||page.offset+page.limit>=page.total} onClick={()=>onPage(page.offset+page.limit)}><ChevronRight size={15}/></button>
   </div>
  </div>
 </div>;
}
function ImageDialog({
 title,onClose,children
}:{title:string;onClose():void;children:React.ReactNode}){
 const ref=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  const before=document.activeElement instanceof HTMLElement?document.activeElement:null;
  ref.current?.focus();
  const keydown=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();onClose();}
   if(e.key==='Tab'){
    const controls=Array.from(document.querySelectorAll<HTMLElement>('[data-v2-image-dialog] button:not([disabled]),[data-v2-image-dialog] [tabindex]'))
     .filter(element=>element.tabIndex>=0&&element.getClientRects().length>0);
    if(!controls.length)return;
    if(e.shiftKey&&document.activeElement===controls[0]){e.preventDefault();controls[controls.length-1].focus();}
    else if(!e.shiftKey&&document.activeElement===controls[controls.length-1]){e.preventDefault();controls[0].focus();}
   }
  };
  document.addEventListener('keydown',keydown);
  return ()=>{document.removeEventListener('keydown',keydown);before?.focus();};
 },[onClose]);
 return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3" role="presentation">
  <div role="dialog" aria-modal="true" aria-label={title} data-v2-image-dialog
   className="flex max-h-[95vh] w-full max-w-[990px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
   <div className="flex items-center justify-between border-b px-4 py-3">
    <strong className="text-sm">{title}</strong>
    <button ref={ref} aria-label="关闭图片预览" type="button" className="rounded p-2 hover:bg-slate-100" onClick={onClose}><X size={18}/></button>
   </div>
   <div className="overflow-y-auto p-4">{children}</div>
  </div>
 </div>;
}
export function CatalogDeleteConfirmation({product,onCancel,onConfirm,busy=false,error=''}:{
 product:CatalogProduct;onCancel():void;onConfirm():void;busy?:boolean;error?:string;
}){
 const cancel=useRef<HTMLButtonElement>(null),dialog=useRef<HTMLDialogElement>(null),latest=useRef({busy,onCancel});
 latest.current={busy,onCancel};
 useEffect(()=>{
  const before=document.activeElement instanceof HTMLElement?document.activeElement:null;
  dialog.current?.showModal();cancel.current?.focus();
  const keydown=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();if(!latest.current.busy)latest.current.onCancel();}
   if(event.key==='Tab'){
    const buttons=Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])')??[]);
    if(!buttons.length){event.preventDefault();dialog.current?.focus();}
    else if(event.shiftKey&&document.activeElement===buttons[0]){event.preventDefault();buttons.at(-1)?.focus();}
    else if(!event.shiftKey&&document.activeElement===buttons.at(-1)){event.preventDefault();buttons[0]?.focus();}
   }
  };
  document.addEventListener('keydown',keydown);
  return ()=>{document.removeEventListener('keydown',keydown);dialog.current?.close();before?.focus();};
 },[]);
 useEffect(()=>{if(busy)dialog.current?.focus();else cancel.current?.focus();},[busy]);
 return <dialog ref={dialog} tabIndex={-1} data-v2-delete-dialog role="alertdialog" aria-modal="true" aria-label="确认删除产品"
  onCancel={event=>{event.preventDefault();if(!busy)onCancel();}}
  className="fixed inset-0 m-auto w-[calc(100%-24px)] max-w-md rounded-xl bg-white p-5 text-[#191b24] shadow-2xl">
   <h2 className="mb-3 text-lg font-semibold">确认删除产品？</h2>
   <p className="break-words text-sm">货号：<strong>{product.productNo}</strong></p>
   <p className="my-3 text-xs text-slate-600">删除仅移除该产品及图片关联，不影响花型、面料或共享图片。已开单产品不能删除。</p>
   {error&&<p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
   <div className="mt-5 flex justify-end gap-2">
    <button ref={cancel} type="button" disabled={busy} onClick={onCancel} className="rounded border border-slate-300 px-4 py-2 text-sm"><ActionIcon name="close"/>取消</button>
    <button type="button" disabled={busy} onClick={onConfirm} className="rounded bg-rose-700 px-4 py-2 text-sm text-white"><ActionIcon name="delete"/>{busy?'正在删除…':'确认删除'}</button>
   </div>
 </dialog>;
}
interface ViewerState{type:'pattern'|'product';item:CatalogProduct}
export interface ProductCatalogV2Props{
 apiFetch:typeof fetch;canManage?:boolean;allowExport?:boolean;
 resolveImages?:CatalogImageResolver;
 onCreate?():void;
 onEdit?(product:CatalogProduct):void;
 onDeleteRequest?(product:CatalogProduct):Promise<void>|void;
}
/** P4 isolated component: deliberately not mounted over legacy ProductLibrary. */
export function ProductCatalogV2({apiFetch,canManage=false,allowExport=true,onCreate,onEdit,onDeleteRequest,resolveImages}:ProductCatalogV2Props){
 const imageResolver=useCallback<CatalogImageResolver>((ids,variant,signal)=>resolveImages?resolveImages(ids,variant,signal):resolveImageUrls(apiFetch,ids,variant,signal),[apiFetch,resolveImages]);
 const [filters,setFilters]=useState<CatalogFilters>(()=>{
  const route=readV2Route(typeof window==='undefined'?'':window.location.hash),q=route.params;
  if(route.view!=='products')return {...emptyCatalogFilters};
  const offset=Number(q.get('offset')??0),limit=Number(q.get('limit')??50);
  return {...emptyCatalogFilters,productNo:q.get('productNo')??'',fabricName:q.get('fabricName')??'',status:q.get('status')==='all'?'all':'active',offset:Number.isSafeInteger(offset)&&offset>=0?offset:0,limit:Number.isInteger(limit)&&limit>0&&limit<=100?limit:50};
 });
 useEffect(()=>{if(typeof window!=='undefined'&&readV2Route(window.location.hash).view==='products'){
  const query=buildCatalogUrl('/api/v2/products',filters).split('?')[1];window.history.replaceState(window.history.state,'',v2Route('products',Object.fromEntries(new URLSearchParams(query))));
 }},[filters]);
 const [page,setPage]=useState<CatalogPage|null>(null),[busy,setBusy]=useState(false);
 const [failure,setFailure]=useState(''),[retry,setRetry]=useState(0);
 const [thumbnailUrls,setThumbnailUrls]=useState<Map<string,string>>(new Map());
 const [viewer,setViewer]=useState<ViewerState|null>(null),[viewerError,setViewerError]=useState('');
 const [viewerUrls,setViewerUrls]=useState<Map<string,string>>(new Map());
 const [viewerImages,setViewerImages]=useState<{fabricDisplay:string[];detail:string[];aiEffect:string[]}|null>(null);
 const [remark,setRemark]=useState<CatalogProduct|null>(null);
 const [pendingDelete,setPendingDelete]=useState<CatalogProduct|null>(null);
 const [deleteBusy,setDeleteBusy]=useState(false),[deleteError,setDeleteError]=useState('');
 const deleting=useRef(false);useV2LeaveProtection(false,deleteBusy);
 const confirmDelete=async()=>{
  if(!pendingDelete||!onDeleteRequest||deleting.current)return;
  deleting.current=true;setDeleteBusy(true);setDeleteError('');
  try{await onDeleteRequest(pendingDelete);setPendingDelete(null);}
  catch(e){setDeleteError(e instanceof Error?e.message:'产品删除失败，请重试');}
  finally{deleting.current=false;setDeleteBusy(false);}
 };
 const listGuard=useRef(createLatestRequestGuard());
 const viewerGuard=useRef(createLatestRequestGuard());
 const closeViewer=useCallback(()=>{viewerGuard.current.cancel();setViewer(null);setViewerUrls(new Map());setViewerImages(null);setViewerError('');},[]);
 const dispatch=(action:Parameters<typeof reduceCatalogFilters>[1])=>setFilters(f=>reduceCatalogFilters(f,action));
 useEffect(()=>{
  const controller=new AbortController(),ticket=listGuard.current.next();
  setBusy(true);setFailure('');
  // Compact debounce applies to both text inputs; non-text filters use the same latest-only protection.
  const delay=filters.productNo||filters.fabricName?220:0;
  const timer=setTimeout(async()=>{
   try{
    const result=await fetchCatalogPage(apiFetch,filters,controller.signal);
    if(controller.signal.aborted||!listGuard.current.isCurrent(ticket))return;
    setPage(result);setThumbnailUrls(new Map());setBusy(false);
    const ids=result.items.map(x=>x.patternImageAssetId).filter((x):x is string=>Boolean(x));
    if(ids.length){
     try{
      const urls=await imageResolver(ids,'thumbnail',controller.signal);
      if(!controller.signal.aborted&&listGuard.current.isCurrent(ticket))setThumbnailUrls(urls);
     }catch{/* An inaccessible asset must be a non-clickable placeholder, not a fake image. */}
    }
   }catch{
    if(!controller.signal.aborted&&listGuard.current.isCurrent(ticket)){setFailure('产品加载失败，请重试。');setBusy(false);}
   }
  },delay);
  return ()=>{clearTimeout(timer);controller.abort();listGuard.current.cancel();};
 },[filters,retry,apiFetch,imageResolver]);
 useEffect(()=>{
  if(!viewer)return;
  const controller=new AbortController(),ticket=viewerGuard.current.next();
  setViewerError('');setViewerUrls(new Map());setViewerImages(null);
  (async()=>{
   try{
    if(viewer.type==='pattern'){
     const id=viewer.item.patternImageAssetId;
     if(!id)throw Error('Missing original image');
     const urls=await imageResolver([id],'original',controller.signal);
     if(!urls.get(id))throw Error('No accessible original');
     if(!controller.signal.aborted&&viewerGuard.current.isCurrent(ticket))setViewerUrls(urls);
    }else{
     const detail=await getCatalogProductImages(apiFetch,viewer.item.id,controller.signal);
     if(!controller.signal.aborted&&viewerGuard.current.isCurrent(ticket)){
      setViewerImages(detail.images);
     }
    }
   }catch{
    if(!controller.signal.aborted&&viewerGuard.current.isCurrent(ticket))
     setViewerError('图片加载失败，请关闭后重试。');
   }
  })();
  return ()=>{controller.abort();viewerGuard.current.cancel();};
 },[viewer,apiFetch,imageResolver]);
 return <section className="v2-catalog flex min-h-[520px] flex-col gap-3 bg-[#faf8ff] p-3 text-[#191b24] sm:p-5" aria-label="V2 产品库">
  <div className="v2-catalog-toolbar">
   <div><h1 className="text-xl font-semibold tracking-tight">产品库</h1>
    <p className="mt-1 text-sm text-slate-500">管理花型配色与面料组合</p></div>
   <div className="v2-catalog-actions">
   {allowExport?<CatalogExportButton apiFetch={apiFetch} listUrl={buildCatalogUrl("/api/v2/products",filters)} filename="产品资料.xlsx"/>:null}
   {canManage&&onCreate?<button type="button" onClick={onCreate}
    className="inline-flex items-center gap-1 rounded-lg bg-[#346ef6] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#275ee0]">
    <Plus size={16}/>新增产品</button>:null}
   </div>
  </div>
  <div className="v2-catalog-filters v2-library-filters flex flex-wrap items-center gap-2 rounded-lg border border-[#c3c6d7] bg-white p-2.5 text-xs">
   <label className="relative"><span className="sr-only">货号</span>
    <Search className="absolute left-2 top-2 text-[#737686]" size={14}/>
    <input aria-label="货号" value={filters.productNo} onChange={e=>dispatch({type:'productNo',value:e.target.value})}
     placeholder="请输入货号" className="h-8 w-36 rounded-lg border border-[#c3c6d7] pl-7 pr-2 outline-[#346ef6]" /></label>
   <label><span className="sr-only">品名</span>
    <input aria-label="品名" value={filters.fabricName} onChange={e=>dispatch({type:'fabricName',value:e.target.value})}
     placeholder="请输入品名" className="h-8 w-36 rounded-lg border border-[#c3c6d7] px-2 outline-[#346ef6]" /></label>
   <label className="inline-flex items-center gap-1.5 whitespace-nowrap">
    <input aria-label="包含停用" type="checkbox" checked={filters.status==='all'}
     onChange={e=>dispatch({type:'status',value:e.target.checked?'all':'active'})}/>包含停用</label>
   <button type="button" onClick={()=>dispatch({type:'reset'})}
    className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-[#0053da] hover:bg-[#eef1fd]"><RotateCcw size={13}/>清空筛选</button>

  </div>

   <div className="v2-catalog-status" role="status" aria-live="polite">{busy?(page?'正在更新产品…':'正在查找产品…'):page?'共 '+page.total+' 条产品':''}</div>
  {failure?<div role="alert" className="rounded-lg border border-rose-200 bg-white p-4 text-sm text-rose-700">
   {failure}<button type="button" onClick={()=>setRetry(n=>n+1)} className="ml-3 underline"><ActionIcon name="refresh"/>重试</button></div>:null}
   <div className="v2-catalog-viewport" aria-busy={busy} data-updating={busy}>
   {page?<CatalogV2Table updating={busy||Boolean(failure)} page={page} patternUrls={thumbnailUrls}
   onPatternPreview={item=>setViewer({type:'pattern',item})}
   onProductImages={item=>setViewer({type:'product',item})}
   onPage={offset=>dispatch({type:'page',offset})} onRemark={setRemark}
    canManage={canManage} onEdit={onEdit} onDeleteRequest={onDeleteRequest?item=>{setDeleteError('');setPendingDelete(item);}:undefined}/>:<div className="v2-catalog-skeleton" aria-hidden="true"/>}
   </div>
  {pendingDelete&&onDeleteRequest?<CatalogDeleteConfirmation product={pendingDelete}
    busy={deleteBusy} error={deleteError} onCancel={()=>{if(!deleting.current)setPendingDelete(null);}}
    onConfirm={()=>void confirmDelete()}/>:null}
  {remark?<ImageDialog title={'产品备注 · '+remark.productNo} onClose={()=>setRemark(null)}>
   <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{remark.remark}</p>
  </ImageDialog>:null}
  {viewer?<ImageDialog title={(viewer.type==='pattern'?'花型原图 · ':'产品图片 · ')+viewer.item.productNo} onClose={closeViewer}>
   {viewerError?<p role="alert" className="text-sm text-rose-700">{viewerError}</p>:null}
   {!viewerError&&viewer.type==='pattern'?
    (viewerUrls.get(viewer.item.patternImageAssetId??'')?
     <img src={viewerUrls.get(viewer.item.patternImageAssetId??'')} alt="当前配色花型原图"
      className="mx-auto max-h-[75vh] max-w-full object-contain"/>:
     <p className="text-center text-slate-500">正在加载原图…</p>):
    null}
   {!viewerError&&viewer.type==='product'?
    (viewerImages?<ProductImageTabs key={viewer.item.id} images={viewerImages} resolveImages={imageResolver}/>:
     <p className="text-center text-slate-500">正在加载图片资料…</p>):null}
  </ImageDialog>:null}
 </section>;
}
export default ProductCatalogV2;
