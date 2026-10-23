import React,{useState} from 'react';
import type {PublicPattern,PublicPreview} from '../../../server/customer-share/publicPatternProjection';

/** B1 isolated read-only view. Only receives a server-whitelisted projection.
 * An eventual approved integration must provide the safe-preview renderer after
 * checking the link, publication and image authorization for each request.
 * Never issue/store tokens or mount public routes from this component.
 */
export interface PublicPatternGalleryProps {
 pattern:PublicPattern|null;
 productNo?:string;
 productOnly?:boolean;
 renderPreview?:(previewRef:string,description:string)=>React.ReactNode;
}
function PreviewStrip({title,images,renderPreview,large=false}:{
 title:string;images:PublicPreview[];
 large?:boolean;
 renderPreview?:PublicPatternGalleryProps['renderPreview'];
}){
 const rendered=images.map((image,index)=>renderPreview?.(image.previewRef,title+' '+(index+1))??null)
  .filter(Boolean);
 return <section aria-label={title} className="space-y-2">
  <h4 className="text-xs font-semibold text-slate-600">{title}</h4>
  {rendered.length?<div className={large?'grid gap-3':'flex gap-2 overflow-x-auto pb-2'}>{rendered.map((image,index)=>
   <div key={index} className={(large?'w-full':'max-w-[240px] shrink-0')+' overflow-hidden rounded-lg border border-slate-200 bg-white'}>{image}</div>)}</div>:
   <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">暂无可展示图片</div>}
 </section>;
}
export function PublicPatternGallery({pattern,renderPreview,productNo,productOnly=false}:PublicPatternGalleryProps){
 const [chosen,setChosen]=useState<number|null>(null);
 if(!pattern||!pattern.colorways.length)return <main aria-label={productOnly?'花型产品公开展示':'花型公开展示'} className="mx-auto max-w-4xl p-6 text-slate-700">
  <h1 className="text-xl font-semibold">暂不可用</h1><p className="mt-3 text-sm">{productOnly?'该产品当前暂不可用，请稍后重试。':'该花型当前没有可展示的配色。'}</p>
 </main>;
 const current=pattern.colorways.find(c=>c.colorwayNumber===chosen)??pattern.colorways[0];
 return <main aria-label="花型公开展示" className="mx-auto max-w-4xl space-y-6 px-4 py-6 text-slate-900 sm:px-6">
  <header className="space-y-1 border-b border-slate-100 pb-4">
   <p className="text-xs text-blue-700">{productNo?'产品展示':'花型展示'} · 客户只读</p>
   <h1 className="break-words text-2xl font-bold">{productNo?'花型产品 '+productNo:'花型 '+pattern.patternNo}</h1>
  </header>
  {!productNo&&<nav aria-label="选择花型配色" className="flex flex-wrap gap-2">
   {pattern.colorways.map(c=><button key={c.colorwayNumber} type="button"
    aria-current={current.colorwayNumber===c.colorwayNumber?'true':undefined}
    onClick={()=>setChosen(c.colorwayNumber)}
    className={'rounded-full border px-4 py-2 text-sm '+(current.colorwayNumber===c.colorwayNumber?
     'border-blue-700 bg-blue-700 text-white':'border-slate-300 bg-white text-slate-700')}>
    配色 {c.colorwayNumber}
   </button>)}
  </nav>}
  {!productNo&&<section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
   <h2 className="text-lg font-semibold">配色 {current.colorwayNumber} · 花型设计图</h2>
   <PreviewStrip title="花型设计图" images={current.designImages} renderPreview={renderPreview}/>
  </section>}
  <section aria-label="关联面料" className="space-y-4">
   <h2 className="text-lg font-semibold">对应面料</h2>
   {!current.fabrics.length&&<p className="rounded-lg border bg-slate-50 p-4 text-sm text-slate-500">暂无可展示的关联面料</p>}
   {current.fabrics.map((fabric,i)=><article key={fabric.fabricNo+'-'+i} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
    <h3 className="font-semibold">{fabric.fabricNo} · {fabric.fabricName}</h3>
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
     <div><dt className="text-xs text-slate-500">成分</dt><dd>{fabric.composition||'—'}</dd></div>
     <div><dt className="text-xs text-slate-500">克重</dt><dd>{fabric.weightValue===null||fabric.weightUnit===null?'—':fabric.weightValue+' '+fabric.weightUnit}</dd></div>
     <div><dt className="text-xs text-slate-500">门幅</dt><dd>{fabric.widthCm===null?'—':fabric.widthCm+' cm'}</dd></div>
    </dl>
    <PreviewStrip large={!!productNo} title={productNo?'面料大图':'面料实拍'} images={fabric.displayImages} renderPreview={renderPreview}/>
    <PreviewStrip large={!!productNo} title={productNo?'细节图':'面料细节图'} images={fabric.detailImages} renderPreview={renderPreview}/>
    <PreviewStrip large={!!productNo} title="效果图" images={fabric.effectImages} renderPreview={renderPreview}/>
   </article>)}
  </section>
 </main>;
}
