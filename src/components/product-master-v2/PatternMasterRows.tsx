import {useEffect,useRef,useState} from 'react';
import {ArrowDown,ArrowUp,ArrowUpDown,Edit3,MoreHorizontal,Pencil,Trash2} from 'lucide-react';
import {formatPatternDimensions} from '../../lib/patternDimensions';
import {formatPatternTags} from './patternPresentation';
import {PatternThumbnail} from './PatternThumbnail';
import type {PatternMasterItem,PatternVersionItem} from './patternModel';

export function PatternMasterRows({items,thumbnailUrls,onPreview,onEdit,onDelete,onCreateProduct,onQuickTopicEdit,onViewProducts,onRetryThumbnail,imagesPending,canManage=false,sort='newest',onSort}:{
 items:PatternMasterItem[];thumbnailUrls:Map<string,string>;
 onPreview(version:PatternVersionItem):void;onEdit(master:PatternMasterItem):void;onDelete?(master:PatternMasterItem):void;canManage?:boolean;
 onShare?(master:PatternMasterItem):void;onCreateProduct?(master:PatternMasterItem):void;
 onQuickTopicEdit?(master:PatternMasterItem):void;onViewProducts?(master:PatternMasterItem):void;
 onRetryThumbnail?(assetId:string):Promise<string|undefined>;imagesPending?:boolean;
 sort?:'newest'|'numberAsc'|'numberDesc';onSort?():void;
}){
 const [menu,setMenu]=useState<string|null>(null);
 const menuRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!menu)return;
  const outside=(event:PointerEvent)=>{
   if(event.target instanceof HTMLElement&&!menuRef.current?.contains(event.target)&&!event.target.closest('dialog,[role="alertdialog"]'))setMenu(null);
  };
  const escape=(event:KeyboardEvent)=>{
   if(event.key!=='Escape'||event.defaultPrevented||!menuRef.current?.contains(document.activeElement))return;
   setMenu(null);
   menuRef.current.querySelector('button')?.focus();
  };
  document.addEventListener('pointerdown',outside);
  document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[menu]);
 const SortIcon=sort==='numberAsc'?ArrowUp:sort==='numberDesc'?ArrowDown:ArrowUpDown;
 return <div role="table" aria-label="花型母版列表" className={'pattern-master-table'}>
  <div role="row" className="pattern-master-head">
   <span role="columnheader" aria-sort={sort==='newest'?'none':sort==='numberAsc'?'ascending':'descending'}>
    {onSort?<button type="button" aria-label={'按花型号排序 '+(sort==='numberAsc'?'降序':'升序')} onClick={onSort}
     className="inline-flex min-h-10 items-center gap-1 rounded text-blue-800 focus-visible:outline-2 max-md:min-h-11">花型号 <SortIcon size={13}/></button>:'花型号'}
   </span><span role="columnheader">题材标签</span><span role="columnheader">配色版本</span><span role="columnheader">关联产品</span><span role="columnheader">操作</span>
  </div>
  {items.map(master=><div key={master.id} role="row" className="pattern-master-row">
   <div role="cell" className="pattern-master-identity min-w-0 break-words"><strong className="block text-sm">{master.masterNo}</strong>
    <span className="mt-1 block text-xs text-slate-600" aria-label={master.masterNo+' 花型尺寸'}>{formatPatternDimensions(master)}</span>
   </div>
   <div role="cell" className="pattern-master-topics min-w-0 break-words text-xs text-slate-700">
    {canManage&&onQuickTopicEdit?<button type="button" aria-label={'修改 '+master.masterNo+' 题材标签'} title="直接修改题材标签"
     onClick={()=>onQuickTopicEdit(master)} className="inline-flex min-h-10 max-w-full items-center gap-1 rounded px-1 text-left text-blue-800 focus-visible:outline-2 max-md:min-h-11">
     <span className="min-w-0 break-words">{master.topicTags.length?formatPatternTags(master.topicTags):'添加题材'}</span><Pencil size={12} aria-hidden="true" className="shrink-0"/>
    </button>:formatPatternTags(master.topicTags)}
   </div>
   <div role="cell" className="pattern-master-colors flex min-w-0 flex-wrap gap-2">
    {master.versions.length?master.versions.map(version=>{
     const id=version.patternImageAssetId,url=id?thumbnailUrls.get(id):undefined;
     return <div key={version.id} className="pattern-master-tile">
      <PatternThumbnail key={url??id??''} url={url} hasImage={!!id} pending={!!id&&!url&&imagesPending}
       alt={version.patternNo} onOpen={()=>onPreview(version)} onRetry={id&&onRetryThumbnail?()=>onRetryThumbnail(id):undefined}/>
      <strong title={version.patternNo} className="pattern-master-colorway-number">{version.patternNo}</strong>
     </div>;
    }):<span className="text-xs text-slate-600">尚无配色版本</span>}
   </div>
   <div role="cell" className="pattern-master-linked">
    {master.productCount===undefined?<span title="尚未读取关联产品统计">待统计</span>:onViewProducts?
     <button type="button" aria-label={'查看 '+master.masterNo+' 关联产品 '+master.productCount+' 个'} onClick={()=>onViewProducts(master)}
      className="min-h-10 rounded px-2 text-blue-800 hover:underline focus-visible:outline-2 max-md:min-h-11"><span className="md:hidden">关联产品 </span>{master.productCount}</button>:<span>{master.productCount}</span>}
   </div>
   <div role="cell" className="pattern-master-actions">
    <button type="button" aria-label={'编辑花型及配色 '+master.masterNo}
     title={canManage?'编辑花型及配色':'查看花型及配色'} onClick={()=>onEdit(master)}
     className="inline-grid min-h-10 min-w-10 place-items-center rounded text-blue-800 hover:bg-blue-50 focus-visible:outline-2 max-md:min-h-11 max-md:min-w-11"><Edit3 size={16}/></button>
    {(canManage&&onDelete||onCreateProduct)&&<div ref={menu===master.id?menuRef:undefined} className="pattern-master-more">
     <button type="button" aria-label={'更多操作 '+master.masterNo} aria-expanded={menu===master.id}
      onClick={()=>setMenu(menu===master.id?null:master.id)}
      className="pattern-master-more-toggle size-11 place-items-center rounded text-slate-700 focus-visible:outline-2"><MoreHorizontal size={18}/></button>
     <div className="pattern-master-more-items" data-expanded={menu===master.id}>
      {canManage&&onDelete?<button type="button" aria-label={'删除花型 '+master.masterNo} title="删除整个花型" onClick={()=>onDelete(master)}
       className="inline-flex min-h-10 min-w-10 items-center justify-center gap-1 rounded px-2 text-rose-700 hover:bg-rose-50 focus-visible:outline-2 max-md:min-h-11">
       <Trash2 size={15}/><span className="md:hidden">删除花型</span></button>:null}
      {onCreateProduct&&<button type="button" className="min-h-10 rounded px-2 text-xs text-blue-800 focus-visible:outline-2 max-md:min-h-11"
       aria-label={'使用花型 '+master.masterNo+' 的全部配色创建产品'} disabled={!master.isActive||!master.versions.some(v=>v.isActive)}
       onClick={()=>onCreateProduct(master)}>创建产品</button>}
     </div>
    </div>}
   </div>
  </div>)}
  {!items.length?<p className="py-16 text-center text-sm text-slate-600">没有匹配的花型，可调整或清空筛选条件。</p>:null}
 </div>;
}
