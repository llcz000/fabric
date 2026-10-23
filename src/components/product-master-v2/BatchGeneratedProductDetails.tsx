import React from 'react';
import type {FabricCatalogItem} from './fabricModel';
import type {BatchPreviewItem} from './productBatchModel';

/** Full, untruncated fabric specs for every planned product. Batch identity and duplicate status stay server-derived. */
export function BatchGeneratedProductDetails({items,fabric}:{
 items:BatchPreviewItem[];fabric:FabricCatalogItem;
}){
 const present=(value:string|null)=>value?.trim()||'未填写';
 const details=[
  ['面料品号',fabric.fabricNo],
  ['品名',fabric.fabricName],
  ['成分',present(fabric.composition)],
  ['克重',fabric.weightValue===null?'未填写':fabric.weightValue+' '+(fabric.weightUnit??'')],
  ['门幅',fabric.widthValue===null?'未填写':fabric.widthValue+' cm'],
 ];
 return <div className="space-y-2" aria-label="自动生成产品信息明细">
  {items.map(item=><article key={item.patternColorwayId} aria-label={'产品 '+item.productNo+' 预览'}
   className="rounded-lg border border-[#e2e8f0] bg-[#fafbfe] px-3 py-3">
   <header className="flex flex-wrap items-start justify-between gap-2">
    <div className="min-w-0"><span className="block text-[11px] text-slate-500">产品货号</span>
     <strong className="block break-all text-sm font-semibold text-[#17212e]">{item.productNo}</strong></div>
    <span className={'shrink-0 rounded px-2 py-1 text-xs '+(item.existing?
     'bg-amber-50 text-amber-700':'bg-emerald-50 text-emerald-700')}>{item.existing?'已存在，跳过':'待创建'}</span>
   </header>
   <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-200 pt-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
    {details.map(([label,value])=><div key={label} className="min-w-0">
     <dt className="mb-1 text-[11px] text-slate-500">{label}</dt>
     <dd className="whitespace-normal break-words text-xs leading-5 text-[#273449]">{value}</dd>
    </div>)}
   </dl>
   {fabric.remark?.trim()?<div className="mt-2 min-w-0 border-t border-slate-100 pt-2">
    <span className="block text-[11px] text-slate-500">面料备注</span>
    <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-[#273449]">{fabric.remark}</p>
   </div>:null}
  </article>)}
 </div>;
}
