import {ActionIcon} from './ActionIcon';
import {useV2LeaveProtection} from './useV2LeaveProtection';
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,ChevronDown,ChevronUp,Image as ImageIcon,Plus,Search,X} from 'lucide-react';
import type {FabricCatalogItem} from './fabricModel';
import type {PatternVersionItem} from './patternModel';
import {
 IMAGE_ROLES,emptyProductDraft,initialProductDraft,parseProductDetails,
 buildProductNumberPreview,addDraftAsset,replaceDraftAsset,removeDraftAssets,moveDraftAsset,
 updateSelectedImages,loadProductForEdit,saveProductDraft,
 fetchColorwayChoices,fetchFabricChoices,
 type ImageRole,type EditorImages,type ProductEditorDetails,type ProductEditorDraft,
 type ProductPatternChoice
} from './productEditorModel';
import {resolveImageUrls,createLatestRequestGuard} from './catalogModel';
const tag='rounded-md border border-[#c3c6d7] bg-white px-3 py-2 text-xs text-[#191b24]';
const heading='text-sm font-semibold text-[#191b24]';
const roles:{key:ImageRole;name:string}[]=[
 {key:'fabricDisplay',name:'面料大图'},{key:'detail',name:'面料细节图'},{key:'aiEffect',name:'效果图'}
];
const emptySelected=():Record<ImageRole,string[]>=>({fabricDisplay:[],detail:[],aiEffect:[]});
const show=(x:string|null|number)=>x===null||x===''?'—':x;
export interface ProductIdentityChoicesProps{
 version:ProductPatternChoice|null;fabric:FabricCatalogItem|null;
 canChange:boolean;onChooseVersion():void;onChooseFabric():void;
 onPatternLibrary?():void;onFabricLibrary?():void;patternUrl?:string;
}
export function ProductIdentityChoices({
 version,fabric,canChange,onChooseVersion,onChooseFabric,onPatternLibrary,onFabricLibrary,patternUrl
}:ProductIdentityChoicesProps){
 return <div className="grid gap-3 md:grid-cols-2">
  <section className="rounded-lg border border-[#c3c6d7] bg-white p-3">
   <header className="flex items-center justify-between gap-2">
    <h2 className={heading}>花型编号与配色版本</h2>
    {onPatternLibrary?<button type="button" onClick={onPatternLibrary} className="text-xs text-[#0053da]"><ActionIcon name="next"/>去花型库维护</button>:null}
   </header>
   <button type="button" disabled={!canChange} onClick={onChooseVersion}
    aria-label="选择花型版本" className={tag+' mt-2 w-full text-left disabled:opacity-65'}>
    <span className="font-semibold">{version?.patternNo??'搜索选择完整花型编号'}</span>
    {canChange?<span className="float-right text-[#0053da]">选择 / 更换</span>:null}
   </button>
   <div className="mt-2 flex min-h-20 items-center gap-3 rounded bg-[#f8fafc] p-2 text-xs text-slate-600">
    {version&&patternUrl?<img src={patternUrl} alt={'当前配色花型 '+version.patternNo}
     className="h-14 w-14 rounded object-cover" loading="lazy"/>:
     <span className="flex h-14 w-14 items-center justify-center rounded border bg-white text-[10px] text-slate-400">
      {version?.patternImageAssetId?'图片暂不可用':'待上传'}</span>}
    <div className="space-y-1"><div>母版：{version?.patternNo.split('-')[0]??'—'} · 配色：{version?.colorwayNo??'—'}</div>
     <div>题材标签：{version?.topicTags.map(t=>t.name).join('、')||'—'}</div>
     <div>颜色标签：{version?.colorTags.map(t=>t.name).join('、')||'—'}</div>
     <div className="text-slate-500">选择的是具体花型版本，不单独编辑配色身份。</div>
    </div>
   </div>
  </section>
  <section className="rounded-lg border border-[#c3c6d7] bg-white p-3">
   <header className="flex items-center justify-between gap-2">
    <h2 className={heading}>面料品号</h2>
    {onFabricLibrary?<button type="button" onClick={onFabricLibrary} className="text-xs text-[#0053da]"><ActionIcon name="next"/>去面料库维护</button>:null}
   </header>
   <button type="button" disabled={!canChange} onClick={onChooseFabric} aria-label="选择面料"
    className={tag+' mt-2 w-full text-left disabled:opacity-65'}>
    <span className="font-semibold">{fabric?.fabricNo??'搜索选择面料'}</span>
    {canChange?<span className="float-right text-[#0053da]">选择 / 更换</span>:null}
   </button>
   <div className="mt-2 min-h-20 space-y-1 rounded bg-[#f8fafc] p-2 text-xs text-slate-600">
    <div>品名：<strong>{show(fabric?.fabricName??null)}</strong></div>
    <div>成分：{show(fabric?.composition??null)}</div>
    <div>克重：{fabric?.weightValue==null?'—':fabric.weightValue+' '+fabric.weightUnit} · 门幅：{fabric?.widthValue==null?'—':fabric.widthValue+' cm'}</div>
    <div className="text-slate-500">面料资料只读，请在面料库维护。</div>
   </div>
  </section>
 </div>;
}
export interface ProductImageTabsProps{
 images:EditorImages;selected:string[];activeRole:ImageRole;
 onRole(role:ImageRole):void;onSelect(id:string,checked:boolean):void;
 onDeleteSelected():void;onMove(index:number,direction:-1|1):void;
 urls:Map<string,string>;canManage:boolean;onUploadClick?():void;
 onReplaceClick?(index:number):void;
}
export function ProductImageTabs({images,selected,activeRole,onRole,onSelect,onDeleteSelected,
 onMove,urls,canManage,onUploadClick,onReplaceClick}:ProductImageTabsProps){
 return <section className="rounded-lg border border-[#c3c6d7] bg-white">
  <div role="tablist" aria-label="产品三类图片" className="flex flex-wrap items-center border-b border-[#e2e1ee]">
   {roles.map(r=><button key={r.key} type="button" role="tab"
    aria-selected={activeRole===r.key} onClick={()=>onRole(r.key)}
    className={'border-b-2 px-4 py-3 text-xs font-medium '+(activeRole===r.key?
     'border-[#346ef6] text-[#0053da]':'border-transparent text-slate-600')}>
    {r.name} <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">{images[r.key].length} / 10</span>
   </button>)}
  </div>
  <p className="px-4 pt-2 text-[11px] text-slate-500">切换类别保留已选图片与排序；保存时一次提交全部类别。每类首张为该类主图。</p>
  <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-2">
   {canManage?<button type="button" disabled={selected.length===0} onClick={onDeleteSelected}
    className={tag+' disabled:opacity-40'}><ActionIcon name="delete"/>删除选中（{selected.length}）</button>:null}
   {canManage&&onUploadClick&&images[activeRole].length<10?
    <button type="button" onClick={onUploadClick}
     className="rounded bg-[#346ef6] px-3 py-2 text-xs text-white"><ActionIcon name="upload"/>上传图片</button>:null}
  </div>
  <div role="tabpanel" aria-label={roles.find(x=>x.key===activeRole)?.name} className="flex min-h-40 flex-wrap gap-3 bg-[#f8fafc] p-4">
   {images[activeRole].length?images[activeRole].map((id,index)=><div key={id}
    className="w-28 space-y-1 rounded border border-[#e2e1ee] bg-white p-1">
    <div className="relative h-24 w-full">
     {urls.get(id)?<img src={urls.get(id)} alt={roles.find(x=>x.key===activeRole)?.name+' 第'+(index+1)+'张'}
      loading="lazy" className="h-24 w-full rounded object-contain"/>:
      <span className="flex h-24 items-center justify-center rounded bg-slate-100 text-[11px] text-slate-500">图片暂不可用</span>}
     {canManage?<input type="checkbox" aria-label={'选中第'+(index+1)+'张图片'}
      checked={selected.includes(id)} onChange={e=>onSelect(id,e.target.checked)}
      className="absolute left-1 top-1 h-4 w-4"/>:null}
    </div>
    {canManage&&onReplaceClick?<button type="button" onClick={()=>onReplaceClick(index)}
     aria-label={'替换第'+(index+1)+'张图片'}
     className="block w-full rounded border px-1 py-0.5 text-center text-[10px] text-[#0053da]">
     <ActionIcon name="refresh"/>替换第{index+1}张</button>:null}
    <div className="flex items-center justify-between gap-1 text-[10px]">
     <span>{index===0?'主图':'第 '+(index+1)+' 张'}</span>
     {canManage?<span className="flex gap-1">
      <button type="button" aria-label={'图片'+(index+1)+'前移'} disabled={index===0}
       onClick={()=>onMove(index,-1)} className="rounded border px-1 disabled:opacity-30"><ChevronUp size={12}/></button>
      <button type="button" aria-label={'图片'+(index+1)+'后移'}
       disabled={index===images[activeRole].length-1} onClick={()=>onMove(index,1)}
       className="rounded border px-1 disabled:opacity-30"><ChevronDown size={12}/></button>
     </span>:null}
    </div>
   </div>):<p className="text-xs text-slate-500">当前分类暂无图片</p>}
  </div>
 </section>;
}
type ChoiceState='pattern'|'fabric'|null;
interface ProductChoiceDialogProps{
 type:Exclude<ChoiceState,null>;apiFetch:typeof fetch;onClose():void;
 onChooseVersion(value:ProductPatternChoice):void;onChooseFabric(value:FabricCatalogItem):void;
}
function ProductChoiceDialog({type,apiFetch,onClose,onChooseVersion,onChooseFabric}:ProductChoiceDialogProps){
 const [query,setQuery]=useState(''),[error,setError]=useState('');
 const [loading,setLoading]=useState(true);
 const [patterns,setPatterns]=useState<ProductPatternChoice[]>([]);
 const [fabrics,setFabrics]=useState<FabricCatalogItem[]>([]);
 const [hasMore,setHasMore]=useState(false);
 const seq=useRef(createLatestRequestGuard()),ref=useRef<HTMLInputElement>(null);
 useEffect(()=>{ref.current?.focus();},[]);
 useEffect(()=>{
  const controller=new AbortController(),token=seq.current.next();
  setLoading(true);setError('');
  const timer=setTimeout(async()=>{
   try{
    if(type==='pattern'){
     const result=await fetchColorwayChoices(apiFetch,query,controller.signal);
     if(controller.signal.aborted||!seq.current.isCurrent(token))return;
     setPatterns(result.items);setHasMore(result.total>result.limit);
    }else{
     const result=await fetchFabricChoices(apiFetch,query,controller.signal);
     if(controller.signal.aborted||!seq.current.isCurrent(token))return;
     setFabrics(result.items.filter(x=>x.isActive));setHasMore(result.total>result.limit);
    }
   }catch{
    if(!controller.signal.aborted&&seq.current.isCurrent(token))setError('选项查询失败，请重试关键词。');
   }finally{if(!controller.signal.aborted&&seq.current.isCurrent(token))setLoading(false);}
  },200);
  return ()=>{clearTimeout(timer);controller.abort();seq.current.cancel();};
 },[query,apiFetch,type]);
 return <div role="presentation" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-3">
  <div role="dialog" aria-modal="true" aria-label={type==='pattern'?'查找花型版本':'查找面料'}
   className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white p-4">
   <div className="flex items-center justify-between">
    <strong className="text-sm">{type==='pattern'?'选择完整花型编号':'选择面料品号'}</strong>
    <button type="button" aria-label="关闭选择窗口" onClick={onClose}><X size={18}/></button>
   </div>
   <label className="relative mt-3 flex items-center">
    <Search size={16} className="absolute left-2 text-slate-500"/>
    <input ref={ref} aria-label={type==='pattern'?'搜索花型编号':'搜索面料'}
     value={query} onChange={e=>setQuery(e.target.value)} autoComplete="off"
     placeholder={type==='pattern'?'按母版号或完整花型编号搜索':'按品号、品名、成分搜索'}
     className="w-full rounded-lg border border-[#c3c6d7] px-8 py-2 text-sm"/>
   </label>
   {loading?<p role="status" className="mt-2 text-xs">正在搜索…</p>:null}
   {error?<p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>:null}
   <div className="mt-2 max-h-[55vh] overflow-auto divide-y">
    {type==='pattern'?patterns.map(v=><button type="button" key={v.id}
     className="block w-full px-2 py-3 text-left text-xs hover:bg-[#eef1fd]"
     onClick={()=>onChooseVersion(v)}>
      <strong>{v.patternNo}</strong>
      <span className="ml-3 text-slate-500">{v.colorTags.map(t=>t.name).join('、')||'未标记颜色'}</span>
     </button>):fabrics.map(f=><button type="button" key={f.id}
     className="block w-full px-2 py-3 text-left text-xs hover:bg-[#eef1fd]"
     onClick={()=>onChooseFabric(f)}>
      <strong>{f.fabricNo}</strong><span className="ml-3">{f.fabricName}</span>
      <span className="ml-2 text-slate-500">{f.composition??'—'}</span>
     </button>)}
    {!loading&&!error&&(type==='pattern'?patterns.length===0:fabrics.length===0)?
     <p className="py-6 text-center text-xs text-slate-500">没有匹配项，请换关键词。</p>:null}
   </div>
   {hasMore?<p className="mt-2 text-[11px] text-slate-500">匹配项较多，请输入更完整的编号或关键词精确定位。</p>:null}
  </div>
 </div>;
}
export interface ProductEditorV2Props{
 apiFetch:typeof fetch;mode:'create'|'edit';productId?:string;canManage?:boolean;
 onCancel():void;onSaved(product:ProductEditorDetails):void;
 onPatternLibrary?():void;onFabricLibrary?():void;
 /** Not enabled until an authenticated V2 image-upload bridge has been verified.
  * Must upload exactly one file, await ready status and return a ready UUID assetId.
  */
 onUploadImage?(file:File,role:ImageRole):Promise<string>;
}
export function ProductEditorV2({apiFetch,mode,productId,canManage=false,onCancel,onSaved,
 onPatternLibrary,onFabricLibrary,onUploadImage}:ProductEditorV2Props){
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
 const close=()=>{
  if(saving||imageBusy)return;
  if(dirty&&typeof window!=='undefined'&&!window.confirm('放弃未保存的产品修改吗？'))return;
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
   <div className="flex gap-2">
    <button type="button" onClick={close} className={tag} disabled={saving||imageBusy}><ActionIcon name="close"/>取消</button>
    {canManage?<button type="button" onClick={save} disabled={saving||imageBusy||loadBusy||fatal}
     className="rounded-lg bg-[#346ef6] px-4 py-2 text-xs text-white disabled:opacity-40"><ActionIcon name="save"/>
      {saving?'正在保存…':'保存产品'}</button>:null}
   </div>
  </header>
  {error?<p role="alert" className="rounded border border-rose-200 bg-white p-3 text-xs text-rose-700">{error}
   {fatal?'提交结果不明确，请先返回产品库核实是否已创建；不要重复点击保存。':''}</p>:null}
  {loadBusy?<p role="status" className="rounded bg-white p-5 text-sm text-slate-500">正在加载产品详情…</p>:
   <><ProductIdentityChoices version={version} fabric={fabric} canChange={canManage&&!saving&&!imageBusy}
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
     <label className="inline-flex items-center gap-2 pb-2 text-xs font-semibold">
      启用状态 <input aria-label="启用状态" type="checkbox" disabled={!canManage}
       checked={draft.isActive} onChange={e=>setDraft(v=>({...v,isActive:e.target.checked}))}/>
      {draft.isActive?'已启用':'已停用'}
     </label>
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
export default ProductEditorV2;
