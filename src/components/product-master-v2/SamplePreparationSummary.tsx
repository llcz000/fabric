import React,{useEffect,useRef,useState} from 'react';
import type {PreparationSummary} from '../../../server/customer-samples/sessionPreparation';
import type {CatalogImageResolver} from './ProductImageTabs';
import {fetchPreparationSummary} from './samplePreparationModel';
import {selectionAccessRevoked,SelectionHttpError} from './sampleSelectionClient';
import {SampleBatchBlocked} from './sampleSessionExport';
import {resolveSelectionThumbnails} from './selectedCardModel';
import {SamplePatternThumbnail} from './SamplePatternThumbnail';

interface Props{apiFetch:typeof fetch;sessionIds:string[];resolveImages?:CatalogImageResolver;onClose:()=>void;onAccessLost:()=>void;onBlocked:(error:SampleBatchBlocked)=>void}
const button='v2-business-button v2-business-touch';
const pageSize=20;
export function SamplePreparationSummary({apiFetch,sessionIds,resolveImages,onClose,onAccessLost,onBlocked}:Props){
 const [data,setData]=useState<PreparationSummary|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[offset,setOffset]=useState(0);
 const heading=useRef<HTMLHeadingElement>(null),callbacks=useRef({onAccessLost,onBlocked});callbacks.current={onAccessLost,onBlocked};
 const identity=JSON.stringify(sessionIds);
 useEffect(()=>{heading.current?.focus();},[]);
 useEffect(()=>{const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();onClose();}};document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);},[onClose]);
 useEffect(()=>{
  const c=new AbortController();setData(null);setError('');setOffset(0);
  void fetchPreparationSummary(apiFetch,JSON.parse(identity),c.signal).then(result=>{if(!c.signal.aborted)setData(result);}).catch(e=>{
   if(c.signal.aborted)return;
   if(e instanceof SampleBatchBlocked)callbacks.current.onBlocked(e);
   else if(selectionAccessRevoked(e))callbacks.current.onAccessLost();
   else setError('汇总读取失败，已保留勾选，请重试');
  });return()=>c.abort();
 },[apiFetch,identity,revision]);
 const visible=data?.rows.slice(offset,offset+pageSize)??[],assetIds=[...new Set(visible.map(row=>row.patternImageAssetId).filter((id):id is string=>!!id))],assetKey=JSON.stringify(assetIds);
 const [images,setImages]=useState<{key:string;urls:Map<string,string>;failed:Set<string>;pending:boolean}>({key:'',urls:new Map(),failed:new Set(),pending:false});
 useEffect(()=>{
  const c=new AbortController(),ids:string[]=JSON.parse(assetKey);setImages({key:assetKey,urls:new Map(),failed:new Set(),pending:!!ids.length&&!!resolveImages});
  if(ids.length&&resolveImages)void resolveSelectionThumbnails(ids,(ids,signal)=>resolveImages(ids,'thumbnail',signal),c.signal).then(result=>{if(!c.signal.aborted)setImages({key:assetKey,...result,pending:false});}).catch(e=>{
   if(c.signal.aborted)return;if((e as {status?:number}).status===401)callbacks.current.onAccessLost();else setImages({key:assetKey,urls:new Map(),failed:new Set(ids),pending:false});
  });return()=>c.abort();
 },[assetKey,resolveImages]);
 const currentImages=images.key===assetKey?images:null;
 async function reload(id:string,signal:AbortSignal){
  try{return (await resolveImages?.([id],'thumbnail',signal))?.get(id);}catch(e){if(!signal.aborted&&(e as SelectionHttpError).status===401)callbacks.current.onAccessLost();throw e;}
 }
 return <section className="mx-auto max-w-5xl space-y-3 p-3 sm:p-5" aria-label="备样汇总">
  <header className="flex items-center gap-3"><button type="button" className={button} onClick={onClose}>返回客户选样</button><h2 ref={heading} tabIndex={-1} className="text-base font-semibold">备样汇总</h2></header>
  {!data&&!error&&<p role="status">正在汇总…</p>}
  {error&&<div role="alert" className="text-sm text-red-700">{error} <button type="button" className={button} onClick={()=>setRevision(n=>n+1)}>重试</button></div>}
  {data&&!data.rows.length&&<p className="text-sm text-slate-600">所选单据暂无可汇总的配色</p>}
  {data&&data.rows.length>0&&<>
   <table className="v2-preparation-table"><thead><tr><th scope="col">色卡编号</th><th scope="col">配色缩略图</th><th scope="col">份数</th><th scope="col">客户／联系人</th></tr></thead><tbody>
    {visible.map(row=><tr key={row.cardId+':'+row.productId} data-preparation-row>
     <td data-preparation-card>{row.cardNo}</td>
     <td data-preparation-image><SamplePatternThumbnail assetId={row.patternImageAssetId} url={row.patternImageAssetId?currentImages?.urls.get(row.patternImageAssetId):undefined} label={row.patternNo} pending={currentImages?.pending} failed={!!row.patternImageAssetId&&!!currentImages?.failed.has(row.patternImageAssetId)} reload={resolveImages&&row.patternImageAssetId?signal=>reload(row.patternImageAssetId!,signal):undefined}/><span className="v2-preparation-pattern">{row.patternNo}</span></td>
     <td data-preparation-quantity><span className="v2-preparation-mobile-label">份数</span><strong>{row.quantity}</strong></td>
     <td data-preparation-recipients>{row.recipients.map((person,index)=><div key={index}>{person.customerName}／{person.contactName??'未指定'}</div>)}</td>
    </tr>)}
   </tbody></table>
   {data.rows.length>pageSize&&<nav aria-label="汇总分页" className="flex items-center justify-between gap-2 text-sm"><span>{offset+1}–{Math.min(offset+pageSize,data.rows.length)} / {data.rows.length}</span><div className="flex gap-2"><button type="button" className={button} disabled={!offset} onClick={()=>setOffset(n=>Math.max(0,n-pageSize))}>上一页</button><button type="button" className={button} disabled={offset+pageSize>=data.rows.length} onClick={()=>setOffset(n=>n+pageSize)}>下一页</button></div></nav>}
  </>}
 </section>;
}
