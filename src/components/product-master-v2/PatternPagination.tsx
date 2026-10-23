import React from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import type {PatternPage} from './patternModel';
export function PatternPagination({page,onPage}:{page:PatternPage;onPage(offset:number):void}){
 const pages=Math.max(1,Math.ceil(page.total/page.limit)),current=Math.floor(page.offset/page.limit)+1;
 return <nav aria-label="花型分页" className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
  <span>共 {page.total} 个花型{page.totalColorways!==undefined?' · '+page.totalColorways+' 个配色':''} · 每页 {page.limit} 个花型</span>
  <div className="flex items-center gap-2">
   <button type="button" aria-label="上一页" disabled={page.offset===0} onClick={()=>onPage(Math.max(0,page.offset-page.limit))} className="rounded border px-2 py-1 disabled:opacity-40"><ChevronLeft size={16}/></button>
   <span aria-live="polite">第 {current} / {pages} 页</span>
   <button type="button" aria-label="下一页" disabled={page.offset+page.limit>=page.total} onClick={()=>onPage(page.offset+page.limit)} className="rounded border px-2 py-1 disabled:opacity-40"><ChevronRight size={16}/></button>
  </div>
 </nav>;
}
