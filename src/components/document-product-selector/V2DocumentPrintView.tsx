import React,{useEffect,useRef,useState} from 'react';
import html2canvas from 'html2canvas-pro';
import type {DocumentPrintModel} from '../../lib/documentPrintModel';
import {documentResourceUrl} from './documentSearchModel';
/** JSON of the shared, server-authorized print projection, not a database-backup export. */
export function serializeV2PrintJson(model:DocumentPrintModel):string{
 return JSON.stringify(model,null,2);
}

/** Isolated V2 preview: authenticated print-model and XLSX only, never legacy /api/export_template. */
export interface V2DocumentPrintViewProps{
 apiFetch:typeof fetch;documentId:string;onBack():void;backLabel?:string;
}
function assertModel(value:unknown):DocumentPrintModel{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('打印数据格式错误');
 const m=value as DocumentPrintModel;
 if(!Array.isArray(m.columns)||!Array.isArray(m.rows)||!Array.isArray(m.summaries)||
  typeof m.docNo!=='string'||typeof m.companyName!=='string'||
  m.columns.some(c=>typeof c.label!=='string')||
  m.rows.some(row=>!Array.isArray(row)||row.length!==m.columns.length||
   row.some(cell=>typeof cell!=='string')))
  throw Error('打印数据不完整');
 return m;
}
export default function V2DocumentPrintView({
 apiFetch,documentId,onBack,backLabel='返回编辑'
}:V2DocumentPrintViewProps){
 const [model,setModel]=useState<DocumentPrintModel|null>(null);
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
 const downloadJson=()=>{
  if(!model||exporting)return;
  setError('');setExporting(true);
  try{offerDownload(new Blob([serializeV2PrintJson(model)],{type:'application/json;charset=utf-8'}),'V2-'+documentId+'-print.json');}
  catch(e){setError(e instanceof Error?e.message:'打印JSON导出失败');}
  finally{setExporting(false);}
 };
 const downloadPng=async()=>{
  if(!model||exporting||!sheetRef.current)return;
  setError('');setExporting(true);
  try{
   const canvas=await html2canvas(sheetRef.current,{scale:2,backgroundColor:'#ffffff',useCORS:false,allowTaint:false,logging:false});
   const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('PNG图片生成失败')),'image/png'));
   offerDownload(blob,'V2-'+documentId+'.png');
  }catch(e){setError(e instanceof Error?e.message:'PNG导出失败');}
  finally{setExporting(false);}
 };
 useEffect(()=>{
  const controller=new AbortController();
  setLoading(true);setError('');setModel(null);
  (async()=>{
   try{
    const response=await apiFetch(documentResourceUrl(documentId)+'/print-model',{
     signal:controller.signal,headers:{Accept:'application/json'}
    });
    if(!response.ok)throw Error(response.status===404?'单据不存在或没有查看权限':'打印数据读取失败');
    const parsed=assertModel(await response.json());
    if(!controller.signal.aborted)setModel(parsed);
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
  <style>{`@media print{body *{visibility:hidden!important} [data-v2-print-sheet],[data-v2-print-sheet] *{visibility:visible!important}[data-v2-print-sheet]{position:absolute!important;top:0;left:0;width:240mm!important}}`}</style>
  <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
   <button type="button" onClick={onBack} className="rounded-lg border px-4 py-2 text-sm">{backLabel}</button>
   <div className="flex gap-2">
    <button type="button" disabled={!model||exporting} onClick={()=>window.print()} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">浏览器打印</button>
    <button type="button" disabled={!model||exporting} onClick={()=>void downloadPng()} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">下载 PNG</button>
    <button type="button" disabled={!model||exporting} onClick={downloadJson} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">下载打印 JSON</button>
    <button type="button" disabled={!model||exporting} onClick={()=>void download()}
     className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
     {exporting?'正在导出…':'下载打印Excel'}</button>
   </div>
  </div>
  {loading&&<p role="status">正在读取打印资料…</p>}
  {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
  {model&&<div className="overflow-x-auto">
   <div ref={sheetRef} data-v2-print-sheet="true" className="mx-auto w-[240mm] min-h-[140mm] bg-white p-8 text-slate-900">
    <header className="border-b-2 border-slate-900 pb-3 text-right">
     <h3 className="text-lg font-bold">{model.companyName}</h3>
     {model.companyLines.map((line,i)=><p key={i} className="text-xs">{line}</p>)}
    </header>
    <h2 className="my-4 text-center text-xl font-bold">{model.title}</h2>
    <div className="mb-3 flex justify-between text-xs">
     <span>NO：{model.docNo}　收货单位：{model.customerName}</span><span>{model.dateText}</span>
    </div>
    <table className="w-full table-fixed border-collapse text-[10px]">
     <thead><tr>{model.columns.map(c=><th key={c.key} className="border border-slate-500 px-1 py-1">{c.label}</th>)}</tr></thead>
     <tbody>{model.rows.map((row,i)=><tr key={i}>{row.map((value,j)=><td key={j}
      className="break-words border border-slate-300 px-1 py-2 text-center">{value}</td>)}</tr>)}</tbody>
    </table>
    <div className="mt-3 space-y-1">{model.summaries.map((s,i)=><div key={i} className="flex justify-between gap-4 text-xs font-medium">
     <span>{s.left}</span><span>{s.right??''}</span></div>)}</div>
    <p className="mt-3 border border-slate-200 p-2 text-xs">备注条款：{model.terms}</p>
    <footer className="mt-3 text-xs">开单人签字：{model.signature.issuer}　收货人签字：{model.signature.receiver}　电话：{model.signature.phone}
     {model.signature.receiverAddress&&<p>收货地址：{model.signature.receiverAddress}</p>}
    </footer>
   </div>
  </div>}
 </section>;
}
