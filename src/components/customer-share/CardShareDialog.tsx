import React,{useEffect,useRef,useState} from 'react';
import {ActionIcon} from '../product-master-v2/ActionIcon';
import {DialogDismissButton} from '../ui/DialogDismissButton';
import {useV2LeaveProtection} from '../product-master-v2/useV2LeaveProtection';
import {parseCardShareLink} from './publicPatternClient';
import {copyPatternShareLink} from './copyPatternShareLink';

export function CardShareDialog({card,apiFetch,onClose}:{card:{id:string;cardNo:string};apiFetch:typeof fetch;onClose():void}){
 const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null),inFlight=useRef(true);
 const [busy,setBusy]=useState(true),[share,setShare]=useState<{url:string;path:string}|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0);
 useV2LeaveProtection(false,busy);
 useEffect(()=>{const node=dialog.current,before=typeof document==='undefined'?null:document.activeElement;node?.showModal();return()=>{node?.close();if(typeof HTMLElement!=='undefined'&&before instanceof HTMLElement&&before.isConnected)before.focus();};},[]);
 useEffect(()=>{
  const abort=new AbortController();inFlight.current=true;setBusy(true);setShare(null);setError('');setNotice('');
  void (async()=>{
   try{
    if(!/^[1-9]\d{0,19}$/.test(card.id)||BigInt(card.id)>18446744073709551615n)throw Error();
    const response=await apiFetch('/api/v2/sample-cards/'+card.id+'/share',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:abort.signal});
    if(!response.ok)throw Error();const value=parseCardShareLink((await response.json()).url,typeof window==='undefined'?undefined:window.location.origin);
    if(!abort.signal.aborted)setShare(value);
   }catch{if(!abort.signal.aborted)setError('色卡分享链接读取失败，请核对色卡状态后重试');}
   finally{if(!abort.signal.aborted){inFlight.current=false;setBusy(false);}}
  })();return()=>abort.abort();
 },[card.id,apiFetch,revision]);
 const close=()=>{if(!inFlight.current)onClose();};
 return <dialog ref={dialog} aria-label="分享色卡花型产品" onCancel={event=>{if(event.target!==event.currentTarget)return;event.preventDefault();close();}} className="m-auto w-[min(92vw,580px)] space-y-4 rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-xl backdrop:bg-black/35 sm:p-6">
  <header className="flex items-center justify-between gap-3 border-b border-[#edf0f2] pb-3"><div className="min-w-0"><p className="mb-0.5 text-[11px] tracking-wide text-slate-500">色卡 · 分享</p><h2 className="truncate text-[17px] font-semibold text-[#1e293b]">{card.cardNo}</h2></div><DialogDismissButton onClick={close} disabled={busy} label="关闭分享"/></header>
  {error?<><p role="alert">{error}</p><button type="button" className="rounded border px-3 py-2 text-sm" onClick={()=>setRevision(n=>n+1)}><ActionIcon name="refresh"/>重试</button></>:!share?<p role="status">正在读取稳定分享链接…</p>:<>
   <label className="block text-sm">分享链接<input ref={input} readOnly value={share.url} onFocus={event=>event.currentTarget.select()} className="mt-2 w-full rounded border p-2"/></label>
   <p className="text-xs leading-5 text-slate-500">链接包含当前色卡全部有效配色，新增产品自动更新；删除色卡后失效。</p>
   <div className="flex flex-wrap gap-3"><button type="button" className="inline-flex min-h-10 items-center rounded-lg bg-[#346ef6] px-4 py-2 text-sm font-medium text-white hover:bg-[#275ee0]" onClick={()=>{void copyPatternShareLink(share.url,globalThis.navigator?.clipboard,()=>{input.current?.focus();input.current?.select();}).then(result=>setNotice(result==='copied'?'链接已复制':'请复制已选中的链接'));}}><ActionIcon name="copy"/>复制链接</button><a className="inline-flex min-h-10 items-center rounded-lg border border-[#d7dce6] px-4 py-2 text-sm text-[#334155] hover:bg-[#f8fafc]" href={share.url} target="_blank" rel="noreferrer">查看色卡产品</a></div>
   {notice&&<p role="status" className="text-sm">{notice}</p>}
  </>}
 </dialog>;
}
