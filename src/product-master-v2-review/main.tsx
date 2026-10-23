import React,{useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../index.css';
import {PatternLibraryV2} from '../components/product-master-v2/PatternLibraryV2';
import {FabricWorkspaceV2} from '../components/product-master-v2/FabricImportV2';
import {ProductCatalogWorkspaceV2} from '../components/product-master-v2/ProductCatalogWorkspaceV2';
import {SampleCardLibraryV2} from '../components/product-master-v2/SampleCardLibraryV2';
import {SampleCardUxPilot} from './SampleCardUxPilot';
import {composeSampleCardReviewFetch} from './sampleCardMockApi';
import {reviewFetch,reviewFacts,reviewUploadPatternImage,reviewResolvePatternImages} from './mockApi';
import {ManualSelectionReview} from './ManualSelectionReview';
import {DocumentQueryReview} from './DocumentQueryReview';
const sampleCardReviewFetch=composeSampleCardReviewFetch(reviewFetch);
type View='pattern'|'fabric'|'products'|'sampleCards'|'cardUx'|'sampleSelection'|'documents'|'stats';
/** Only approved local review tabs can be deep-linked; unknown query values fail closed. */
export function initialReviewView(search:string):View{
 const name=new URLSearchParams(search).get('view');
 return name==='fabric'||name==='products'||name==='sampleCards'||name==='cardUx'||name==='sampleSelection'||name==='documents'||name==='stats'?name:'pattern';
}
function Review(){
 const [view,setView]=useState<View>(()=>initialReviewView(window.location.search));
 const [permission,setPermission]=useState(true);
 const revision=useMemo(()=>reviewFacts(),[view]);
 return <div className="min-h-screen bg-[#faf8ff]">
  <div className="sticky top-0 z-40 border-b border-amber-200 bg-[#fff9e7] px-3 py-2 text-xs text-amber-900">
   <strong>Fabric V2 · 隔离 UI 评审</strong>
   <span className="ml-2">仅本机内存模拟数据，不连接生产服务器、MySQL 或 COS；刷新可恢复初始数据。</span>
  </div>
  <header className="border-b border-slate-200 bg-white px-3 py-3 sm:px-6">
   <div className="mx-auto flex max-w-[1480px] flex-wrap items-center justify-between gap-3">
    <div><strong className="block text-lg text-slate-900">Fabric <span className="font-normal text-[#0053da]">产品主数据 V2</span></strong>
     <span className="text-xs text-slate-500">已批准 Stitch 样式 · React 页面交互验收</span></div>
    <label className="flex items-center gap-2 text-xs text-slate-600">
     <input type="checkbox" checked={permission} onChange={e=>setPermission(e.target.checked)} aria-label="模拟管理权限"/>
     模拟一期三库管理权限</label>
   </div>
   <nav aria-label="V2 本地评审页面" className="mx-auto mt-3 flex max-w-[1480px] gap-2 overflow-x-auto">
    {([['pattern','花型库'],['fabric','面料库'],['products','产品库'],['sampleCards','色卡库'],['cardUx','色卡UX样板'],['sampleSelection','客户选样 · 评审'],['stats','经营大盘 · 评审'],['documents','单据查询 · 评审']] as const).map(([name,label])=>
     <button key={name} type="button" onClick={()=>setView(name)} aria-current={view===name?'page':undefined}
      className={'whitespace-nowrap rounded-t-lg px-4 py-2 text-sm '+(view===name?
       'bg-[#eef1fd] font-semibold text-[#0053da]':'text-slate-600 hover:bg-slate-100')}>{label}</button>)}
   </nav>
  </header>
  <main className="mx-auto max-w-[1480px]" data-review-view={view}>
   {view==='stats'||view==='documents'?<DocumentQueryReview key={view} initialMode={view==='stats'?'stats':'query'}/>:view==='sampleSelection'?<ManualSelectionReview/>:view==='pattern'?<PatternLibraryV2 key="patterns" apiFetch={sampleCardReviewFetch} canManage={permission} onUploadPatternImage={reviewUploadPatternImage} resolvePatternImages={reviewResolvePatternImages}/>:
    view==='fabric'?<FabricWorkspaceV2 key="fabrics" apiFetch={sampleCardReviewFetch} canManage={permission} isAdmin={permission}/>:
    view==='products'?<ProductCatalogWorkspaceV2 key="products" apiFetch={sampleCardReviewFetch} canManage={permission} resolveImages={reviewResolvePatternImages}
     onPatternLibrary={()=>setView('pattern')} onFabricLibrary={()=>setView('fabric')}/>:
    view==='cardUx'?<SampleCardUxPilot/>:
    <SampleCardLibraryV2 key="sample-cards" apiFetch={sampleCardReviewFetch}/>}
  </main>
  <footer className="mx-auto max-w-[1480px] px-5 py-5 text-xs text-slate-400">
   P4-6 / B2-3 本地评审 · 色卡管理模拟业务员（管理员同权限） · 模拟 {revision.masters} 个母版 / {revision.colorways} 个配色 /
   {revision.fabrics} 种面料 / {revision.products} 个产品 · 不是正式应用
  </footer>
 </div>;
}
if(typeof document!=='undefined')createRoot(document.getElementById('root')!).render(<Review/>);
