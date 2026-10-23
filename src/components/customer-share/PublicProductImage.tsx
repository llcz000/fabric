import React,{useEffect,useRef,useState} from 'react';
export function PublicProductImage({src,description,priority=false}:{src:string;description:string;priority?:boolean}){
 const [open,setOpen]=useState(false),[failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0),dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{setOpen(false);setFailed(false);setAttempt(0);},[src]);
 useEffect(()=>{if(!open)return;const before=document.activeElement;dialog.current?.showModal();dialog.current?.querySelector('button')?.focus();return()=>{dialog.current?.close();if(before instanceof HTMLElement)before.focus();};},[open]);
 return <>
  {failed?<div role="status" className="flex min-h-32 flex-col items-center justify-center gap-3 p-5 text-center"><p className="text-sm text-slate-600">图片加载失败，请检查网络后重试。</p><button type="button" className="min-h-11 rounded-lg border border-[#b9c9bb] bg-white px-5 text-sm text-[#294d36] focus-visible:outline-2 focus-visible:outline-[#417253]" aria-label={'重新加载图片 '+description} onClick={()=>{setAttempt(n=>n+1);setFailed(false);}}>重新加载图片</button></div>:<button type="button" className="block w-full min-h-11 cursor-zoom-in bg-[#f6f6f2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#417253]" aria-label={'查看大图 '+description} onClick={()=>setOpen(true)}>
   <img key={attempt} src={src} alt={description} loading={priority?'eager':'lazy'} fetchPriority={priority?'high':'auto'} decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(true)} className="mx-auto max-h-[520px] w-full object-contain"/>
  </button>}
  <dialog ref={dialog} aria-label={description+'大图'} className="m-auto w-[calc(100vw-16px)] max-w-[1100px] max-h-[calc(100dvh-16px)] overflow-auto rounded-xl border-0 bg-transparent p-0 shadow-none backdrop:bg-black/90" onCancel={event=>{event.preventDefault();setOpen(false);}} onClick={event=>{if(event.target===event.currentTarget)setOpen(false);}}>
   {open&&<button type="button" aria-label={'点击图片返回 '+description} className="flex min-h-11 w-full cursor-zoom-out items-center justify-center border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" onClick={()=>setOpen(false)}>
    <img src={src} alt={description+'大图'} referrerPolicy="no-referrer" className="pointer-events-none mx-auto max-h-[calc(100dvh-16px)] max-w-full object-contain"/>
   </button>}
  </dialog>
 </>;
}
