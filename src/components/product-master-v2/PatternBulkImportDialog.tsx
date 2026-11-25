import {useEffect,useMemo,useRef,useState,type ChangeEvent} from 'react';
import {ActionIcon} from './ActionIcon';
import {PatternImportUnconfirmedError,patternImageDisplayName,planPatternImageImports,previewPatternImports,
 saveImportedPatternImage,type PatternImageImportEntry,type PatternImportMatch} from './patternBulkImportModel';
import {useV2LeaveProtection,useV2DiscardGuard} from './useV2LeaveProtection';

interface Result{entry:PatternImageImportEntry;status:'success'|'failed'|'paused';message:string}
export function PatternBulkImportDialog({apiFetch,onUpload,onClose,onImported}:{
 apiFetch:typeof fetch;onUpload(file:File):Promise<string>;onClose():void;onImported(count:number):void
}){
 const [files,setFiles]=useState<File[]>([]),[busy,setBusy]=useState(false);
 const [progress,setProgress]=useState({done:0,total:0});
 const [results,setResults]=useState<Map<string,Result>>(new Map());
 const [match,setMatch]=useState<Map<string,PatternImportMatch>|null>(null);
 const [previewError,setPreviewError]=useState('');
 const [previewRetry,setPreviewRetry]=useState(0);
 const [directorySupported]=useState(()=>typeof document!=='undefined'&&'webkitdirectory' in document.createElement('input'));
 const dialog=useRef<HTMLDialogElement>(null),active=useRef(true),inFlight=useRef(false);
 const planned=useMemo(()=>planPatternImageImports(files),[files]);
 const pendingFiles=files.length>0&&!results.size;useV2LeaveProtection(pendingFiles,busy);
 const allowLeave=useV2DiscardGuard(pendingFiles,busy,{title:'放弃本次批量导入？',message:'已选文件不会保留，需要重新选择。'});
 useEffect(()=>{
  active.current=true;
  const node=dialog.current,before=document.activeElement;
  node?.showModal();
  return()=>{active.current=false;node?.close();if(before instanceof HTMLElement&&before.isConnected)before.focus();};
 },[]);
 useEffect(()=>{
  if(!planned.ready.length)return;
  const controller=new AbortController();
  void previewPatternImports(apiFetch,planned.ready,controller.signal)
   .then(matches=>{if(!controller.signal.aborted)setMatch(matches);})
   .catch(()=>{if(!controller.signal.aborted)setPreviewError('无法核对现有配色，请重试预览。');});
  return()=>controller.abort();
 },[apiFetch,planned,previewRetry]);
 const close=async()=>{if(!inFlight.current&&await allowLeave())onClose();};
 const selectFiles=(event:ChangeEvent<HTMLInputElement>)=>{
  const selected=Array.from(event.target.files??[]);event.target.value='';
  if(inFlight.current||!selected.length)return;
  setMatch(null);setPreviewError('');setFiles(selected);setResults(new Map());setProgress({done:0,total:0});
 };
 const outcomes=[...results.values()];
 const failed=outcomes.filter(item=>item.status==='failed');
 const paused=outcomes.filter(item=>item.status==='paused');
 const success=outcomes.length-failed.length-paused.length;
 const conflicts=planned.rejected.filter(item=>item.conflict).length;
 const start=async(entries:PatternImageImportEntry[])=>{
  if(inFlight.current||!match||!entries.length||!active.current)return;
  inFlight.current=true;
  setBusy(true);setProgress({done:0,total:entries.length});
  let saved=0;
  try{
   for(const entry of entries){
    if(!active.current)break;
    let result:Result;
    try{
     await saveImportedPatternImage(apiFetch,onUpload,entry,()=>active.current,match.get(entry.patternNo)??null);
     saved++;result={entry,status:'success',message:'导入成功'};
    }catch(error){
     result={entry,status:error instanceof PatternImportUnconfirmedError?'paused':'failed',
      message:error instanceof Error?error.message:'导入失败，请核对后重试'};
    }
    if(!active.current)break;
    setResults(current=>new Map(current).set(entry.patternNo,result));
    setProgress(current=>({...current,done:current.done+1}));
   }
  }finally{
   inFlight.current=false;
   if(active.current){setBusy(false);if(saved)onImported(saved);}
  }
 };
 return <dialog ref={dialog} aria-label="批量导入花型库" onCancel={event=>{if(event.target!==event.currentTarget)return;event.preventDefault();void close();}}
   className="m-auto max-h-[94dvh] w-[min(94vw,672px)] overflow-y-auto rounded-xl border bg-white p-4 text-slate-900 shadow-xl backdrop:bg-black/40 sm:p-5">
  <div className="flex flex-col gap-3">
   <header className="flex items-center justify-between gap-3">
    <h2 className="text-lg font-semibold">批量导入花型库</h2>
    <button type="button" disabled={busy} onClick={close} aria-label="关闭导入窗口" className="size-11 rounded hover:bg-slate-100 focus-visible:outline-2"><ActionIcon name="close"/></button>
   </header>
   <p className="text-sm text-slate-700">文件名示例：<code>G0008-1.jpg</code>。已删除编号可复用；已有同编号将替换图片，已关联产品同步显示新图。</p>
   <div className="grid gap-2 sm:grid-cols-2">
    <label className="min-w-0 rounded-lg border border-slate-500 p-3 text-sm">选择多个文件
     <input aria-label="选择多个文件" className="mt-2 block w-full text-sm" type="file" accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif"
      multiple disabled={busy} onChange={selectFiles}/>
    </label>
    <label className="min-w-0 rounded-lg border border-slate-500 p-3 text-sm">选择文件夹（包含子目录）
     <input aria-label="选择文件夹" className="mt-2 block w-full text-sm" type="file" {...{webkitdirectory:''}}
      multiple disabled={busy||!directorySupported} onChange={selectFiles}/>
    </label>
   </div>
   {!directorySupported&&<p className="text-xs text-slate-700">当前浏览器不支持文件夹选择，请使用“选择多个文件”。</p>}
   <p className="text-xs text-slate-700">JPG / PNG / WebP / GIF，每张不超过 20MB。重新选择会替换当前批次，取消选择保留原批次。</p>
   {!!files.length&&<div className="space-y-2 text-sm">
    <p>已选 {files.length} 张，可导入 {planned.ready.length} 张，命名／格式不符合 {planned.rejected.length-conflicts} 张{conflicts?'，同批冲突 '+conflicts+' 张。':'。'}</p>
    {!!planned.ready.length&&!match&&!previewError&&<p role="status">正在核对配色编号…</p>}
    {previewError&&<p role="alert" className="text-rose-700">{previewError} <button type="button" className="min-h-11 px-2 text-blue-800"
     onClick={()=>{setPreviewError('');setPreviewRetry(n=>n+1);}}>重试预览</button></p>}
    {match&&!results.size&&<div className="space-y-2">
     <p className="font-medium">新增 {planned.ready.length-match.size} 张 · 替换 {match.size} 张</p>
     <ul aria-label="导入预览" className="max-h-36 overflow-auto rounded border border-slate-300 p-2">
      {[...planned.ready.filter(entry=>match.has(entry.patternNo)),...planned.ready.filter(entry=>!match.has(entry.patternNo))].map(entry=><li className="break-all py-1" key={entry.patternNo}>
       <span className={match.has(entry.patternNo)?'font-semibold text-amber-800':'text-slate-700'}>{match.has(entry.patternNo)?'替换':'新增'} </span>
       {patternImageDisplayName(entry.file)} · {entry.patternNo}
      </li>)}
     </ul>
    </div>}
    {!!planned.rejected.length&&<ul aria-label="无法导入的文件" className="max-h-28 overflow-auto rounded border border-rose-200 bg-rose-50 p-2 text-rose-800">
     {planned.rejected.map((item,i)=><li className="break-all" key={i}>{item.name}：{item.error}</li>)}
    </ul>}
    {busy&&<p role="status">正在导入：{progress.done} / {progress.total}</p>}
    {!!outcomes.length&&<div className="max-h-44 overflow-auto rounded border border-slate-300 p-2">
     <p role="status" className="font-medium">导入结果：成功 {success} 张，失败 {failed.length} 张，暂停 {paused.length} 张。</p>
     {outcomes.map(({entry,status,message})=><p key={entry.patternNo} className={'break-all '+(status==='success'?'text-emerald-800':'text-rose-800')}>{patternImageDisplayName(entry.file)}（{entry.patternNo}）：{message}</p>)}
    </div>}
   </div>}
   <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 bg-white py-2">
    <button type="button" disabled={busy} onClick={close} className="min-h-11 rounded border border-slate-500 px-4 text-sm">关闭</button>
    {!results.size&&<button type="button" disabled={busy||!match} onClick={()=>void start(planned.ready)}
     className="min-h-11 rounded bg-blue-700 px-4 text-sm text-white disabled:opacity-50">{busy?'导入中…':'开始导入 '+planned.ready.length+' 张'}</button>}
    {!!failed.length&&<button type="button" disabled={busy} onClick={()=>void start(failed.map(item=>item.entry))}
     className="min-h-11 rounded bg-blue-700 px-4 text-sm text-white disabled:opacity-50">仅重试失败 {failed.length} 张</button>}
   </div>
  </div>
 </dialog>;
}
