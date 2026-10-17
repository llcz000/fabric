import React,{useMemo,useState} from 'react';
import {V2DocumentBrowser} from '../components/document-product-selector/V2DocumentBrowser';
import {V2DocumentStats} from '../components/document-product-selector/V2DocumentStats';
import V2DocumentPrintView from '../components/document-product-selector/V2DocumentPrintView';
import {createDocumentQueryReviewApi,documentReviewCompany} from './documentQueryMockApi';
export function DocumentQueryReview({initialMode='query'}:{initialMode?:'query'|'stats'}){
 const [role,setRole]=useState<'sales'|'admin'>('sales');
 const [mode,setMode]=useState<{view:'stats'|'query'|'preview';productName?:string;documentId?:string}>({view:initialMode});
 const demo=useMemo(()=>createDocumentQueryReviewApi(role),[role]);
 return <div>
  <aside className="mx-3 mt-4 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 sm:mx-6">
   <p>经营大盘与单据查询评审 · 29张仅本机内存演示单据。可核对账号范围、统计排名、日期、品名筛选和预览；本评审不模拟保存与文件导出。</p>
   <div className="flex flex-wrap items-center gap-3"><label>演示角色 <select aria-label="查询演示角色" className="rounded border bg-white p-1" value={role} onChange={e=>{setRole(e.target.value as typeof role);setMode({view:initialMode});}}><option value="sales">业务员</option><option value="admin">管理员</option></select></label>
    <button className="rounded border border-amber-400 px-3 py-1" onClick={()=>demo.failNext()}>下一次查询失败</button>
   </div>
  </aside>
  <div className="mx-3 mt-3 flex gap-3 sm:mx-6">
   <button type="button" className="rounded border bg-white px-3 py-2 text-sm" aria-pressed={mode.view==='stats'} onClick={()=>setMode({view:'stats'})}>经营大盘</button>
   <button type="button" className="rounded border bg-white px-3 py-2 text-sm" aria-pressed={mode.view==='query'} onClick={()=>setMode({view:'query'})}>单据查询</button>
  </div>
  {mode.view==='stats'?<V2DocumentStats apiFetch={demo.apiFetch}
   onProduct={productName=>setMode({view:'query',productName})}
   onDocument={documentId=>setMode({view:'preview',documentId})}/>:
   mode.view==='preview'&&mode.documentId?<V2DocumentPrintView apiFetch={demo.apiFetch} documentId={mode.documentId} backLabel="返回经营大盘" onBack={()=>setMode({view:'stats'})}/>:
   <V2DocumentBrowser key={role+'-'+(mode.productName??'all')} apiFetch={demo.apiFetch} role={role} companyProfile={documentReviewCompany}
    initialFilters={mode.productName?{productName:mode.productName}:undefined}/>}
 </div>;
}
