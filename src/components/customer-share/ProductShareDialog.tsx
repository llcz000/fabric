import {ActionIcon} from '../product-master-v2/ActionIcon';
import React,{useEffect,useRef,useState} from 'react';
import {parsePatternShareLink} from './publicPatternClient';
import {copyPatternShareLink} from './copyPatternShareLink';
export function ProductShareDialog({product,apiFetch,onClose}:{product:{id:string;productNo:string};apiFetch:typeof fetch;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null);
 const [share,setShare]=useState<{url:string;path:string}|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{const before=document.activeElement;dialog.current?.showModal();return()=>{dialog.current?.close();if(before instanceof HTMLElement)before.focus();};},[]);
 useEffect(()=>{
  const abort=new AbortController();setShare(null);setError('');setNotice('');
  void apiFetch('/api/v2/products/'+product.id+'/share',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:abort.signal}).then(async response=>{
   if(!response.ok)throw Error();return parsePatternShareLink((await response.json()).url,true);
  }).then(value=>{if(!abort.signal.aborted)setShare(value);}).catch(()=>{if(!abort.signal.aborted)setError('产品分享链接读取失败，请重试');});
  return()=>abort.abort();
 },[product.id,apiFetch,revision]);
 return <dialog ref={dialog} aria-label="分享花型产品" className="m-auto w-[min(92vw,580px)] space-y-4 rounded-xl border p-6 shadow-xl backdrop:bg-black/30" onCancel={event=>{if(event.target!==event.currentTarget)return;event.preventDefault();onClose();}}>
  <header className="flex items-center justify-between gap-3"><h2 className="break-words text-lg font-semibold">分享花型产品 {product.productNo}</h2><button type="button" className="rounded border px-3 py-1 text-sm" onClick={onClose}><ActionIcon name="close"/>关闭</button></header>
  {error?<><p role="alert">{error}</p><button type="button" className="rounded border px-3 py-2 text-sm" onClick={()=>setRevision(n=>n+1)}><ActionIcon name="refresh"/>重试</button></>:!share?<p role="status">正在读取稳定分享链接…</p>:<>
   <label className="block text-sm">分享链接<input ref={input} readOnly className="mt-2 w-full rounded border p-2" value={share.url} onFocus={event=>event.currentTarget.select()}/></label>
   <p className="text-sm text-slate-500">客户免登录，仅查看当前产品的面料大图、细节图、效果图和面料成分、规格。产品或关联资料停用后暂不可用，重新启用后原链接恢复。</p>
   <div className="flex flex-wrap gap-3"><button type="button" className="rounded bg-blue-700 px-4 py-2 text-sm text-white" onClick={()=>{void copyPatternShareLink(share.url,navigator.clipboard,()=>{input.current?.focus();input.current?.select();}).then(result=>setNotice(result==='copied'?'链接已复制':'请复制已选中的链接'));}}><ActionIcon name="copy"/>复制链接</button><a className="rounded border px-4 py-2 text-sm" href={share.path} target="_blank" rel="noreferrer">查看花型产品</a></div>
   {notice&&<p role="status" className="text-sm">{notice}</p>}
  </>}
 </dialog>;
}
