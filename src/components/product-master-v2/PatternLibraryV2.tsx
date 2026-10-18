import {CatalogExportButton} from './CatalogExportButton';
import React,{useState,useEffect,useRef,useCallback} from 'react';
import {ChevronLeft,ChevronRight,Image as ImageIcon,Plus,Search,X,Edit3} from 'lucide-react';
import type {CatalogTag} from './catalogModel';
import {uploadImageAsset} from '../../lib/imageAssets';
import {createLatestRequestGuard,loadCatalogTags,resolveImageUrls} from './catalogModel';
import {
 initialPatternFilters,reducePatternFilters,fetchPatternPage,fetchMasterColorways,
 createNextColorway,saveColorwayProperties,saveMasterTopicTags,addColorTagChoice,
 buildPatternUrl,patchMasterStatus,deleteUnreferencedColorway,saveMasterColorTags,fetchMasterColorTags,
 type PatternMasterItem,type PatternVersionItem,type PatternPage,type PatternFilters
} from './patternModel';
const box='rounded-lg border border-[#c3c6d7] bg-white';
const asTags=(tags:CatalogTag[])=>tags.length?tags.map(t=>t.name).join(' · '):'—';
const throttle=100; // image signing request max 100 IDs
function chunks<T>(items:T[],size:number):T[][]{
 const result:T[][]=[];for(let i=0;i<items.length;i+=size)result.push(items.slice(i,i+size));
 return result;
}
export function PatternMasterRows({items,thumbnailUrls,onPreview,onEdit,onShare,canManage=false}:{
 items:PatternMasterItem[];thumbnailUrls:Map<string,string>;
 onPreview(version:PatternVersionItem):void;onEdit(master:PatternMasterItem):void;canManage?:boolean;
 onShare?(master:PatternMasterItem):void;
}){
 return <div role="table" aria-label="花型母版列表" className={box+' overflow-x-auto'}>
  <div role="row" className="flex min-w-[640px] gap-3 border-b border-[#c3c6d7] bg-[#fbfcfd] px-3 py-2 text-xs text-[#434655]">
   <span role="columnheader" className="w-32 shrink-0">花型</span><span role="columnheader" className="w-32 shrink-0">题材标签</span><span role="columnheader" className="w-32 shrink-0">颜色标签</span><span role="columnheader" className="min-w-0 flex-1">配色版本</span><span role="columnheader" className="w-16 shrink-0 text-center">操作</span>
  </div>
  {items.map(master=><div key={master.id} role="row"
   className="flex min-w-[640px] items-center gap-3 border-b border-[#e2e1ee] px-3 py-3 last:border-0 hover:bg-[#fcfdff]">
   <div role="cell" className="w-32 shrink-0">
    <strong className="block text-sm text-[#191b24]">{master.masterNo}</strong>
    {!master.isActive?<span className="text-[11px] text-slate-500">已停用</span>:null}
   </div>
   <div role="cell" className="w-32 shrink-0 break-words text-xs text-[#737686]">{asTags(master.topicTags)}</div>
   <div role="cell" className="w-32 shrink-0 break-words text-xs text-[#737686]">{asTags(master.colorTags??[])}</div>
   <div role="cell" className="flex min-w-0 flex-1 flex-wrap gap-2">
    {master.versions.length?master.versions.map(version=>{
     const url=version.patternImageAssetId?thumbnailUrls.get(version.patternImageAssetId):undefined;
     return <div key={version.id} className="flex w-[104px] shrink-0 flex-col items-center rounded-lg border border-[#ededf9] p-1">
      {url?<button type="button" aria-label={'查看花型原图 '+version.patternNo} onClick={()=>onPreview(version)}
        className="rounded focus-visible:outline-2 focus-visible:outline-[#346ef6]">
        <img className="h-16 w-16 rounded object-cover" src={url}
         alt={'花型 '+version.patternNo} width={64} height={64} loading="lazy"/></button>:
       <span className="inline-flex h-16 w-16 flex-col items-center justify-center rounded border border-dashed border-[#c3c6d7] bg-[#f3f2ff] text-[10px] text-[#737686]">
        <ImageIcon size={15}/>{version.patternImageAssetId?'图片不可用':'待上传'}</span>}
      <strong title={version.patternNo} className="mt-1 max-w-full truncate text-[11px]">{version.patternNo}</strong>
      {!version.isActive?<span className="text-[10px] text-slate-400">已停用</span>:null}
     </div>;
    }):<span className="text-xs text-[#737686]">尚无配色版本</span>}
   </div>
   <div role="cell" className="w-16 shrink-0 text-center">
    <button type="button" aria-label={'编辑花型及配色 '+master.masterNo} onClick={()=>onEdit(master)}
     className="inline-flex items-center gap-1 rounded p-2 text-[#0053da] hover:bg-[#eef1fd]"
     title={canManage?'编辑花型及配色':'查看花型及配色'}><Edit3 size={15}/></button>
    {onShare&&<button type="button" className="rounded px-1 py-2 text-xs text-[#0053da]" aria-label={'分享花型 '+master.masterNo} onClick={()=>onShare(master)}>分享</button>}
   </div>
  </div>)}
  {!items.length?<p className="py-16 text-center text-sm text-[#737686]">没有匹配的花型，可调整或清空筛选条件。</p>:null}
 </div>;
}
function TagSelector({options,selected,onChange,disabled=false,ariaLabel,reserved=0}:{
 options:CatalogTag[];selected:string[];onChange(value:string[]):void;disabled?:boolean;ariaLabel:string;
 reserved?:number;
}){
 return <div className="flex max-w-full flex-wrap gap-1" role="group" aria-label={ariaLabel}>
  {options.length?options.map(tag=>{
   const on=selected.includes(tag.id);
   return <button key={tag.id} type="button" aria-pressed={on} disabled={disabled||(!on&&(selected.length+reserved>=10||tag.isArchived))}
    onClick={()=>onChange(on?selected.filter(x=>x!==tag.id):[...selected,tag.id])}
    title={tag.isArchived?'已归档标签（仅可从历史关联移除）':tag.name}
    className={'rounded-full px-2 py-1 text-[11px] '+(on?
     'bg-[#346ef6] text-white':'bg-[#eef1fd] text-[#31447b]')}>{tag.name}</button>;
  }):<span className="text-[11px] text-[#737686]">暂无可选标签</span>}
 </div>;
}
function InlineColorTagEditor({options,tagIds,newColorTags,onChange,disabled=false,label}:{
 options:CatalogTag[];tagIds:string[];newColorTags:string[];
 onChange(value:{tagIds:string[];newColorTags:string[]}):void;
 disabled?:boolean;label:string;
}){
 const [text,setText]=useState(''),[error,setError]=useState('');
 const add=()=>{
  try{onChange(addColorTagChoice(options,tagIds,newColorTags,text));setText('');setError('');}
  catch(e){setError(e instanceof Error?e.message:'颜色名称错误');}
 };
 return <div className="space-y-1">
  <TagSelector ariaLabel={label} options={options} selected={tagIds}
   onChange={next=>onChange({tagIds:next,newColorTags})}
   reserved={newColorTags.length} disabled={disabled}/>
  {newColorTags.length?<div className="flex flex-wrap gap-1" aria-label={'待创建颜色 '+label}>
   {newColorTags.map(name=><button key={name} type="button" disabled={disabled}
    aria-label={'移除自定义颜色 '+name}
    title="取消本次新颜色标签"
    onClick={()=>onChange({tagIds,newColorTags:newColorTags.filter(x=>x!==name)})}
    className="rounded bg-[#e9f0ff] px-1.5 py-0.5 text-[11px] text-[#0053da]">{name} ×</button>)}
   </div>:null}
  <div className="flex max-w-[250px] items-center gap-1">
   <input type="text" aria-label={'自定义颜色 '+label} maxLength={32} value={text}
    disabled={disabled} onChange={e=>{setText(e.target.value);setError('');}}
    onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();add();}}}
    placeholder="输入自定义颜色" className="w-32 min-w-0 rounded border border-[#c3c6d7] px-1.5 py-1 text-[11px]"/>
   <button type="button" disabled={disabled||tagIds.length+newColorTags.length>=10}
    onClick={add} className="whitespace-nowrap rounded border px-1.5 py-1 text-[11px] text-[#0053da]">添加颜色</button>
  </div>
  {error?<span role="alert" className="block text-[11px] text-rose-700">{error}</span>:null}
 </div>;
}
export interface PatternColorwayEditorProps{
 master:PatternMasterItem;items:PatternVersionItem[];
 topics:CatalogTag[];colors:CatalogTag[];nextColorwayNo:number;canManage?:boolean;
 thumbnailUrls?:Map<string,string>;onPreview?(item:PatternVersionItem):void;
 onClose():void;onSaveVersion(item:PatternVersionItem,value:{remark:string;isActive:boolean;patternImageAssetId?:string|null}):Promise<void>;
 onAdd(value:{remark:string;isActive:boolean;patternImageAssetId?:string|null}):Promise<void>;
 onSaveMasterTags(ids:string[]):Promise<void>;
 onSaveMasterColorTags?(ids:string[],newColorTags?:string[]):Promise<void>;
 onUploadPatternImage?(file:File):Promise<string>;
 onDeleteVersion(item:PatternVersionItem):Promise<void>;
 onToggleMaster?(enabled:boolean):Promise<void>;
}
export function PatternColorwayEditor({
 master,items,topics,colors,nextColorwayNo,canManage=false,onClose,onSaveVersion,onAdd,
 thumbnailUrls=new Map(),onPreview,
 onSaveMasterTags,onSaveMasterColorTags,onUploadPatternImage,onDeleteVersion,onToggleMaster
}:PatternColorwayEditorProps){
 const [editing,setEditing]=useState<string|null>(null);
 const [draft,setDraft]=useState({remark:'',isActive:true,patternImageAssetId:null as string|null});
 const [colorDraft,setColorDraft]=useState((master.colorTags??[]).map(tag=>tag.id)),[colorEditing,setColorEditing]=useState(false);
 const [newPatternColors,setNewPatternColors]=useState<string[]>([]);
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
 const unsaved=editing!==null||adding||topicEditing||colorEditing;
 const close=()=>{
  if(working)return;
  if(unsaved&&typeof window!=='undefined'&&!window.confirm('放弃未保存的花型修改吗？'))return;
  onClose();
 };
 useEffect(()=>{
  const before=document.activeElement instanceof HTMLElement?document.activeElement:null;
  closeButton.current?.focus();
  const key=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();close();}
   if(e.key==='Tab'){
    const buttons=Array.from(document.querySelectorAll<HTMLElement>('[data-pattern-editor] button:not([disabled]),[data-pattern-editor] input:not([disabled])'));
    if(!buttons.length)return;
    if(e.shiftKey&&document.activeElement===buttons[0]){e.preventDefault();buttons[buttons.length-1].focus();}
    else if(!e.shiftKey&&document.activeElement===buttons[buttons.length-1]){e.preventDefault();buttons[0].focus();}
   }
  };
  document.addEventListener('keydown',key);
  return ()=>{document.removeEventListener('keydown',key);before?.focus();};
 });
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
    <span className={master.isActive?'text-emerald-700':'text-slate-500'}>{master.isActive?'已启用':'已停用'}</span>
    {canManage&&onToggleMaster?<button type="button" disabled={working}
      onClick={()=>call(()=>onToggleMaster(!master.isActive))}
      className="text-[#0053da] underline">{master.isActive?'停用花型':'启用花型'}</button>:null}
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
     <strong>题材标签</strong>
     {topicEditing?<><TagSelector ariaLabel="修改题材标签" options={[...topics,...master.topicTags.filter(t=>!topics.some(x=>x.id===t.id))]} selected={topicDraft} onChange={setTopicDraft} disabled={working}/>
      <button type="button" disabled={working} onClick={()=>call(()=>onSaveMasterTags(topicDraft),()=>setTopicEditing(false))}
       className="rounded bg-[#346ef6] px-2 py-1 text-white">保存题材</button>
      <button type="button" onClick={()=>setTopicEditing(false)}>取消</button></>:
      <><span>{asTags(master.topicTags)}</span>
      {canManage?<button type="button" onClick={()=>{setTopicDraft(master.topicTags.map(x=>x.id));setTopicEditing(true);}}
       className="text-[#0053da] underline">维护</button>:null}</>}
    </div>
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
     <strong>颜色标签</strong>
     {colorEditing?<><InlineColorTagEditor label="花型颜色标签" options={[...colors,...(master.colorTags??[]).filter(tag=>!colors.some(option=>option.id===tag.id))]}
       tagIds={colorDraft} newColorTags={newPatternColors} onChange={value=>{setColorDraft(value.tagIds);setNewPatternColors(value.newColorTags);}} disabled={working}/>
      <button type="button" disabled={working} onClick={()=>call(()=>onSaveMasterColorTags!(colorDraft,newPatternColors),()=>setColorEditing(false))} className="rounded bg-[#346ef6] px-2 py-1 text-white">保存颜色</button>
      <button type="button" disabled={working} onClick={()=>setColorEditing(false)}>取消</button></>:
      <><span>{asTags(master.colorTags??[])}</span>{canManage&&onSaveMasterColorTags?<button type="button" onClick={()=>{setColorDraft((master.colorTags??[]).map(tag=>tag.id));setNewPatternColors([]);setColorEditing(true);}} className="text-[#0053da] underline">维护颜色</button>:null}</>}
    </div>
   </div>
   {error?<p role="alert" className="px-4 py-2 text-sm text-rose-700">{error}</p>:null}
   <div className="overflow-auto">
    <table className="w-full min-w-[830px] border-collapse text-left text-xs">
     <thead className="sticky top-0 bg-[#f8fafc] text-[#64748b]"><tr>
      {['花型图','配色序号','花型编号','版本备注','启用状态','操作'].map(t=>
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
        <button type="button" disabled={!canManage||working||adding||editing!==null&&editing!==version.id} aria-label={'编辑花型图 '+version.patternNo} onClick={()=>{setDraft({remark:version.remark,isActive:version.isActive,patternImageAssetId:version.patternImageAssetId});setEditing(version.id);}}
         className="flex h-14 w-14 items-center justify-center rounded border border-dashed bg-slate-50 text-[10px] text-blue-700 disabled:text-slate-400">{imageId?'更换图片':'上传花型图'}</button>}
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
          onClick={()=>setDraft(before=>({...before,patternImageAssetId:null}))}>删除花型图</button>:null}
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
       <td className="px-3 py-3">
        {editing===version.id?<input type="checkbox" aria-label={'启用 '+version.patternNo}
         checked={draft.isActive} onChange={e=>setDraft({...draft,isActive:e.target.checked})}/>:
         <span>{version.isActive?'已启用':'已停用'}</span>}
       </td>
       <td className="px-3 py-3 whitespace-nowrap">
        {editing===version.id?<><button type="button" disabled={working}
          onClick={()=>call(()=>onSaveVersion(version,draft),()=>setEditing(null))}
          className="rounded bg-[#346ef6] px-2 py-1 text-white">保存配色</button>
         <button type="button" disabled={working} onClick={()=>setEditing(null)} className="ml-1">取消</button></>:
         canManage?<><button type="button" disabled={working||adding||editing!==null} className="text-[#0053da] disabled:opacity-40" onClick={()=>{
          setDraft({remark:version.remark,isActive:version.isActive,patternImageAssetId:version.patternImageAssetId});
          setEditing(version.id);}}>编辑</button>
          <button type="button" disabled={working||adding||editing!==null} className="ml-2 text-rose-600 disabled:opacity-40" onClick={()=>setConfirmRemove(version)}>删除</button></>:<span className="text-slate-400">只读</span>}
       </td>
      </tr>;})}
      {adding&&canManage?<tr className="bg-[#f3f2ff]">
       <td className="px-3 py-2 text-xs">{newDraft.patternImageAssetId&&stagedThumbs.get(newDraft.patternImageAssetId)&&<img alt="新配色花型图" className="mb-1 h-14 w-14 rounded object-cover" src={stagedThumbs.get(newDraft.patternImageAssetId)}/>}
        {onUploadPatternImage&&<label className="cursor-pointer text-blue-700">{newDraft.patternImageAssetId?'更换图片':'上传花型图'}<input type="file" aria-label="新配色花型图" className="sr-only" disabled={working} accept="image/jpeg,image/png,image/webp,image/gif" onChange={event=>{
         const file=event.target.files?.[0];event.target.value='';if(!file)return;
         void call(async()=>{if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)||!file.size||file.size>20*1024*1024)throw Error('请选择20MB以内的图片');
          const id=await onUploadPatternImage(file);const url=URL.createObjectURL(file);stagedUrls.current.push(url);setStagedThumbs(before=>new Map(before).set(id,url));setNewDraft(before=>({...before,patternImageAssetId:id}));});
        }}/></label>}
        {newDraft.patternImageAssetId&&<button disabled={working} className="ml-2 text-rose-700" onClick={()=>setNewDraft(before=>({...before,patternImageAssetId:null}))}>移除图片</button>}
       </td>
       <td className="px-3 py-2 text-xs" title="保存时由服务端分配最终配色序号">下一配色 {nextColorwayNo}</td>
       <td className="px-3 py-2 text-xs">{master.masterNo}-{nextColorwayNo} (预计)</td>
       <td className="px-3 py-2"><input aria-label="新版本备注" maxLength={500}
        value={newDraft.remark} onChange={e=>setNewDraft({...newDraft,remark:e.target.value})}
        className="w-44 rounded border px-2 py-1"/></td>
       <td className="px-3 py-2"><input aria-label="新版本启用" type="checkbox" checked={newDraft.isActive}
        onChange={e=>setNewDraft({...newDraft,isActive:e.target.checked})}/></td>
       <td className="px-3 py-2 whitespace-nowrap">
        <button disabled={working} type="button" className="rounded bg-[#346ef6] px-2 py-1 text-white"
         onClick={()=>call(()=>onAdd(newDraft),()=>setAdding(false))}>保存新配色</button>
        <button type="button" disabled={working} onClick={()=>setAdding(false)} className="ml-2">取消</button>
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
      disabled={working} onClick={()=>call(()=>onDeleteVersion(confirmRemove),()=>setConfirmRemove(null))}>确认删除</button>
     <button type="button" onClick={()=>setConfirmRemove(null)}>取消</button>
    </div></div>:null}
   <footer className="border-t px-4 py-2 text-[11px] text-slate-500">题材与颜色标签由花型统一维护。每个配色保留独立花型图；上传、删除图片与备注、启停一起保存，取消不改变原关联。配色序号保存后永久只读。</footer>
  </div>
 </div>;
}
export interface PatternLibraryV2Props{
 apiFetch:typeof fetch;canManage?:boolean;allowExport?:boolean;onCreateMaster?():void;onEditorStateChange?(active:boolean):void;
 onShareMaster?(master:PatternMasterItem):void;
 onUploadPatternImage?(file:File):Promise<string>;
 resolvePatternImages?(ids:string[],variant:'thumbnail'|'display'|'original',signal?:AbortSignal):Promise<Map<string,string>>;
}
export function PatternLibraryV2({apiFetch,canManage=false,allowExport=true,onCreateMaster,onEditorStateChange,onUploadPatternImage,resolvePatternImages,onShareMaster}:PatternLibraryV2Props){
 const imageResolver=useCallback((ids:string[],variant:'thumbnail'|'display'|'original',signal?:AbortSignal)=>resolvePatternImages?resolvePatternImages(ids,variant,signal):resolveImageUrls(apiFetch,ids,variant,signal),[apiFetch,resolvePatternImages]);
 const [filters,setFilters]=useState<PatternFilters>({...initialPatternFilters});
 const [page,setPage]=useState<PatternPage|null>(null),[loading,setLoading]=useState(false);
 const [error,setError]=useState(''),[retry,setRetry]=useState(0);
 const [topics,setTopics]=useState<CatalogTag[]>([]),[colors,setColors]=useState<CatalogTag[]>([]);
 const [tagsError,setTagsError]=useState('');
 const [thumbs,setThumbs]=useState<Map<string,string>>(new Map());
 const [selected,setSelected]=useState<PatternMasterItem|null>(null);
 const [editingItems,setEditingItems]=useState<PatternVersionItem[]>([]);
 const [editorThumbs,setEditorThumbs]=useState<Map<string,string>>(new Map());
 const [next,setNext]=useState(1),[editorLoading,setEditorLoading]=useState(false);
 const [editorError,setEditorError]=useState('');
 const [preview,setPreview]=useState<PatternVersionItem|null>(null);
 const [original,setOriginal]=useState<string|null>(null),[previewError,setPreviewError]=useState('');
 const listGuard=useRef(createLatestRequestGuard()),previewGuard=useRef(createLatestRequestGuard());
 const editGuard=useRef(createLatestRequestGuard());
 const dispatch=(action:Parameters<typeof reducePatternFilters>[1])=>setFilters(f=>reducePatternFilters(f,action));
 useEffect(()=>{
  const ctrl=new AbortController();
  Promise.all([loadCatalogTags(apiFetch,'topic',ctrl.signal),loadCatalogTags(apiFetch,'color',ctrl.signal)])
   .then(([a,b])=>{if(!ctrl.signal.aborted){setTopics(a);setColors(b);}})
   .catch(()=>{if(!ctrl.signal.aborted)setTagsError('标签加载失败，请刷新重试。');});
  return ()=>ctrl.abort();
 },[apiFetch]);
 useEffect(()=>{
  const ctrl=new AbortController(),rev=listGuard.current.next();
  setLoading(true);setError('');setThumbs(new Map());
  const timer=setTimeout(async()=>{
   try{
    const data=await fetchPatternPage(apiFetch,filters,ctrl.signal);
    if(ctrl.signal.aborted||!listGuard.current.isCurrent(rev))return;
    setPage(data);setLoading(false);
    const ids=[...new Set(data.items.flatMap(m=>m.versions.map(v=>v.patternImageAssetId).filter((s):s is string=>!!s)))];
    const map=new Map<string,string>();
    for(const batch of chunks(ids,throttle)){
     try{
      const value=await imageResolver(batch,'thumbnail',ctrl.signal);
      if(ctrl.signal.aborted||!listGuard.current.isCurrent(rev))return;
      for(const [k,v] of value)map.set(k,v);
      setThumbs(new Map(map));
     }catch{/* Missing/expired asset stays a non-clickable placeholder. */}
    }
   }catch{
    if(!ctrl.signal.aborted&&listGuard.current.isCurrent(rev)){setLoading(false);setError('花型数据加载失败，请重试。');}
   }
  },filters.number?180:0);
  return ()=>{clearTimeout(timer);ctrl.abort();listGuard.current.cancel();};
 },[apiFetch,filters,retry,imageResolver]);
 const openEdit=async(master:PatternMasterItem)=>{
  onEditorStateChange?.(true);
  setSelected(master);setEditingItems([]);setEditorThumbs(new Map());setEditorError('');setEditorLoading(true);
  const rev=editGuard.current.next();
  try{
   const result=await fetchMasterColorways(apiFetch,master);
   if(editGuard.current.isCurrent(rev)){
    setEditingItems(result.items);setNext(result.nextColorwayNo);
    const ids=[...new Set(result.items.map(v=>v.patternImageAssetId).filter((x):x is string=>!!x))];
    const signed=new Map<string,string>();
    for(const batch of chunks(ids,throttle)){
     try{const urls=await imageResolver(batch,'thumbnail');
      if(!editGuard.current.isCurrent(rev))return;
      for(const [k,v] of urls)signed.set(k,v);
      setEditorThumbs(new Map(signed));
     }catch{/* leave inaccessible originals as placeholders */}
    }
   }
  }catch(e){if(editGuard.current.isCurrent(rev))setEditorError(e instanceof Error?e.message:'配色编辑加载失败');}
  finally{if(editGuard.current.isCurrent(rev))setEditorLoading(false);}
 };
 const refreshEdit=async(master:PatternMasterItem)=>{
  const revision=editGuard.current.next();
  const result=await fetchMasterColorways(apiFetch,master);
  if(!editGuard.current.isCurrent(revision))return;
  if(selected?.id===master.id){
   setEditingItems(result.items);setNext(result.nextColorwayNo);
   const identities=[...new Set(result.items.map(item=>item.patternImageAssetId).filter((id):id is string=>Boolean(id)))],urls=new Map<string,string>();
   for(const batch of chunks(identities,throttle)){
    try{for(const [id,url] of await imageResolver(batch,'thumbnail'))urls.set(id,url);}catch{/* Unavailable image remains a placeholder. */}
    if(!editGuard.current.isCurrent(revision))return;
   }
   setEditorThumbs(urls);
  }
  try{setColors(await loadCatalogTags(apiFetch,'color'));}
  catch{/* Historical linked colors are still provided by the version details. */}
  setRetry(x=>x+1);
 };
 const closePreview=useCallback(()=>{previewGuard.current.cancel();setPreview(null);setOriginal(null);setPreviewError('');},[]);
 useEffect(()=>{
  if(!preview)return;
  const ctrl=new AbortController(),rev=previewGuard.current.next();
  setOriginal(null);setPreviewError('');
  (async()=>{try{
   if(!preview.patternImageAssetId)throw Error('No original');
   const urls=await imageResolver([preview.patternImageAssetId],'original',ctrl.signal);
   if(!ctrl.signal.aborted&&previewGuard.current.isCurrent(rev)){
    const url=urls.get(preview.patternImageAssetId);
    if(!url)throw Error('No image URL');setOriginal(url);
   }
  }catch{if(!ctrl.signal.aborted&&previewGuard.current.isCurrent(rev))setPreviewError('原图读取失败，请关闭后重试。');}})();
  return ()=>{ctrl.abort();previewGuard.current.cancel();};
 },[preview,apiFetch,imageResolver]);
 const selectedVersionSave=async(item:PatternVersionItem,draft:{remark:string;isActive:boolean;patternImageAssetId?:string|null})=>{
  await saveColorwayProperties(apiFetch,item,draft);
  try{await refreshEdit(selected!);}catch{setEditorError('配色已保存，但刷新失败。请重新打开花型核对，不要重复保存。');}
 };
 const add=async(input:{remark:string;isActive:boolean;patternImageAssetId?:string|null})=>{
  if(!selected)throw Error('Missing master');
  // A successful POST permanently reserves its number. Failure of the following
  // GET must NEVER leave the Add button treating that committed POST as retryable.
  await createNextColorway(apiFetch,selected.id,input);
  try{await refreshEdit(selected);}
  catch{setEditorError('新配色已保存，但刷新失败。请重新打开配色资料核对，切勿重复新增。');}
 };
 const masterTagsSave=async(ids:string[])=>{
  if(!selected)throw Error('Missing master');
  await saveMasterTopicTags(apiFetch,selected.id,ids);
  // Refresh list and editor; newly loaded list is canonical for parent badges.
  setSelected({...selected,topicTags:topics.filter(t=>ids.includes(t.id))});
  setRetry(x=>x+1);
 };
 const masterColorsSave=async(ids:string[],newColorTags:string[]=[])=>{
  if(!selected)throw Error('未选择花型');
  await saveMasterColorTags(apiFetch,selected.id,ids,newColorTags);
  try{const associated=await fetchMasterColorTags(apiFetch,selected.id);setSelected({...selected,colorTags:associated});
   setColors(await loadCatalogTags(apiFetch,'color'));}
  catch{setEditorError('花型颜色已保存，但刷新失败。请重新打开花型核对。');}
  setRetry(value=>value+1);
 };
 const uploadPatternImage=async(file:File)=>onUploadPatternImage?onUploadPatternImage(file):(await uploadImageAsset(file,'product_image',{apiFetch})).id;
 const deleteVersion=async(item:PatternVersionItem)=>{
  if(!selected)throw Error('Missing master');
  await deleteUnreferencedColorway(apiFetch,item.id);await refreshEdit(selected);
 };
 const toggleStatus=async(enabled:boolean)=>{
  if(!selected)throw Error('Missing master');
  await patchMasterStatus(apiFetch,selected.id,enabled);setSelected({...selected,isActive:enabled});
  setRetry(x=>x+1);
 };
 return <section aria-label="V2 花型库" className="flex min-h-[520px] flex-col gap-3 bg-[#faf8ff] p-3 text-[#191b24] sm:p-5">
  <header className="flex items-center justify-between gap-3">
   <h1 className="text-xl font-semibold">花型库</h1>
   {allowExport?<CatalogExportButton apiFetch={apiFetch} listUrl={buildPatternUrl("/api/v2/pattern-catalog",filters)} filename="花型资料.xlsx"/>:null}
   {canManage&&onCreateMaster?<button onClick={onCreateMaster} type="button"
    className="rounded bg-[#346ef6] px-3 py-2 text-xs text-white">新增花型</button>:null}
  </header>
  <div className={box+' flex flex-wrap items-center gap-2 px-3 py-2'}>
   <label className="flex items-center gap-1">
    <Search size={14} className="text-[#737686]"/>
    <input aria-label="搜索编号" placeholder="搜索编号..." value={filters.number}
     onChange={e=>dispatch({type:'number',value:e.target.value})} className="w-40 px-2 py-1 text-xs outline-[#346ef6]"/>
   </label>
   <div className="flex flex-wrap items-center gap-1 text-xs" aria-label="题材标签">
    <span className="text-slate-500">题材标签</span>{topics.map(t=><button key={t.id} type="button"
     aria-pressed={filters.topicTagIds.includes(t.id)} onClick={()=>dispatch({type:'topic',id:t.id})}
     className={'rounded-full px-2 py-1 '+(filters.topicTagIds.includes(t.id)?'bg-[#346ef6] text-white':'bg-[#eef1fd] text-[#31447b]')}>{t.name}</button>)}
   </div>
   <div className="flex flex-wrap items-center gap-1 text-xs" aria-label="颜色标签">
    <span className="text-slate-500">颜色标签</span>{colors.map(t=><button key={t.id} type="button"
     aria-pressed={filters.colorTagIds.includes(t.id)} onClick={()=>dispatch({type:'color',id:t.id})}
     className={'rounded-full px-2 py-1 '+(filters.colorTagIds.includes(t.id)?'bg-[#346ef6] text-white':'bg-[#eef1fd] text-[#31447b]')}>{t.name}</button>)}
   </div>
   <label className="ml-auto flex items-center gap-1 text-xs">
    <input type="checkbox" checked={filters.includeInactive} onChange={e=>dispatch({type:'includeInactive',value:e.target.checked})}/>
    包含停用</label>
   <button type="button" onClick={()=>dispatch({type:'reset'})} className="text-xs text-[#0053da] underline">清空筛选</button>
  </div>
  {tagsError?<p role="status" className="text-xs text-amber-700">{tagsError}</p>:null}
  {loading?<p role="status" className="p-3 text-sm text-slate-500">正在加载花型…</p>:null}
  {error?<p role="alert" className="p-3 text-sm text-rose-700">{error}
   <button type="button" onClick={()=>setRetry(n=>n+1)} className="ml-2 underline">重试</button></p>:null}
  {!loading&&!error&&page?<><PatternMasterRows items={page.items} thumbnailUrls={thumbs} onShare={onShareMaster}
   onPreview={setPreview} onEdit={openEdit} canManage={canManage}/>
   <footer className="flex items-center justify-between gap-2 text-xs text-slate-600">
    <span>共 {page.total} 个花型 · 每页 {page.limit} 个</span>
    <div className="flex gap-2">
     <button type="button" aria-label="上一页" disabled={page.offset===0} onClick={()=>dispatch({type:'page',offset:Math.max(0,page.offset-page.limit)})}
      className="rounded border px-2 py-1"><ChevronLeft size={16}/></button>
     <button type="button" aria-label="下一页" disabled={page.offset+page.limit>=page.total}
      onClick={()=>dispatch({type:'page',offset:page.offset+page.limit})} className="rounded border px-2 py-1"><ChevronRight size={16}/></button>
    </div>
   </footer></>:null}
  {selected?<>{editorLoading?<div role="status" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 text-white">正在加载配色…</div>:
   editorError?<div role="alert" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
    <div className="rounded bg-white p-5 text-sm">{editorError}
     <button type="button" onClick={()=>setSelected(null)} className="ml-3 underline">关闭</button>
     <button type="button" onClick={()=>openEdit(selected)} className="ml-3 underline">重试</button>
    </div></div>:
   <PatternColorwayEditor key={selected.id} master={selected} items={editingItems}
    nextColorwayNo={next} topics={topics} colors={colors} canManage={canManage}
    thumbnailUrls={editorThumbs} onPreview={setPreview}
    onClose={()=>{editGuard.current.cancel();setSelected(null);onEditorStateChange?.(false);}} onSaveVersion={selectedVersionSave}
    onAdd={add} onSaveMasterTags={masterTagsSave}
    onSaveMasterColorTags={masterColorsSave} onUploadPatternImage={uploadPatternImage}
    onToggleMaster={toggleStatus} onDeleteVersion={deleteVersion}/>}</>:null}
  {preview?<div role="presentation" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-3">
   <div role="dialog" aria-modal="true" aria-label={'花型原图 '+preview.patternNo}
    className="flex max-h-[95vh] max-w-4xl flex-col overflow-hidden rounded-lg bg-white">
    <div className="flex justify-between border-b px-4 py-2 text-sm"><span>{preview.patternNo}</span>
     <button type="button" onClick={closePreview} aria-label="关闭原图"><X size={18}/></button></div>
    <div className="overflow-auto p-3">
     {previewError?<p role="alert" className="text-rose-700">{previewError}</p>:
      original?<img src={original} alt={'花型原图 '+preview.patternNo} className="max-h-[75vh] max-w-full object-contain"/>:
       <p className="text-slate-500">正在加载原图…</p>}
    </div>
   </div>
  </div>:null}
 </section>;
}
export default PatternLibraryV2;
