import { ActionIcon } from './ActionIcon';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { type ImageRole, type EditorImages } from './productEditorModel';

const roles:{key:ImageRole;name:string}[]=[
 {key:'fabricDisplay',name:'面料大图'},{key:'detail',name:'面料细节图'},{key:'aiEffect',name:'效果图'}
];

const tag='rounded-md border border-[#c3c6d7] bg-white px-3 py-2 text-xs text-[#191b24]';

export interface ProductImageTabsProps{
 images:EditorImages;selected:string[];activeRole:ImageRole;
 onRole(role:ImageRole):void;onSelect(id:string,checked:boolean):void;
 onDeleteSelected():void;onMove(index:number,direction:-1|1):void;
 urls:Map<string,string>;canManage:boolean;onUploadClick?():void;
 onReplaceClick?(index:number):void;
}

export function ProductImageTabs({images,selected,activeRole,onRole,onSelect,onDeleteSelected,
 onMove,urls,canManage,onUploadClick,onReplaceClick}:ProductImageTabsProps){
 return <section className="rounded-lg border border-[#c3c6d7] bg-white">
  <div role="tablist" aria-label="产品三类图片" className="flex flex-wrap items-center border-b border-[#e2e1ee]">
   {roles.map(r=><button key={r.key} type="button" role="tab"
    aria-selected={activeRole===r.key} onClick={()=>onRole(r.key)}
    className={'border-b-2 px-4 py-3 text-xs font-medium '+(activeRole===r.key?
     'border-[#346ef6] text-[#0053da]':'border-transparent text-slate-600')}>
    {r.name} <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">{images[r.key].length} / 10</span>
   </button>)}
  </div>
  <p className="px-4 pt-2 text-[11px] text-slate-500">切换类别保留已选图片与排序；保存时一次提交全部类别。每类首张为该类主图。</p>
  <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-2">
   {canManage?<button type="button" disabled={selected.length===0} onClick={onDeleteSelected}
    className={tag+' disabled:opacity-40'}><ActionIcon name="delete"/>删除选中（{selected.length}）</button>:null}
   {canManage&&onUploadClick&&images[activeRole].length<10?
    <button type="button" onClick={onUploadClick}
     className="rounded bg-[#346ef6] px-3 py-2 text-xs text-white"><ActionIcon name="upload"/>上传图片</button>:null}
  </div>
  <div role="tabpanel" aria-label={roles.find(x=>x.key===activeRole)?.name} className="flex min-h-40 flex-wrap gap-3 bg-[#f8fafc] p-4">
   {images[activeRole].length?images[activeRole].map((id,index)=><div key={id}
    className="w-28 space-y-1 rounded border border-[#e2e1ee] bg-white p-1">
    <div className="relative h-24 w-full">
     {urls.get(id)?<img src={urls.get(id)} alt={roles.find(x=>x.key===activeRole)?.name+' 第'+(index+1)+'张'}
      loading="lazy" className="h-24 w-full rounded object-contain"/>:
      <span className="flex h-24 items-center justify-center rounded bg-slate-100 text-[11px] text-slate-500">图片暂不可用</span>}
     {canManage?<input type="checkbox" aria-label={'选中第'+(index+1)+'张图片'}
      checked={selected.includes(id)} onChange={e=>onSelect(id,e.target.checked)}
      className="absolute left-1 top-1 h-4 w-4"/>:null}
    </div>
    {canManage&&onReplaceClick?<button type="button" onClick={()=>onReplaceClick(index)}
     aria-label={'替换第'+(index+1)+'张图片'}
     className="block w-full rounded border px-1 py-0.5 text-center text-[10px] text-[#0053da]">
     <ActionIcon name="refresh"/>替换第{index+1}张</button>:null}
    <div className="flex items-center justify-between gap-1 text-[10px]">
     <span>{index===0?'主图':'第 '+(index+1)+' 张'}</span>
     {canManage?<span className="flex gap-1">
      <button type="button" aria-label={'图片'+(index+1)+'前移'} disabled={index===0}
       onClick={()=>onMove(index,-1)} className="rounded border px-1 disabled:opacity-30"><ChevronUp size={12}/></button>
      <button type="button" aria-label={'图片'+(index+1)+'后移'}
       disabled={index===images[activeRole].length-1} onClick={()=>onMove(index,1)}
       className="rounded border px-1 disabled:opacity-30"><ChevronDown size={12}/></button>
     </span>:null}
    </div>
   </div>):<p className="text-xs text-slate-500">当前分类暂无图片</p>}
  </div>
 </section>;
}

