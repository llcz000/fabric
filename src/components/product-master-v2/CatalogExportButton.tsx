import React,{useRef,useState} from 'react';
export function buildCatalogExportUrl(listUrl:string):string{
 const url=new URL(listUrl,'https://local.invalid');
 if(!['/api/v2/pattern-catalog','/api/v2/fabrics/catalog','/api/v2/products'].includes(url.pathname))throw Error('无效导出范围');
 url.searchParams.delete('limit');url.searchParams.delete('offset');
 const query=url.searchParams.toString();return url.pathname+'/export.xlsx'+(query?'?'+query:'');
}
export function CatalogExportButton({apiFetch,listUrl,filename}:{apiFetch:typeof fetch;listUrl:string;filename:string}){
 const active=useRef(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const download=async()=>{
  if(active.current)return;active.current=true;setBusy(true);setError('');
  try{
   const response=await apiFetch(buildCatalogExportUrl(listUrl));
   if(!response.ok)throw Error(response.status===401?'登录已失效，请重新登录':response.status===409?'资料已变化，请重试导出':'导出失败，请重试');
   if(!response.headers.get('Content-Type')?.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))throw Error('导出文件格式错误');
   const blob=await response.blob();if(!blob.size)throw Error('导出文件为空，请重试');
   const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;
   document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }catch(error){setError(error instanceof Error?error.message:'导出失败');}
  finally{active.current=false;setBusy(false);}
 };
 return <div className="flex flex-wrap items-center gap-2 text-xs">
  <button type="button" disabled={busy} onClick={()=>void download()} title="导出全部匹配记录，不含图片"
   className="rounded border border-[#c3c6d7] bg-white px-3 py-1.5 text-[#0053da] disabled:opacity-40">{busy?'正在导出…':'导出筛选结果'}</button>
  {error?<span role="alert" className="text-rose-700">{error}</span>:null}
 </div>;
}
