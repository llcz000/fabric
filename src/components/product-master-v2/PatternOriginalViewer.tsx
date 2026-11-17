import React,{useEffect,useRef} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {DialogDismissButton} from '../ui/DialogDismissButton';
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
 const dialog=useRef<HTMLDialogElement>(null);
 const options=galleryVersions(current,versions),index=options.findIndex(item=>item.id===current.id);
 const position=index<0?0:index,multiple=options.length>1;
 const switchTo=(direction:-1|1)=>{
  if(!multiple)return;
  onChange(options[(position+direction+options.length)%options.length]);
 };
 useEffect(()=>{
  const previous=document.activeElement;
  const node=dialog.current;
  node?.showModal();
  return ()=>{node?.close();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};
 },[]);
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
 return <dialog ref={dialog} role="dialog" aria-modal="true" aria-label={'花型原图 '+current.patternNo}
  onCancel={event=>{event.preventDefault();onClose();}}
  onMouseDown={event=>{
   if(event.target!==event.currentTarget)return;
   const box=event.currentTarget.getBoundingClientRect();
   if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)onClose();
  }}
  onKeyDown={event=>{
   if(event.key!=='Tab')return;
   const controls=event.currentTarget.querySelectorAll('button');
   const first=controls[0],last=controls[controls.length-1];
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }}
  className="m-auto max-h-[95dvh] w-[min(94vw,1024px)] max-w-none overflow-auto rounded-lg bg-white backdrop:bg-black/75">
   <div className="flex items-center justify-between gap-3 border-b px-4 py-2 text-sm">
    <span>{current.patternNo}{multiple?<span className="ml-2 text-xs text-slate-500">{position+1}/{options.length}</span>:null}</span>
    <DialogDismissButton onClick={onClose} label="关闭原图"/>
   </div>
   <div className="flex min-h-[240px] items-center justify-between gap-2 p-2 sm:gap-3">
    {multiple?<button type="button" aria-label="上一配色原图" onClick={()=>switchTo(-1)}
     className="grid size-10 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-[#0053da] hover:bg-[#eef1fd] max-md:size-11"><ChevronLeft size={24}/></button>:null}
    <div className="flex min-w-0 flex-1 items-center justify-center overflow-auto" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
     {error?<p role="alert" className="text-sm text-rose-700">{error}</p>:
      original?<img src={original} alt={'花型原图 '+current.patternNo}
       className="max-h-[75vh] max-w-full object-contain"/>:
       <p role="status" className="text-sm text-slate-500">正在加载原图…</p>}
    </div>
    {multiple?<button type="button" aria-label="下一配色原图" onClick={()=>switchTo(1)}
     className="grid size-10 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-[#0053da] hover:bg-[#eef1fd] max-md:size-11"><ChevronRight size={24}/></button>:null}
   </div>
 </dialog>;
}
