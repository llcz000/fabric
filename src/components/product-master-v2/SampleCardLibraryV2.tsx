import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import QRCode from 'qrcode';
import type {PatternMasterItem} from './patternModel';
import type {FabricCatalogItem} from './fabricModel';
import {resolveImageUrls} from './catalogModel';
import {
 SampleCardDraftController,makeSampleCardDraftController,fetchSampleCardPage,
 createSampleCard,exportSampleCards,retireSampleCard,confirmSampleCardReprinted,toggleCardSelection,setPageSelection,
 type SampleCard,type SampleCardPage
} from './sampleCardModel';
const border='rounded-lg border border-[#c3c6d7] bg-white';
const button='rounded border border-[#c3c6d7] px-3 py-1.5 text-xs disabled:opacity-40';
const blue=button+' border-[#346ef6] bg-[#346ef6] text-white';
const field='h-8 w-full rounded border border-[#c3c6d7] bg-[#fbfcfd] px-2 text-xs focus:outline-[#346ef6]';
export type SampleCardQrRenderer=React.ComponentType<{payload:string;size?:number}>;
/** Byte mode preserves the server's exact string; SVG and decoder tests use this same matrix. */
export function createCardQrMatrix(payload:string){
 if(!payload)throw Error('二维码编码文本为空');
 const modules=QRCode.create([{data:new TextEncoder().encode(payload),mode:'byte'}],{errorCorrectionLevel:'M'}).modules;
 return {size:modules.size,get:(x:number,y:number)=>Boolean(modules.get(y,x))};
}
export function SampleCardQr({payload,size=52}:{payload:string;size?:number}){
 try{
  const matrix=createCardQrMatrix(payload),margin=4,dimension=matrix.size+margin*2;
  const path:string[]=[];
  for(let y=0;y<matrix.size;y++)for(let x=0;x<matrix.size;x++)if(matrix.get(x,y))path.push('M'+(x+margin)+' '+(y+margin)+'h1v1h-1z');
  return <svg width={size} height={size} viewBox={'0 0 '+dimension+' '+dimension}
   shapeRendering="crispEdges" role="img" aria-label="色卡二维码" data-qr-payload={payload}>
   <rect width={dimension} height={dimension} fill="#fff"/><path d={path.join('')} fill="#000"/>
  </svg>;
 }catch{return <span role="alert" className="text-[10px] text-rose-700">二维码生成失败</span>;}
}
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
      className="w-full border-t p-2 text-xs text-[#0053da]">加载更多候选</button>:null}
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
    <h2 className="text-sm font-semibold">新增色卡</h2><button type="button" disabled={busy} aria-label="关闭新增色卡" onClick={close}>×</button>
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
     <QrRenderer payload={state.createdCard.qrPayload} size={128}/><span className="text-xs">色卡已就绪：{state.createdCard.cardNo}</span>
    </div>:null}
    {error?<p role="alert" className="text-xs text-rose-700">{error}</p>:null}
   </div>
   <footer className="flex justify-end gap-2 border-t border-[#c3c6d7] bg-[#fbfcfd] px-4 py-3">
    <button type="button" disabled={busy} onClick={close} className={button}>{state.createdCard?'关闭':'取消'}</button>
    <button type="button" disabled={busy||!controller.cardNo||Boolean(state.createdCard)} onClick={()=>void submit()} className={blue}>
     {busy?'生成中…':'生成色卡'}</button>
   </footer>
  </div>
 </div>;
}
export function SampleCardTable({page,selectedIds,onToggle,onPageAll,onPage,onConfirmReprinted,onRetire,QrRenderer=SampleCardQr,busy=false}:{
 page:SampleCardPage;selectedIds:readonly string[];onToggle(id:string,selected:boolean):void;
 onPageAll(selected:boolean):void;onPage(offset:number):void;
 onConfirmReprinted?(card:SampleCard):void;onRetire?(card:SampleCard):void;
 QrRenderer?:SampleCardQrRenderer;busy?:boolean;
}){
 const all=page.items.length>0&&page.items.every(c=>selectedIds.includes(c.id));
 return <section className={border+' overflow-hidden'}>
  <div className="overflow-x-auto" role="region" aria-label="色卡列表，可横向滚动" tabIndex={0}>
   <table className="w-full min-w-[880px] border-collapse text-left text-xs">
    <thead className="border-b border-[#c3c6d7] bg-[#fbfcfd]"><tr>
     <th className="w-10 px-3 py-2.5"><input type="checkbox" aria-label="选择本页色卡" checked={all}
      disabled={busy||!page.items.length} onChange={e=>onPageAll(e.target.checked)}/></th>
     {['色卡编号','品名','成分','克重','门幅','二维码'].map((title,i)=><th scope="col" key={title} className={'px-3 py-2.5 font-semibold '+(i===5?'text-center':'')}>{title}</th>)}
     <th scope="col" className="whitespace-nowrap px-3 py-2.5 font-semibold">操作</th>
    </tr></thead>
    <tbody>{page.items.map(c=><tr key={c.id} data-qr-payload={c.qrPayload} className="border-b border-[#e2e8f0] last:border-0 hover:bg-[#fbfcfd]">
     <td className="px-3 py-3"><input type="checkbox" aria-label={'选择色卡 '+c.cardNo} checked={selectedIds.includes(c.id)}
      disabled={busy} onChange={e=>onToggle(c.id,e.target.checked)}/></td>
     <td className="px-3 py-3"><div className="font-mono font-semibold text-[#0053da]">{c.cardNo}</div>
      {c.needsReprint===true?<span className="mt-1 inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">需重新打印</span>:null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
       {c.needsReprint===true&&onConfirmReprinted?<button type="button" disabled={busy} className="text-xs text-[#0053da] hover:underline disabled:opacity-50"
        aria-label={'标记已重新打印 '+c.cardNo} onClick={()=>onConfirmReprinted(c)}>标记已重新打印</button>:null}
      </div>
     </td><td className="px-3 py-3">{c.description}</td>
     <td className="px-3 py-3">{c.composition||'—'}</td><td className="whitespace-nowrap px-3 py-3">{c.weightValue===null?'—':c.weightValue+' '+c.weightUnit}</td>
     <td className="whitespace-nowrap px-3 py-3">{c.widthValue===null?'—':c.widthValue+' cm'}</td>
     <td className="px-3 py-3 text-center"><span className="inline-flex rounded border border-[#c3c6d7] bg-white p-1"><QrRenderer payload={c.qrPayload}/></span></td>
     <td className="whitespace-nowrap px-3 py-3">
      {onRetire?<button type="button" disabled={busy} className="text-xs text-rose-700 hover:underline disabled:opacity-50"
       aria-label={'删除色卡 '+c.cardNo} onClick={()=>onRetire(c)}>删除色卡</button>:null}
     </td>
    </tr>)}</tbody>
   </table>
   {!page.items.length?<p className="py-12 text-center text-xs text-slate-500">{busy?'加载中…':'没有匹配的色卡'}</p>:null}
  </div>
  <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#c3c6d7] bg-[#fbfcfd] px-4 py-3 text-[11px] text-slate-500">
   <p>勾选所需色卡导出六列Excel，二维码列为该卡二维码的原始编码文本。</p>
   <div className="flex items-center gap-3"><span>共 {page.total} 张色卡 · 页码 {Math.floor(page.offset/page.limit)+1}/{Math.max(1,Math.ceil(page.total/page.limit))}</span>
    <button type="button" className={button} disabled={busy||page.offset===0} onClick={()=>onPage(Math.max(0,page.offset-page.limit))}>上一页</button>
    <button type="button" className={button} disabled={busy||page.offset+page.limit>=page.total} onClick={()=>onPage(page.offset+page.limit)}>下一页</button>
   </div>
  </footer>
 </section>;
}
export interface SampleCardLibraryV2Props{
 apiFetch:typeof fetch;QrRenderer?:SampleCardQrRenderer;
 resolvePatternImages?(assetIds:string[],signal?:AbortSignal):Promise<Map<string,string>>;
 onDownload?(blob:Blob,filename:string):void;
}
function download(blob:Blob,filename:string){
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
/** Standalone page. Assembly must supply the existing authenticated fetch; server still authorizes every call. */
export function SampleCardLibraryV2({apiFetch,QrRenderer=SampleCardQr,resolvePatternImages,onDownload=download}:SampleCardLibraryV2Props){
 const [query,setQuery]=useState(''),[offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0);
 const [needsReprint,setNeedsReprint]=useState(false),[acting,setActing]=useState(false);
 const [page,setPage]=useState<SampleCardPage>({items:[],total:0,limit:50,offset:0});
 const [selectedIds,setSelectedIds]=useState<string[]>([]),[busy,setBusy]=useState(false),[exporting,setExporting]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [controller,setController]=useState<SampleCardDraftController|null>(null),[draftSnapshot,setDraftSnapshot]=useState(controller?.state);
 const [imageUrls,setImageUrls]=useState<Map<string,string>>(new Map()),request=useRef(0);
 useEffect(()=>{
  const epoch=++request.current,abort=new AbortController();setBusy(true);setError('');
  // Clear prior rows when changing filters so a late click cannot select invisible stale results.
  setPage({items:[],total:0,limit:50,offset});
  void fetchSampleCardPage(apiFetch,query,offset,50,abort.signal,needsReprint).then(p=>{
   if(epoch===request.current){setPage(p);setBusy(false);}
  }).catch(e=>{if(epoch===request.current&&!abort.signal.aborted){setError(e instanceof Error?e.message:'加载失败');setBusy(false);}});
  return ()=>{abort.abort();request.current++;};
 },[apiFetch,query,offset,needsReprint,refresh]);
 useEffect(()=>{
  if(!controller){setDraftSnapshot(undefined);return;}
  setDraftSnapshot(controller.state);return controller.subscribe(()=>setDraftSnapshot(controller.state));
 },[controller]);
 useEffect(()=>{
  const abort=new AbortController();let active=true;setImageUrls(new Map());
  const ids=[...new Set((draftSnapshot?.versions??[]).map(v=>v.patternImageAssetId).filter((x):x is string=>Boolean(x)))];
  if(!ids.length)return ()=>{active=false;abort.abort();};
  void (async()=>{
   const urls=new Map<string,string>();
   for(let i=0;i<ids.length;i+=100){
    const chunk=ids.slice(i,i+100),result=await (resolvePatternImages?resolvePatternImages(chunk,abort.signal):resolveImageUrls(apiFetch,chunk,'thumbnail',abort.signal));
    result.forEach((url,id)=>urls.set(id,url));
   }
   if(active)setImageUrls(urls);
  })().catch(()=>{if(active)setImageUrls(new Map());});
  return ()=>{active=false;abort.abort();};
 },[apiFetch,resolvePatternImages,draftSnapshot?.versions]);
 const close=()=>{controller?.dispose();setController(null);setImageUrls(new Map());};
 const create=async()=>{
  if(!controller)return;
  const result=await createSampleCard(apiFetch,controller.state.master,controller.state.fabric);
  setNotice(result.created?'已生成色卡 '+result.card.cardNo:'已复用现有色卡 '+result.card.cardNo);close();setOffset(0);setQuery('');setNeedsReprint(false);setRefresh(x=>x+1);
 };
 const markPrinted=async(card:SampleCard)=>{
  if(acting||!card.needsReprint)return;
  setActing(true);setError('');
  try{await confirmSampleCardReprinted(apiFetch,card);setNotice('已标记重新打印：'+card.cardNo);setRefresh(x=>x+1);}
  catch(e){setError(e instanceof Error?e.message:'操作失败，请刷新后重试');setRefresh(x=>x+1);}
  finally{setActing(false);}
 };
 const retire=async(card:SampleCard)=>{
  if(acting||!window.confirm('删除色卡 '+card.cardNo+'？旧二维码将永久作废，历史选样记录会保留。'))return;
  setActing(true);setError('');
  try{await retireSampleCard(apiFetch,card.id);setSelectedIds(x=>x.filter(id=>id!==card.id));setNotice('色卡已删除，旧二维码永久作废：'+card.cardNo);setOffset(0);setRefresh(x=>x+1);}
  catch(e){setError(e instanceof Error?e.message:'删除失败，请重试');}
  finally{setActing(false);}
 };
 const exportSelected=async()=>{
  if(exporting||!selectedIds.length)return;setExporting(true);setError('');
  const exactIds=[...selectedIds];
  try{onDownload(await exportSampleCards(apiFetch,exactIds),'sample-cards.xlsx');setNotice('已导出 '+exactIds.length+' 张所选色卡');}
  catch(e){setError(e instanceof Error?e.message:'导出失败');}finally{setExporting(false);}
 };
 return <main className="mx-auto flex max-w-[1440px] flex-col gap-3 p-4 text-[#191b24]">
  <header className={border+' flex flex-wrap items-center justify-between gap-3 p-3.5'}>
   <div><h1 className="text-lg font-semibold">实体色卡 <span className="ml-2 rounded border border-[#c3c6d7] px-1.5 py-0.5 text-[11px] font-normal text-slate-500">列表与Excel导出</span></h1>
    <p className="mt-1 text-[11px] text-slate-500">一张色卡由一个花型母版与一种面料品号唯一绑定，稳定对应一个二维码；扫码动态读取该组合下已建成品</p></div>
   <div className="flex flex-wrap items-center gap-2">
    <input aria-label="查找色卡" className={field+' w-64'} value={query} maxLength={100}
     placeholder="按色卡编号、母版编号或面料品号查找…" onChange={e=>{setQuery(e.target.value);setOffset(0);}}/>
    <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" aria-label="只看需重新打印"
     checked={needsReprint} onChange={e=>{setNeedsReprint(e.target.checked);setOffset(0);}}/>只看需重新打印</label>
    <span className="text-xs">已选 <strong className="text-[#0053da]">{selectedIds.length}</strong> 张色卡（含跨页选择）</span>
    <button type="button" disabled={!selectedIds.length||exporting} className={button} onClick={()=>void exportSelected()}>{exporting?'导出中…':'导出 Excel'}</button>
    {selectedIds.length?<button type="button" disabled={exporting} className={button} onClick={()=>setSelectedIds([])}>清空选择</button>:null}
    <button type="button" className={blue} onClick={()=>{setNotice('');setController(makeSampleCardDraftController(apiFetch));}}>新增色卡</button>
   </div>
  </header>
  {error?<p role="alert" className="text-xs text-rose-700">{error}</p>:null}
  {notice?<p role="status" className="text-xs text-[#0053da]">{notice}</p>:null}
  <SampleCardTable page={page} selectedIds={selectedIds} busy={busy||exporting||acting} QrRenderer={QrRenderer}
   onToggle={(id,value)=>setSelectedIds(old=>toggleCardSelection(old,id,value))}
   onPageAll={value=>setSelectedIds(old=>setPageSelection(old,page.items,value))}
   onConfirmReprinted={card=>void markPrinted(card)} onRetire={card=>void retire(card)} onPage={setOffset}/>
  {controller?<SampleCardCreateDialog key="create" controller={controller} imageUrls={imageUrls} QrRenderer={QrRenderer} onClose={close} onCreate={create}/>:null}
 </main>;
}
