import React from 'react';
import {Image as ImageIcon, Trash2} from 'lucide-react';
import type {ProductPatternChoice} from './productEditorModel';

/** Shows each selected colorway with its own signed thumbnail, identity and removal action. */
export function BatchSelectedColorways({items,urls,failedIds,onRemove,onImageError,disabled=false}:{
 items:ProductPatternChoice[];
 urls:Map<string,string>;
 failedIds:Set<string>;
 onRemove(item:ProductPatternChoice):void;
 onImageError?(id:string):void;
 disabled?:boolean;
}){
 return <ul aria-label="已选花型配色" className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
  {items.map(item=>{
   const id=item.patternImageAssetId,url=id?urls.get(id):undefined;
   const thumbnail=url&&!failedIds.has(item.id);
   return <li key={item.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-[#dee4f2] bg-[#f7f9ff] p-2">
    {thumbnail?<img src={url} alt={'已选花型配色 '+item.patternNo+' 缩略图'} width={60} height={60}
     className="h-[60px] w-[60px] shrink-0 rounded-md border border-[#dee4f2] bg-white object-cover" loading="lazy" onError={()=>onImageError?.(item.id)}/>:
     <span role="img" aria-label={id?'花型图片暂不可用':'花型图片未上传'}
      className="flex h-[60px] w-[60px] shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-[#c3c6d7] bg-white text-[10px] text-slate-500">
      <ImageIcon size={15} aria-hidden="true"/>{id?'图片不可用':'待上传'}
     </span>}
    <strong className="min-w-0 flex-1 break-all text-xs font-medium text-[#243247]">{item.patternNo}</strong>
    <button type="button" disabled={disabled} aria-label={'移除 '+item.patternNo}
     onClick={()=>onRemove(item)} title={'移除 '+item.patternNo}
     className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-2 focus-visible:outline-[#346ef6] disabled:opacity-40">
     <Trash2 size={15} aria-hidden="true"/></button>
   </li>;
  })}
 </ul>;
}
