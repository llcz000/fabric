import {ActionIcon} from './ActionIcon';
import React,{useEffect,useRef,useState} from 'react';
import type {SelectionCard,SelectionCardPage,ManualFilters} from './manualSelectionModel';
import {selectionAccessRevoked} from './sampleSelectionClient';

export interface ManualSelectionPaneProps{
 sessionId:string;
 search:(filters:ManualFilters,signal?:AbortSignal)=>Promise<SelectionCardPage>;
 add:(card:SelectionCard,productIds?:string[])=>Promise<void>;
 resolveThumbnails?:(ids:string[],signal?:AbortSignal)=>Promise<Map<string,string>>;
 disabled:boolean;actionError?:string;actionNotice?:string;customerReference?:string;onAccessLost:(error:unknown)=>void;onClose:()=>void;
}
function CardRow({card,disabled,add,resolveThumbnails,onAccessLost}:{card:SelectionCard;disabled:boolean;add:ManualSelectionPaneProps['add'];resolveThumbnails?:ManualSelectionPaneProps['resolveThumbnails'];onAccessLost:ManualSelectionPaneProps['onAccessLost']}){
 const [expanded,setExpanded]=useState(false);
 const [selected,setSelected]=useState(()=>new Set(card.products.map(p=>p.id)));
 const all=selected.size===card.products.length,partial=selected.size>0&&!all;
 const selectAll=useRef<HTMLInputElement>(null);
 const [thumbs,setThumbs]=useState<Map<string,string>>(new Map()),[failed,setFailed]=useState<Set<string>>(new Set());
 const accessLost=useRef(onAccessLost);accessLost.current=onAccessLost;
 useEffect(()=>{if(selectAll.current)selectAll.current.indeterminate=partial;},[partial]);
 useEffect(()=>{
  if(!expanded||!resolveThumbnails)return;
  const controller=new AbortController();setThumbs(new Map());setFailed(new Set());
  const ids=[...new Set(card.products.map(p=>p.patternImageAssetId).filter((id):id is string=>!!id))];
  void (async()=>{
   const urls=new Map<string,string>();
   for(let i=0;i<ids.length;i+=100){for(const [id,url] of await resolveThumbnails(ids.slice(i,i+100),controller.signal))urls.set(id,url);}
   if(!controller.signal.aborted)setThumbs(urls);
  })().catch(error=>{if(!controller.signal.aborted&&selectionAccessRevoked(error))accessLost.current(error);});
  return ()=>controller.abort();
 },[expanded,card,resolveThumbnails]);
 return <>
  <tr className="border-t border-[#ededf9] hover:bg-[#f8f9ff]">
   <td className="px-3 py-2"><div className="flex items-center gap-2">
    <input ref={selectAll} type="checkbox" aria-label={`全选色卡 ${card.cardNo} 的配色`} aria-checked={partial?'mixed':all} checked={all} disabled={disabled}
     onChange={e=>setSelected(new Set(e.target.checked?card.products.map(p=>p.id):[]))}/>
    <button type="button" aria-expanded={expanded} aria-controls={'card-colors-'+card.id} disabled={disabled} onClick={()=>setExpanded(x=>!x)} className="text-left font-medium text-[#0053da]">
     <span aria-hidden="true">{expanded?'▾':'▸'} </span>{card.cardNo}
    </button></div></td>
   <td className="px-3 py-3">{card.fabricName}</td><td className="px-3 py-3">{card.composition??'—'}</td>
   <td className="px-3 py-3">{card.weightValue===null?'—':`${card.weightValue} ${card.weightUnit??''}`}</td><td className="px-3 py-3">{card.widthCm??'—'}</td>
   <td className="px-3 py-2">{selected.size} / {card.products.length}</td>
   <td className="px-3 py-2"><button type="button" disabled={disabled||selected.size===0} aria-label={`加入色卡 ${card.cardNo}`} onClick={()=>void add(card,card.products.filter(p=>selected.has(p.id)).map(p=>p.id))} className="rounded bg-[#0053da] px-3 py-1.5 text-white disabled:opacity-40"><ActionIcon name="add"/>加入</button></td>
  </tr>
  {expanded&&<tr id={'card-colors-'+card.id}><td colSpan={7} className="border-t bg-[#f8f9ff] px-4 py-2">
   <fieldset disabled={disabled}><legend className="sr-only">{card.cardNo} 的花型配色</legend>
    <div className="flex flex-wrap gap-2">{card.products.map(product=>{const image=product.patternImageAssetId&&!failed.has(product.id)?thumbs.get(product.patternImageAssetId):undefined;return <label key={product.id} title={product.patternNo} className={`relative flex w-24 cursor-pointer flex-col items-center gap-1 rounded border bg-white p-2 ${selected.has(product.id)?'border-[#0053da]':'border-[#c3c6d7]'}`}>
     <input type="checkbox" className="absolute left-1 top-1" aria-label={`配色 ${product.productNo}`} checked={selected.has(product.id)} onChange={e=>setSelected(before=>{
      const next=new Set(before);if(e.target.checked)next.add(product.id);else next.delete(product.id);return next;
     })}/>{image?<img src={image} alt={`花型 ${product.patternNo} 缩略图`} loading="lazy" width={64} height={64} className="h-16 w-16 rounded object-contain" onError={()=>setFailed(before=>new Set(before).add(product.id))}/>:<span className="flex h-16 w-16 items-center justify-center rounded bg-slate-100 text-xs text-slate-500">{product.patternImageAssetId?'图片暂不可用':'暂无图片'}</span>}
     <span className="max-w-full truncate text-xs font-medium">{product.patternNo}</span>
    </label>;})}</div>
   </fieldset>
   {selected.size===0&&<p className="mt-1 text-xs text-slate-600">请至少勾选一个配色</p>}
  </td></tr>}
 </>;
}
/** Modal card search keeps the selected list stable behind the dialog. Each new result defaults to all colorways. */
export function ManualSelectionPane({sessionId,search,add,resolveThumbnails,disabled,onAccessLost,onClose,actionError='',actionNotice='',customerReference=''}:ManualSelectionPaneProps){
 const [query,setQuery]=useState('');const [filters,setFilters]=useState<ManualFilters>({sessionId,query:'',offset:0});
 const [revision,setRevision]=useState(0),[page,setPage]=useState<SelectionCardPage|null>(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState('');
 const dialog=useRef<HTMLDialogElement>(null);
 const firstInput=useRef<HTMLInputElement>(null),accessLost=useRef(onAccessLost);accessLost.current=onAccessLost;
 useEffect(()=>{const previous=document.activeElement,element=dialog.current;element?.showModal();firstInput.current?.focus();return()=>{if(element?.open)element.close();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};},[]);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError('');setPage(null);
  void search(filters,controller.signal).then(result=>{if(!controller.signal.aborted)setPage(result);}).catch(error=>{
   if(controller.signal.aborted)return;
   if(selectionAccessRevoked(error)){accessLost.current(error);return;}
   setError('色卡检索失败，请重试；筛选条件已保留');
  }).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[search,filters,revision]);
 const apply=(text:string)=>{setPage(null);setFilters({sessionId,query:text.trim(),offset:0});setRevision(x=>x+1);};
 const locked=disabled||loading;
 return <dialog ref={dialog} aria-label="人工补选" aria-modal="true" className="m-auto max-h-[90vh] w-[min(96vw,1100px)] overflow-auto rounded-xl border p-0 shadow-xl backdrop:bg-black/30" onCancel={event=>{if(event.target!==event.currentTarget)return;event.preventDefault();if(!disabled)onClose();}}><section aria-label="人工补选色卡" aria-busy={loading||disabled} className="rounded-lg border border-[#c3c6d7] bg-[#f8f9ff] p-4">
  <header className="mb-3 flex items-start justify-between gap-3"><div><h3 className="font-semibold">人工补选 · 搜索色卡</h3>
   <p className="mt-1 text-xs text-slate-600">点击色卡编号查看花型，默认全选；可取消部分勾选后加入，重复加入不会新增一行。</p></div>
   <button type="button" disabled={disabled} onClick={onClose} className="shrink-0 rounded border px-3 py-1 text-sm disabled:opacity-40"><ActionIcon name="close"/>关闭补选</button></header>
  {customerReference&&<p className="mb-2 text-sm text-slate-600">客户：{customerReference}</p>}
  {actionError&&<p role="alert" className="mb-2 text-sm text-rose-700">{actionError}</p>}{actionNotice&&<p role="status" className="mb-2 text-sm text-emerald-800">{actionNotice}</p>}
  <form onSubmit={e=>{e.preventDefault();if(!locked)apply(query);}} className="mb-3 flex flex-wrap items-end gap-3">
   <label className="min-w-[180px] flex-1 text-sm">色卡搜索<input ref={firstInput} value={query} maxLength={100} disabled={disabled} onChange={e=>setQuery(e.target.value)} placeholder="色卡编号、花型编号、面料品号或品名"
    className="mt-1 block w-full rounded border border-[#c3c6d7] bg-white px-3 py-2 focus:outline-[#346ef6]"/></label>
   <button type="submit" disabled={locked} className="rounded bg-[#0053da] px-4 py-2 text-sm text-white disabled:opacity-40"><ActionIcon name="search"/>搜索色卡</button>
   <button type="button" disabled={locked} onClick={()=>{setQuery('');apply('');}} className="rounded border px-3 py-2 text-sm disabled:opacity-40"><ActionIcon name="reset"/>清除筛选</button>
  </form>
  {loading&&<p role="status" className="py-4 text-sm">正在检索色卡…</p>}
  {error&&<div role="alert" className="py-3 text-sm text-red-700">{error} <button type="button" disabled={locked} onClick={()=>setRevision(x=>x+1)} className="underline"><ActionIcon name="refresh"/>重试检索</button></div>}
  {!loading&&page&&!page.items.length&&<p className="py-6 text-center text-sm text-slate-600">{filters.query?'没有匹配的可选色卡，请调整或清除筛选':'暂无可选色卡，请先在色卡库建卡并确认存在可供样配色'}</p>}
  {!loading&&!!page?.items.length&&<div className="overflow-x-auto rounded border border-[#c3c6d7] bg-white"><table className="w-full min-w-[780px] text-left text-sm">
   <thead className="bg-[#f3f4fa] text-[#434655]"><tr>{['色卡编号','品名','成分','克重','门幅 / cm','可选配色','操作'].map(x=><th key={x} className="px-3 py-2 font-medium">{x}</th>)}</tr></thead>
   <tbody>{page.items.map(card=><CardRow key={card.id} card={card} disabled={locked} add={add} resolveThumbnails={resolveThumbnails} onAccessLost={onAccessLost}/>)}</tbody>
  </table></div>}
  {page&&!loading&&<footer className="mt-3 flex items-center justify-between gap-3 text-sm"><span>共 {page.total} 张色卡 · 第 {Math.floor(page.offset/20)+1} 页</span><div className="flex gap-2">
   <button type="button" disabled={locked||page.offset===0} onClick={()=>{setPage(null);setFilters({...filters,offset:Math.max(0,page.offset-20)});}} className="rounded border px-3 py-1.5 disabled:opacity-40"><ActionIcon name="back"/>上一页色卡</button>
   <button type="button" disabled={locked||page.offset+page.limit>=page.total} onClick={()=>{setPage(null);setFilters({...filters,offset:page.offset+20});}} className="rounded border px-3 py-1.5 disabled:opacity-40"><ActionIcon name="next"/>下一页色卡</button>
  </div></footer>}
 </section></dialog>;
}
