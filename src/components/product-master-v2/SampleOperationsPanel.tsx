import {ActionIcon} from './ActionIcon';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import type {SampleSessionPage} from '../../../server/customer-samples/sessionRead';
import {createSampleSelectionClient,selectionAccessRevoked} from './sampleSelectionClient';
import {createSampleOperationsClient,shipmentInput,followupInput,type OperationKind,type SampleShipmentProgress,type OperationsHistory,type FollowupForm} from './sampleOperationsModel';
const button='rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40';
const field='mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm';
export const localDay=()=>{const now=new Date();return [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');};
const localTime=()=>localDay()+'T'+new Date().toTimeString().slice(0,5);
const emptyFollow=():FollowupForm=>({contactedOn:localDay(),customerConfirmed:'unknown',feedback:'',outcome:'',nextAction:'',nextFollowupOn:'',productIds:[]});
interface Data{selection:SampleSessionPage;progress:SampleShipmentProgress;history:OperationsHistory}
export interface SampleOperationsPanelProps{apiFetch:typeof fetch;sessionId:string;kind:OperationKind;initial?:Data;onDirtyChange?:(dirty:boolean)=>void;onBusyChange?:(busy:boolean)=>void;onAccessRevoked?:()=>void;readOnly?:boolean}
export function SampleOperationsPanel({apiFetch,sessionId,kind,initial,onDirtyChange,onBusyChange,onAccessRevoked,readOnly=false}:SampleOperationsPanelProps){
 const api=useMemo(()=>createSampleOperationsClient(apiFetch),[apiFetch]),selection=useMemo(()=>createSampleSelectionClient(apiFetch),[apiFetch]);
 const [data,setData]=useState<Data|null>(()=>initial?.selection.session.id===sessionId&&initial.progress.sessionId===sessionId&&initial.history.sessionId===sessionId?initial:null);
 const [productOffset,setProductOffset]=useState(0),[historyOffset,setHistoryOffset]=useState(0),[revision,setRevision]=useState(0);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(!data),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [time,setTime]=useState(localTime),[carrier,setCarrier]=useState(''),[tracking,setTracking]=useState(''),[quantities,setQuantities]=useState<Record<string,string>>({}),[follow,setFollow]=useState(emptyFollow);
 const scope=useRef<AbortController|null>(null),pending=useRef(false);
 const knownProducts=useRef(new Map((initial?.selection.session.id===sessionId?initial.selection.items:[]).map(item=>[item.productId,item.current])));
 const isDirty=kind==='shipments'?Boolean(carrier||tracking||Object.values(quantities).some(Boolean)):Boolean(follow.feedback||follow.outcome||follow.nextAction||follow.nextFollowupOn||follow.productIds.length||follow.customerConfirmed!=='unknown');
 const dirtyCallback=useRef(onDirtyChange);dirtyCallback.current=onDirtyChange;
 const revokedCallback=useRef(onAccessRevoked);revokedCallback.current=onAccessRevoked;
 const busyCallback=useRef(onBusyChange);busyCallback.current=onBusyChange;
 useEffect(()=>{dirtyCallback.current?.(isDirty);const prevent=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};if(isDirty)window.addEventListener('beforeunload',prevent);return()=>{window.removeEventListener('beforeunload',prevent);};},[isDirty]);
 useEffect(()=>{
  const controller=new AbortController();scope.current=controller;setData(null);setLoading(true);setError('');
  void Promise.all([selection.load(sessionId,20,productOffset,controller.signal),api.progress(sessionId,controller.signal),api.history(sessionId,kind,historyOffset,controller.signal)])
   .then(([selection,progress,history])=>{if(!controller.signal.aborted){for(const item of selection.items)knownProducts.current.set(item.productId,item.current);setData({selection,progress,history});}})
   .catch(cause=>{if(!controller.signal.aborted){setData(null);setError(selectionAccessRevoked(cause)?'无权访问此选样单，请返回列表':'读取失败，请重试');if(selectionAccessRevoked(cause)){setQuantities({});setCarrier('');setTracking('');setFollow(emptyFollow());revokedCallback.current?.();}}})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>{controller.abort();};
 },[api,selection,sessionId,kind,productOffset,historyOffset,revision]);
 async function save(event:React.FormEvent){
  event.preventDefault();if(!data||data.selection.session.status!=='open'||pending.current||loading)return;
  const controller=scope.current;if(!controller||controller.signal.aborted)return;
  pending.current=true;setBusy(true);busyCallback.current?.(true);setError('');setNotice('');
  try{
   const productIds=[...knownProducts.current.keys()];
   const input=kind==='shipments'?shipmentInput(sessionId,time,carrier,tracking,quantities,productIds):followupInput(sessionId,follow,productIds);
   await api.save(sessionId,kind,input,controller.signal);
   if(controller.signal.aborted)return;
   setNotice(kind==='shipments'?'寄样批次已保存':'跟进记录已保存');setQuantities({});setCarrier('');setTracking('');setFollow(emptyFollow());setHistoryOffset(0);setRevision(n=>n+1);
  }catch(cause){if(!controller.signal.aborted){if(selectionAccessRevoked(cause)){setData(null);setQuantities({});setFollow(emptyFollow());setError('访问权限已失效，请返回列表');revokedCallback.current?.();}else setError(cause instanceof Error&&!(cause as {status?:number}).status?cause.message:'保存未确认，请先重新读取记录后核对');}}
  finally{pending.current=false;busyCallback.current?.(false);if(!controller.signal.aborted)setBusy(false);}
 }
 const current=data?.selection.session.id===sessionId?data:null;
 if(!current)return <section aria-label={kind==='shipments'?'寄样管理':'客户跟进'} className="rounded-xl border bg-white p-5"><p role={error?'alert':'status'}>{error||(loading?'正在读取选样业务…':'正在读取选样业务…')}</p>{error&&<button className={button} onClick={()=>setRevision(n=>n+1)}><ActionIcon name="refresh"/>重新读取</button>}</section>;
 const closed=readOnly||current.selection.session.status==='closed',progress=current.progress;
 const dirty=kind==='shipments'?Object.values(quantities).some(Boolean):follow.productIds.length>0;
 return <section aria-label={kind==='shipments'?'寄样管理':'客户跟进'} className="space-y-4 rounded-xl border bg-white p-5">
  <header><h2 className="text-lg font-semibold">{kind==='shipments'?'寄样管理':'客户跟进'} · {current.selection.session.customerReference}</h2><p className="mt-2 text-sm text-slate-600">已选 {progress.selectedProducts} 款 · 已寄 {progress.shippedProducts} 款 · 待寄 {progress.pendingProducts} 款 · 累计实寄 {progress.shippedQuantity} 份</p></header>
  {notice&&<p role="status" className="text-sm text-green-800">{notice}</p>}{error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
  {closed?<p>{readOnly?'查看模式，仅可查阅记录。':'选样单已结束，仅可查阅记录。'}</p>:<form onSubmit={save} className="space-y-4" aria-label={kind==='shipments'?'登记寄样':'登记跟进'}>
   <fieldset disabled={busy||loading} className="space-y-4">
    {kind==='shipments'?<><div className="grid gap-3 sm:grid-cols-3"><label>寄样时间<input required type="datetime-local" className={field} value={time} onChange={e=>setTime(e.target.value)}/></label><label>物流公司<input maxLength={160} className={field} value={carrier} onChange={e=>setCarrier(e.target.value)}/></label><label>快递单号<input maxLength={160} className={field} value={tracking} onChange={e=>setTracking(e.target.value)}/></label></div><p className="text-sm text-slate-500">为本次寄出的产品填写数量；未填的产品保留待寄，可分批或补寄。</p></>:<div className="grid gap-3 sm:grid-cols-2"><label>联系日期<input required type="date" className={field} value={follow.contactedOn} onChange={e=>setFollow({...follow,contactedOn:e.target.value})}/></label><label>客户确认<select className={field} value={follow.customerConfirmed} onChange={e=>setFollow({...follow,customerConfirmed:e.target.value})}><option value="unknown">尚未确认</option><option value="yes">已确认</option><option value="no">未确认</option></select></label><label>反馈<textarea className={field} maxLength={2000} value={follow.feedback} onChange={e=>setFollow({...follow,feedback:e.target.value})}/></label><label>跟进结果<textarea required className={field} maxLength={400} value={follow.outcome} onChange={e=>setFollow({...follow,outcome:e.target.value})}/></label><label>下一步安排<input maxLength={400} className={field} value={follow.nextAction} onChange={e=>setFollow({...follow,nextAction:e.target.value})}/></label><label>下次跟进日期<input type="date" min={follow.contactedOn} className={field} value={follow.nextFollowupOn} onChange={e=>setFollow({...follow,nextFollowupOn:e.target.value})}/></label></div>}
    <div className="overflow-x-auto rounded border"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-2">货号</th><th className="p-2">品名</th><th className="p-2">{kind==='shipments'?'寄样数量':'关联产品（可选）'}</th></tr></thead><tbody>{current.selection.items.map(item=><tr key={item.productId} className="border-t"><td className="p-2">{item.current.productNo}</td><td className="p-2">{item.current.fabricName}</td><td className="p-2">{kind==='shipments'?<input aria-label={'寄样数量 '+item.current.productNo} className="w-24 rounded border p-2" inputMode="numeric" value={quantities[item.productId]??''} onChange={e=>setQuantities({...quantities,[item.productId]:e.target.value})}/>:<input type="checkbox" aria-label={'关联 '+item.current.productNo} checked={follow.productIds.includes(item.productId)} onChange={e=>setFollow({...follow,productIds:e.target.checked?[...follow.productIds,item.productId]:follow.productIds.filter(id=>id!==item.productId)})}/>}</td></tr>)}</tbody></table>{!current.selection.items.length&&<p className="p-3 text-sm text-slate-500">暂无已选产品，请先从色卡加入。</p>}</div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>选样产品共 {current.selection.total} 款 · 本次 {kind==='shipments'?Object.values(quantities).filter(Boolean).length:follow.productIds.length} 款，翻页保留选择</span><div className="flex gap-2"><button type="button" className={button} disabled={productOffset===0} onClick={()=>setProductOffset(n=>Math.max(0,n-20))}><ActionIcon name="back"/>上一页产品</button><button type="button" className={button} disabled={productOffset+20>=current.selection.total} onClick={()=>setProductOffset(n=>n+20)}><ActionIcon name="next"/>下一页产品</button>{dirty&&<button type="button" className={button} onClick={()=>{setQuantities({});setFollow({...follow,productIds:[]});}}><ActionIcon name="reset"/>清除产品选择</button>}</div></div>
    <button type="submit" className="rounded bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-40" disabled={kind==='shipments'&&!Object.values(quantities).some(Boolean)}><ActionIcon name="save"/>{busy?'正在保存…':kind==='shipments'?'保存寄样批次':'保存跟进记录'}</button>
   </fieldset>
  </form>}
  <section className="space-y-3 border-t pt-4" aria-label={kind==='shipments'?'寄样历史':'跟进历史'}><h3 className="font-medium">{kind==='shipments'?'寄样历史':'跟进历史'}</h3>
   {!current.history.items.length&&<p className="text-sm text-slate-500">暂无记录</p>}
   {current.history.items.map(item=><article key={item.id} className="rounded border p-3 text-sm">{'shippedAt' in item?<><p>{new Date(item.shippedAt).toLocaleString()} · {item.carrier||'未登记物流'} · {item.trackingNo||'未登记单号'}</p><ul className="mt-2 space-y-1">{item.items.map(line=><li key={line.productId}>产品 {line.productId} · {line.quantity} 份</li>)}</ul></>:<><p>{item.contactedOn} · 客户{item.customerConfirmed===null?'尚未确认':item.customerConfirmed?'已确认':'未确认'}</p><p className="mt-2 whitespace-pre-wrap">{item.outcome}</p>{item.feedback&&<p className="mt-1 whitespace-pre-wrap">反馈：{item.feedback}</p>}{item.nextAction&&<p>下一步：{item.nextAction}</p>}{item.nextFollowupOn&&<p>下次跟进：{item.nextFollowupOn}</p>}{item.productIds.length>0&&<p>关联产品：{item.productIds.join('、')}</p>}</>}</article>)}
   <div className="flex items-center justify-between text-sm"><span>共 {current.history.total} 条记录</span><div className="flex gap-2"><button className={button} disabled={busy||loading||historyOffset===0} onClick={()=>setHistoryOffset(n=>Math.max(0,n-20))}><ActionIcon name="back"/>上一页记录</button><button className={button} disabled={busy||loading||historyOffset+20>=current.history.total} onClick={()=>setHistoryOffset(n=>n+20)}><ActionIcon name="next"/>下一页记录</button></div></div>
  </section>
 </section>;
}
