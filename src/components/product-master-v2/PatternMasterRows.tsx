import {patternBox as box,formatPatternTags as asTags} from './patternPresentation';
import { Image as ImageIcon, Edit3, Trash2, ArrowUp, ArrowDown, ArrowUpDown, Pencil } from 'lucide-react';
import type { CatalogTag } from './catalogModel';
import { type PatternMasterItem, type PatternVersionItem } from './patternModel';



export function PatternMasterRows({items,thumbnailUrls,onPreview,onEdit,onDelete,onShare,onCreateProduct,onQuickTopicEdit,canManage=false,sort='newest',onSort}:{
 items:PatternMasterItem[];thumbnailUrls:Map<string,string>;
 onPreview(version:PatternVersionItem):void;onEdit(master:PatternMasterItem):void;onDelete?(master:PatternMasterItem):void;canManage?:boolean;
 onShare?(master:PatternMasterItem):void;onCreateProduct?(version:PatternMasterItem):void;
 onQuickTopicEdit?(master:PatternMasterItem):void;
 sort?:'newest'|'numberAsc'|'numberDesc';onSort?():void;
}){
 return <div role="table" aria-label="花型母版列表" className={box+' overflow-x-auto'}>
  <div role="row" className="flex min-w-[640px] gap-3 border-b border-[#c3c6d7] bg-[#fbfcfd] px-3 py-2 text-xs text-[#434655]">
   <span role="columnheader" aria-sort={sort==='newest'?'none':sort==='numberAsc'?'ascending':'descending'} className="w-32 shrink-0">
    {onSort?<button type="button" aria-label={'按花型号排序 '+(sort==='numberAsc'?'降序':'升序')} onClick={onSort}
     className="inline-flex items-center gap-1 text-[#0053da] hover:underline">花型号 {sort==='numberAsc'?<ArrowUp size={12}/>:sort==='numberDesc'?<ArrowDown size={12}/>:<ArrowUpDown size={12}/>}</button>:'花型号'}
   </span><span role="columnheader" className="w-32 shrink-0">题材标签</span><span role="columnheader" className="min-w-0 flex-1">配色版本</span><span role="columnheader" className="w-28 shrink-0 text-center">操作</span>
  </div>
  {items.map(master=><div key={master.id} role="row"
   className="v2-library-row flex min-w-[640px] items-center gap-3 border-b border-[#e2e1ee] px-3 py-3 last:border-0 hover:bg-[#fcfdff]">
   <div role="cell" className="w-32 shrink-0">
    <strong className="block text-sm text-[#191b24]">{master.masterNo}</strong>
    
   </div>
   <div role="cell" className="w-32 shrink-0 min-w-0 break-words text-xs text-[#737686]">
    {canManage&&onQuickTopicEdit?<button type="button" aria-label={'修改 '+master.masterNo+' 题材标签'}
     title="直接修改题材标签" onClick={()=>onQuickTopicEdit(master)}
     className="group inline-flex max-w-full items-start gap-1 rounded-md px-1 py-1 text-left text-[#31447b] hover:bg-[#eef1fd] focus-visible:outline-2 focus-visible:outline-[#346ef6]">
     <span className="min-w-0 break-words">{master.topicTags.length?asTags(master.topicTags):'添加题材'}</span>
     <Pencil size={12} aria-hidden="true" className="mt-0.5 shrink-0 opacity-60 group-hover:opacity-100"/>
    </button>:asTags(master.topicTags)}
   </div>

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
      
     </div>;
    }):<span className="text-xs text-[#737686]">尚无配色版本</span>}
   </div>
   <div role="cell" className="w-28 shrink-0 text-center">
    <button type="button" aria-label={'编辑花型及配色 '+master.masterNo} onClick={()=>onEdit(master)}
     className="inline-flex items-center gap-1 rounded p-2 text-[#0053da] hover:bg-[#eef1fd]"
     title={canManage?'编辑花型及配色':'查看花型及配色'}><Edit3 size={15}/></button>
    {canManage&&onDelete?<button type="button" aria-label={'删除花型 '+master.masterNo} title="删除整个花型"
     onClick={()=>onDelete(master)} className="inline-flex items-center rounded p-2 text-rose-600 hover:bg-rose-50"><Trash2 size={15}/></button>:null}
     {onCreateProduct&&<button type="button" className="mt-1 rounded px-1 py-1 text-xs text-[#0053da] hover:bg-[#eef1fd]" aria-label={'使用花型 '+master.masterNo+' 的全部配色创建产品'} disabled={!master.isActive||!master.versions.some(v=>v.isActive)} onClick={()=>onCreateProduct(master)}>创建产品</button>}
   </div>
  </div>)}
  {!items.length?<p className="py-16 text-center text-sm text-[#737686]">没有匹配的花型，可调整或清空筛选条件。</p>:null}
 </div>;
}

