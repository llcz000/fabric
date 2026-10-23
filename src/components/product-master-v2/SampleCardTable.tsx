import { ActionIcon } from './ActionIcon';
import React, { useEffect, useRef, useState } from 'react';
import { type SampleCard, type SampleCardPage } from './sampleCardModel';
import {SampleCardQr,type SampleCardQrRenderer} from './SampleCardQr';
import {buildColumnVisibility,readColumnVisibility,toggleColumnVisibility,
 visibleColumns,writeColumnVisibility,type LibraryColumn} from './libraryTableChromeModel';
import {ColumnSettingsMenu} from './LibraryTableChrome';
import {DialogDismissButton} from '../ui/DialogDismissButton';
const button='rounded border border-[#c3c6d7] px-3 py-1.5 text-xs disabled:opacity-40';

const border='rounded-lg border border-[#c3c6d7] bg-white';

/** 色卡管理表遵守服务端默认顺序，不提供仅当前页的伪排序；保留已上线的列显示偏好。 */
const cardColumns:LibraryColumn<SampleCard>[]=[
 {key:'cardNo',label:'色卡编号'},
 {key:'description',label:'品名'},
 {key:'composition',label:'成分'},
 {key:'weight',label:'克重'},
 {key:'width',label:'门幅'},
 {key:'actions',label:'操作',locked:true},
];
const CARD_COLUMN_KEY='fabric.v2.library.columns.sampleCard';
const cardColumnWidths:Record<string,string|undefined>={
 cardNo:'160px',description:'166px',composition:undefined,weight:'100px',width:'96px',actions:'206px'
};

function CardQrZoom({card,QrRenderer,onClose}:{card:SampleCard;QrRenderer:SampleCardQrRenderer;onClose():void}){
 const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{const before=document.activeElement,dialog=ref.current;dialog?.showModal();return()=>{dialog?.close();if(before instanceof HTMLElement&&before.isConnected)before.focus();};},[]);
  return <dialog ref={ref} aria-label={'色卡二维码 '+card.cardNo} onCancel={event=>{event.preventDefault();onClose();}} className="m-auto max-w-[94vw] rounded-xl border bg-white p-5 shadow-xl backdrop:bg-black/30"><header className="mb-3 flex items-center justify-between gap-4"><h3 className="font-semibold">{card.cardNo}</h3><DialogDismissButton onClick={onClose} label="关闭二维码"/></header><div className="mx-auto w-[min(76vw,420px)] [&>svg]:h-auto [&>svg]:w-full"><QrRenderer payload={card.scanUrl??card.qrPayload} size={420}/></div><p className="mt-3 text-center text-xs text-slate-500">扫码查看花型或加入选样</p></dialog>;
}

export function SampleCardTable({page,selectedIds,onToggle,onPageAll,onPage,onConfirmReprinted,onRetire,onViewPatterns,onShare,QrRenderer=SampleCardQr,busy=false}:{
 page:SampleCardPage;selectedIds:readonly string[];onToggle(id:string,selected:boolean):void;
 onPageAll(selected:boolean):void;onPage(offset:number):void;
 onConfirmReprinted?(card:SampleCard):void;onRetire?(card:SampleCard):void;onViewPatterns?(card:SampleCard):void;
 onShare?(card:SampleCard):void;
 QrRenderer?:SampleCardQrRenderer;busy?:boolean;
}){
 const [qrCard,setQrCard]=useState<SampleCard|null>(null);
 const [visibility,setVisibility]=useState(()=>readColumnVisibility(cardColumns,CARD_COLUMN_KEY));
 const shown=visibleColumns(cardColumns,visibility);
 const rows=page.items;
 const toggleVisibility=(key:string)=>setVisibility(current=>{
  const next=toggleColumnVisibility(cardColumns,current,key);
  writeColumnVisibility(CARD_COLUMN_KEY,next);
  return next;
 });
 const resetVisibility=()=>{
  const next=buildColumnVisibility(cardColumns);
  writeColumnVisibility(CARD_COLUMN_KEY,next);
  setVisibility(next);
 };
 const renderCell=(c:SampleCard,key:string)=>{
  switch(key){
   case 'cardNo':return <td className="px-3 py-3"><div className="font-mono font-semibold text-[#0053da]">{c.cardNo}</div>
    {c.needsReprint===true?<span className="mt-1 inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">需重新打印</span>:null}
    <div className="mt-2 flex flex-wrap items-center gap-2">
     {c.needsReprint===true&&onConfirmReprinted?<button type="button" disabled={busy} className="text-xs text-[#0053da] hover:underline disabled:opacity-50"
      aria-label={'标记已重新打印 '+c.cardNo} onClick={()=>onConfirmReprinted(c)}><ActionIcon name="check"/>标记已重新打印</button>:null}
    </div>
   </td>;
   case 'description':return <td className="max-w-[166px] truncate px-3 py-3" title={c.description}>{c.description}</td>;
   case 'composition':return <td className="px-3 py-3">{c.composition||'—'}</td>;
   case 'weight':return <td className="whitespace-nowrap px-3 py-3">{c.weightValue===null?'—':c.weightValue+' '+c.weightUnit}</td>;
   case 'width':return <td className="whitespace-nowrap px-3 py-3">{c.widthValue===null?'—':c.widthValue+' cm'}</td>;
   case 'actions':return <td className="col-actions whitespace-nowrap px-3 py-3">
    <div className="flex flex-nowrap items-center justify-end gap-2" style={{gap:8}} aria-label={'色卡操作 '+c.cardNo}>
    <button type="button" aria-label={'放大色卡二维码 '+c.cardNo} onClick={()=>setQrCard(c)} className="v2-icon-button" title="查看二维码"><ActionIcon name="qr"/></button>
    {onViewPatterns&&<button type="button" disabled={busy} className="v2-icon-button" title="查看花型" aria-label={'查看花型 '+c.cardNo} onClick={()=>onViewPatterns(c)}><ActionIcon name="view"/></button>}
    {onShare&&<button type="button" disabled={busy||!c.isActive} className="v2-icon-button" title="分享花型产品" aria-label={'分享花型产品 '+c.cardNo} onClick={()=>onShare(c)}><ActionIcon name="share"/></button>}
    {onRetire?<button type="button" disabled={busy} className="v2-icon-button v2-icon-danger" title="删除色卡"
     aria-label={'删除色卡 '+c.cardNo} onClick={()=>onRetire(c)}><ActionIcon name="delete"/></button>:null}
    </div>
   </td>;
   default:return null;
  }
 };
 const all=rows.length>0&&rows.every(c=>selectedIds.includes(c.id));
 return <section className={border+' v2-card-data overflow-hidden'}>
  {qrCard&&<CardQrZoom card={qrCard} QrRenderer={QrRenderer} onClose={()=>setQrCard(null)}/>}
  <div className="v2-library-toolbar" style={{justifyContent:'flex-end'}}>
   <ColumnSettingsMenu columns={cardColumns} visibility={visibility}
    onToggle={toggleVisibility} onReset={resetVisibility}/>
  </div>
  <div className="overflow-x-auto" role="region" aria-label="色卡列表，可横向滚动" tabIndex={0}>
   <table className="v2-library-table w-full min-w-[970px] border-collapse text-left text-xs">
    <colgroup>
     <col style={{width:'44px'}}/>
     {shown.map(column=><col key={column.key} style={cardColumnWidths[column.key]?{width:cardColumnWidths[column.key]}:undefined}/>)}
    </colgroup>
    <thead className="border-b border-[#c3c6d7] bg-[#fbfcfd]"><tr>
     <th className="w-10 px-3 py-2.5"><input type="checkbox" aria-label="选择本页色卡" checked={all}
      disabled={busy||!rows.length} onChange={e=>onPageAll(e.target.checked)}/></th>
     {shown.map(column=><th key={column.key} scope="col" className={'px-3 py-2.5 font-semibold '+(column.key==='actions'?'col-actions whitespace-nowrap':'')}>{column.label}</th>)}
    </tr></thead>
    <tbody>{rows.map(c=><tr key={c.id} data-qr-payload={c.qrPayload} className="v2-library-row border-b border-[#e2e8f0] last:border-0 hover:bg-[#fbfcfd]">
     <td className="px-3 py-3"><input type="checkbox" aria-label={'选择色卡 '+c.cardNo} checked={selectedIds.includes(c.id)}
      disabled={busy} onChange={e=>onToggle(c.id,e.target.checked)}/></td>
     {shown.map(column=><React.Fragment key={column.key}>{renderCell(c,column.key)}</React.Fragment>)}
    </tr>)}</tbody>
   </table>
   {!rows.length?<p className="py-12 text-center text-xs text-slate-500">{busy?'加载中…':'没有匹配的色卡'}</p>:null}
  </div>
  <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-[#e5eaf0] bg-[#fbfcfd] px-4 py-3 text-[11px] text-slate-500">
   <div className="flex items-center gap-3"><span>共 {page.total} 张色卡 · 页码 {Math.floor(page.offset/page.limit)+1}/{Math.max(1,Math.ceil(page.total/page.limit))}</span>
    <button type="button" className={button} disabled={busy||page.offset===0} onClick={()=>onPage(Math.max(0,page.offset-page.limit))}><ActionIcon name="back"/>上一页</button>
    <button type="button" className={button} disabled={busy||page.offset+page.limit>=page.total} onClick={()=>onPage(page.offset+page.limit)}><ActionIcon name="next"/>下一页</button>
   </div>
  </footer>
 </section>;
}

