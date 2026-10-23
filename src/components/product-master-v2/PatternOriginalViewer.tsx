import React,{useEffect} from 'react';
import {ChevronLeft,ChevronRight,X} from 'lucide-react';
import type {PatternVersionItem} from './patternModel';

/** Keep the opened colorway's master as the gallery boundary; no neighboring master leakage. */
export function galleryVersions(selected:PatternVersionItem,versions:PatternVersionItem[]):PatternVersionItem[]{
 const sameMaster=versions.filter(v=>v.masterId===selected.masterId&&v.patternImageAssetId);
 if(!sameMaster.some(v=>v.id===selected.id))return selected.patternImageAssetId?[selected]:[];
 return [...sameMaster].sort((a,b)=>a.colorwayNo-b.colorwayNo||a.id.localeCompare(b.id));
}
export function PatternOriginalViewer({current,versions,original,error,onChange,onClose}:{
 current:PatternVersionItem;versions:PatternVersionItem[];original:string|null;error:string;
 onChange(next:PatternVersionItem):void;onClose():void;
}){
 const options=galleryVersions(current,versions),index=options.findIndex(item=>item.id===current.id);
 const position=index<0?0:index,multiple=options.length>1;
 const switchTo=(direction:-1|1)=>{
  if(!multiple)return;
  onChange(options[(position+direction+options.length)%options.length]);
 };
 useEffect(()=>{
  const onKey=(event:KeyboardEvent)=>{
   if(!['Escape','ArrowLeft','ArrowRight'].includes(event.key))return;
   if(event.key!=='Escape'&&!multiple)return;
   event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
   if(event.key==='Escape')onClose();
   else if(event.key==='ArrowLeft')switchTo(-1);
   else switchTo(1);
  };
  // Capture before the underlying pattern-editor modal's Escape listener.
  document.addEventListener('keydown',onKey,true);
  return ()=>document.removeEventListener('keydown',onKey,true);
 },[current.id,options.map(v=>v.id).join(','),multiple,onChange,onClose]);
 return <div role="presentation" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-3"
  onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <div role="dialog" aria-modal="true" aria-label={'花型原图 '+current.patternNo}
   className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white">
   <div className="flex items-center justify-between gap-3 border-b px-4 py-2 text-sm">
    <span>{current.patternNo}{multiple?<span className="ml-2 text-xs text-slate-500">{position+1}/{options.length}</span>:null}</span>
    <button type="button" onClick={onClose} aria-label="关闭原图" className="rounded p-1 hover:bg-slate-100"><X size={18}/></button>
   </div>
   <div className="flex min-h-[240px] items-center justify-between gap-2 p-2 sm:gap-3">
    {multiple?<button type="button" aria-label="上一配色原图" onClick={()=>switchTo(-1)}
     className="shrink-0 rounded-full border border-slate-200 bg-white p-2 text-[#0053da] hover:bg-[#eef1fd]"><ChevronLeft size={24}/></button>:null}
    <div className="flex min-w-0 flex-1 items-center justify-center overflow-auto" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
     {error?<p role="alert" className="text-sm text-rose-700">{error}</p>:
      original?<img src={original} alt={'花型原图 '+current.patternNo}
       className="max-h-[75vh] max-w-full object-contain"/>:
       <p role="status" className="text-sm text-slate-500">正在加载原图…</p>}
    </div>
    {multiple?<button type="button" aria-label="下一配色原图" onClick={()=>switchTo(1)}
     className="shrink-0 rounded-full border border-slate-200 bg-white p-2 text-[#0053da] hover:bg-[#eef1fd]"><ChevronRight size={24}/></button>:null}
   </div>
  </div>
 </div>;
}
