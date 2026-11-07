import {SamplePatternThumbnail} from './SamplePatternThumbnail';
import {ActionIcon} from './ActionIcon';
import React,{useEffect,useRef,useState} from 'react';
import type {SelectionCard,SelectionCardPage,ManualFilters} from './manualSelectionModel';
import {selectionAccessRevoked} from './sampleSelectionClient';

export interface ManualSelectionPaneProps{
 sessionId:string;
 search:(filters:ManualFilters,signal?:AbortSignal)=>Promise<SelectionCardPage>;
 add:(card:SelectionCard,productIds?:string[])=>Promise<boolean|void>;
 resolveThumbnails?:(ids:string[],signal?:AbortSignal)=>Promise<Map<string,string>>;
 selectedProductIds?:readonly string[];
 disabled:boolean;actionError?:string;actionNotice?:string;customerReference?:string;onAccessLost:(error:unknown)=>void;onClose:()=>void;
}
function CardRow({card,disabled,add,resolveThumbnails,onAccessLost,selectedProductIds=[]}:{card:SelectionCard;disabled:boolean;add:ManualSelectionPaneProps['add'];resolveThumbnails?:ManualSelectionPaneProps['resolveThumbnails'];onAccessLost:ManualSelectionPaneProps['onAccessLost'];selectedProductIds?:readonly string[]}){
 const existing=new Set(selectedProductIds);
 const available=card.products.filter(p=>!existing.has(p.id));
 // No preselection: an old removed colorway can only be restored by an explicit new choice.
 const [selected,setSelected]=useState<Set<string>>(()=>new Set());
 const [thumbs,setThumbs]=useState<Map<string,string>>(new Map());
 const accessLost=useRef(onAccessLost);accessLost.current=onAccessLost;
 useEffect(()=>{
  if(!resolveThumbnails)return;
  const controller=new AbortController();setThumbs(new Map());
  const ids=[...new Set(card.products.map(p=>p.patternImageAssetId).filter((id):id is string=>!!id))];
  void (async()=>{const urls=new Map<string,string>();
   for(let i=0;i<ids.length;i+=100){for(const [id,url] of await resolveThumbnails(ids.slice(i,i+100),controller.signal))urls.set(id,url);}
   if(!controller.signal.aborted)setThumbs(urls);
  })().catch(error=>{if(!controller.signal.aborted&&selectionAccessRevoked(error))accessLost.current(error);});
  return ()=>controller.abort();
 },[card,resolveThumbnails]);
 const chosen=available.filter(p=>selected.has(p.id)).map(p=>p.id);
 return <article aria-label={'可补选色卡 '+card.cardNo} className="border-b border-[#ededf9] last:border-b-0">
  <div className="v2-sample-card-head flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3">
   <h4 className="min-w-0 break-all font-semibold text-slate-800">{card.cardNo}</h4>
   <span className="v2-sample-card-spec min-w-0 flex-1 truncate text-xs text-slate-600" title={[card.fabricName,card.composition,card.weightValue===null?'':card.weightValue+' '+(card.weightUnit??''),card.widthCm===null?'':card.widthCm+' cm'].filter(Boolean).join(' · ')}>
    {card.fabricName} · {card.composition??'—'} · {card.weightValue===null?'—':card.weightValue+' '+(card.weightUnit??'')} · {card.widthCm??'—'} cm
   </span>
   <span className="whitespace-nowrap text-xs text-slate-600" aria-label={'本次选择 '+chosen.length+' 款，共 '+card.products.length+' 款'}>{chosen.length}/{card.products.length} 款</span>
   <button type="button" disabled={disabled||chosen.length===0} aria-label={'加入色卡 '+card.cardNo} onClick={()=>{void add(card,chosen).then(saved=>{if(saved===true)setSelected(new Set());});}} className="v2-business-button-primary shrink-0"><ActionIcon name="add"/>加入</button>
  </div>
  <div id={'card-colors-'+card.id} className="border-t bg-[#f8f9ff] px-3 py-3">
   <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
    <span>勾选本次要加入的配色</span>
    <div className="flex items-center gap-2">
     <button type="button" disabled={disabled||chosen.length===available.length} aria-label={'全选本卡 '+card.cardNo} onClick={()=>setSelected(new Set(available.map(p=>p.id)))} className="v2-business-button">全选本卡</button>
     {chosen.length>0&&<button type="button" disabled={disabled} aria-label={'清空本卡 '+card.cardNo+' 的选择'} onClick={()=>setSelected(new Set())} className="v2-business-button-quiet">清空</button>}
    </div>
   </div>
   <fieldset disabled={disabled}><legend className="sr-only">{card.cardNo} 的花型配色</legend>
    <div className="v2-sample-colorways">{card.products.map(product=>{const already=existing.has(product.id),on=!already&&selected.has(product.id),image=product.patternImageAssetId?thumbs.get(product.patternImageAssetId):undefined;return <label key={product.id} title={product.productNo} className={'v2-sample-tile '+(already?'is-existing':on?'is-selected':'')+(already?'':' cursor-pointer')}>
     <input type="checkbox" aria-label={'配色 '+product.productNo} checked={on} disabled={disabled||already} onChange={e=>setSelected(before=>{const next=new Set(before);if(e.target.checked)next.add(product.id);else next.delete(product.id);return next;})}/>
     <SamplePatternThumbnail label={product.patternNo} assetId={product.patternImageAssetId} url={image}/>
     <span>{product.patternNo}</span>{already&&<span className="text-xs text-slate-500">本单已选</span>}
    </label>;})}</div>
   </fieldset>
  </div>
 </article>;
}
/** Manual search never preselects results; explicit colorway choice is required before writing. */
export function ManualSelectionPane({sessionId,search,add,resolveThumbnails,disabled,onAccessLost,onClose,actionError='',actionNotice='',customerReference='',selectedProductIds=[]}:ManualSelectionPaneProps){
 const [query,setQuery]=useState('');
 const [filters,setFilters]=useState<ManualFilters>({sessionId,query:'',offset:0});
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
 return <dialog ref={dialog} aria-label="人工补选" aria-modal="true" className="m-auto max-h-[90vh] w-[min(96vw,900px)] overflow-auto rounded-xl border p-0 shadow-xl backdrop:bg-black/30" onCancel={event=>{if(event.target!==event.currentTarget)return;event.preventDefault();if(!disabled)onClose();}}><section aria-label="人工补选色卡" aria-busy={loading||disabled} className="v2-sample-picker rounded-lg border border-[#c3c6d7] bg-[#f8f9ff] p-3 sm:p-4">
  <header className="mb-3 flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-semibold">人工补选</h3>
   <p className="mt-1 text-xs text-slate-600">勾选配色后加入；本单已选项已标识，取消过的配色不会自动恢复。</p></div>
   <button type="button" disabled={disabled} onClick={onClose} aria-label="关闭人工补选" title="关闭" className="v2-business-icon-button shrink-0"><ActionIcon name="close"/></button></header>
  {customerReference&&<p className="mb-2 text-sm text-slate-600">客户：{customerReference}</p>}
  {actionError&&<p role="alert" className="mb-2 text-sm text-rose-700">{actionError}</p>}{actionNotice&&<p role="status" className="mb-2 text-sm text-emerald-800">{actionNotice}</p>}
  <form onSubmit={e=>{e.preventDefault();if(!locked)apply(query);}} className="mb-3 flex flex-wrap items-end gap-3">
   <label className="min-w-[150px] flex-1 text-sm"><span className="sr-only">色卡搜索</span><input ref={firstInput} value={query} maxLength={100} disabled={disabled} onChange={e=>setQuery(e.target.value)} placeholder="色卡编号、花型编号、面料品号或品名"
    className="block w-full rounded border border-[#c3c6d7] bg-white px-3 py-2 focus:outline-[#346ef6]"/></label>
   <button type="submit" disabled={locked} className="v2-business-button"><ActionIcon name="search"/>搜索色卡</button>
   {(query.trim()||filters.query)&&<button type="button" disabled={locked} onClick={()=>{setQuery('');apply('');}} className="v2-business-button-quiet"><ActionIcon name="reset"/>清除筛选</button>}
  </form>
  {loading&&<p role="status" className="py-4 text-sm">正在检索色卡…</p>}
  {error&&<div role="alert" className="py-3 text-sm text-red-700">{error} <button type="button" disabled={locked} onClick={()=>setRevision(x=>x+1)} className="v2-business-button-quiet"><ActionIcon name="refresh"/>重试检索</button></div>}
  {!loading&&page&&!page.items.length&&<p className="py-6 text-center text-sm text-slate-600">{filters.query?'没有匹配的可选色卡，请调整或清除筛选':'暂无可选色卡，请先在产品库创建对应产品'}</p>}
  {!loading&&!!page?.items.length&&<div role="list" aria-label="可补选色卡" className="min-w-0 rounded border border-[#c3c6d7] bg-white">{page.items.map(card=><div role="listitem" key={filters.query+':'+filters.offset+':'+card.id}><CardRow card={card} disabled={locked} selectedProductIds={selectedProductIds} add={add} resolveThumbnails={resolveThumbnails} onAccessLost={onAccessLost}/></div>)}</div>}
  {page&&!loading&&page.total>page.limit&&<footer className="mt-3 flex items-center justify-between gap-3 text-sm"><span>共 {page.total} 张色卡 · 第 {Math.floor(page.offset/20)+1} 页</span><div className="flex gap-2">
   <button type="button" disabled={locked||page.offset===0} onClick={()=>{setPage(null);setFilters({...filters,offset:Math.max(0,page.offset-20)});}} className="v2-business-button"><ActionIcon name="back"/>上一页色卡</button>
   <button type="button" disabled={locked||page.offset+page.limit>=page.total} onClick={()=>{setPage(null);setFilters({...filters,offset:page.offset+20});}} className="v2-business-button"><ActionIcon name="next"/>下一页色卡</button>
  </div></footer>}
 </section></dialog>;
}
