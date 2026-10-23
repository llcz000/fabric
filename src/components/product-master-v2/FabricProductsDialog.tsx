import {ActionIcon} from './ActionIcon';
import React,{useEffect,useRef,useState} from 'react';
import type {FabricCatalogItem} from './fabricModel';
import {parseCatalogPage,type CatalogPage} from './catalogModel';
export function FabricProductsDialog({apiFetch,fabric,onClose}:{apiFetch:typeof fetch;fabric:FabricCatalogItem;onClose():void}){
 const ref=useRef<HTMLDialogElement>(null),[offset,setOffset]=useState(0),[data,setData]=useState<CatalogPage|null>(null),[error,setError]=useState('');
 useEffect(()=>{ref.current?.showModal();return()=>ref.current?.close();},[]);
 useEffect(()=>{const controller=new AbortController();setData(null);setError('');
  void apiFetch('/api/v2/products?'+new URLSearchParams({fabricId:fabric.id,status:'all',limit:'20',offset:String(offset)}),{signal:controller.signal}).then(async response=>{
   if(!response.ok)throw Error('关联产品读取失败');const page=parseCatalogPage(await response.json());
   if(page.limit!==20||page.offset!==offset||page.items.some(item=>item.fabricId!==fabric.id))throw Error('关联产品资料无效');
   if(!controller.signal.aborted)setData(page);
  }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'读取失败');});
  return()=>controller.abort();
 },[apiFetch,fabric.id,offset]);
 return <dialog ref={ref} aria-label={'面料关联产品 '+fabric.fabricNo} onCancel={event=>{event.preventDefault();onClose();}} className="m-auto w-[min(92vw,720px)] rounded-xl border p-5 shadow-xl backdrop:bg-black/30">
  <header className="mb-4 flex items-center justify-between"><h2 className="font-semibold">{fabric.fabricNo} · {fabric.fabricName} · 关联产品</h2><button type="button" onClick={onClose} aria-label="关闭关联产品"><ActionIcon name="close"/>关闭</button></header>
  {error?<p role="alert">{error}</p>:!data?<p role="status">正在读取…</p>:<>
   <div className="max-h-[60vh] overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{['货号','花型编号'].map(label=><th key={label} className="border-b p-2">{label}</th>)}</tr></thead><tbody>{data.items.map(item=><tr key={item.id}><td className="border-b p-2">{item.productNo}</td><td className="border-b p-2">{item.masterNo}-{item.colorwayNo}</td></tr>)}</tbody></table>{!data.items.length&&<p className="p-4">暂无关联产品</p>}</div>
   <footer className="mt-4 flex items-center justify-between text-sm"><span>共 {data.total} 条 · 第 {Math.floor(offset/20)+1} 页</span><div className="space-x-3"><button disabled={!offset} onClick={()=>setOffset(n=>Math.max(0,n-20))}><ActionIcon name="back"/>上一页</button><button disabled={offset+20>=data.total} onClick={()=>setOffset(n=>n+20)}><ActionIcon name="next"/>下一页</button></div></footer>
  </>}
 </dialog>;
}
