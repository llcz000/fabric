import {useEffect,useMemo,useRef,useState,type ChangeEvent} from 'react';
import {ActionIcon} from './ActionIcon';
import {patternImageDisplayName,planPatternImageImports,saveImportedPatternImage} from './patternBulkImportModel';
import {useV2LeaveProtection,useV2DiscardGuard} from './useV2LeaveProtection';

interface Result{name:string;patternNo:string;status:'success'|'failed'|'paused';message:string}
export function PatternBulkImportDialog({apiFetch,onUpload,onClose,onImported}:{
 apiFetch:typeof fetch;onUpload(file:File):Promise<string>;onClose():void;onImported(count:number):void
}){
 const [files,setFiles]=useState<File[]>([]),[busy,setBusy]=useState(false);
 const [done,setDone]=useState(0),[results,setResults]=useState<Result[]>([]);
 const [directorySupported]=useState(()=>typeof document!=='undefined'&&'webkitdirectory' in document.createElement('input'));
 const dialog=useRef<HTMLDialogElement>(null),active=useRef(true),inFlight=useRef(false);
 const planned=useMemo(()=>planPatternImageImports(files),[files]);
 const pendingFiles=files.length>0&&results.length===0;useV2LeaveProtection(pendingFiles,busy);
 const allowLeave=useV2DiscardGuard(pendingFiles,busy,{title:'放弃本次批量导入？',message:'已选文件不会保留，需要重新选择。'});
 useEffect(()=>{
  active.current=true;const node=dialog.current,before=typeof document==='undefined'?null:document.activeElement;
  node?.showModal();
  return()=>{active.current=false;node?.close();if(typeof HTMLElement!=='undefined'&&before instanceof HTMLElement&&before.isConnected)before.focus();};
 },[]);
 const close=async()=>{if(!inFlight.current&&await allowLeave())onClose();};
 const selectFiles=(event:ChangeEvent<HTMLInputElement>)=>{
  const selected=Array.from(event.target.files??[]);event.target.value='';
  // Cancellation retains the batch. Guard changes queued before disabled applies.
  if(inFlight.current||!selected.length)return;
  setFiles(selected);setResults([]);setDone(0);
 };
 const success=results.filter(x=>x.status==='success').length,failed=results.filter(x=>x.status==='failed').length,paused=results.filter(x=>x.status==='paused').length;
 const start=async()=>{
  if(inFlight.current||results.length||!planned.ready.length||!active.current)return;
  inFlight.current=true;
  setBusy(true);setDone(0);setResults([]);
  let saved=0;
  try{
   for(const entry of planned.ready){
    if(!active.current)break;
    try{
     await saveImportedPatternImage(apiFetch,onUpload,entry,()=>active.current);
     if(!active.current)break;
     saved++;setResults(items=>[...items,{name:patternImageDisplayName(entry.file),patternNo:entry.patternNo,status:'success',message:'导入成功'}]);
    }catch(error){
     if(!active.current)break;
     setResults(items=>[...items,{name:patternImageDisplayName(entry.file),patternNo:entry.patternNo,status:'failed',
      message:error instanceof Error?error.message:'导入失败，请核对后重试'}]);
    }
    setDone(n=>n+1);
   }
  }finally{
   inFlight.current=false;
   if(active.current){setBusy(false);if(saved)onImported(saved);}
  }
 };
 return <dialog ref={dialog} aria-label="批量导入花型库" onCancel={event=>{if(event.target!==event.currentTarget)return;event.preventDefault();close();}}
   className="m-auto max-h-[90vh] w-[min(94vw,672px)] overflow-y-auto rounded-xl border bg-white p-5 text-[#191b24] shadow-xl backdrop:bg-black/40">
  <div className="flex flex-col gap-4">
   <header className="flex items-center justify-between gap-3">
    <h2 className="text-lg font-semibold">批量导入花型库</h2>
    <button type="button" disabled={busy} onClick={close} aria-label="关闭导入窗口" className="rounded px-2 py-1 hover:bg-slate-100"><ActionIcon name="close"/></button>
   </header>
   <p className="text-sm text-slate-600">选择多张花型图片，文件名使用 <strong>花型母版号-配色号</strong>，例如 <code>G0008-1.jpg</code>、<code>G0008-2.png</code>。同一母版自动按配色号从小到大导入；已删除编号可复用；已有同编号将替换图片，已关联产品同步显示新图。</p>
   <div className="grid gap-3 sm:grid-cols-2">
    <label className="block rounded-lg border border-dashed border-[#b4c3ef] bg-[#f7f9ff] p-4 text-sm">
     选择多个文件
     <input aria-label="选择多个文件" className="mt-2 block w-full text-sm" type="file" accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif"
      multiple disabled={busy} onChange={selectFiles}/>
    </label>
    <label className="block rounded-lg border border-dashed border-[#b4c3ef] bg-[#f7f9ff] p-4 text-sm">
     选择文件夹（包含子目录）
     <input aria-label="选择文件夹" className="mt-2 block w-full text-sm" type="file" {...{webkitdirectory:''}}
      multiple disabled={busy||!directorySupported} onChange={selectFiles}/>
    </label>
   </div>
   {!directorySupported?<p className="text-xs text-slate-600">当前浏览器不支持文件夹选择，请使用“选择多个文件”。</p>:null}
   <p className="text-xs text-slate-500">JPG / PNG / WebP / GIF，每张不超过 20MB；重新选择会替换当前批次，取消选择保留原批次。目录仅在此显示，不用于花号或标签；同一花号的冲突文件全部排除。</p>
   {files.length?<div className="space-y-2 text-sm">
    <p>已选 {files.length} 张，可导入 {planned.ready.length} 张，命名／格式不符合 {planned.rejected.length} 张。</p>
    <ul aria-label="已选文件" className="max-h-28 overflow-auto rounded border p-2">
     {files.map((file,i)=><li key={i} className="break-all">{patternImageDisplayName(file)}</li>)}
    </ul>
    {planned.rejected.length?<div role="alert" className="max-h-28 overflow-auto rounded border border-rose-200 bg-rose-50 p-2 text-rose-700">
     {planned.rejected.map((item,i)=><p key={i}>{item.name}：{item.error}</p>)}
    </div>:null}
    {busy?<p role="status">正在导入：{done} / {planned.ready.length}</p>:null}
    {results.length?<div role="status" className="max-h-44 overflow-y-auto rounded border p-2">
     <p className="font-medium">导入结果：成功 {success} 张，失败 {failed} 张，暂停 {paused} 张。</p>
     {results.map((item,i)=><p key={i} className={item.status==='success'?'text-emerald-700':item.status==='paused'?'text-amber-700':'text-rose-700'}>{item.name}（{item.patternNo}）：{item.message}</p>)}
    </div>:null}
   </div>:null}
   <p className="text-xs text-slate-500">逐张上传与保存；单张失败不影响其他图片。请按失败清单重新选择图片；同编号重导会替换图片，不会新增重复配色。</p>
   <div className="flex justify-end gap-2">
    <button type="button" disabled={busy} onClick={close} className="rounded border px-4 py-2 text-sm">关闭</button>
    <button type="button" disabled={busy||!planned.ready.length||results.length>0} onClick={start}
     className="rounded bg-[#346ef6] px-4 py-2 text-sm text-white disabled:opacity-50">{busy?'导入中…':'开始导入 '+planned.ready.length+' 张'}</button>
   </div>
  </div>
 </dialog>;
}
