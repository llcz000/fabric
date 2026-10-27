import {CardShareDialog} from '../customer-share/CardShareDialog';
import { ActionIcon } from './ActionIcon';
import { useEffect, useRef, useState } from 'react';
import { SampleCardPatternsDialog } from './SampleCardPatternsDialog';
import {useConfirm} from '../ui/ConfirmDialog';
import { fetchSampleCardPage, exportSampleCards, retireSampleCard, confirmSampleCardReprinted, toggleCardSelection, setPageSelection, type SampleCard, type SampleCardPage } from './sampleCardModel';
import {SampleCardQr,type SampleCardQrRenderer} from './SampleCardQr';
import {SampleCardCreateDialog} from './SampleCardCreateDialog';
import {SampleCardTable} from './SampleCardTable';
const field='h-8 w-full rounded border border-[#c3c6d7] bg-[#fbfcfd] px-2 text-xs focus:outline-[#346ef6]';



const button='rounded border border-[#c3c6d7] px-3 py-1.5 text-xs disabled:opacity-40';


const border='rounded-lg border border-[#c3c6d7] bg-white';

export interface SampleCardLibraryV2Props{
 shareEnabled?:boolean;
 apiFetch:typeof fetch;QrRenderer?:SampleCardQrRenderer;
 onDownload?(blob:Blob,filename:string):void;
}

function download(blob:Blob,filename:string){
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

/** Standalone page. Assembly must supply the existing authenticated fetch; server still authorizes every call. */
export function SampleCardLibraryV2({apiFetch,QrRenderer=SampleCardQr,onDownload=download,shareEnabled=false}:SampleCardLibraryV2Props){
 const confirm=useConfirm();
 const [sharingCard,setSharingCard]=useState<SampleCard|null>(null);
 const [viewingPatterns,setViewingPatterns]=useState<SampleCard|null>(null);
 const [query,setQuery]=useState(''),[offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0);
 const [needsReprint,setNeedsReprint]=useState(false),[acting,setActing]=useState(false);
 const [page,setPage]=useState<SampleCardPage>({items:[],total:0,limit:50,offset:0});
 const [selectedIds,setSelectedIds]=useState<string[]>([]),[busy,setBusy]=useState(false),[exporting,setExporting]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const request=useRef(0);
 const searchRef=useRef<HTMLInputElement|null>(null);
 const clearSearch=()=>{setQuery('');setOffset(0);searchRef.current?.focus();};
 useEffect(()=>{
  const epoch=++request.current,abort=new AbortController();setBusy(true);setError('');
  // Clear prior rows when changing filters so a late click cannot select invisible stale results.
  setPage({items:[],total:0,limit:50,offset});
  void fetchSampleCardPage(apiFetch,query,offset,50,abort.signal,needsReprint).then(p=>{
   if(epoch===request.current){setPage(p);setBusy(false);}
  }).catch(e=>{if(epoch===request.current&&!abort.signal.aborted){setError(e instanceof Error?e.message:'加载失败');setBusy(false);}});
  return ()=>{abort.abort();request.current++;};
 },[apiFetch,query,offset,needsReprint,refresh]);
 const markPrinted=async(card:SampleCard)=>{
  if(acting||!card.needsReprint)return;
  setActing(true);setError('');
  try{await confirmSampleCardReprinted(apiFetch,card);setNotice('已标记重新打印：'+card.cardNo);setRefresh(x=>x+1);}
  catch(e){setError(e instanceof Error?e.message:'操作失败，请刷新后重试');setRefresh(x=>x+1);}
  finally{setActing(false);}
 };
 const retire=async(card:SampleCard)=>{
  if(acting)return;
  const ok=await confirm({title:'删除色卡？',message:'色卡 '+card.cardNo+' 删除后旧二维码永久作废，历史选样记录会保留。',confirmText:'确认删除',danger:true});
  if(!ok)return;
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
 return <main className="v2-card-library mx-auto flex max-w-[1440px] flex-col gap-3 p-4 text-[#191b24]">
  <header className="v2-card-pagehead">
   <h1>实体色卡</h1>
   <div className="v2-card-toolbar-actions">
    <div className="v2-card-search">
     <input ref={searchRef} type="search" aria-label="查找色卡" className={field+' w-64'} value={query} maxLength={100}
      placeholder="按色卡编号、母版编号或面料品号查找…" onChange={e=>{setQuery(e.target.value);setOffset(0);}}
      onKeyDown={e=>{if(e.key==='Escape'&&query){e.preventDefault();clearSearch();}}}/>
     {query?<button type="button" aria-label="清空色卡搜索" title="清空搜索" className="v2-card-clear" onClick={clearSearch}><ActionIcon name="close"/></button>:null}
    </div>
    <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" aria-label="只看需重新打印"
     checked={needsReprint} onChange={e=>{setNeedsReprint(e.target.checked);setOffset(0);}}/>只看需重新打印</label>
    {selectedIds.length>0?<span role="status" className="v2-card-selection">已选 {selectedIds.length} 张</span>:null}
    <button type="button" disabled={!selectedIds.length||exporting} className="v2-card-secondary" onClick={()=>void exportSelected()}><ActionIcon name="download"/>{exporting?'导出中…':'导出 Excel'}</button>
    {selectedIds.length?<button type="button" disabled={exporting} className="v2-card-secondary" onClick={()=>setSelectedIds([])}><ActionIcon name="reset"/>清空选择</button>:null}
   </div>
  </header>
  {error?<p role="alert" className="text-xs text-rose-700">{error}</p>:null}
  {notice?<p role="status" className="text-xs text-[#0053da]">{notice}</p>:null}
  <SampleCardTable page={page} selectedIds={selectedIds} busy={busy||exporting||acting} QrRenderer={QrRenderer}
   onToggle={(id,value)=>setSelectedIds(old=>toggleCardSelection(old,id,value))}
   onPageAll={value=>setSelectedIds(old=>setPageSelection(old,page.items,value))}
   onShare={shareEnabled?setSharingCard:undefined} onViewPatterns={setViewingPatterns} onConfirmReprinted={card=>void markPrinted(card)} onRetire={card=>void retire(card)} onPage={setOffset}/>
  {sharingCard&&<CardShareDialog key={sharingCard.id} card={sharingCard} apiFetch={apiFetch} onClose={()=>setSharingCard(null)}/>}
  {viewingPatterns&&<SampleCardPatternsDialog key={viewingPatterns.id} card={viewingPatterns} apiFetch={apiFetch} onClose={()=>setViewingPatterns(null)}/>}
 </main>;
}
export {SampleCardQr,SampleCardCreateDialog,SampleCardTable};
export {createCardQrMatrix} from './SampleCardQr';
export type {SampleCardQrRenderer} from './SampleCardQr';
export {NumberCandidates} from './SampleCardCreateDialog';
