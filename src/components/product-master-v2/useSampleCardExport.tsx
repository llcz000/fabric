import React,{useEffect,useRef,useState} from 'react';
import type {SampleCardReview} from '../../../server/customer-samples/sessionCardReview';
import type {SampleSessionSummary} from './sampleOperationsModel';
import {downloadSessionCards} from './sampleSessionExport';
import {SelectionHttpError,selectionAccessRevoked} from './sampleSelectionClient';

type Download=Awaited<ReturnType<typeof downloadSessionCards>>;
type Options={reviewOnly?:boolean;onUpdated?:(review:SampleCardReview)=>void|Promise<void>;onDetails?:()=>void};
type Active={trigger:HTMLElement|null;session:SampleSessionSummary;signal?:AbortSignal;options:Options;resolve:(value:Download|null)=>void;reject:(error:unknown)=>void;abort:()=>void};
function parseReview(raw:unknown,id:string):SampleCardReview{
 const p=raw as SampleCardReview;
 if(!p||p.sessionId!==id||typeof p.snapshot!=='string'||!/^[a-f0-9]{64}$/.test(p.snapshot)||typeof p.canUpdate!=='boolean'||!Number.isSafeInteger(p.totalProducts)||p.totalProducts<0||!Number.isSafeInteger(p.cardCount)||p.cardCount<0||!Array.isArray(p.issues))throw Error('Invalid card review response');
 const seen=new Set<string>();
 for(const issue of p.issues){if(!issue||!(/^[1-9]\d{0,19}$/).test(issue.itemId)||seen.has(issue.itemId)||typeof issue.productNo!=='string'||typeof issue.reason!=='string'||typeof issue.canUpdate!=='boolean'||!Array.isArray(issue.oldCards)||issue.oldCards.some(c=>typeof c.cardId!=='string'||typeof c.cardNo!=='string'||typeof c.retired!=='boolean')||issue.currentCard!==null&&(!issue.currentCard||typeof issue.currentCard.id!=='string'||typeof issue.currentCard.cardNo!=='string'||typeof issue.currentCard.description!=='string'))throw Error('Invalid card review issue');seen.add(issue.itemId);}
 return p;
}
class ReviewChanged extends Error{constructor(readonly review:SampleCardReview){super('Card review changed');}}
async function fetchReview(apiFetch:typeof fetch,id:string,signal?:AbortSignal,body?:{snapshot:string;itemIds:string[]}){
 if(!/^[1-9]\d{0,19}$/.test(id))throw Error('Invalid selection identity');
 const response=await apiFetch('/api/v2/customer-samples/sessions/'+id+'/cards/review',{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal,cache:'no-store'});
 if(response.status===409){const data=await response.json();if(data.review)throw new ReviewChanged(parseReview(data.review,id));}
 if(!response.ok)throw new SelectionHttpError(response.status);
 return parseReview(await response.json(),id);
}
/** Shared by homepage and details. A dialog cancels the download, never the saved selection. */
export function useSampleCardExport(apiFetch:typeof fetch){
 const active=useRef<Active|null>(null),operation=useRef(false),mounted=useRef(true);
 const [review,setReview]=useState<SampleCardReview|null>(null),[checked,setChecked]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 function finish(result:Download|null,error?:unknown){const task=active.current;active.current=null;operation.current=false;task?.signal?.removeEventListener('abort',task.abort);if(mounted.current){setReview(null);setChecked([]);setBusy(false);setError('');}if(error)task?.reject(error);else task?.resolve(result);}
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;finish(null);};},[apiFetch]);
 async function download(session:SampleSessionSummary,signal?:AbortSignal,options:Options={}):Promise<Download|null>{
  signal?.throwIfAborted();if(active.current)throw Error('已有导出正在处理');
  const trigger=document.activeElement instanceof HTMLElement?document.activeElement:null;
  let plan=await fetchReview(apiFetch,session.id,signal);signal?.throwIfAborted();
  if(options.reviewOnly&&!plan.issues.length)return null;
  if(!plan.issues.length){try{return await downloadSessionCards(apiFetch,session,signal);}catch(cause){if((cause as {status?:number})?.status!==409)throw cause;plan=await fetchReview(apiFetch,session.id,signal);if(!plan.issues.length)throw cause;}}
  return new Promise<Download|null>((resolve,reject)=>{const abort=()=>finish(null);active.current={trigger,session,signal,options,resolve,reject,abort};signal?.addEventListener('abort',abort,{once:true});setReview(plan);setChecked([]);setBusy(false);setError('');if(signal?.aborted)abort();});
 }
 async function update(){
  const task=active.current;if(!task||!review||operation.current||!review.canUpdate||!checked.length)return;
  operation.current=true;setBusy(true);setError('');
  try{const result=await fetchReview(apiFetch,task.session.id,task.signal,{snapshot:review.snapshot,itemIds:checked});if(active.current!==task)return;setReview(result);setChecked([]);await task.options.onUpdated?.(result);}
  catch(cause){if(active.current!==task)return;if(selectionAccessRevoked(cause)){finish(null,cause);return;}if(cause instanceof ReviewChanged){setReview(cause.review);setChecked(before=>before.filter(id=>cause.review.issues.some(i=>i.itemId===id&&i.canUpdate)));setError('资料已变化，请核对最新差异后重新确认');}else setError('更新失败，已保留勾选，请重试');}
  finally{if(active.current===task){operation.current=false;setBusy(false);}}
 }
 async function exportConfirmed(){
  const task=active.current;if(!task||!review||review.issues.length||operation.current||!review.totalProducts)return;
  operation.current=true;setBusy(true);setError('');
  try{const result=task.options.reviewOnly?null:await downloadSessionCards(apiFetch,task.session,task.signal);if(active.current===task)finish(result);}
  catch(cause){if(active.current!==task)return;if(selectionAccessRevoked(cause)){finish(null,cause);return;}if((cause as {status?:number})?.status===409){try{setReview(await fetchReview(apiFetch,task.session.id,task.signal));setChecked([]);setError('资料已变化，请重新核对后导出');}catch(next){if(selectionAccessRevoked(next))finish(null,next);else setError('暂时无法读取最新差异，请重试导出');}}else setError('导出失败，确认结果已保留，请重试');}
  finally{if(active.current===task){operation.current=false;setBusy(false);}}
 }
 return {download,dialog:review?<CardReviewDialog reviewOnly={active.current?.options.reviewOnly} returnFocus={active.current?.trigger??null} review={review} checked={checked} setChecked={setChecked} busy={busy} error={error} onCancel={()=>{if(!operation.current)finish(null);}} onUpdate={()=>void update()} onExport={()=>void exportConfirmed()} onDetails={active.current?.options.onDetails?()=>{const next=active.current?.options.onDetails;finish(null);next?.();}:undefined}/>:null};
}
function CardReviewDialog({reviewOnly,returnFocus,review,checked,setChecked,busy,error,onCancel,onUpdate,onExport,onDetails}:{reviewOnly?:boolean;returnFocus:HTMLElement|null;review:SampleCardReview;checked:string[];setChecked:React.Dispatch<React.SetStateAction<string[]>>;busy:boolean;error:string;onCancel:()=>void;onUpdate:()=>void;onExport:()=>void;onDetails?:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),close=useRef<HTMLButtonElement>(null);
 useEffect(()=>{const before=returnFocus;dialog.current?.showModal();close.current?.focus();return()=>{dialog.current?.close();requestAnimationFrame(()=>{if(before?.isConnected)before.focus();});};},[]);
 const eligible=review.issues.filter(i=>i.canUpdate&&review.canUpdate).map(i=>i.itemId),all=eligible.length>0&&eligible.every(id=>checked.includes(id));
 return <dialog ref={dialog} aria-label="核对导出色卡" onCancel={event=>{event.preventDefault();if(!busy)onCancel();}} className="m-auto max-h-[90dvh] w-[min(94vw,940px)] max-w-none overflow-auto rounded-xl border border-slate-200 bg-white p-4 text-slate-800 shadow-xl backdrop:bg-black/40 sm:p-5">
  <header className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">核对导出色卡</h2><p className="mt-1 text-sm text-slate-500">{review.totalProducts} 个已选产品 · {review.cardCount} 张当前色卡</p></div><button ref={close} type="button" aria-label="取消核对" disabled={busy} onClick={onCancel} className="min-h-11 min-w-11 rounded border">×</button></header>
  {error&&<p role="alert" className="mt-3 rounded bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
  {!review.canUpdate&&review.issues.length>0&&<p className="mt-3 text-sm text-amber-800">当前为只读选样，请联系有编辑权限的人员确认更新。</p>}
  {review.issues.length?<>
   <p className="mt-3 text-sm">发现 {review.issues.length} 条差异，请核对后确认更新。仅更新本单关联，已选配色和历史记录保留。</p>
   <label className="my-3 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" aria-label="全选可更新条目" disabled={busy||!eligible.length} checked={all} onChange={event=>setChecked(event.target.checked?eligible:[])}/>全选可更新条目</label>
   <div className="max-h-[48dvh] overflow-y-auto rounded-lg border border-slate-200">{review.issues.map(issue=><article key={issue.itemId} className="grid min-w-0 gap-2 border-b border-slate-200 p-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
    <label className="flex min-w-0 items-start gap-2"><input type="checkbox" className="mt-1 shrink-0" aria-label={'确认更新 '+issue.productNo} disabled={busy||!review.canUpdate||!issue.canUpdate} checked={checked.includes(issue.itemId)} onChange={event=>setChecked(before=>event.target.checked?[...new Set([...before,issue.itemId])]:before.filter(id=>id!==issue.itemId))}/><span className="min-w-0 break-words text-sm font-medium">{issue.productNo}</span></label>
    <div className="min-w-0 break-words text-sm"><span className="text-xs text-slate-500">原来源</span>{issue.oldCards.filter(c=>c.cardId!==issue.currentCard?.id||c.retired).map(c=><p key={c.cardId}>{c.cardNo}{c.retired?' · 已失效':''}</p>)}{!issue.oldCards.length&&<p>未记录</p>}</div>
    <div className="min-w-0 break-words text-sm"><span className="text-xs text-slate-500">当前色卡</span><p className={issue.currentCard?'font-medium text-blue-700':'text-rose-700'}>{issue.currentCard?.cardNo??'暂无有效色卡'}</p>{issue.currentCard&&<p className="text-xs text-slate-500">{issue.currentCard.description}</p>}<p className="mt-1 text-xs text-amber-800">{issue.reason}</p></div>
   </article>)}</div>
  </>:<p role="status" className="my-5 rounded bg-emerald-50 p-4 text-sm text-emerald-800">全部差异已确认</p>}
  {review.issues.some(i=>!i.currentCard)&&<p className="mt-3 text-sm text-rose-700">无有效替代卡的条目请返回选样明细处理，再重新导出。{onDetails&&<button type="button" disabled={busy} onClick={onDetails} className="ml-2 min-h-11 underline">返回明细处理</button>}</p>}
  <footer className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" disabled={busy} onClick={onCancel} className="min-h-11 rounded border px-3 text-sm">取消</button>{review.issues.length>0&&<button type="button" disabled={busy||!checked.length||!review.canUpdate} onClick={onUpdate} className="min-h-11 rounded border border-blue-600 px-3 text-sm text-blue-700 disabled:opacity-40">确认更新所选</button>}<button type="button" disabled={busy||!!review.issues.length||!review.totalProducts} onClick={onExport} className="min-h-11 rounded bg-blue-700 px-3 text-sm text-white disabled:opacity-40">{reviewOnly?'完成核对':'导出确认结果'}</button></footer>
 </dialog>;
}
