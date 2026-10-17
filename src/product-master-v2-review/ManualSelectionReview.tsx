import React,{useMemo,useState} from 'react';
import {SampleSelectionWorkspaceV2} from '../components/product-master-v2/SampleSelectionWorkspaceV2';
import {createManualSelectionReviewApi} from './manualSelectionMockApi';
import {reviewResolvePatternImages} from './mockApi';

export function ManualSelectionReview(){
 const demo=useMemo(()=>createManualSelectionReviewApi(),[]);
 const [closed,setClosed]=useState(false),[hint,setHint]=useState('');
 return <div className="space-y-4 p-3 sm:p-6">
  <section aria-label="AC-84 预览控制" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
   <h1 className="text-lg font-semibold">AC-84 · 客户选样人工补选 · UI 评审预览</h1>
   <p className="my-2">全部为演示数据与内存私有 API。点击色卡编号可查看花型缩略图，默认全选；取消部分勾选后点“加入”即可。刷新页面重置。</p>
   <div className="flex flex-wrap items-center gap-3">
    <label className="flex items-center gap-2"><input type="checkbox" checked={closed} onChange={e=>{setClosed(e.target.checked);setHint('');}}/>演示已结束选样单（只读）</label>
    <button type="button" onClick={()=>{demo.updateLatest();setHint('F019 品名已在内存主数据中更新，点击选样清单“刷新”查看最新资料');}} className="rounded border border-amber-400 px-3 py-1.5">模拟主数据更新</button>
    {(['search','add','read'] as const).map(operation=><button key={operation} type="button" onClick={()=>{demo.failNext(operation);setHint('下一次'+({search:'检索',add:'补选',read:'读取'})[operation]+'将失败一次，可重试');}}
     className="rounded border border-amber-400 px-3 py-1.5">模拟{({search:'检索',add:'补选',read:'读取'})[operation]}失败一次</button>)}
   </div>
   {hint&&<p role="status" className="mt-2">{hint}</p>}
  </section>
  <SampleSelectionWorkspaceV2 key={closed?'closed':'open'} sessionId={closed?'52':'51'} apiFetch={demo.apiFetch} resolveImages={reviewResolvePatternImages} onRescan={demo.scan}/>
  <p className="text-xs text-slate-500">2026-10-17 用户确认仅基于色卡补选、展开默认全选及部分配色加入。当前为本地交互验证；正式 App 接线、真实数据库验收和部署均未进行。重新扫码仅模拟同单去重。</p>
 </div>;
}
