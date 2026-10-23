import React from 'react';
import type {PublicCard,PublicCardColorway} from '../../../server/customer-share/cardShareCatalog';

/** Customer-facing /c/ view only. Receives whitelisted DTOs and authorized preview renderer. */
export interface PublicCardGalleryProps{
 card:PublicCard|null;
 renderPreview?:(previewRef:string,description:string,priority?:boolean)=>React.ReactNode;
}
const photos=[
 {key:'displayImages',title:'面料大图',hint:'面料整体'},
 {key:'detailImages',title:'细节图',hint:'纹理细节'},
 {key:'effectImages',title:'效果图',hint:'穿着效果'},
] as const;
function MediaGroup({color,keyName,title,hint,renderPreview,priority=false}:{
 color:PublicCardColorway;keyName:typeof photos[number]['key'];title:string;hint:string;
 renderPreview:PublicCardGalleryProps['renderPreview'];priority?:boolean;
}){
 const images=color[keyName];
 return <section aria-label={color.productNo+' '+title} className="space-y-3">
  <div className="flex items-center justify-between gap-3">
   <h3 className="text-[15px] font-semibold text-[#25332d]">{title}</h3>
   <span className="text-xs text-[#66736a]">{images.length} 张</span>
  </div>
  {images.length?
   <div className={keyName==='displayImages'?'grid grid-cols-1 gap-3 sm:grid-cols-2':'grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3'}>
    {images.map((image,i)=><div key={image.previewRef} className={'min-w-0 overflow-hidden rounded-xl border border-[#e9e9e1] bg-[#f6f5f1] '+
      (keyName==='displayImages'&&i===0?'sm:col-span-2':'')}>
     {renderPreview?.(image.previewRef,color.productNo+' '+title+' '+(i+1),priority&&i===0)??<p className="p-6 text-center text-sm text-[#70776e]">图片暂不可用</p>}
    </div>)}
   </div>:
   <p className="rounded-xl border border-dashed border-[#e7e7df] bg-[#fafaf8] px-4 py-5 text-sm text-[#717870]">暂无图片</p>}
 </section>;
}
function Colorway({color,index,renderPreview}:{
 color:PublicCardColorway;index:number;renderPreview:PublicCardGalleryProps['renderPreview'];
}){
 return <article id={'colorway-'+color.colorwayNo} aria-label={'配色 '+color.colorwayNo} className="scroll-mt-5 overflow-hidden rounded-2xl border border-[#e5e5df] bg-white shadow-[0_3px_16px_rgba(30,40,31,0.035)]">
  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eeeee9] px-4 py-4 sm:px-6">
   <div className="min-w-0">
    <p className="text-[11px] font-semibold tracking-[.14em] text-[#9b7765]">COLORWAY {String(color.colorwayNo).padStart(2,'0')}</p>
    <h2 className="mt-1 break-all text-[17px] font-semibold text-[#24322c]">{color.productNo}</h2>
   </div>
   <span className="shrink-0 rounded-full bg-[#f1f2ed] px-3 py-1.5 text-xs font-medium text-[#586a5e]">配色 {color.colorwayNo}</span>
  </header>
  <div className="space-y-6 px-4 py-4 sm:px-6 sm:py-6">
   {photos.map((group,groupIndex)=><MediaGroup key={group.key} color={color} keyName={group.key} title={group.title}
    hint={group.hint} renderPreview={renderPreview} priority={index===0&&groupIndex===0}/>)}
  </div>
 </article>;
}
export function PublicCardGallery({card,renderPreview}:PublicCardGalleryProps){
 if(!card?.colorways.length)return <main aria-label="色卡花型产品公开展示" className="mx-auto max-w-xl px-5 py-16 text-center text-[#2f3933]">
  <h1 className="text-xl font-semibold">暂不可用</h1><p className="mt-3 text-base text-[#68756b]">此色卡当前没有可展示的产品，请稍后重试。</p>
 </main>;
 return <main aria-label="色卡花型产品公开展示"
  className="min-h-[100dvh] bg-[#f7f7f3] pb-[max(28px,env(safe-area-inset-bottom))] text-[#29372e] [overflow-wrap:anywhere]">
  <div className="border-b border-[#e5e5df] bg-white px-[max(16px,env(safe-area-inset-left))] py-3.5 pr-[max(16px,env(safe-area-inset-right))]">
   <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
    <span className="text-[13px] font-semibold tracking-[.12em] text-[#2b4235]">FABRIC <span className="font-normal tracking-normal text-[#8b938a]">· 花型面料</span></span>
    <span className="text-xs text-[#758075]">色卡产品展示</span>
   </div>
  </div>
  <div className="mx-auto max-w-4xl space-y-5 px-[max(14px,env(safe-area-inset-left))] pt-5 pr-[max(14px,env(safe-area-inset-right))] sm:space-y-7 sm:px-6 sm:pt-8">
   <header className="rounded-2xl bg-white px-4 py-5 sm:px-6 sm:py-6">
    <p className="text-xs font-semibold tracking-[.13em] text-[#9b7765]">FABRIC COLLECTION</p>
    <h1 className="mt-2 break-all text-2xl font-semibold tracking-tight sm:text-3xl">{card.cardNo}</h1>
    <p className="mt-1.5 text-base text-[#46594c]">{card.fabricNo} · {card.fabricName}</p>
    <dl className="mt-3 grid grid-cols-[minmax(0,1.65fr)_minmax(0,.8fr)_minmax(0,.7fr)] gap-x-2 border-t border-[#ebebe6] pt-3 sm:gap-x-5">
     <div className="min-w-0"><dt className="text-[11px] text-[#67746b]">成分</dt><dd className="mt-0.5 break-words text-xs leading-[1.45] font-medium text-[#28382d] sm:text-sm">{card.composition||'—'}</dd></div>
     <div className="min-w-0"><dt className="text-[11px] text-[#67746b]">克重</dt><dd className="mt-0.5 text-xs leading-[1.45] font-medium text-[#28382d] sm:text-sm">{card.weightValue===null?'—':card.weightValue+' '+card.weightUnit}</dd></div>
     <div className="min-w-0"><dt className="text-[11px] text-[#67746b]">门幅</dt><dd className="mt-0.5 text-xs leading-[1.45] font-medium text-[#28382d] sm:text-sm">{card.widthCm===null?'—':card.widthCm+' cm'}</dd></div>
    </dl>
   </header>
   <nav aria-label="跳转到花型配色" className="-mx-3 flex snap-x snap-mandatory gap-2 overflow-x-auto px-3 pb-2 [scrollbar-width:none]">
    {card.colorways.map(c=><a key={c.colorwayNo} href={'#colorway-'+c.colorwayNo} style={{minHeight:44}}
     className="inline-flex min-h-11 shrink-0 snap-start items-center rounded-full border border-[#d9dfd8] bg-white px-5 text-sm font-medium text-[#344a3b] no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#477d62]">
      配色 {c.colorwayNo}
     </a>)}
   </nav>
   <section aria-label="关联产品" className="space-y-4 sm:space-y-6">
    {card.colorways.map((c,index)=><Colorway key={c.colorwayNo} color={c} index={index} renderPreview={renderPreview}/>)}
   </section>
   <p className="px-1 pb-3 text-center text-xs leading-5 text-[#758076]">图片和规格以当前分享页面显示为准</p>
  </div>
 </main>;
}
