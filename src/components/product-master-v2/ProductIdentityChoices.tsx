import { ActionIcon } from './ActionIcon';
import type { FabricCatalogItem } from './fabricModel';
import { FabricSearchSelect } from './FabricSearchSelect';
import { type ProductPatternChoice } from './productEditorModel';

const show=(x:string|null|number)=>x===null||x===''?'—':x;

const heading='text-sm font-semibold text-[#191b24]';

const tag='rounded-md border border-[#c3c6d7] bg-white px-3 py-2 text-xs text-[#191b24]';

export interface ProductIdentityChoicesProps{
 version:ProductPatternChoice|null;fabric:FabricCatalogItem|null;
 canChange:boolean;onChooseVersion():void;onChooseFabric():void;
 apiFetch?:typeof fetch;onSelectFabric?(item:FabricCatalogItem):void;
 onPatternLibrary?():void;onFabricLibrary?():void;patternUrl?:string;
}

export function ProductIdentityChoices({
 version,fabric,canChange,onChooseVersion,onChooseFabric,onPatternLibrary,onFabricLibrary,patternUrl,apiFetch,onSelectFabric
}:ProductIdentityChoicesProps){
 return <div className="grid gap-3 md:grid-cols-2">
  <section className="rounded-lg border border-[#c3c6d7] bg-white p-3">
   <header className="flex items-center justify-between gap-2">
    <h2 className={heading}>花型编号与配色版本</h2>
    {onPatternLibrary?<button type="button" onClick={onPatternLibrary} className="text-xs text-[#0053da]"><ActionIcon name="next"/>去花型库维护</button>:null}
   </header>
   <button type="button" disabled={!canChange} onClick={onChooseVersion}
    aria-label="选择花型版本" className={tag+' mt-2 w-full text-left disabled:opacity-65'}>
    <span className="font-semibold">{version?.patternNo??'搜索选择完整花型编号'}</span>
    {canChange?<span className="float-right text-[#0053da]">选择 / 更换</span>:null}
   </button>
   <div className="mt-2 flex min-h-20 items-center gap-3 rounded bg-[#f8fafc] p-2 text-xs text-slate-600">
    {version&&patternUrl?<img src={patternUrl} alt={'当前配色花型 '+version.patternNo}
     className="h-14 w-14 rounded object-cover" loading="lazy"/>:
     <span className="flex h-14 w-14 items-center justify-center rounded border bg-white text-[10px] text-slate-400">
      {version?.patternImageAssetId?'图片暂不可用':'待上传'}</span>}
    <div className="space-y-1"><div>母版：{version?.patternNo.split('-')[0]??'—'} · 配色：{version?.colorwayNo??'—'}</div>
     <div>题材标签：{version?.topicTags.map(t=>t.name).join('、')||'—'}</div>
     <div className="text-slate-500">选择的是具体花型版本，不单独编辑配色身份。</div>
    </div>
   </div>
  </section>
  <section className="rounded-lg border border-[#c3c6d7] bg-white p-3">
   <header className="flex items-center justify-between gap-2">
    <h2 className={heading}>面料品号</h2>
    {onFabricLibrary?<button type="button" onClick={onFabricLibrary} className="text-xs text-[#0053da]"><ActionIcon name="next"/>去面料库维护</button>:null}
   </header>
   {apiFetch&&onSelectFabric?<FabricSearchSelect apiFetch={apiFetch} fabric={fabric} disabled={!canChange} onSelect={onSelectFabric}/>:
   <button type="button" disabled={!canChange} onClick={onChooseFabric} aria-label="选择面料" className={tag+' mt-2 w-full text-left disabled:opacity-65'}>{fabric?.fabricNo??'搜索选择面料'}</button>}
   <div className="mt-2 min-h-20 space-y-1 rounded bg-[#f8fafc] p-2 text-xs text-slate-600">
    <div>品名：<strong>{show(fabric?.fabricName??null)}</strong></div>
    <div>成分：{show(fabric?.composition??null)}</div>
    <div>克重：{fabric?.weightValue==null?'—':fabric.weightValue+' '+fabric.weightUnit} · 门幅：{fabric?.widthValue==null?'—':fabric.widthValue+' cm'}</div>
    <div className="text-slate-500">面料资料只读，请在面料库维护。</div>
   </div>
  </section>
 </div>;
}

