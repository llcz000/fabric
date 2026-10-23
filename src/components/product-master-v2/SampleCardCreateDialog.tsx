import { ActionIcon } from './ActionIcon';
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PatternMasterItem } from './patternModel';
import type { FabricCatalogItem } from './fabricModel';
import { SampleCardDraftController } from './sampleCardModel';
import {SampleCardQr,type SampleCardQrRenderer} from './SampleCardQr';
const field='h-8 w-full rounded border border-[#c3c6d7] bg-[#fbfcfd] px-2 text-xs focus:outline-[#346ef6]';



const button='rounded border border-[#c3c6d7] px-3 py-1.5 text-xs disabled:opacity-40';
const blue=button+' border-[#346ef6] bg-[#346ef6] text-white';

const border='rounded-lg border border-[#c3c6d7] bg-white';

export function NumberCandidates({kind,items,onSelect,activeIndex=0,id='card-'+kind+'-options'}:{
 kind:'master'|'fabric';items:readonly (PatternMasterItem|FabricCatalogItem)[];
 onSelect(item:PatternMasterItem|FabricCatalogItem):void;activeIndex?:number;id?:string;
}){
 return <div role="listbox" aria-label={kind==='master'?'母版候选':'面料候选'} id={id} className="max-h-40 overflow-y-auto">
  {items.map((item,index)=><button type="button" key={item.id} role="option" aria-selected={index===activeIndex}
   id={id+'-'+index} onMouseDown={e=>e.preventDefault()} onClick={()=>onSelect(item)}
   className={'block w-full px-3 py-2 text-left text-xs hover:bg-[#eef1fd] '+(index===activeIndex?'bg-[#eef1fd]':'')}>
   {'masterNo' in item?item.masterNo:item.fabricNo}
  </button>)}
 </div>;
}

function PatternProofImage({url,patternNo,hasAsset}:{url?:string;patternNo:string;hasAsset:boolean}){
 const [failed,setFailed]=useState(false);useEffect(()=>{setFailed(false);},[url]);
 return url&&!failed?<img src={url} alt={'花型 '+patternNo} width={64} height={64}
  onError={()=>setFailed(true)} className="h-16 w-16 rounded border border-[#e2e8f0] bg-slate-50 object-contain"/>:
  <span className="flex h-16 w-16 items-center justify-center rounded border border-dashed border-[#c3c6d7] bg-slate-50 text-[10px] text-slate-500">
   {failed?'图片加载失败':hasAsset?'图片不可用':'缺少图片'}</span>;
}

export function SampleCardCreateDialog({controller,onClose,onCreate,imageUrls=new Map(),QrRenderer=SampleCardQr}:{
 controller:SampleCardDraftController;onClose():void;onCreate():Promise<void>;
 imageUrls?:Map<string,string>;QrRenderer?:SampleCardQrRenderer;
}){
 const state=useSyncExternalStore(controller.subscribe,()=>controller.state,()=>controller.state);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[masterIndex,setMasterIndex]=useState(0),[fabricIndex,setFabricIndex]=useState(0);
 const dialog=useRef<HTMLDivElement>(null),first=useRef<HTMLInputElement>(null);
 const close=()=>{if(!busy)onClose();};
 useEffect(()=>{
  const before=document.activeElement instanceof HTMLElement?document.activeElement:null;
  first.current?.focus();
  return ()=>before?.focus();
 },[]);
 const keyboard=(event:React.KeyboardEvent<HTMLInputElement>,kind:'master'|'fabric')=>{
  const items=kind==='master'?state.masterPage.items:state.fabricPage.items;
  const index=kind==='master'?masterIndex:fabricIndex,setIndex=kind==='master'?setMasterIndex:setFabricIndex;
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
   event.preventDefault();setIndex(Math.max(0,Math.min(items.length-1,index+(event.key==='ArrowDown'?1:-1))));
  }
  if(event.key==='Enter'){
   event.preventDefault();const item=items[index];if(item)kind==='master'?void controller.selectMaster(item as PatternMasterItem):controller.selectFabric(item as FabricCatalogItem);
  }
 };
 const submit=async()=>{
  if(busy||!controller.cardNo||state.createdCard)return;
  setBusy(true);setError('');
  try{await onCreate();}catch(e){setError(e instanceof Error?e.message:'生成色卡失败');}finally{setBusy(false);}
 };
 const input=(kind:'master'|'fabric')=>{
  const isMaster=kind==='master',text=isMaster?state.masterText:state.fabricText,selected=isMaster?state.master:state.fabric;
  const page=isMaster?state.masterPage:state.fabricPage,loading=isMaster?state.masterLoading:state.fabricLoading;
  const failure=isMaster?state.masterError:state.fabricError,index=isMaster?masterIndex:fabricIndex;
  const showing=!selected&&(page.items.length>0||loading||text.length>0);
  return <div className="relative flex-1">
   <label className="block text-xs font-semibold">{isMaster?'花型母版':'面料品号'}
    <input ref={isMaster?first:undefined} aria-label={isMaster?'花型母版':'面料品号'} role="combobox"
     aria-autocomplete="list" aria-expanded={showing} aria-controls={'card-'+kind+'-options'}
     aria-activedescendant={showing&&page.items[index]?'card-'+kind+'-options-'+index:undefined}
     disabled={busy||Boolean(state.createdCard)} maxLength={160} value={text} className={field+' mt-1'}
     placeholder={isMaster?'输入母版编号 / 完整花型编号':'输入面料品号 / 品名'}
     onFocus={()=>{if(!selected&&!page.items.length&&!loading)void controller.edit(kind,text);}}
     onKeyDown={e=>keyboard(e,kind)} onChange={e=>{
      (isMaster?setMasterIndex:setFabricIndex)(0);setError('');void controller.edit(kind,e.target.value);
     }}/>
   </label>
   {showing?<div className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded border border-[#c3c6d7] bg-white shadow-lg">
    <NumberCandidates kind={kind} items={page.items} activeIndex={index}
     onSelect={item=>isMaster?void controller.selectMaster(item as PatternMasterItem):controller.selectFabric(item as FabricCatalogItem)}/>
    {loading?<p className="p-2 text-xs text-slate-500" role="status">检索中…</p>:null}
    {!loading&&!page.items.length?<p className="p-2 text-xs text-slate-500">没有匹配记录</p>:null}
    {failure?<p role="alert" className="p-2 text-xs text-rose-700">{failure}</p>:null}
    {page.offset+page.limit<page.total?<button type="button" disabled={loading||busy} onClick={()=>void controller.loadMore(kind)}
      className="w-full border-t p-2 text-xs text-[#0053da]"><ActionIcon name="add"/>加载更多候选</button>:null}
   </div>:null}
  </div>;
 };
 return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
  <div role="dialog" aria-modal="true" aria-label="新增色卡" ref={dialog}
   className={border+' flex max-h-[90vh] w-full max-w-[640px] flex-col overflow-hidden shadow-xl'}
   onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();close();}
    if(event.key==='Tab'){
     const focusable=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled])')??[]);
     if(!focusable.length)return;
     if(event.shiftKey&&document.activeElement===focusable[0]){event.preventDefault();focusable[focusable.length-1].focus();}
     else if(!event.shiftKey&&document.activeElement===focusable[focusable.length-1]){event.preventDefault();focusable[0].focus();}
    }
   }}>
   <header className="flex items-center justify-between border-b border-[#c3c6d7] bg-[#fbfcfd] px-4 py-2.5">
    <h2 className="text-sm font-semibold">新增色卡</h2><button type="button" disabled={busy} aria-label="关闭新增色卡" onClick={close} title="关闭新增色卡" className="v2-icon-button"><ActionIcon name="close"/></button>
   </header>
   <div className="space-y-4 overflow-y-auto p-4">
    <p className="text-xs text-slate-500">选择已有花型母版与面料，保存唯一组合并生成稳定二维码。</p>
    <div className="flex flex-col gap-4 sm:flex-row">{input('master')}{input('fabric')}</div>
    <section aria-label="花型母版校对区" className="rounded border border-[#e2e8f0] p-3">
     <h3 className="text-xs font-semibold">花型母版校对区</h3>
     {state.master?<div className="mt-2 flex flex-wrap gap-3">
      {state.versions.map(version=><div key={version.id} className="flex w-20 flex-col items-center gap-1">
       <PatternProofImage patternNo={version.patternNo} hasAsset={Boolean(version.patternImageAssetId)} url={version.patternImageAssetId?imageUrls.get(version.patternImageAssetId):undefined}/>
       <span className="text-[11px]">{version.patternNo}</span>
      </div>)}
      {state.versionsLoading?<p role="status" className="text-xs text-slate-500">配色资料加载中…</p>:null}
      {!state.versionsLoading&&!state.versions.length&&!state.versionsError?<p className="text-xs text-slate-500">暂无配色版本</p>:null}
      {state.versionsError?<p role="alert" className="text-xs text-rose-700">{state.versionsError}</p>:null}
     </div>:<p className="mt-2 text-xs text-slate-500">请先选择花型母版以校对已有配色版本</p>}
    </section>
    <section aria-label="面料校对条" className="rounded border border-[#e2e8f0] p-3 text-xs">
     <h3 className="font-semibold">面料校对条</h3>
     {state.fabric?<p className="mt-2 leading-6">品号 {state.fabric.fabricNo} · 品名 {state.fabric.fabricName} · 成分 {state.fabric.composition||'—'} · 克重 {state.fabric.weightValue===null?'—':state.fabric.weightValue+' '+state.fabric.weightUnit} · 门幅 {state.fabric.widthValue===null?'—':state.fabric.widthValue+' cm'}</p>:
      <p className="mt-2 text-slate-500">请先选择面料以校对成分与规格</p>}
    </section>
    <div className="rounded border border-[#c3c6d7] bg-[#f3f5ff] p-3 text-xs">
     色卡编号：<strong className="ml-2 font-mono text-[#0053da]">{controller.cardNo||'未就绪（需母版与面料均确认）'}</strong>
    </div>
    {state.createdCard?<div role="status" className="flex items-center gap-4">
     <QrRenderer payload={state.createdCard.scanUrl??state.createdCard.qrPayload} size={128}/><span className="text-xs">色卡已就绪：{state.createdCard.cardNo}</span>
    </div>:null}
    {error?<p role="alert" className="text-xs text-rose-700">{error}</p>:null}
   </div>
   <footer className="flex justify-end gap-2 border-t border-[#c3c6d7] bg-[#fbfcfd] px-4 py-3">
    <button type="button" disabled={busy} onClick={close} className={button}><ActionIcon name="close"/>{state.createdCard?'关闭':'取消'}</button>
    <button type="button" disabled={busy||!controller.cardNo||Boolean(state.createdCard)} onClick={()=>void submit()} className={blue}>
     <ActionIcon name="qr"/>{busy?'生成中…':'生成色卡'}</button>
   </footer>
  </div>
 </div>;
}

