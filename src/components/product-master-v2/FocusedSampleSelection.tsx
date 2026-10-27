import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ActionIcon} from './ActionIcon';
import {CardPhotoInput} from './CardPhotoInput';
import {createSampleOperationsClient,type SampleSessionSummary} from './sampleOperationsModel';
import {createSampleSelectionClient,selectionAccessRevoked} from './sampleSelectionClient';
import {resolveImageUrls} from './catalogModel';
import type {CatalogImageResolver} from './ProductImageTabs';
import {loadScanSelection,scanFabricDescription,type ScanSelectionCard,type ScanSelectionData} from './scanSelectionModel';
import {searchManualCards,type SelectionCard} from './manualSelectionModel';
import {ManualSelectionPane} from './ManualSelectionPane';
import {useV2LeaveProtection,useV2DiscardGuard} from './useV2LeaveProtection';
import type {RegisterSampleLeaveGuard} from './SampleBusinessWorkspaceV2';
const button='inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-blue-600';
type Undo={cardId:string;productIds:string[]};
function Thumbnail({url,label}:{url?:string;label:string}){
 const [broken,setBroken]=useState(false);useEffect(()=>setBroken(false),[url]);
 return url&&!broken?<img src={url} alt={label} onError={()=>setBroken(true)} loading="lazy" className="aspect-square w-full rounded-md bg-slate-50 object-contain"/>:<span className="flex aspect-square w-full items-center justify-center rounded-md bg-slate-100 text-xs text-slate-400">{broken?'图片加载失败':'暂无图片'}</span>;
}
export function FocusedSampleSelection({session,apiFetch,initialCardToken,onFinish,onDetails,onRegisterLeaveGuard,resolveImages}:{resolveImages?:CatalogImageResolver;session:SampleSessionSummary;apiFetch:typeof fetch;initialCardToken?:string;onFinish():void;onDetails?:()=>void;onRegisterLeaveGuard?:RegisterSampleLeaveGuard}){
 const selection=useMemo(()=>createSampleSelectionClient(apiFetch),[apiFetch]),operations=useMemo(()=>createSampleOperationsClient(apiFetch),[apiFetch]);
 const [data,setData]=useState<ScanSelectionData|null>(null),[busy,setBusy]=useState(false),[photoBusy,setPhotoBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revoked,setRevoked]=useState(false),[retry,setRetry]=useState(0);
 const [urls,setUrls]=useState(new Map<string,string>()),[imageError,setImageError]=useState(false),[imageRetry,setImageRetry]=useState(0),[draft,setDraft]=useState(new Map<string,boolean>()),[hidden,setHidden]=useState<string[]>([]),[undo,setUndo]=useState<Undo|null>(null),[newest,setNewest]=useState(''),[token,setToken]=useState('');
 const [manualOpen,setManualOpen]=useState(false);
 const searchManual=useCallback((filters:Parameters<typeof searchManualCards>[1],signal?:AbortSignal)=>searchManualCards(apiFetch,filters,signal),[apiFetch]);
 const resolveThumbnails=useCallback((ids:string[],signal?:AbortSignal)=>resolveImages?resolveImages(ids,'thumbnail',signal):resolveImageUrls(apiFetch,ids,'thumbnail',signal),[apiFetch,resolveImages]);
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{heading.current?.focus();},[session.id]);
 const scope=useRef(new AbortController()),locked=useRef(false),pending=useRef<null|(()=>Promise<void>)>(null),incoming=useRef('');
 useV2LeaveProtection(draft.size>0||pending.current!==null,busy||photoBusy);
 const canLeave=useV2DiscardGuard(draft.size>0||pending.current!==null,busy||photoBusy,{title:'离开未保存的选样？',message:'未保存的选择尚未确认，请先重试保存。已保存的选样会保留。'});
 useEffect(()=>{onRegisterLeaveGuard?.(canLeave);return()=>onRegisterLeaveGuard?.(null);},[onRegisterLeaveGuard,canLeave]);
 useEffect(()=>{const c=new AbortController();scope.current=c;setData(null);setError('');
  void loadScanSelection(apiFetch,session.id,c.signal).then(v=>{if(!c.signal.aborted)setData({...v,cards:v.cards.filter(card=>card.products.some(p=>v.items.some(i=>i.productId===p.id)))});}).catch(e=>{if(!c.signal.aborted){if(selectionAccessRevoked(e))setRevoked(true);setError('选样读取失败，请重试');}});return()=>c.abort();
 },[apiFetch,session.id,retry]);
 useEffect(()=>{
  const c=new AbortController();setUrls(new Map());setImageError(false);
  const ids=[...new Set(data?.cards.flatMap(card=>card.products.map(p=>p.patternImageAssetId).filter((id):id is string=>!!id))??[])];
  void (async()=>{const all=new Map<string,string>();for(let offset=0;offset<ids.length;offset+=100){const part=await (resolveImages?resolveImages(ids.slice(offset,offset+100),'thumbnail',c.signal):resolveImageUrls(apiFetch,ids.slice(offset,offset+100),'thumbnail',c.signal));part.forEach((url,id)=>all.set(id,url));}if(!c.signal.aborted)setUrls(all);})().catch(()=>{if(!c.signal.aborted)setImageError(true);});return()=>c.abort();
 },[apiFetch,resolveImages,data,imageRetry]);
 function revoke(){setRevoked(true);setData(null);setUrls(new Map());setDraft(new Map());setManualOpen(false);setNotice('');pending.current=null;}
 const readOnly=!!data&&(data.session.canManage===false);
 async function mutate(action:()=>Promise<void>){
  if(locked.current||revoked||readOnly||scope.current.signal.aborted)return false;
  locked.current=true;setBusy(true);setError('');pending.current=action;
  try{await action();const latest=await loadScanSelection(apiFetch,session.id,scope.current.signal);if(!scope.current.signal.aborted){setData(latest);setDraft(new Map());pending.current=null;return true;}return false;}
  catch(e){if(!scope.current.signal.aborted){
   setNotice('');const status=(e as {status?:number}).status;
   if(status===401||status===403)revoke();
   else if(status===404){
    // A card can be missing, but session authorization is also deliberately masked as 404.
    // Hide cached private data while independently checking the session before restoring it.
    setData(null);setUrls(new Map());setDraft(new Map());pending.current=null;
    try{const latest=await loadScanSelection(apiFetch,session.id,scope.current.signal);if(!scope.current.signal.aborted){setData(latest);setError('色卡或选样已变更，请核对后重新扫码。');}}
    catch{if(!scope.current.signal.aborted)revoke();}
   }else if(status===400){pending.current=null;setDraft(new Map());setError('色卡编码无效，请核对后重新扫码。');}
   else setError('保存未确认，当前选择已保留，请重试。');
  }return false;}
  finally{locked.current=false;if(!scope.current.signal.aborted)setBusy(false);}
 }
 function scan(value:string){
  if(!value.trim()||locked.current||pending.current||!data)return;
  void mutate(async()=>{const result=await operations.scan(session.id,value.trim(),scope.current.signal);setNewest(result.cardId);setHidden(before=>before.filter(id=>id!==result.cardId));setToken('');setNotice(result.addedProductIds.length?'已加入 '+result.addedProductIds.length+' 个配色':'已选过，保留原有配色选择');});
 }
 useEffect(()=>{if(data&&initialCardToken&&incoming.current!==initialCardToken&&!locked.current&&!pending.current&&!readOnly){incoming.current=initialCardToken;scan(initialCardToken);}},[data,initialCardToken,readOnly]); // scan is gated by the session-local lock.
 function toggle(card:ScanSelectionCard,productId:string){
  if(locked.current||pending.current||photoBusy)return;
  const item=data?.items.find(i=>i.productId===productId),checked=draft.get(productId)??!!item;
  setDraft(new Map([[productId,!checked]]));setNotice('');
  void mutate(async()=>{if(checked&&item)await selection.remove(session.id,item.id);else await selection.addManual(session.id,card.id,[productId]);});
 }
 function removeCard(card:ScanSelectionCard){
  if(locked.current||pending.current)return;
  const ids=card.products.filter(p=>data?.items.some(i=>i.productId===p.id)).map(p=>p.id);
  if(!ids.length){setHidden(before=>[...before,card.id]);return;}
  setDraft(new Map(ids.map(id=>[id,false])));
  void mutate(async()=>{await selection.removeCards(session.id,[card.id]);setHidden(before=>[...new Set([...before,card.id])]);setUndo({cardId:card.id,productIds:ids});setNotice('已移除此色卡');});
 }
 function restore(){const value=undo;if(!value||locked.current||pending.current)return;void mutate(async()=>{await selection.addManual(session.id,value.cardId,value.productIds);setHidden(before=>before.filter(id=>id!==value.cardId));setNewest(value.cardId);setUndo(null);setNotice('已撤销移除');});}
 async function addManual(card:SelectionCard,productIds?:string[]){
  if(!productIds?.length)return false;
  return mutate(async()=>{await selection.addManual(session.id,card.id,productIds);setNewest(card.id);setHidden(before=>before.filter(id=>id!==card.id));setNotice('已加入所选配色');});
 }
 const checked=(id:string)=>draft.get(id)??!!data?.items.some(i=>i.productId===id);
 const selectedProducts=new Set(data?.items.map(i=>i.productId)??[]);draft.forEach((on,id)=>on?selectedProducts.add(id):selectedProducts.delete(id));
 const selectedCards=data?.cards.filter(c=>c.products.some(p=>selectedProducts.has(p.id))).length??0;
 const blocked=busy||photoBusy||!!pending.current||!data||readOnly||revoked;
 const cards=[...(data?.cards??[])].sort((a,b)=>a.id===newest?-1:b.id===newest?1:0).filter(c=>!hidden.includes(c.id));
 if(revoked)return <section className="p-4"><p role="alert">当前选样不可访问，请重新登录或检查权限。</p><button type="button" className={button} onClick={onFinish}>返回客户选样</button></section>;
 return <section aria-label="扫码选样" className="mx-auto max-w-4xl space-y-4 p-1 pb-32 text-slate-800 sm:p-6 sm:pb-32">
  <header className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-slate-500">正在为客户选样</p><h2 ref={heading} tabIndex={-1} className="mt-1 break-words text-xl font-semibold outline-none">{data?.session.customerReference??(busy?'正在核对选样…':session.customerReference)}</h2></div>{onDetails&&<details className="relative shrink-0 text-sm"><summary className="cursor-pointer rounded-lg px-3 py-2 text-slate-500">更多</summary><button type="button" disabled={blocked} className={button+' absolute right-0 z-10 w-28 shadow-sm'} onClick={()=>void canLeave().then(ok=>{if(ok)onDetails();})}>产品反馈</button></details>}</header>
  <p role="status" className="text-xs text-slate-500">{busy?'保存中…':error?'尚未保存':data?'已自动保存':'正在读取选样…'}</p>
  {readOnly&&<p role="status" className="rounded-lg bg-amber-50 p-3 text-sm">当前选样只读，已保留选样内容。</p>}
  {error&&<div role="alert" className="flex items-center justify-between gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-700"><span>{error}</span><button type="button" disabled={busy} className="min-h-11 shrink-0 rounded px-2 underline" onClick={()=>pending.current?void mutate(pending.current):setRetry(n=>n+1)}>重试保存</button></div>}
  {notice&&<p role="status" className="flex items-center gap-3 text-sm text-blue-700">{notice}{undo&&<button type="button" className="min-h-11 underline" disabled={blocked} onClick={restore}>撤销移除</button>}</p>}
  {imageError&&<p role="alert" className="text-xs text-amber-800">缩略图读取失败，配色选择已保留。<button type="button" className="min-h-11 px-2 underline" onClick={()=>setImageRetry(n=>n+1)}>重试图片</button></p>}
  {data&&!cards.length&&<div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center"><p className="font-medium">开始扫描色卡</p><p className="mt-2 text-sm text-slate-500">扫码后自动加入全部配色，点配色可取消或恢复。</p></div>}
  {cards.map(card=><article key={card.id} aria-label={'已加入色卡 '+card.cardNo} className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
   <header className="flex items-center justify-between gap-2"><h3 className="min-w-0 break-all font-semibold">{card.cardNo}</h3><div className="flex shrink-0 items-center gap-2"><span className="text-xs text-slate-500">已选 {card.products.filter(p=>checked(p.id)).length}/{card.products.length}</span><button type="button" aria-label={'移除色卡 '+card.cardNo} disabled={blocked} onClick={()=>removeCard(card)} className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-700"><ActionIcon name="delete"/></button></div></header>
   <p className="mb-3 overflow-x-auto whitespace-nowrap pb-1 text-xs text-slate-500">{scanFabricDescription(card)}</p>
   {card.retired&&<p className="mb-2 text-xs text-amber-800">色卡已失效，保留原选样。</p>}
   <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">{card.products.map(product=>{const on=checked(product.id);return <button key={product.id} type="button" role="checkbox" aria-label={'配色 '+product.patternNo} title={product.productNo} aria-checked={on} aria-disabled={blocked||card.retired&&!on} disabled={readOnly||revoked||card.retired&&!on} onClick={()=>{if(!blocked)toggle(card,product.id);}} className={'relative min-w-0 rounded-lg border-2 p-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 '+(on?'border-blue-600 bg-blue-50/40':'border-slate-200 bg-white')+' disabled:cursor-default'}>
    <Thumbnail label={'花型 '+product.patternNo} url={product.patternImageAssetId?urls.get(product.patternImageAssetId):undefined}/>
    <span aria-hidden="true" className={'absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border text-xs '+(on?'border-blue-600 bg-blue-600 text-white':'border-slate-300 bg-white')}>{on?'✓':''}</span>
    <span className="mt-2 block break-all text-xs font-medium">{product.patternNo}</span>
   </button>;})}</div>
  </article>)}
  {!readOnly&&<details className="rounded-lg text-sm"><summary className="cursor-pointer py-3 text-slate-500">其他添加方式</summary><div className="space-y-3 rounded-lg border bg-white p-3">
   <form className="flex gap-2" onSubmit={e=>{e.preventDefault();scan(token);}}><input aria-label="输入色卡编码" placeholder="粘贴色卡编码或扫码链接" className="min-h-11 min-w-0 flex-1 rounded border px-3 text-sm" value={token} disabled={blocked} onChange={e=>setToken(e.target.value)} maxLength={1024}/><button className={button} disabled={blocked||!token.trim()}>加入</button></form>
   <button type="button" className={button} disabled={blocked} onClick={()=>setManualOpen(true)}>搜索色卡并选择配色</button>
   {manualOpen&&<ManualSelectionPane sessionId={session.id} search={searchManual} add={addManual} resolveThumbnails={resolveThumbnails} disabled={blocked} customerReference={data?.session.customerReference} onAccessLost={revoke} onClose={()=>setManualOpen(false)}/>}
  </div></details>}
  <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_16px_rgba(15,23,42,0.04)] sm:sticky sm:inset-x-auto sm:rounded-xl sm:border">
   <p className="mb-2 text-xs text-slate-500">已选 <strong className="text-slate-800">{selectedCards}</strong> 张色卡 · <strong className="text-slate-800">{selectedProducts.size}</strong> 个配色</p><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><CardPhotoInput compact label="继续扫码" disabled={busy||!!pending.current||!data||readOnly||revoked} onBusyChange={setPhotoBusy} onDecoded={scan}/></div><button type="button" className={button+' shrink-0'} disabled={busy||photoBusy||!!pending.current||!data} onClick={onFinish}>完成选样</button></div>
  </footer>
 </section>;
}
