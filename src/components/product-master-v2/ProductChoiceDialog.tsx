import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Search, X } from 'lucide-react';
import type { FabricCatalogItem } from './fabricModel';
import { fetchColorwayChoices, fetchFabricChoices, type ProductPatternChoice } from './productEditorModel';
import { createLatestRequestGuard, resolveImageUrls } from './catalogModel';

type ChoiceState='pattern'|'fabric'|null;

interface ProductChoiceDialogProps{
 type:Exclude<ChoiceState,null>;apiFetch:typeof fetch;onClose():void;
 onChooseVersion(value:ProductPatternChoice):void;onChooseFabric(value:FabricCatalogItem):void;
 multiSelectVersionIds?:string[];
 selectionError?:string;
}

export function ProductPatternChoiceRow({item,selected,showCheckbox=false,url,failed=false,onImageError,onChoose}:{
 item:ProductPatternChoice;selected:boolean;showCheckbox?:boolean;url?:string;failed?:boolean;
 onImageError?():void;onChoose():void;
}){
 return <button type="button" onClick={onChoose} aria-label={'选择花型配色 '+item.patternNo}
  aria-pressed={showCheckbox?selected:undefined}
  className={'flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-[#eef1fd] '+(selected?'bg-[#eef1fd]':'')}>
  {showCheckbox?<span aria-hidden="true" className={'flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[11px] '+(selected?
   'border-[#346ef6] bg-[#346ef6] text-white':'border-slate-400 bg-white')}>{selected?'✓':''}</span>:null}
  {url&&!failed?<img src={url} alt={'花型配色 '+item.patternNo+' 缩略图'} loading="lazy" width={60} height={60}
   className="h-[60px] w-[60px] shrink-0 rounded-md border border-slate-200 bg-slate-50 object-cover"
   onError={onImageError}/>:
   <span className="flex h-[60px] w-[60px] shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-slate-200 bg-slate-50 text-[10px] text-slate-500"
    aria-label={item.patternImageAssetId?'花型图片暂不可用':'花型图片未上传'}>
    <ImageIcon size={16} aria-hidden="true"/>{item.patternImageAssetId?'图片不可用':'待上传'}
   </span>}
  <span className="min-w-0 flex-1">
   <strong className="block break-all text-sm font-semibold text-[#243247]">{item.patternNo}</strong>
   {item.colorTags.length?<span className="mt-1 block break-words text-[11px] text-slate-500">{item.colorTags.map(t=>t.name).join(' · ')}</span>:null}
  </span>
 </button>;
}
/** Shared visual content for both the single-product combobox and batch-choice dialog. */
export function ProductFabricChoiceContent({item}:{item:FabricCatalogItem}){
 return <>
  <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
   <strong className="break-all text-sm font-semibold text-[#174c9b]">{item.fabricNo}</strong>
   <span className="break-words text-sm font-medium text-[#191b24]">{item.fabricName}</span>
  </span>
  <span className="mt-1.5 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs">
   <span className="min-w-0 text-slate-500">成分 <span className="break-words text-[#434655]">{item.composition?.trim()||'未填写'}</span></span>
   <span className="whitespace-nowrap text-slate-500">克重 <strong className="font-medium text-[#273449]">{item.weightValue===null?'未填写':item.weightValue+' '+(item.weightUnit??'')}</strong></span>
   <span className="whitespace-nowrap text-slate-500">门幅 <strong className="font-medium text-[#273449]">{item.widthValue===null?'未填写':item.widthValue+' cm'}</strong></span>
  </span>
 </>;
}
export function ProductFabricChoiceRow({item,onChoose}:{item:FabricCatalogItem;onChoose():void}){
 return <button type="button" onClick={onChoose} aria-label={'选择面料 '+item.fabricNo}
  className="block w-full min-w-0 rounded-lg px-3 py-3 text-left hover:bg-[#eef1fd]">
  <ProductFabricChoiceContent item={item}/>
 </button>;
}
export function ProductChoiceDialog({type,apiFetch,onClose,onChooseVersion,onChooseFabric,multiSelectVersionIds,selectionError}:ProductChoiceDialogProps){
 const [query,setQuery]=useState(''),[error,setError]=useState('');
 const [loading,setLoading]=useState(true);
 const [patterns,setPatterns]=useState<ProductPatternChoice[]>([]);
 const [fabrics,setFabrics]=useState<FabricCatalogItem[]>([]);
 const [hasMore,setHasMore]=useState(false);
 const [thumbs,setThumbs]=useState<Map<string,string>>(new Map());
 const [failedImages,setFailedImages]=useState<Set<string>>(new Set());
 const seq=useRef(createLatestRequestGuard()),ref=useRef<HTMLInputElement>(null);
 useEffect(()=>{
  const previous=typeof document==='undefined'?null:document.activeElement;
  ref.current?.focus();
  return ()=>{if(typeof HTMLElement!=='undefined'&&previous instanceof HTMLElement&&previous.isConnected)previous.focus();};
 },[]);
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
 useEffect(()=>{
  if(type!=='pattern'){setThumbs(new Map());return;}
  const ids=[...new Set(patterns.map(v=>v.patternImageAssetId).filter((id):id is string=>!!id))];
  setThumbs(new Map());setFailedImages(new Set());
  if(!ids.length)return;
  const controller=new AbortController();let active=true;
  void resolveImageUrls(apiFetch,ids,'thumbnail',controller.signal)
   .then(urls=>{if(active&&!controller.signal.aborted)setThumbs(urls);})
   .catch(()=>{/* Unavailable images keep the placeholder; selection still works. */});
  return ()=>{active=false;controller.abort();};
 },[type,patterns,apiFetch]);
 return <div role="presentation" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-3">
  <div role="dialog" aria-modal="true" aria-label={type==='pattern'?'查找花型版本':'查找面料'}
   onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}}}
   className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white p-4">
   <div className="flex items-center justify-between">
    <strong className="text-sm">{type==='pattern'&&multiSelectVersionIds?'多选花型配色（已选 '+multiSelectVersionIds.length+'）':type==='pattern'?'选择完整花型编号':'选择面料品号'}</strong>
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
   {selectionError?<p role="alert" className="mt-2 text-xs text-rose-700">{selectionError}</p>:null}
   <div className="mt-2 max-h-[55vh] overflow-auto divide-y">
    {type==='pattern'?patterns.map(v=><ProductPatternChoiceRow key={v.id} item={v}
     selected={multiSelectVersionIds?.includes(v.id)??false} showCheckbox={multiSelectVersionIds!==undefined}
     url={v.patternImageAssetId?thumbs.get(v.patternImageAssetId):undefined}
     failed={failedImages.has(v.id)}
     onImageError={()=>setFailedImages(old=>new Set(old).add(v.id))}
     onChoose={()=>onChooseVersion(v)}/>):
     fabrics.map(f=><ProductFabricChoiceRow key={f.id} item={f} onChoose={()=>onChooseFabric(f)}/>)}
    {!loading&&!error&&(type==='pattern'?patterns.length===0:fabrics.length===0)?
     <p className="py-6 text-center text-xs text-slate-500">没有匹配项，请换关键词。</p>:null}
   </div>
   {hasMore?<p className="mt-2 text-[11px] text-slate-500">匹配项较多，请输入更完整的编号或关键词精确定位。</p>:null}
   {type==='pattern'&&multiSelectVersionIds?<div className="mt-3 flex justify-end"><button type="button" onClick={onClose} className="rounded bg-[#346ef6] px-4 py-2 text-sm text-white">完成选择</button></div>:null}
  </div>
 </div>;
}

