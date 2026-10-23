import { ActionIcon } from './ActionIcon';
import { useV2LeaveProtection } from './useV2LeaveProtection';
import {useConfirm} from '../ui/ConfirmDialog';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { FabricCatalogItem } from './fabricModel';
import { emptyProductDraft, initialProductDraft, buildProductNumberPreview, addDraftAsset, replaceDraftAsset, removeDraftAssets, moveDraftAsset, updateSelectedImages, loadProductForEdit, saveProductDraft, fetchColorwayChoices, type ImageRole, type ProductEditorDetails, type ProductEditorDraft, type ProductPatternChoice } from './productEditorModel';
import { resolveImageUrls, createLatestRequestGuard } from './catalogModel';
import {ProductIdentityChoices} from './ProductIdentityChoices';
import {ProductImageTabs} from './ProductEditorImageTabs';
import {ProductChoiceDialog} from './ProductChoiceDialog';
type ChoiceState='pattern'|'fabric'|null;

const emptySelected=():Record<ImageRole,string[]>=>({fabricDisplay:[],detail:[],aiEffect:[]});

const tag='rounded-md border border-[#c3c6d7] bg-white px-3 py-2 text-xs text-[#191b24]';

export interface ProductEditorV2Props{
 apiFetch:typeof fetch;mode:'create'|'edit';productId?:string;canManage?:boolean;
 prefillPatternId?:string;prefillPatternNo?:string;
 onCancel():void;onSaved(product:ProductEditorDetails):void;onBatchCreate?():void;
 onPatternLibrary?():void;onFabricLibrary?():void;
 /** Not enabled until an authenticated V2 image-upload bridge has been verified.
  * Must upload exactly one file, await ready status and return a ready UUID assetId.
  */
 onUploadImage?(file:File,role:ImageRole):Promise<string>;
}

export function ProductEditorV2({apiFetch,mode,productId,canManage=false,onCancel,onSaved,
 onPatternLibrary,onFabricLibrary,onUploadImage,prefillPatternId,prefillPatternNo,onBatchCreate}:ProductEditorV2Props){
 const confirm=useConfirm();
 const [draft,setDraft]=useState<ProductEditorDraft>(emptyProductDraft);
 const [original,setOriginal]=useState<ProductEditorDetails|null>(null);
 const [version,setVersion]=useState<ProductPatternChoice|null>(null);
 const [fabric,setFabric]=useState<FabricCatalogItem|null>(null);
 const [active,setActive]=useState<ImageRole>('fabricDisplay');
 const [selected,setSelected]=useState<Record<ImageRole,string[]>>(emptySelected);
 const [chooser,setChooser]=useState<ChoiceState>(null);
 const [loadBusy,setLoadBusy]=useState(mode==='edit'),[saving,setSaving]=useState(false);
 const [imageBusy,setImageBusy]=useState(false),[error,setError]=useState('');
 const [fatal,setFatal]=useState(false),[urls,setUrls]=useState<Map<string,string>>(new Map());
 const fileRef=useRef<HTMLInputElement>(null);
 const uploadTarget=useRef<{role:ImageRole;index:number|null}|null>(null);
 const activeSave=useRef(false),draftRef=useRef(draft),baseline=useRef(emptyProductDraft());
 const loaded=useRef(createLatestRequestGuard());
 useEffect(()=>{draftRef.current=draft;},[draft]);
 const dirty=JSON.stringify(draft)!==JSON.stringify(baseline.current);
 useV2LeaveProtection(dirty,saving||imageBusy);
 const close=async()=>{
  if(saving||imageBusy)return;
  if(dirty){
   const ok=await confirm({title:'放弃未保存的产品修改？',message:'当前修改尚未保存，放弃后无法恢复。',confirmText:'放弃修改',danger:true});
   if(!ok)return;
  }
  onCancel();
 };
 useEffect(()=>{
  const listener=(e:BeforeUnloadEvent)=>{
   if(JSON.stringify(draftRef.current)!==JSON.stringify(baseline.current)){
    e.preventDefault();e.returnValue='';
   }
  };
  window.addEventListener('beforeunload',listener);
  return ()=>window.removeEventListener('beforeunload',listener);
 },[]);
 useEffect(()=>{
  if(mode!=='create'||!prefillPatternId||!prefillPatternNo)return;
  const controller=new AbortController();
  void fetchColorwayChoices(apiFetch,prefillPatternNo,controller.signal).then(result=>{
   if(controller.signal.aborted)return;
   const match=result.items.find(item=>item.id===prefillPatternId&&item.patternNo===prefillPatternNo&&item.isActive);
   if(!match){setError('预选花型不存在或已删除，请重新选择可用配色');return;}
   setVersion(match);setDraft(d=>({...d,patternColorwayId:match.id}));
  }).catch(()=>{if(!controller.signal.aborted)setError('预选花型读取失败，请重新选择');});
  return ()=>controller.abort();
 },[apiFetch,mode,prefillPatternId,prefillPatternNo]);
 useEffect(()=>{
  if(mode!=='edit')return;
  if(!productId){setLoadBusy(false);setError('没有提供产品身份，无法编辑');return;}
  const ctrl=new AbortController(),seq=loaded.current.next();
  (async()=>{
   try{
    const detail=await loadProductForEdit(apiFetch,productId,ctrl.signal);
    if(ctrl.signal.aborted||!loaded.current.isCurrent(seq))return;
    const initial=initialProductDraft(detail);
    setOriginal(detail);setDraft(initial);baseline.current=initial;
    // Derive an immutable read-only identity summary from server detail even when
    // original parents are inactive; re-selection always queries active sources.
    const patternNo=detail.masterNo+'-'+detail.colorwayNo;
    setVersion({id:detail.patternColorwayId,masterId:'0',
     colorwayNo:detail.colorwayNo,patternNo,patternImageAssetId:detail.patternImageAssetId,
     remark:'',isActive:detail.colorwayActive,colorTags:[],topicTags:[]});
    setFabric({id:detail.fabricId,fabricNo:detail.fabricNo,fabricName:detail.fabricName,
     composition:detail.composition,weightValue:detail.weightValue,weightUnit:detail.weightUnit,
     widthValue:detail.widthCm,remark:null,isActive:detail.fabricActive,productCount:0});
    // Enrich parent topic and version color tags from their authoritative
    // pattern catalog; keep the safe detail snapshot when a parent is inactive.
    try{
     const found=await fetchColorwayChoices(apiFetch,patternNo,ctrl.signal);
     const match=found.items.find(v=>v.id===detail.patternColorwayId);
     if(match&&!ctrl.signal.aborted&&loaded.current.isCurrent(seq))setVersion(match);
    }catch{/* Keep the original product detail if current catalog cannot be read. */}
   }catch(e){
    if(!ctrl.signal.aborted&&loaded.current.isCurrent(seq))
     setError(e instanceof Error?e.message:'产品详情加载失败');
   }finally{if(!ctrl.signal.aborted&&loaded.current.isCurrent(seq))setLoadBusy(false);}
  })();
  return ()=>{ctrl.abort();loaded.current.cancel();};
 },[apiFetch,mode,productId]);
 useEffect(()=>{
  const ctrl=new AbortController(),ids=[
   ...draft.images.fabricDisplay,...draft.images.detail,...draft.images.aiEffect,
   ...(version?.patternImageAssetId?[version.patternImageAssetId]:[])
  ];
  setUrls(new Map());
  if(!ids.length)return ()=>ctrl.abort();
  resolveImageUrls(apiFetch,[...new Set(ids)],'thumbnail',ctrl.signal).then(m=>{
   if(!ctrl.signal.aborted)setUrls(m);
  }).catch(()=>{/* no preview URL means non-clickable placeholder */});
  return ()=>ctrl.abort();
 },[draft.images,version?.patternImageAssetId,apiFetch]);
 const setRole=(role:ImageRole)=>setActive(role);
 const toggle=(assetId:string,value:boolean)=>setSelected(prev=>({...prev,
  [active]:updateSelectedImages(prev[active],assetId,value)}));
 const deleteSelected=()=>{
  setDraft(current=>removeDraftAssets(current,active,selected[active]));
  setSelected(prev=>({...prev,[active]:[]}));
 };
 const move=(index:number,direction:-1|1)=>setDraft(state=>moveDraftAsset(state,active,index,direction));
 const requestUpload=(index:number|null)=>{
  uploadTarget.current={role:active,index};fileRef.current?.click();
 };
 const upload=async(file:File)=>{
  const target=uploadTarget.current;
  if(!onUploadImage||!target||imageBusy||saving)return;
  setError('');setImageBusy(true);
  try{
   const readyId=await onUploadImage(file,target.role);
   setDraft(state=>target.index===null?addDraftAsset(state,target.role,readyId):
    replaceDraftAsset(state,target.role,target.index!,readyId));
   setSelected(prev=>({...prev,[target.role]:[]}));
  }catch(e){setError(e instanceof Error?e.message:'图片上传失败，未加入草稿');}
  finally{uploadTarget.current=null;setImageBusy(false);if(fileRef.current)fileRef.current.value='';}
 };
 const save=async()=>{
  if(saving||imageBusy||loadBusy||!canManage||fatal||activeSave.current)return;
  setError('');activeSave.current=true;setSaving(true);
  try{
   const result=await saveProductDraft(apiFetch,mode,draft,productId);
   baseline.current=initialProductDraft(result);draftRef.current=baseline.current;
   onSaved(result);
  }catch(e){
   setError(e instanceof Error?e.message:'保存失败，请检查资料后重试。');
   // If network succeeded but response was malformed we cannot establish whether the
   // POST committed. The UI must not invite an automatic duplicate create.
   if(e instanceof Error&&/产品详情|JSON|Unexpected token/.test(e.message))
    setFatal(true);
  }finally{activeSave.current=false;setSaving(false);}
 };
 const autoNo=useMemo(()=>buildProductNumberPreview(version,fabric),[version,fabric]);
 return <section aria-label="V2 产品编辑" className="flex min-h-[610px] flex-col gap-3 bg-[#faf8ff] p-3 text-[#191b24] sm:p-5">
  <header className="flex flex-wrap items-center justify-between gap-2">
   <button type="button" onClick={close} className="inline-flex items-center gap-1 text-sm text-[#0053da]">
    <ArrowLeft size={16}/>返回产品库</button>
   <h1 className="text-base font-semibold">{mode==='create'?'新增产品':'编辑产品'}</h1>
   <div className="flex flex-wrap gap-2">
    {mode==='create'&&onBatchCreate&&canManage?<button type="button" disabled={saving||imageBusy} onClick={async()=>{
     if(dirty&&!await confirm({title:'切换到批量新增？',message:'当前单个产品的未保存内容将丢失。',confirmText:'切换',danger:true}))return;
     onBatchCreate();
    }} className={tag}>批量新增多配色</button>:null}
    <button type="button" onClick={close} className={tag} disabled={saving||imageBusy}><ActionIcon name="close"/>取消</button>
    {canManage?<button type="button" onClick={save} disabled={saving||imageBusy||loadBusy||fatal}
     className="rounded-lg bg-[#346ef6] px-4 py-2 text-xs text-white disabled:opacity-40"><ActionIcon name="save"/>
      {saving?'正在保存…':'保存产品'}</button>:null}
   </div>
  </header>
  {error?<p role="alert" className="rounded border border-rose-200 bg-white p-3 text-xs text-rose-700">{error}
   {fatal?'提交结果不明确，请先返回产品库核实是否已创建；不要重复点击保存。':''}</p>:null}
  {loadBusy?<p role="status" className="rounded bg-white p-5 text-sm text-slate-500">正在加载产品详情…</p>:
   <><ProductIdentityChoices version={version} fabric={fabric} canChange={canManage&&!saving&&!imageBusy} apiFetch={apiFetch}
    onSelectFabric={f=>{setFabric(f);setDraft(d=>({...d,fabricId:f.id}));}}
    onChooseVersion={()=>setChooser('pattern')} onChooseFabric={()=>setChooser('fabric')}
    onPatternLibrary={onPatternLibrary} onFabricLibrary={onFabricLibrary}
    patternUrl={version?.patternImageAssetId?urls.get(version.patternImageAssetId):undefined}/>
    <section className="flex flex-wrap items-end gap-4 rounded-lg border border-[#c3c6d7] bg-white p-3">
     <div className="min-w-[220px] flex-1">
      <label className="mb-1 block text-xs font-semibold">自动货号</label>
      <input aria-label="自动货号" readOnly value={autoNo??'组合编号暂不可用'}
       className="w-full rounded border border-[#e2e1ee] bg-[#f8fafc] px-3 py-2 text-sm font-semibold"/>
      {original&&autoNo!==original.productNo?
       <p className="mt-1 text-[11px] text-amber-700">身份变化：{original.productNo} → {autoNo}。已开单产品由服务器禁止更改。</p>:null}
     </div>
     <label className="min-w-[180px] flex-[2] text-xs font-semibold">备注
      <input aria-label="产品备注" maxLength={5000} value={draft.remark} disabled={!canManage}
       onChange={e=>setDraft(v=>({...v,remark:e.target.value}))}
       className="mt-1 block w-full rounded border border-[#c3c6d7] px-3 py-2 font-normal"/></label>
     
    </section>
    <ProductImageTabs images={draft.images} selected={selected[active]} activeRole={active} onRole={setRole}
     onSelect={toggle} onMove={move} onDeleteSelected={deleteSelected} urls={urls} canManage={canManage}
     onUploadClick={canManage&&onUploadImage?()=>requestUpload(null):undefined}
     onReplaceClick={canManage&&onUploadImage?index=>requestUpload(index):undefined}/>
    {onUploadImage?<input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
     aria-label="单张上传图片" className="hidden" onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);}}/>:null}
    {imageBusy?<p role="status" className="text-xs">图片上传处理中，完成后才可保存产品…</p>:null}
    {!onUploadImage?<p className="text-[11px] text-slate-500">新增上传需先完成V2图片鉴权桥接；已有关联图片可排序、选择解除关联并统一保存，不会删除共享的其他图片资源。</p>:null}
   </>}
  {chooser?<ProductChoiceDialog type={chooser} apiFetch={apiFetch} onClose={()=>setChooser(null)}
   onChooseVersion={v=>{setVersion(v);setDraft(d=>({...d,patternColorwayId:v.id}));setChooser(null);}}
   onChooseFabric={f=>{setFabric(f);setDraft(d=>({...d,fabricId:f.id}));setChooser(null);}}/>:null}
 </section>;
}
export {ProductIdentityChoices,ProductImageTabs};
export type {ProductIdentityChoicesProps} from './ProductIdentityChoices';
export type {ProductImageTabsProps} from './ProductEditorImageTabs';
export default ProductEditorV2;
