import React,{useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Copy} from 'lucide-react';
import {DialogDismissButton} from '../ui/DialogDismissButton';
import type {PatternVersionItem} from './patternModel';

/** Keep the opened colorway's master as the gallery boundary; no neighboring master leakage. */
export function galleryVersions(selected:PatternVersionItem,versions:PatternVersionItem[]):PatternVersionItem[]{
 const sameMaster=versions.filter(v=>v.masterId===selected.masterId&&v.patternImageAssetId);
 if(!sameMaster.some(v=>v.id===selected.id))return selected.patternImageAssetId?[selected]:[];
 return [...sameMaster].sort((a,b)=>a.colorwayNo-b.colorwayNo||a.id.localeCompare(b.id));
}
export function PatternOriginalViewer({current,versions,original,error,onChange,onClose,onImageError,onRetry,thumbnail,inactive,onRelatedProducts,onRetryVersions}:{
 current:PatternVersionItem;versions:PatternVersionItem[];original:string|null;error:string;
 onChange(next:PatternVersionItem):void;onClose():void;onImageError():void;onRetry():void;
 thumbnail?:string;inactive?:boolean;onRelatedProducts?():void;onRetryVersions?():void;
}){
 const dialog=useRef<HTMLDialogElement>(null);
 const code=useRef<HTMLSpanElement>(null);
 const [loadedSource,setLoadedSource]=useState<string|null>(null);
 const [copyNotice,setCopyNotice]=useState<{id:string;text:string}|null>(null);
 const options=galleryVersions(current,versions),index=options.findIndex(item=>item.id===current.id);
 const position=index<0?0:index,multiple=options.length>1;
 const showThumbnail=!!thumbnail&&(!original||loadedSource!==original);
 const switchTo=(direction:-1|1)=>{
  if(!multiple)return;
  onChange(options[(position+direction+options.length)%options.length]);
 };
 useEffect(()=>{
  const previous=document.activeElement;
  const node=dialog.current;
  node?.showModal();
  return ()=>{node?.close();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus({preventScroll:true});};
 },[]);
 useEffect(()=>{
  if(inactive)return;
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
 },[current.id,options.map(v=>v.id).join(','),multiple,onChange,onClose,inactive]);
 const copyCode=async()=>{
  const id=current.id;
  try{
   await navigator.clipboard.writeText(current.patternNo);
   setCopyNotice({id,text:'配色号已复制'});
  }catch{
   if(code.current?.textContent===current.patternNo){
    const selection=window.getSelection(),range=document.createRange();
    range.selectNodeContents(code.current);
    selection?.removeAllRanges();
    selection?.addRange(range);
   }
   setCopyNotice({id,text:'复制失败，可手动复制配色号'});
  }
 };
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
  className={'m-auto max-h-[95dvh] w-[min(94vw,1024px)] max-w-none overflow-auto rounded-lg bg-white backdrop:bg-black/75'+(onRelatedProducts?' pattern-grid-viewer':'')}>
   <header className="flex items-center justify-between gap-3 border-b px-4 py-2 text-sm">
    <span className="min-w-0 [overflow-wrap:anywhere]"><span ref={code}>{current.patternNo}</span>{multiple?<span className="ml-2 text-xs text-slate-500">{position+1}/{options.length}</span>:null}</span>
    <DialogDismissButton onClick={onClose} label="关闭原图"/>
   </header>
   <div className="pattern-viewer-body flex min-h-[240px] items-center justify-between gap-2 p-2 sm:gap-3">
    {multiple?<button type="button" aria-label="上一配色原图" onClick={()=>switchTo(-1)}
     className="pattern-previous pattern-viewer-step grid size-10 shrink-0 place-items-center rounded-full border max-md:size-11"><ChevronLeft size={24}/></button>:null}
    <div className="pattern-viewer-image-area flex min-w-0 flex-1 flex-col items-center justify-center overflow-auto" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
     {showThumbnail||original?<div className="pattern-original-image-stack">
      {showThumbnail&&<img src={thumbnail} alt="" className="pattern-preview-thumbnail"/>}
      {original&&<img src={original} alt={'花型原图 '+current.patternNo}
       onLoad={()=>setLoadedSource(original)} onError={onImageError}
       className={'max-h-[75vh] max-w-full object-contain'+(showThumbnail?' pattern-original-pending':'')}/>}
     </div>:null}
     {error?<div className="text-center text-sm" onMouseDown={event=>event.stopPropagation()}>
      <p role="alert" className="text-rose-700">{error}</p>
      <button type="button" onClick={onRetry} className="min-h-11 rounded px-3 text-blue-700 focus-visible:outline-2">重试原图</button>
     </div>:!original&&!showThumbnail?<p role="status" className="text-sm text-slate-500">正在加载原图…</p>:null}
    </div>
    {multiple?<button type="button" aria-label="下一配色原图" onClick={()=>switchTo(1)}
     className="pattern-next pattern-viewer-step grid size-10 shrink-0 place-items-center rounded-full border max-md:size-11"><ChevronRight size={24}/></button>:null}
   </div>
   {onRelatedProducts&&<footer className="pattern-viewer-actions">
    {onRetryVersions&&<button type="button" className="pattern-text-action" onClick={onRetryVersions}>重试读取配色</button>}
    <button type="button" className="pattern-text-action" onClick={()=>void copyCode()}><Copy size={15} aria-hidden="true"/>复制配色号</button>
    <button type="button" className="pattern-action pattern-action-secondary" onClick={onRelatedProducts}>关联产品</button>
    {copyNotice?.id===current.id&&<p role="status" className="pattern-viewer-notice">{copyNotice.text}</p>}
   </footer>}
 </dialog>;
}
