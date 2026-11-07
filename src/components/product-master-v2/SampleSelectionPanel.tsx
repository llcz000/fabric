import {groupSelectedCards,loadCompleteSelection,resolveSelectionThumbnails} from './selectedCardModel';
import {SamplePatternThumbnail} from './SamplePatternThumbnail';
import {ActionIcon} from './ActionIcon';
import {useConfirm} from '../ui/ConfirmDialog';
import {useToast} from '../ui/Toast';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import type {SampleSessionPage} from '../../../server/customer-samples/sessionRead';
import {selectionAccessRevoked,type SelectionApi} from './sampleSelectionClient';
import {ManualSelectionPane,type ManualSelectionPaneProps} from './ManualSelectionPane';
import {createManualSelectionAction} from './manualSelectionModel';
import type {SelectionCard} from './manualSelectionModel';

const LIMIT=20;
export interface SampleSelectionPanelProps {
 sessionId:string;
 load:(sessionId:string,limit:number,offset:number)=>Promise<SampleSessionPage>;
 remove:(sessionId:string,itemId:string)=>Promise<void>;
 removeItems?:SelectionApi['removeItems'];
 readOnly?:boolean;
 addManual?:SelectionApi['addManual'];
 searchManual?:ManualSelectionPaneProps['search'];
 resolveThumbnails?:ManualSelectionPaneProps['resolveThumbnails'];
 onRescan?:()=>Promise<void>|void;
 onExport?:(session:SampleSessionPage['session'],onUpdated:()=>Promise<void>)=>Promise<boolean|void>;
 /** For SSR preview of a previously authorized response; never persist across sessions. */
 initialPage?:SampleSessionPage;
}
const errorText=(error:unknown):string=>{
 const status=(error as {status?:unknown})?.status;
 return status===401?'登录已失效，请重新登录':status===403||status===404?'无权查看或选样单不存在':'暂时无法读取选样资料';
};
const value=(text:string|null)=>text===null||text===''?'—':text;
export function SampleSelectionPanel({sessionId,load,removeItems,readOnly=false,addManual,searchManual,resolveThumbnails,onRescan,onExport,initialPage}:SampleSelectionPanelProps){
 const confirm=useConfirm(),toast=useToast();
 const [page,setPage]=useState<SampleSessionPage|null>(
  initialPage?.session.id===sessionId?initialPage:null);
 const [busy,setBusy]=useState(false);
 const [cardOffset,setCardOffset]=useState(0);
 const [message,setMessage]=useState('');
 const [notice,setNotice]=useState('');
 const [manualOpen,setManualOpen]=useState(false);
 const [selectedItems,setSelectedItems]=useState<string[]>([]);
 const groups=useMemo(()=>groupSelectedCards(page?.items??[]),[page]);
 const visibleGroups=groups.slice(cardOffset,cardOffset+LIMIT);
 const thumbnailIds=[...new Set(visibleGroups.flatMap(group=>group.items.map(item=>item.current.patternImageAssetId)).filter((id):id is string=>!!id))];
 const thumbnailKey=JSON.stringify([sessionId,thumbnailIds]);
 const [thumbnailData,setThumbnailData]=useState<{key:string;urls:Map<string,string>;pending:boolean;failed:Set<string>}>({key:'',urls:new Map(),pending:false,failed:new Set()});
 useEffect(()=>{
  const controller=new AbortController(),ids=page?.session.id===sessionId?thumbnailIds:[];
  setThumbnailData({key:thumbnailKey,urls:new Map(),pending:Boolean(ids.length&&resolveThumbnails),failed:new Set()});
  if(ids.length&&resolveThumbnails)void resolveSelectionThumbnails(ids,resolveThumbnails,controller.signal).then(result=>{if(!controller.signal.aborted)setThumbnailData({key:thumbnailKey,...result,pending:false});}).catch(()=>{if(!controller.signal.aborted)setThumbnailData({key:thumbnailKey,urls:new Map(),pending:false,failed:new Set(ids)});});
  return()=>controller.abort();
 // The serialized identity avoids renewing every URL when only a checkbox changes.
 },[thumbnailKey,resolveThumbnails]);
 const ticket=useRef(0);
 const manualPending=useRef(false),removePending=useRef(false),exportPending=useRef(false);
 const currentPage=useRef(page);currentPage.current=page;
 const manualAction=useMemo(()=>addManual?createManualSelectionAction({sessionId,addManual,
  
  reload:async()=>{
   const seq=ticket.current;
   const latest=await loadCompleteSelection(load,sessionId);
   if(seq!==ticket.current)throw Error('Selection changed');
   if(latest.session.id!==sessionId)throw Error('Unexpected selection identity');
   setPage(latest);setCardOffset(0);
  }}):null,[sessionId,addManual,load]);
 function accessLost(error:unknown){setPage(null);setSelectedItems([]);setManualOpen(false);setMessage(errorText(error));}
 async function addOne(card:SelectionCard,productIds?:string[]){
  if(!manualAction||busy||manualPending.current||!page||readOnly)return false;
  manualPending.current=true;
  setBusy(true);setMessage('');setNotice('');
  try{
   const result=await manualAction(card,productIds);
   const count=(action:string)=>result.items.filter(x=>x.action===action).length;
   setNotice(card.cardNo+'：新增 '+count('added')+' 款，恢复 '+count('restored')+' 款，已选 '+count('already_selected')+' 款；已读取最新资料');
   return true;
  }catch(error){
   if(selectionAccessRevoked(error))accessLost(error);
   else setMessage((error as {status?:number})?.status===409?'产品供样状态或选样单已变更，请刷新核对':
    error instanceof Error&&error.message.includes('刷新失败')?error.message:'补选失败，请重试或刷新核对');
   return false;
  }finally{manualPending.current=false;setBusy(false);}
 }
 async function refresh(offset:number){
  const seq=++ticket.current;setBusy(true);setMessage('');setNotice('');
  try{
   const result=await loadCompleteSelection(load,sessionId);
   if(seq!==ticket.current)return;
   if(result.session.id!==sessionId)throw Error('Unexpected selection identity');
   setPage(result);setCardOffset(offset);
  }catch(error){
   if(seq!==ticket.current)return;
   if(selectionAccessRevoked(error))accessLost(error);else{setPage(null);setMessage(errorText(error));}
  }finally{if(seq===ticket.current)setBusy(false);}
 }
 useEffect(()=>{
  ticket.current++;
  setSelectedItems([]);
  if(!initialPage||initialPage.session.id!==sessionId)setPage(null);
  void refresh(0);
  return ()=>{ticket.current++;};
 // The session ID is the security boundary; callers keep injected adapters stable.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[sessionId]);
 async function exportExcel(){
  if(!onExport||busy||exportPending.current||!page||!page.total )return;
  const seq=ticket.current;exportPending.current=true;setBusy(true);setMessage('');setNotice('');
  try{const exported=await onExport(page.session,()=>refresh(cardOffset));if(exported!==false&&seq===ticket.current)toast.success('Excel 已导出');}
  catch(error){if(seq!==ticket.current)return;if(selectionAccessRevoked(error))accessLost(error);else setMessage((error as {status?:number}).status===409?'暂无可导出的色卡，或部分色卡已失效，请核对后重试':'导出失败，请重试');}
  finally{exportPending.current=false;if(seq===ticket.current)setBusy(false);}
 }
 async function rescan(){
  if(!onRescan||!page||readOnly||busy)return;
  setBusy(true);setMessage('');
  try{await onRescan();await refresh(page.offset);}
  catch(error){
   if(selectionAccessRevoked(error))accessLost(error);
   setMessage(errorText(error));setBusy(false);
  }
 }
 // A session switch must never paint the previous customer's cached records.
 if(page&&page.session.id!==sessionId)return <section aria-label="客户选样明细">正在读取选样资料…</section>;
 if(!page)return <section aria-label="客户选样明细" className="rounded-xl border p-5">
  <h2 className="font-semibold">客户选样明细</h2>
  <p role={message?'alert':'status'}>{message||'正在读取选样资料…'}</p>
  {message&&<button type="button" disabled={busy} onClick={()=>void refresh(0)} className="mt-3 v2-business-button"><ActionIcon name="refresh"/>重试读取</button>}
 </section>;
 const closed=readOnly;
 const pageIds=visibleGroups.flatMap(group=>group.items.map(item=>item.id));
 const allChecked=pageIds.length>0&&pageIds.every(id=>selectedItems.includes(id));
 const select=(id:string,on:boolean)=>setSelectedItems(before=>on?[...new Set([...before,id])]:before.filter(value=>value!==id));
 const removeSelected=async()=>{
  if(closed||busy||removePending.current||!removeItems||!selectedItems.length)return;
  const ok=await confirm({title:'从本次选样移除所选配色？',
   message:'将移除 '+selectedItems.length+' 个已选配色。仅移除勾选记录，寄样、跟进及来源历史会保留，色卡库不受影响。',
   confirmText:'确认移除',danger:true});
  if(!ok)return;
  removePending.current=true;setBusy(true);setMessage('');setNotice('');
  try{const result=await removeItems(sessionId,selectedItems);setSelectedItems([]);await refresh(0);setNotice('已移除 '+result.removedCount+' 款已选配色');}
  catch(error){if(selectionAccessRevoked(error))accessLost(error);else setMessage('批量移除未确认，请刷新核对后重试');setBusy(false);}finally{removePending.current=false;}
 };
 const max=Math.max(0,Math.ceil(groups.length/LIMIT)-1)*LIMIT;
 return <section aria-label="客户选样明细" className="rounded-xl border border-slate-200 bg-white p-3 text-slate-800 sm:p-5">
  <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
   <p className="text-sm text-slate-600">已选 {page.total} 款 · {page.selectedCardCount} 张色卡</p>
   <div className="flex flex-wrap items-center gap-2">
    {onExport&&<button type="button" aria-label="导出 Excel" disabled={busy||!page.total} onClick={()=>void exportExcel()} className="v2-business-button v2-business-touch"><ActionIcon name="excel"/>导出 Excel</button>}
    {!readOnly&&manualAction&&searchManual&&<button type="button" disabled={busy||closed} onClick={()=>{setManualOpen(true);setNotice('');setMessage('');}}
     className="v2-business-button v2-business-touch"><ActionIcon name="add"/>人工补选</button>}
    {closed?<span className="rounded bg-slate-100 px-2 py-1 text-xs">查看 · 只读</span>:<>
     {onRescan&&<button type="button" disabled={busy} onClick={()=>void rescan()} className="v2-business-button v2-business-touch"><ActionIcon name="scan"/>重新扫码补选</button>}
    </>}
    
   </div>
  </header>
  {!closed&&removeItems&&<div className="mb-3 flex items-center gap-3 text-sm"><label className="flex items-center gap-2"><input type="checkbox" aria-label="全选当前页配色" disabled={busy||!pageIds.length} checked={allChecked} ref={element=>{if(element)element.indeterminate=!allChecked&&pageIds.some(id=>selectedItems.includes(id));}} onChange={event=>setSelectedItems(before=>event.target.checked?[...new Set([...before,...pageIds])]:before.filter(id=>!pageIds.includes(id)))}/>全选当前页待移除配色</label><button type="button" disabled={busy||!selectedItems.length} className="v2-business-button-danger" onClick={()=>void removeSelected()}><ActionIcon name="delete"/>移除所选{selectedItems.length?'（'+selectedItems.length+'）':''}</button></div>}

  {message&&<p role="alert" className="mb-3 text-sm text-red-700">{message}</p>}
  {notice&&<p role="status" className="mb-3 rounded bg-[#eef1fd] p-3 text-sm text-[#31447b]">{notice}</p>}
  {busy&&<p role="status" className="mb-3 text-sm text-slate-500">正在处理，请稍候…</p>}
  {manualOpen&&!closed&&searchManual&&manualAction&&<ManualSelectionPane sessionId={sessionId} search={searchManual} selectedProductIds={page.items.map(i=>i.productId)} add={addOne} resolveThumbnails={resolveThumbnails} disabled={busy}
   actionError={message} actionNotice={notice} customerReference={page.session.customerReference} onAccessLost={accessLost} onClose={()=>setManualOpen(false)}/>}
  {page.items.length===0?<p className="rounded bg-slate-50 p-6 text-center text-sm text-slate-500">暂无已选产品</p>:
  <div className="v2-selected-cards" aria-label="按色卡展示已选配色">{visibleGroups.map(group=>{const current=group.items[0].current;return <article key={group.id} data-selected-card={group.id} aria-label={'已选色卡 '+group.cardNo} className="v2-selected-card">
   <div className="v2-selected-card-info"><strong><span className="sr-only">色卡编号 </span>{group.cardNo}</strong>{group.retired&&<span className="text-amber-800">已失效</span>}<span>{current.fabricName} · {current.fabricNo}</span><span>{value(current.composition)} · {current.weightValue===null?'—':current.weightValue+' '+(current.weightUnit??'')} · {value(current.widthCm)} cm</span><span>已选 {group.items.length} 个配色</span></div>
   <div className="v2-sample-colorways">{group.items.map(item=>{const no=item.current.patternNo+'-'+item.current.colorwayNo;return <label key={item.id} className={'v2-sample-tile '+(selectedItems.includes(item.id)?'is-selected':'')}>
    {!closed&&removeItems&&<input type="checkbox" data-selection-item={item.id} aria-label={'勾选配色 '+no+'，色卡 '+group.cardNo} disabled={busy} checked={selectedItems.includes(item.id)} onChange={event=>select(item.id,event.target.checked)}/>}
    <SamplePatternThumbnail key={sessionId+':'+cardOffset+':'+item.id+':'+item.current.patternImageAssetId} assetId={item.current.patternImageAssetId} url={thumbnailData.key===thumbnailKey&&item.current.patternImageAssetId?thumbnailData.urls.get(item.current.patternImageAssetId):undefined} label={no} pending={thumbnailData.key===thumbnailKey&&thumbnailData.pending} failed={!!item.current.patternImageAssetId&&thumbnailData.key===thumbnailKey&&thumbnailData.failed.has(item.current.patternImageAssetId)} reload={resolveThumbnails&&item.current.patternImageAssetId?async signal=>(await resolveThumbnails([item.current.patternImageAssetId!],signal)).get(item.current.patternImageAssetId!):undefined}/>
    <span>{no}</span>
    {item.sources.filter(source=>source.cardId!==group.id).map(source=><span key={source.cardId} className="text-[10px] text-slate-500">历史来源 {source.cardNo}{source.retired?' · 已失效':''}</span>)}
   </label>;})}</div>
  </article>;})}</div>}

  <footer className="mt-4 flex items-center justify-between gap-3 text-sm">
   <span>{groups.length===0?'0':cardOffset+1}–{Math.min(groups.length,cardOffset+LIMIT)} / {groups.length} 张色卡</span>
   <div className="flex gap-2">
    <button type="button" disabled={busy||cardOffset===0} onClick={()=>setCardOffset(Math.max(0,cardOffset-LIMIT))} className="v2-business-button v2-business-touch"><ActionIcon name="back"/>上一页</button>
    <button type="button" disabled={busy||cardOffset>=max} onClick={()=>setCardOffset(Math.min(max,cardOffset+LIMIT))} className="v2-business-button v2-business-touch"><ActionIcon name="next"/>下一页</button>
   </div>
  </footer>
 </section>;
}
