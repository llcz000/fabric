import React,{useEffect,useRef,useState,type CSSProperties} from 'react';
import {ActionIcon} from '../product-master-v2/ActionIcon';
import html2canvas from 'html2canvas-pro';
import type {DocumentPrintModel} from '../../lib/documentPrintModel';
import {resolveImageUrls} from '../product-master-v2/catalogModel';
import {resolveSelectionThumbnails} from '../product-master-v2/selectedCardModel';
import {documentResourceUrl} from './documentSearchModel';
const thumbnailColumnWidth=56;
const sheetWidthMm=240;
const sheetPaddingMm=10;
const sheetContentWidthPx=(sheetWidthMm-2*sheetPaddingMm)*96/25.4;
const printSideInsetMm=6;
const printLeftShiftMm=6;
const rollColumn=/^roll\d+$/;
const printWidthsByType:Record<DocumentPrintModel['type'],Record<string,number>>={
 sample:{itemNo:29,colorNo:10,productName:27,composition:25,weight:12,width:17,meters:18,unitPrice:21,amount:24,remark:21},
 deposit:{itemNo:37,colorNo:13,productName:48,meters:28,unitPrice:33,amount:45},
 sales:{itemNo:23,colorNo:9,productName:22,pieceCount:9,meters:15,unitPrice:16,amount:20},
};
const salesWithDeductionWidths:Record<string,number>={
 itemNo:22,colorNo:9,productName:20,pieceCount:9,meters:14,deduction:12,unitPrice:15,amount:18,
};
function PatternThumbnail({src}:{src?:string|null}){
 const [failed,setFailed]=useState(false);
 return <div className="mx-auto flex h-10 w-11 items-center justify-center">
  {src&&!failed?<img src={src} alt="花型缩略图" className="h-full w-full object-contain" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>
   :<span className="text-slate-500">—</span>}
 </div>;
}
export function DocumentPrintTable({model,previewThumbnailUrls,outputOnly=false}:{
 model:DocumentPrintModel;previewThumbnailUrls?:readonly (string|null)[];outputOnly?:boolean;
}){
 const showThumbnails=model.type==='sample'&&previewThumbnailUrls!==undefined;
 const columns=model.columns.length+Number(showThumbnails);
 const leftSpan=Math.max(1,Math.floor(model.columns.length/2))+Number(showThumbnails),rightSpan=columns-leftSpan;
 const weight=model.columns.reduce((sum,col)=>sum+col.webFraction,0);
 const hasDeduction=model.type==='sales'&&model.columns.some(column=>column.key==='deduction');
 const printLayout=hasDeduction?salesWithDeductionWidths:printWidthsByType[model.type];
 // Fixed proportions for the 204 mm print area. Screen and PNG use their existing columns.
 const printWidths=model.columns.map(({key,webFraction})=>
  rollColumn.test(key)?(hasDeduction?8.5:9):printLayout?.[key]??webFraction);
 const printWidth=printWidths.reduce((sum,width)=>sum+width,0);
 const mode=showThumbnails?'preview':outputOnly?'output':undefined;
 return <table data-sample-table={mode} className="w-full table-fixed border-collapse text-[10px]" aria-label="单据明细及汇总">
  <colgroup>
   {showThumbnails&&<col style={{width:thumbnailColumnWidth}}/>}
   {model.columns.map((column,index)=>{
    const fraction=column.webFraction/weight;
    const style:CSSProperties&{'--v2-print-column-width':string}={
     width:showThumbnails?fraction*(sheetContentWidthPx-thumbnailColumnWidth):fraction*100+'%',
     '--v2-print-column-width':printWidths[index]/printWidth*100+'%',
    };
    return <col key={column.key} style={style}/>;
   })}
  </colgroup>
  <thead><tr>
   {showThumbnails&&<th scope="col" className="border border-slate-500 px-1 py-1">花型</th>}
   {model.columns.map(c=><th key={c.key} className="border border-slate-500 px-1 py-1">{c.label}</th>)}
  </tr></thead>
  <tbody>{model.rows.map((row,i)=>{
   const group=model.rowGroups?.find(g=>i>=g.start&&i<g.start+g.rowCount);
   const thumbnail=previewThumbnailUrls?.[i];
   return <tr key={i}>{showThumbnails&&<td className="border border-slate-500 px-1 py-1 text-center"><PatternThumbnail key={thumbnail??''} src={thumbnail}/></td>}{row.map((value,j)=>{
    const merge=group&&group.rowCount>1&&!rollColumn.test(model.columns[j].key);
    if(merge&&i!==group.start)return null;
    return <td key={j} rowSpan={merge?group.rowCount:undefined} className="break-words border border-slate-500 px-1 py-2 text-center">{value}</td>;
   })}</tr>;
  })}</tbody>
  <tfoot className="table-row-group">{model.summaries.map((s,i)=><tr key={i} className="bg-slate-50 font-medium">
   <td colSpan={s.right&&rightSpan>0?leftSpan:columns} className="break-words border border-slate-500 px-2 py-2 text-left">{s.left}{rightSpan===0&&s.right?'　'+s.right:''}</td>
   {s.right&&rightSpan>0&&<td colSpan={rightSpan} className="break-words border border-slate-500 px-2 py-2 text-left">{s.right}</td>}
  </tr>)}
   {model.terms&&<tr><td data-print-terms colSpan={columns} className="whitespace-pre-wrap break-words border border-slate-500 px-2 py-1 text-left">备注条款：{model.terms}</td></tr>}
  </tfoot>
 </table>;
}

/** Isolated V2 preview: authenticated print-model and XLSX only, never legacy /api/export_template. */
export interface V2DocumentPrintViewProps{
 apiFetch:typeof fetch;documentId:string;onBack():void;backLabel?:string;
}
function assertModel(value:unknown):DocumentPrintModel{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('打印数据格式错误');
 const m=value as DocumentPrintModel;
 const invalidImages=m.companyImages&&Object.values(m.companyImages).some(value=>typeof value!=='string'||value.length>3*1024*1024||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value));
 if(!Array.isArray(m.columns)||!Array.isArray(m.rows)||!Array.isArray(m.summaries)||
  typeof m.docNo!=='string'||typeof m.companyName!=='string'||
  m.columns.some(c=>typeof c.label!=='string')||
  m.rows.some(row=>!Array.isArray(row)||row.length!==m.columns.length||
   row.some(cell=>typeof cell!=='string'))||invalidImages)
  throw Error('打印数据不完整');
 return m;
}
export default function V2DocumentPrintView({
 apiFetch,documentId,onBack,backLabel='返回编辑'
}:V2DocumentPrintViewProps){
 const [model,setModel]=useState<DocumentPrintModel|null>(null);
 const [previewThumbnailUrls,setPreviewThumbnailUrls]=useState<(string|null)[]>([]);
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(true);
 const [exporting,setExporting]=useState(false);
 const sheetRef=useRef<HTMLDivElement|null>(null);
 const offerDownload=(blob:Blob,name:string)=>{
  const url=URL.createObjectURL(blob);
  try{
   const a=window.document.createElement('a');a.href=url;a.download=name;
   window.document.body.appendChild(a);a.click();a.remove();
  }finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
 };
 const downloadPng=async()=>{
  if(!model||exporting||!sheetRef.current)return;
  setError('');setExporting(true);
  try{
   await Promise.all([...sheetRef.current.querySelectorAll('img')].filter(img=>!img.closest('[data-sample-table="preview"]')).map(img=>img.decode()));
   const canvas=await html2canvas(sheetRef.current,{
    scale:2,backgroundColor:'#ffffff',useCORS:false,allowTaint:false,logging:false,
    ignoreElements:element=>element.getAttribute('data-sample-table')==='preview',
    onclone:(_document,sheet)=>{
     const table=sheet.querySelector<HTMLTableElement>('[data-sample-table="output"]');
     if(table)table.style.display='table';
    },
   });
   const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('PNG图片生成失败')),'image/png'));
   offerDownload(blob,'V2-'+documentId+'.png');
  }catch(e){setError(e instanceof Error?e.message:'PNG导出失败');}
  finally{setExporting(false);}
 };
 useEffect(()=>{
  const controller=new AbortController();
  setLoading(true);setError('');setModel(null);setPreviewThumbnailUrls([]);
  (async()=>{
   try{
    const response=await apiFetch(documentResourceUrl(documentId)+'/print-model?preview=1',{
     signal:controller.signal,headers:{Accept:'application/json'}
    });
    if(!response.ok)throw Error(response.status===404?'单据不存在或没有查看权限':'打印数据读取失败');
    const raw=await response.json();
    const {patternThumbnailAssetIds,...printModel}=assertModel(raw) as DocumentPrintModel&{patternThumbnailAssetIds?:unknown};
    if(controller.signal.aborted)return;
    setModel(printModel);
    setLoading(false);
    if(printModel.type==='sample'&&Array.isArray(patternThumbnailAssetIds)&&patternThumbnailAssetIds.length===printModel.rows.length){
     const ids=patternThumbnailAssetIds.map(id=>typeof id==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)?id:null);
     const {urls}=await resolveSelectionThumbnails(ids.filter(id=>id!==null),
      (batch,signal)=>resolveImageUrls(apiFetch,batch,'thumbnail',signal),controller.signal).catch(()=>({urls:new Map<string,string>()}));
     if(!controller.signal.aborted)setPreviewThumbnailUrls(ids.map(id=>id?urls.get(id)??null:null));
    }
   }catch(e){
    if(!controller.signal.aborted)setError(e instanceof Error?e.message:'打印数据读取失败');
   }finally{if(!controller.signal.aborted)setLoading(false);}
  })();
  return ()=>controller.abort();
 },[apiFetch,documentId]);
 const download=async()=>{
  if(!model||exporting)return;
  setExporting(true);setError('');
  try{
   const response=await apiFetch(documentResourceUrl(documentId)+'/export.xlsx',{
    headers:{Accept:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
   });
   if(!response.ok)throw Error(response.status===404?'单据不存在或没有导出权限':'Excel导出失败');
   const kind=response.headers.get('content-type')??'';
   if(!kind.includes('spreadsheetml.sheet'))throw Error('服务器返回的不是Excel文件');
   const blob=await response.blob();
   if(blob.size<100)throw Error('Excel文件为空');
   offerDownload(blob,'V2-'+documentId+'.xlsx');
  }catch(e){setError(e instanceof Error?e.message:'下载Excel失败');}
  finally{setExporting(false);}
 };
 return <section className="space-y-4" aria-label="V2单据打印预览">
  <style>{`
   [data-sample-table="output"]{display:none}
   @media print{
    @page v2-document{
     size:${sheetWidthMm}mm 140mm;
     /* Chromium uses the page margins for its automatic headers and footers. */
     margin:0 12mm;
    }
    body:has([data-v2-print-sheet]) > :not([data-v2-print-sheet],:has([data-v2-print-sheet])),
    body :has([data-v2-print-sheet]) > :not([data-v2-print-sheet],:has([data-v2-print-sheet])){
     display:none!important;
    }
    body:has([data-v2-print-sheet]),body :has([data-v2-print-sheet]){
     display:block!important;
     position:static!important;
     width:auto!important;
     max-width:none!important;
     height:auto!important;
     min-height:0!important;
     max-height:none!important;
     margin:0!important;
     padding:0!important;
     overflow:visible!important;
     transform:none!important;
    }
    [data-v2-print-sheet]{
     page:v2-document;
     width:100%!important;
     min-height:0!important;
     margin:0!important;
     /* Compensate for the measured 6 mm rightward printer offset on each page. */
     box-decoration-break:clone;
     padding:15mm calc(${printSideInsetMm+printLeftShiftMm}mm + 1px)
      6mm calc(${printSideInsetMm-printLeftShiftMm}mm + 1px)!important;
     color:#000;
     font:11pt/1.25 SimSun,"宋体",serif;
     overflow-wrap:anywhere;
    }
    [data-v2-print-sheet] header strong,[data-v2-print-sheet] h3{font-size:18pt}
    [data-v2-print-sheet] h2{font-size:16pt}
    [data-v2-print-sheet] header p,[data-v2-print-sheet] [data-print-terms]{font-size:10pt}
    [data-v2-print-sheet] [data-print-reference],[data-v2-print-sheet] footer{font-size:11pt}
    [data-v2-print-sheet] figcaption{font-size:9pt}
    [data-v2-print-sheet] table{table-layout:fixed!important}
    [data-v2-print-sheet] col{width:var(--v2-print-column-width,auto)!important}
    [data-v2-print-sheet] :is(th,td){
     padding:.8mm .65mm!important;
     font-size:10pt!important;
     line-height:1.25;
     overflow-wrap:anywhere;
    }
    [data-v2-print-sheet] [data-print-terms]{padding:.7mm 1.4mm!important}
    [data-v2-print-sheet] [data-print-signatures]{margin-top:1.5mm;line-height:1.2}
    [data-v2-print-sheet] :is(tr,tfoot,[data-print-signatures]){break-inside:avoid}
    [data-v2-print-sheet] [data-sample-table="preview"]{display:none}
    [data-v2-print-sheet] [data-sample-table="output"]{display:table}
   }
  `}</style>
  <h2 className="text-lg font-semibold md:hidden print:hidden">单据预览{model&&' · '+model.title}</h2>
  <div className="grid grid-cols-2 items-center justify-between gap-2 md:flex md:flex-wrap print:hidden">
   <button type="button" onClick={onBack} className="min-h-10 rounded-lg border px-3 py-2 text-sm max-md:min-h-11"><ActionIcon name="back"/>{backLabel}</button>
   <div className="contents md:flex md:flex-wrap md:gap-2">
    <button type="button" disabled={!model||exporting} onClick={()=>window.print()}
     className="min-h-10 rounded-lg border border-emerald-700 bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 max-md:min-h-11">
     <ActionIcon name="print"/>浏览器打印</button>
    <button type="button" disabled={!model||exporting} onClick={()=>void downloadPng()} className="min-h-10 rounded-lg border px-3 py-2 text-sm disabled:opacity-50 max-md:min-h-11"><ActionIcon name="download"/>下载 PNG</button>
    <button type="button" disabled={!model||exporting} onClick={()=>void download()}
     className="min-h-10 rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50 max-md:min-h-11">
     <ActionIcon name="excel"/>{exporting?'正在导出…':'下载 Excel'}</button>
   </div>
  </div>
  {loading&&<p role="status">正在读取打印资料…</p>}
  {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
  {model&&<>
   <p className="text-xs text-slate-600 md:hidden print:hidden">左右滑动查看整张单据</p>
   <div role="region" aria-label="单据纸面" tabIndex={0} className="overflow-x-auto">
   <div ref={sheetRef} data-v2-print-sheet="true" className="mx-auto min-h-[140mm] bg-white text-slate-900" style={{width:sheetWidthMm+'mm',padding:`8mm ${sheetPaddingMm}mm`,boxSizing:'border-box',fontFamily:'SimSun, serif'}}>
    <header className="flex items-start justify-between gap-4 border-b-2 border-slate-900 pb-1">
     <div>{model.companyImages?.brand_logo?<img src={model.companyImages.brand_logo} alt="公司Logo" className="max-h-12 max-w-[120px] object-contain"/>:<strong className="text-lg">{model.brandName}</strong>}</div>
     <div className="text-right">
     <h3 className="text-lg font-bold">{model.companyName}</h3>
     {model.companyLines.map((line,i)=><p key={i} className="text-xs">{line}</p>)}
     </div>
    </header>
    <h2 className="my-1 text-center text-base font-black tracking-[0.5em]">{model.title}</h2>
    <div data-print-reference className="mb-1 flex items-end justify-between gap-3 text-xs">
     <div className="min-w-0 break-all"><p>NO：{model.docNo}</p><p>收货单位：{model.customerName}</p></div><span className="shrink-0 whitespace-nowrap">日期：{model.dateText}</span>
    </div>
    {model.type==='sample'&&<DocumentPrintTable model={model} previewThumbnailUrls={previewThumbnailUrls}/>}
    <DocumentPrintTable model={model} outputOnly={model.type==='sample'}/>
    <div data-print-signatures className="mt-3 flex justify-between gap-4">
     <footer className="min-w-0 flex-1 text-xs">
      <p>{model.signatureLabels?.issuer??'开单人签字'}：{model.signature.issuer}</p>
      <p>{model.signatureLabels?.receiver??'收货人签字'}：{model.signature.receiver}　电话：{model.signature.phone}</p>
      {(model.type==='deposit'||model.signature.receiverAddress)&&<p className="mt-1 min-h-5 whitespace-pre-wrap break-words">收货地址：{model.signature.receiverAddress}</p>}
     </footer>
     {model.type!=='sales'&&<div className="flex gap-3">{(['wechat_qr','alipay_qr'] as const).map(role=>model.companyImages?.[role]?<figure key={role} className="text-center text-[9px]"><img src={model.companyImages[role]} alt={role==='wechat_qr'?'微信收款码':'支付宝收款码'} className="h-16 w-16 object-contain"/><figcaption>{role==='wechat_qr'?'微信收款':'支付宝收款'}</figcaption></figure>:null)}</div>}
    </div>
   </div>
  </div></>}
 </section>;
}
