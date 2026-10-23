import {useConfirm} from '../ui/ConfirmDialog';
import {patternBox as box,formatPatternTags as asTags} from './patternPresentation';
import { ActionIcon } from './ActionIcon';
import { useState, useEffect, useRef } from 'react';
import { Plus, X } from 'lucide-react';
import type { CatalogTag } from './catalogModel';
import { TopicTagPicker } from './TopicTagPicker';
import { type PatternMasterItem, type PatternVersionItem } from './patternModel';
import {TagSelector,InlineColorTagEditor} from './PatternTagControls';
export interface PatternColorwayEditorProps{
 master:PatternMasterItem;items:PatternVersionItem[];
 topics:CatalogTag[];apiFetch:typeof fetch;nextColorwayNo:number;canManage?:boolean;onTopicCreated?(tag:CatalogTag):void;
 thumbnailUrls?:Map<string,string>;onPreview?(item:PatternVersionItem):void;
 onClose():void;onSaveVersion(item:PatternVersionItem,value:{remark:string;isActive:boolean;patternImageAssetId?:string|null}):Promise<void>;
 onAdd(value:{remark:string;isActive:boolean;patternImageAssetId?:string|null}):Promise<void>;
 onSaveMasterTags(ids:string[]):Promise<void>;

 onUploadPatternImage?(file:File):Promise<string>;
 onDeleteVersion(item:PatternVersionItem):Promise<void>;
 onToggleMaster?(enabled:boolean):Promise<void>;
}

export function PatternColorwayEditor({
 master,items,topics,apiFetch,nextColorwayNo,canManage=false,onClose,onSaveVersion,onAdd,onTopicCreated,
 thumbnailUrls=new Map(),onPreview,
 onSaveMasterTags,onUploadPatternImage,onDeleteVersion,onToggleMaster
}:PatternColorwayEditorProps){
 const confirm=useConfirm();
 const [editing,setEditing]=useState<string|null>(null);
 const [draft,setDraft]=useState({remark:'',isActive:true,patternImageAssetId:null as string|null});
 const [stagedThumbs,setStagedThumbs]=useState(new Map<string,string>());
 const stagedUrls=useRef<string[]>([]);
 useEffect(()=>()=>{stagedUrls.current.forEach(url=>URL.revokeObjectURL(url));},[]);
 const [topicDraft,setTopicDraft]=useState(master.topicTags.map(t=>t.id));
 const [topicEditing,setTopicEditing]=useState(false);
 const [adding,setAdding]=useState(false);
 const [newDraft,setNewDraft]=useState({remark:'',isActive:true,patternImageAssetId:null as string|null});
 const [confirmRemove,setConfirmRemove]=useState<PatternVersionItem|null>(null);
 const [working,setWorking]=useState(false),[error,setError]=useState('');
 const workRef=useRef(false);
 const closeButton=useRef<HTMLButtonElement>(null);
 const unsaved=editing!==null||adding||topicEditing;
 const close=async()=>{
  if(working)return;
  if(unsaved){
   const ok=await confirm({title:'放弃未保存的花型修改？',message:'当前修改尚未保存，放弃后无法恢复。',confirmText:'放弃修改',danger:true});
   if(!ok)return;
  }
  onClose();
 };
 const latestClose=useRef(close);latestClose.current=close;
 useEffect(()=>{
  const before=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const beforeLabel=before?.getAttribute('aria-label');
  closeButton.current?.focus();
  const key=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){if(e.defaultPrevented||document.querySelector('dialog[open]'))return;e.preventDefault();void latestClose.current();}
   if(e.key==='Tab'){
    const buttons=Array.from(document.querySelectorAll<HTMLElement>('[data-pattern-editor] button:not([disabled]),[data-pattern-editor] input:not([disabled])'));
    if(!buttons.length)return;
    if(e.shiftKey&&document.activeElement===buttons[0]){e.preventDefault();buttons[buttons.length-1].focus();}
    else if(!e.shiftKey&&document.activeElement===buttons[buttons.length-1]){e.preventDefault();buttons[0].focus();}
   }
  };
  document.addEventListener('keydown',key);
  return ()=>{document.removeEventListener('keydown',key);if(before?.isConnected)before.focus();else if(beforeLabel)Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label]')).find(button=>button.getAttribute('aria-label')===beforeLabel)?.focus();};
 },[]);
 const call=async(fn:()=>Promise<void>,after?:()=>void)=>{
  if(workRef.current)return;workRef.current=true;setWorking(true);setError('');
  try{await fn();after?.();}catch(e){
   setError(e instanceof Error?e.message:'保存失败，请核对权限或引用后重试。');
  }finally{workRef.current=false;setWorking(false);}
 };
 return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-2 sm:p-4" role="presentation">
  <div data-pattern-editor role="dialog" aria-modal="true" aria-label={'编辑花型 '+master.masterNo}
   className="flex max-h-[95vh] w-full max-w-[1120px] flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
   <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[#e2e8f0] px-4 py-3">
    <h2 className="text-sm font-semibold">编辑花型</h2>
    <div className="flex items-center gap-2">
     <span className="text-[11px] text-slate-500">下一配色 {nextColorwayNo}</span>
     {canManage?<button type="button" disabled={working||adding||editing!==null||nextColorwayNo>4294967295}
       onClick={()=>{setNewDraft({remark:'',isActive:true,patternImageAssetId:null});setAdding(true);}}
       className="inline-flex items-center gap-1 rounded border border-[#346ef6] px-2 py-1 text-xs text-[#0053da]">
       <Plus size={13}/>添加配色</button>:null}
     <button ref={closeButton} type="button" onClick={close} className="rounded p-1 hover:bg-slate-100" aria-label="关闭配色编辑">
      <X size={18}/></button>
    </div>
   </header>
   <div className="flex shrink-0 flex-wrap items-center gap-4 border-b border-[#e2e8f0] bg-[#fafbfe] px-4 py-3 text-xs">
    <label>花型编号 <input aria-label="花型编号" readOnly value={master.masterNo}
      className="ml-2 w-28 rounded border border-[#e2e8f0] bg-slate-100 px-2 py-1"/></label>
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
     <strong>题材标签</strong>
     {topicEditing?<><TopicTagPicker apiFetch={apiFetch} ariaLabel="修改题材标签" options={[...topics,...master.topicTags.filter(t=>!topics.some(x=>x.id===t.id))]} selected={topicDraft} onChange={setTopicDraft} onTagCreated={onTopicCreated} disabled={working}/>
      <button type="button" disabled={working} onClick={()=>call(()=>onSaveMasterTags(topicDraft),()=>setTopicEditing(false))}
       className="rounded bg-[#346ef6] px-2 py-1 text-white"><ActionIcon name="save"/>保存题材</button>
      <button type="button" onClick={()=>setTopicEditing(false)}><ActionIcon name="close"/>取消</button></>:
      <><span>{asTags(master.topicTags)}</span>
      {canManage?<button type="button" onClick={()=>{setTopicDraft(master.topicTags.map(x=>x.id));setTopicEditing(true);}}
       className="text-[#0053da] underline"><ActionIcon name="edit"/>维护</button>:null}</>}
    </div>
   </div>
   {error?<p role="alert" className="px-4 py-2 text-sm text-rose-700">{error}</p>:null}
   <div className="overflow-auto">
    <table className="w-full min-w-[720px] border-collapse text-left text-xs">
     <thead className="sticky top-0 bg-[#f8fafc] text-[#64748b]"><tr>
      {['花型图','配色序号','花型编号','版本备注','操作'].map(t=>
       <th key={t} className="border-b border-[#e2e8f0] px-3 py-2 font-medium">{t}</th>)}
     </tr></thead>
     <tbody>
      {items.map(version=>{
       const imageId=editing===version.id?draft.patternImageAssetId:version.patternImageAssetId;
       const imageUrl=imageId?(stagedThumbs.get(imageId)??thumbnailUrls.get(imageId)):undefined;
       return <tr key={version.id} className="border-b border-[#e2e8f0]">
       <td className="px-3 py-3">{imageId&&imageUrl&&onPreview?
        <button type="button" aria-label={'查看花型原图 '+version.patternNo} onClick={()=>onPreview({...version,patternImageAssetId:imageId})}>
         <img src={imageUrl} alt={'配色 '+version.patternNo}
          className="h-14 w-14 rounded border object-cover" loading="lazy"/></button>:
        <button type="button" disabled={!canManage||working||adding||editing!==null&&editing!==version.id} aria-label={'编辑花型图 '+version.patternNo} onClick={()=>{setDraft({remark:version.remark,isActive:true,patternImageAssetId:version.patternImageAssetId});setEditing(version.id);}}
         className="flex h-14 w-14 items-center justify-center rounded border border-dashed bg-slate-50 text-[10px] text-blue-700 disabled:text-slate-400"><ActionIcon name="upload"/>{imageId?'更换图片':'上传花型图'}</button>}
        {editing===version.id&&canManage?<div className="mt-2 flex w-36 flex-wrap gap-2 text-xs">
         {onUploadPatternImage?<label className={'text-[#0053da] '+(working?'opacity-50':'cursor-pointer')}>
          {imageId?'更换花型图':'上传花型图'}<input type="file" className="sr-only" disabled={working} accept="image/jpeg,image/png,image/webp,image/gif"
           aria-label={'上传花型图 '+version.patternNo} onChange={event=>{
            const file=event.target.files?.[0];event.target.value='';if(!file)return;
            void call(async()=>{
             if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)||file.size===0||file.size>20*1024*1024)throw Error('请选择20MB以内的JPG、PNG、WebP或GIF图片');
             const assetId=await onUploadPatternImage(file);
             if(!/^[0-9a-f-]{36}$/.test(assetId))throw Error('上传未返回有效图片标识');
             const url=URL.createObjectURL(file);stagedUrls.current.push(url);setStagedThumbs(before=>new Map(before).set(assetId,url));
             setDraft(before=>({...before,patternImageAssetId:assetId}));
            });
           }}/></label>:<span className="text-slate-500">上传服务未连接</span>}
         {imageId?<button type="button" disabled={working} aria-label={'删除花型图 '+version.patternNo} className="text-rose-700"
          onClick={()=>setDraft(before=>({...before,patternImageAssetId:null}))}><ActionIcon name="delete"/>删除花型图</button>:null}
         <span className="w-full text-[10px] text-slate-500">点击“保存配色”后生效</span>
        </div>:null}
       </td>
       <td className="px-3 py-3"><span aria-label={'配色 '+version.colorwayNo}
        className="rounded bg-slate-100 px-2 py-1 font-semibold">{version.colorwayNo}</span></td>
       <td className="px-3 py-3 font-semibold">{version.patternNo}</td>
       <td className="px-3 py-3">
        {editing===version.id?<input aria-label={'版本备注 '+version.patternNo}
          value={draft.remark} onChange={e=>setDraft({...draft,remark:e.target.value})}
          maxLength={500} className="w-44 rounded border px-2 py-1"/>:
         <span className="block max-w-44 truncate" title={version.remark}>{version.remark||'—'}</span>}
       </td>
       
       <td className="px-3 py-3 whitespace-nowrap">
        {editing===version.id?<><button type="button" disabled={working}
          onClick={()=>call(()=>onSaveVersion(version,draft),()=>setEditing(null))}
          className="rounded bg-[#346ef6] px-2 py-1 text-white"><ActionIcon name="save"/>保存配色</button>
         <button type="button" disabled={working} onClick={()=>setEditing(null)} className="ml-1"><ActionIcon name="close"/>取消</button></>:
         canManage?<><button type="button" disabled={working||adding||editing!==null} className="text-[#0053da] disabled:opacity-40" onClick={()=>{
          setDraft({remark:version.remark,isActive:true,patternImageAssetId:version.patternImageAssetId});
          setEditing(version.id);}}><ActionIcon name="edit"/>编辑</button>
          <button type="button" disabled={working||adding||editing!==null} className="ml-2 text-rose-600 disabled:opacity-40" onClick={()=>setConfirmRemove(version)}><ActionIcon name="delete"/>删除</button></>:<span className="text-slate-400">只读</span>}
       </td>
      </tr>;})}
      {adding&&canManage?<tr className="bg-[#f3f2ff]">
       <td className="px-3 py-2 text-xs">{newDraft.patternImageAssetId&&stagedThumbs.get(newDraft.patternImageAssetId)&&<img alt="新配色花型图" className="mb-1 h-14 w-14 rounded object-cover" src={stagedThumbs.get(newDraft.patternImageAssetId)}/>}
        {onUploadPatternImage&&<label className="cursor-pointer text-blue-700">{newDraft.patternImageAssetId?'更换图片':'上传花型图'}<input type="file" aria-label="新配色花型图" className="sr-only" disabled={working} accept="image/jpeg,image/png,image/webp,image/gif" onChange={event=>{
         const file=event.target.files?.[0];event.target.value='';if(!file)return;
         void call(async()=>{if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)||!file.size||file.size>20*1024*1024)throw Error('请选择20MB以内的图片');
          const id=await onUploadPatternImage(file);const url=URL.createObjectURL(file);stagedUrls.current.push(url);setStagedThumbs(before=>new Map(before).set(id,url));setNewDraft(before=>({...before,patternImageAssetId:id}));});
        }}/></label>}
        {newDraft.patternImageAssetId&&<button disabled={working} className="ml-2 text-rose-700" onClick={()=>setNewDraft(before=>({...before,patternImageAssetId:null}))}><ActionIcon name="delete"/>移除图片</button>}
       </td>
       <td className="px-3 py-2 text-xs" title="保存时由服务端分配最终配色序号">下一配色 {nextColorwayNo}</td>
       <td className="px-3 py-2 text-xs">{master.masterNo}-{nextColorwayNo} (预计)</td>
       <td className="px-3 py-2"><input aria-label="新版本备注" maxLength={500}
        value={newDraft.remark} onChange={e=>setNewDraft({...newDraft,remark:e.target.value})}
        className="w-44 rounded border px-2 py-1"/></td>
       
       <td className="px-3 py-2 whitespace-nowrap">
        <button disabled={working} type="button" className="rounded bg-[#346ef6] px-2 py-1 text-white"
         onClick={()=>call(()=>onAdd(newDraft),()=>setAdding(false))}><ActionIcon name="save"/>保存新配色</button>
        <button type="button" disabled={working} onClick={()=>setAdding(false)} className="ml-2"><ActionIcon name="close"/>取消</button>
       </td>
      </tr>:null}
     </tbody>
    </table>
   </div>
   {confirmRemove?<div role="alertdialog" aria-modal="true" aria-label="删除配色确认"
     className="m-3 rounded border border-rose-200 bg-rose-50 p-3 text-xs">
    <p>确认删除 {confirmRemove.patternNo} 及其花型图？已关联产品的配色不能删除；删除后该配色序号永久不复用。</p>
    <div className="mt-2 flex gap-2">
     <button type="button" className="rounded bg-rose-700 px-2 py-1 text-white"
      disabled={working} onClick={()=>call(()=>onDeleteVersion(confirmRemove),()=>setConfirmRemove(null))}><ActionIcon name="delete"/>确认删除</button>
     <button type="button" onClick={()=>setConfirmRemove(null)}><ActionIcon name="close"/>取消</button>
    </div></div>:null}
   <footer className="border-t px-4 py-2 text-[11px] text-slate-500">题材标签由花型统一维护。每个配色保留独立花型图；上传、删除图片与备注一起保存，取消不改变原关联。配色序号保存后永久只读。</footer>
  </div>
 </div>;
}

