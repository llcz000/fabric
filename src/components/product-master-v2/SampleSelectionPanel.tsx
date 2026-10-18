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
 /** For SSR preview of a previously authorized response; never persist across sessions. */
 initialPage?:SampleSessionPage;
}
const errorText=(error:unknown):string=>{
 const status=(error as {status?:unknown})?.status;
 return status===401?'登录已失效，请重新登录':status===403||status===404?'无权查看或选样单不存在':'暂时无法读取选样资料';
};
const value=(text:string|null)=>text===null||text===''?'—':text;
export function SampleSelectionPanel({sessionId,load,removeItems,readOnly=false,addManual,searchManual,resolveThumbnails,onRescan,initialPage}:SampleSelectionPanelProps){
 const [page,setPage]=useState<SampleSessionPage|null>(
  initialPage?.session.id===sessionId?initialPage:null);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [notice,setNotice]=useState('');
 const [manualOpen,setManualOpen]=useState(false);
 const [selectedItems,setSelectedItems]=useState<string[]>([]);
 const ticket=useRef(0);
 const manualPending=useRef(false),removePending=useRef(false);
 const currentPage=useRef(page);currentPage.current=page;
 const manualAction=useMemo(()=>addManual?createManualSelectionAction({sessionId,addManual,
  isOpen:()=>currentPage.current?.session.id===sessionId&&currentPage.current.session.status==='open',
  reload:async()=>{
   const seq=ticket.current;
   const latest=await load(sessionId,LIMIT,0);
   if(seq!==ticket.current)throw Error('Selection changed');
   if(latest.session.id!==sessionId)throw Error('Unexpected selection identity');
   setPage(latest);
  }}):null,[sessionId,addManual,load]);
 function accessLost(error:unknown){setPage(null);setSelectedItems([]);setManualOpen(false);setMessage(errorText(error));}
 async function addOne(card:SelectionCard,productIds?:string[]){
  if(!manualAction||busy||manualPending.current||!page||page.session.status!=='open')return;
  manualPending.current=true;
  setBusy(true);setMessage('');setNotice('');
  try{
   const result=await manualAction(card,productIds);
   const count=(action:string)=>result.items.filter(x=>x.action===action).length;
   setNotice(card.cardNo+'：新增 '+count('added')+' 款，恢复 '+count('restored')+' 款，已选 '+count('already_selected')+' 款；已读取最新资料');
  }catch(error){
   if(selectionAccessRevoked(error))accessLost(error);
   else setMessage((error as {status?:number})?.status===409?'产品供样状态或选样单已变更，请刷新核对':
    error instanceof Error&&error.message.includes('刷新失败')?error.message:'补选失败，请重试或刷新核对');
  }finally{manualPending.current=false;setBusy(false);}
 }
 async function refresh(offset:number){
  const seq=++ticket.current;setBusy(true);setMessage('');setNotice('');
  try{
   const result=await load(sessionId,LIMIT,offset);
   if(seq!==ticket.current)return;
   if(result.session.id!==sessionId)throw Error('Unexpected selection identity');
   setPage(result);
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
 async function rescan(){
  if(!onRescan||!page||page.session.status!=='open'||busy)return;
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
  {message&&<button type="button" disabled={busy} onClick={()=>void refresh(0)} className="mt-3 rounded border px-3 py-2 text-sm">重试读取</button>}
 </section>;
 const closed=readOnly||page.session.status==='closed';
 const pageIds=page.items.map(item=>item.id);
 const allChecked=pageIds.length>0&&pageIds.every(id=>selectedItems.includes(id));
 const select=(id:string,on:boolean)=>setSelectedItems(before=>on?[...new Set([...before,id])]:before.filter(value=>value!==id));
 const removeSelected=async()=>{
  if(closed||busy||removePending.current||!removeItems||!selectedItems.length||!window.confirm('从本次选样移除所选 '+selectedItems.length+' 个货号？仅移除勾选记录，寄样、跟进及来源历史会保留，色卡库不受影响。'))return;
  removePending.current=true;setBusy(true);setMessage('');setNotice('');
  try{const result=await removeItems(sessionId,selectedItems);setSelectedItems([]);await refresh(0);setNotice('已移除 '+result.removedCount+' 款已选配色');}
  catch(error){if(selectionAccessRevoked(error))accessLost(error);else setMessage('批量移除未确认，请刷新核对后重试');setBusy(false);}finally{removePending.current=false;}
 };
 const max=Math.max(0,Math.ceil(page.total/LIMIT)-1)*LIMIT;
 return <section aria-label="客户选样明细" className="rounded-xl border border-slate-200 bg-white p-5 text-slate-800">
  <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
   <div><h2 className="text-lg font-semibold">客户选样明细</h2>
    <p className="text-sm text-slate-500">{page.session.customerReference} · 已选产品 {page.total} 款 · 色卡 {page.selectedCardCount} 张</p></div>
   <div className="flex items-center gap-2">
    {!readOnly&&manualAction&&searchManual&&<button type="button" disabled={busy||closed} onClick={()=>{setManualOpen(true);setNotice('');setMessage('');}}
     className="rounded bg-[#0053da] px-3 py-1.5 text-sm text-white disabled:opacity-40">人工补选</button>}
    {closed?<span className="rounded bg-slate-100 px-2 py-1 text-xs">{readOnly?'查看 · 只读':'已结束 · 只读'}</span>:<>
     {onRescan&&<button type="button" disabled={busy} onClick={()=>void rescan()} className="rounded border px-3 py-1.5 text-sm">重新扫码补选</button>}
    </>}
    <button type="button" disabled={busy} onClick={()=>void refresh(page.offset)} className="rounded border px-3 py-1.5 text-sm">刷新</button>
   </div>
  </header>
  {!closed&&removeItems&&<div className="mb-3 flex items-center gap-3 text-sm"><label className="flex items-center gap-2"><input type="checkbox" aria-label="全选当前页货号" disabled={busy||!pageIds.length} checked={allChecked} ref={element=>{if(element)element.indeterminate=!allChecked&&pageIds.some(id=>selectedItems.includes(id));}} onChange={event=>setSelectedItems(before=>event.target.checked?[...new Set([...before,...pageIds])]:before.filter(id=>!pageIds.includes(id)))}/>全选当前页货号</label><button type="button" disabled={busy||!selectedItems.length} className="rounded border px-3 py-1 text-rose-700 disabled:opacity-40" onClick={()=>void removeSelected()}>移除所选{selectedItems.length?'（'+selectedItems.length+'）':''}</button></div>}

  {message&&<p role="alert" className="mb-3 text-sm text-red-700">{message}</p>}
  {notice&&<p role="status" className="mb-3 rounded bg-[#eef1fd] p-3 text-sm text-[#31447b]">{notice}</p>}
  {busy&&<p role="status" className="mb-3 text-sm text-slate-500">正在处理，请稍候…</p>}
  {manualOpen&&!closed&&searchManual&&manualAction&&<ManualSelectionPane sessionId={sessionId} search={searchManual} add={addOne} resolveThumbnails={resolveThumbnails} disabled={busy}
   actionError={message} actionNotice={notice} customerReference={page.session.customerReference} onAccessLost={accessLost} onClose={()=>setManualOpen(false)}/>}
  {page.items.length===0?<p className="rounded bg-slate-50 p-6 text-center text-sm text-slate-500">暂无已选产品</p>:
  <div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-left text-sm">
   <thead><tr className="border-b bg-slate-50 text-slate-600">
    {['色卡编号','货号','品名','成分','克重','门幅 / cm'].map(name=><th key={name} className="px-3 py-3 font-medium">{name}</th>)}
   </tr></thead>
   <tbody>{page.items.map(item=><tr key={item.id} className="border-b align-top">
    <td className="px-3 py-3"><div className="flex items-start gap-2">{!closed&&removeItems&&<input type="checkbox" className="mt-1 shrink-0" data-selection-item={item.id} aria-label={'勾选货号 '+item.current.productNo} disabled={busy} checked={selectedItems.includes(item.id)} onChange={event=>select(item.id,event.target.checked)}/>}<div>{item.sources.length?item.sources.map(source=>
     <div key={source.cardId}>{source.cardNo}{source.retired&&<span className="ml-2 rounded bg-amber-100 px-1.5 text-amber-800">已失效</span>}</div>):'—'}</div></div></td>
    <td className="px-3 py-3 font-medium">{item.current.productNo}</td>
    <td className="px-3 py-3">{item.current.fabricName}</td>
    <td className="px-3 py-3">{value(item.current.composition)}</td>
    <td className="px-3 py-3">{item.current.weightValue===null?'—':item.current.weightValue+' '+(item.current.weightUnit??'')}</td>
    <td className="px-3 py-3">{value(item.current.widthCm)}</td>

   </tr>)}</tbody>
  </table></div>}
  <footer className="mt-4 flex items-center justify-between gap-3 text-sm">
   <span>{page.total===0?'0':page.offset+1}–{Math.min(page.total,page.offset+page.items.length)} / {page.total}</span>
   <div className="flex gap-2">
    <button type="button" disabled={busy||page.offset===0} onClick={()=>void refresh(Math.max(0,page.offset-LIMIT))} className="rounded border px-3 py-1.5 disabled:opacity-40">上一页</button>
    <button type="button" disabled={busy||page.offset>=max} onClick={()=>void refresh(Math.min(max,page.offset+LIMIT))} className="rounded border px-3 py-1.5 disabled:opacity-40">下一页</button>
   </div>
  </footer>
 </section>;
}
