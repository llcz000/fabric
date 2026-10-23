import React,{useEffect,useRef,useState} from 'react';
import {ArrowLeft,Plus} from 'lucide-react';
import type {ProductPatternChoice} from './productEditorModel';
import type {FabricCatalogItem} from './fabricModel';
import {ProductChoiceDialog} from './ProductChoiceDialog';
import {loadBatchMasterVersions,previewProductBatch,saveProductBatch,toggleBatchVersion,type BatchPreviewItem,type BatchSaveResult} from './productBatchModel';
import {useConfirm} from '../ui/ConfirmDialog';
import {BatchGeneratedProductDetails} from './BatchGeneratedProductDetails';
import {BatchSelectedColorways} from './BatchSelectedColorways';
import {resolveImageUrls} from './catalogModel';

/** One fabric for up to twenty colorways, each with independent image lists. */
export function ProductBatchCreateV2({apiFetch,onCancel,onSaved,initialMasterId}:{apiFetch:typeof fetch;initialMasterId?:string;onCancel():void;onSaved(result:BatchSaveResult):void}){
 const confirm=useConfirm(),workingRef=useRef(false);
 const [versions,setVersions]=useState<ProductPatternChoice[]>([]),[fabric,setFabric]=useState<FabricCatalogItem|null>(null);
 const [chooser,setChooser]=useState<'pattern'|'fabric'|null>(null);
 const [preview,setPreview]=useState<BatchPreviewItem[]|null>(null),[result,setResult]=useState<BatchSaveResult|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false);
 const [preparing,setPreparing]=useState(Boolean(initialMasterId)),[checking,setChecking]=useState(false);
 const lookupRev=useRef(0),thumbnailCache=useRef(new Map<string,string>());
 const [thumbnailUrls,setThumbnailUrls]=useState<Map<string,string>>(new Map());
 const [failedImageIds,setFailedImageIds]=useState<Set<string>>(new Set());
 useEffect(()=>{if(!initialMasterId)return;let canceled=false;
  loadBatchMasterVersions(apiFetch,initialMasterId).then(items=>{if(!canceled){setVersions(items);setPreparing(false);}})
  .catch(e=>{if(!canceled){setError(e instanceof Error?e.message:'花型配色加载失败');setPreparing(false);}});
  return ()=>{canceled=true;};
 },[apiFetch,initialMasterId]);
 useEffect(()=>{
  const revision=++lookupRev.current;
  setPreview(null);setChecking(false);
  if(!fabric||!versions.length||versions.length>20||preparing||result)return;
  let canceled=false;
  const timer=setTimeout(()=>{
   setChecking(true);
   previewProductBatch(apiFetch,versions,fabric).then(items=>{if(!canceled&&lookupRev.current===revision){setPreview(items);setError('');}})
    .catch(e=>{if(!canceled&&lookupRev.current===revision)setError(e instanceof Error?e.message:'自动核对失败');})
    .finally(()=>{if(!canceled&&lookupRev.current===revision)setChecking(false);});
  },180);
  return ()=>{canceled=true;clearTimeout(timer);};
 },[apiFetch,versions,fabric,preparing,result]);
 useEffect(()=>{
  const ids=[...new Set(versions.map(item=>item.patternImageAssetId).filter((id):id is string=>Boolean(id)))];
  const current=()=>new Map(ids.filter(id=>thumbnailCache.current.has(id))
   .map(id=>[id,thumbnailCache.current.get(id)!] as const));
  setThumbnailUrls(current());
  const missing=ids.filter(id=>!thumbnailCache.current.has(id));
  if(!missing.length)return;
  const controller=new AbortController();let active=true;
  void (async()=>{
   for(let start=0;start<missing.length;start+=100){
    try{
     const batch=await resolveImageUrls(apiFetch,missing.slice(start,start+100),'thumbnail',controller.signal);
     if(!active||controller.signal.aborted)return;
     for(const [id,url] of batch)thumbnailCache.current.set(id,url);
     setThumbnailUrls(current());
    }catch{/* Thumbnail failure only affects the placeholder, not selected colorways. */}
    if(!active||controller.signal.aborted)return;
   }
  })();
  return ()=>{active=false;controller.abort();};
 },[apiFetch,versions]);
 const invalidate=()=>{setPreview(null);setError('');setUncertain(false);};
 const toggle=(item:ProductPatternChoice)=>{
  if(busy)return;
  // Validate in the event handler: updater callbacks run during React rendering,
  // where this try/catch cannot intercept a selection-limit exception.
  try{setVersions(toggleBatchVersion(versions,item));invalidate();}
  catch(e){setError(e instanceof Error?e.message:'无法选择配色');}
 };
 const selectFabric=(item:FabricCatalogItem)=>{setFabric(item);invalidate();setChooser(null);};
 const run=async(action:()=>Promise<void>)=>{
  if(workingRef.current)return;workingRef.current=true;setBusy(true);setError('');
  try{await action();}catch(e){setError(e instanceof Error?e.message:'产品批量操作失败');}
  finally{workingRef.current=false;setBusy(false);}
 };
 
 const doSave=()=>void run(async()=>{
  if(!preview||uncertain||checking||versions.length>20)return;
  setUncertain(true);
  const saved=await saveProductBatch(apiFetch,versions,fabric);
  setResult(saved);setUncertain(false);
 });
 const leave=async()=>{
  if(busy)return;
  if(!result&&(versions.length>0||fabric)){
   if(!await confirm({title:'放弃批量新增草稿？',message:'当前选择尚未保存。',confirmText:'放弃',danger:true}))return;
  }
  onCancel();
 };
 const pending=preview?.filter(x=>!x.existing).length??0;
 return <section aria-label="批量新增产品" className="flex min-h-[560px] flex-col gap-4 bg-[#faf8ff] p-3 text-[#191b24] sm:p-5">
  <header className="flex flex-wrap items-center justify-between gap-3">
   <button type="button" onClick={()=>void leave()} disabled={busy} className="inline-flex items-center gap-2 text-sm text-[#0053da]"><ArrowLeft size={16}/>返回产品库</button>
   <h1 className="text-lg font-semibold">批量新增产品</h1>
   {result?<button type="button" onClick={()=>onSaved(result)} className="rounded-lg bg-[#346ef6] px-4 py-2 text-sm text-white">完成并返回</button>:null}
  </header>
  <p className="text-xs text-slate-500">一次可选择1～20个花型配色，统一选择一种面料；每个组合单独生成产品，原图取自对应配色，三类产品图片不复制、可后补。</p>
  {!result?<div className="space-y-4">
   <div className="rounded-xl border border-[#c3c6d7] bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
     <strong className="text-sm">1. 选择花型配色（{versions.length} 个）</strong>
     <button type="button" disabled={busy||preparing} onClick={()=>setChooser('pattern')}
      className="inline-flex items-center gap-1 rounded border border-[#346ef6] px-3 py-1.5 text-xs text-[#0053da]"><Plus size={14}/>勾选花型配色</button>
    </div>
    {preparing?<p role="status" className="mt-2 text-xs">正在带入花型的全部配色…</p>:null}
    {versions.length>20?<p role="alert" className="mt-2 text-xs text-amber-700">当前花型有 {versions.length} 个有效配色，每批最多创建20个。请先移除部分配色后创建，其余配色可分批操作。</p>:null}
    {versions.length?<BatchSelectedColorways items={versions} urls={thumbnailUrls}
     failedIds={failedImageIds} onImageError={id=>setFailedImageIds(previous=>new Set(previous).add(id))}
     onRemove={toggle} disabled={busy}/>:
     <p className="mt-3 text-xs text-slate-500">尚未选择配色</p>}
   </div>
   <div className="rounded-xl border border-[#c3c6d7] bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
     <strong className="text-sm">2. 统一选择面料</strong>
     <button type="button" disabled={busy} onClick={()=>setChooser('fabric')} className="rounded border border-[#346ef6] px-3 py-1.5 text-xs text-[#0053da]">{fabric?'更换面料':'选择面料'}</button>
    </div>
    <p className="mt-2 text-xs text-slate-600">{fabric?fabric.fabricNo+' · '+fabric.fabricName:'待选择'}</p>
    <p className="mt-1 text-xs text-slate-500">完整面料信息将在下方产品预览中显示。</p>
   </div>
   <div className="rounded-xl border border-[#c3c6d7] bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
     <strong className="text-sm">3. 自动生成产品信息</strong>
     {checking?<span role="status" className="text-xs text-slate-500">正在核对组合…</span>:null}
    </div>
    {preview?<div className="mt-3 space-y-1 text-xs">
     {fabric?<BatchGeneratedProductDetails items={preview} fabric={fabric}/>:null}
     <p className="pt-2 text-slate-600">预计新增 {pending} 个，跳过 {preview.length-pending} 个；新产品创建后即可选样和开单，图片可后补。</p>
     <div className="flex justify-end pt-3"><button type="button" disabled={busy||checking||uncertain||pending===0||versions.length>20} onClick={doSave} className="rounded-lg bg-[#346ef6] px-4 py-2 text-sm text-white disabled:opacity-50">确认批量创建</button></div>
    </div>:<p className="mt-2 text-xs text-slate-500">{versions.length>20?'请减少至20个配色以自动核对':!fabric||!versions.length?'选择配色和面料后，将自动显示产品货号及已有组合':'正在获取最新产品资料…'}</p>}
   </div>
  </div>:<div role="status" className="rounded-xl border border-emerald-200 bg-white p-5 text-sm">
   批量新增完成：成功创建 {result.created.length} 个，跳过已存在组合 {result.skipped.length} 个。
   <p className="mt-2 text-xs text-slate-500">图片默认独立且尚未补充。可返回产品库逐个添加大图、细节图和效果图。</p>
  </div>}
  {uncertain&&!result?<p role="alert" className="rounded bg-amber-50 p-3 text-sm text-amber-800">批量提交已发出但未获得确认，请先返回产品库检查结果，避免重复操作。</p>:null}
  {error?<p role="alert" className="rounded bg-rose-50 p-3 text-sm text-rose-700">{error}</p>:null}
  {chooser?<ProductChoiceDialog type={chooser} apiFetch={apiFetch} onClose={()=>setChooser(null)}
   onChooseVersion={toggle} onChooseFabric={selectFabric} selectionError={chooser==='pattern'?error:undefined}
   multiSelectVersionIds={chooser==='pattern'?versions.map(v=>v.id):undefined}/>:null}
 </section>;
}
