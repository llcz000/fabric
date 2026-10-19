import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../index.css';
import {createSandboxSession,type SandboxPrincipal} from './sandboxSession';
import {PatternLibraryV2} from '../components/product-master-v2/PatternLibraryV2';
import {FabricWorkspaceV2} from '../components/product-master-v2/FabricImportV2';
import {ProductCatalogV2} from '../components/product-master-v2/ProductCatalogV2';
import {sandboxPages,type SandboxPage,SandboxCardsReadOnly,SandboxSessionsReadOnly,
 SandboxDocumentsReadOnly,SandboxStatsReadOnly} from './readOnlyPages';

const EMPTY_IMAGES=async()=>new Map<string,string>();

function SandboxCatalog({origin}:{origin:string}){
 const session=useMemo(()=>createSandboxSession(origin,fetch),[origin]);
 const [actor,setActor]=useState<SandboxPrincipal|null>(null);
 const [page,setPage]=useState<SandboxPage>('products');
 const [documentProduct,setDocumentProduct]=useState('');
 const openProductDocuments=(name:string)=>{setDocumentProduct(name);setPage('documents');};
 const [username,setUsername]=useState('');
 const [password,setPassword]=useState('');
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const apiFetch=useCallback< typeof fetch >(async(input,init)=>{
  if(typeof input!=='string')throw Error('Sandbox API path required');
  return session.request(input,init);
 },[session]);
 useEffect(()=>session.onUnauthenticated(()=>{setActor(null);setMessage('V2 沙箱会话已失效，请重新登录。');}),[session]);
 async function login(event:React.FormEvent){
  event.preventDefault();if(busy)return;
  setBusy(true);setMessage('');
  try{
   const principal=await session.login(username,password);
   setActor(principal);setPassword('');
  }catch{
   setPassword('');setActor(null);setMessage('V2 沙箱登录失败，请确认独立测试服务与账号。');
  }finally{setBusy(false);}
 }
 async function logout(){
  setActor(null);setPassword('');setMessage('');
  await session.logout();
 }
 const title='Fabric V2 · 本机沙箱实时只读目录';
 return <div className="min-h-screen bg-[#faf8ff] text-[#191b24]">
  <div role="note" className="border-b border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
   <strong>{title}</strong> · 仅供已审批的 127.0.0.1 隔离 V2 MySQL 沙箱，不属于旧系统；不允许生产部署、编辑、媒体导出或存储登录令牌。
  </div>
  {!actor?
   <form onSubmit={e=>void login(e)} className="mx-auto mt-12 max-w-md space-y-4 rounded border border-slate-200 bg-white p-6">
    <h1 className="text-lg font-semibold">登录独立 V2 沙箱</h1>
    <label className="block text-sm">测试账号<input autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)}
     required className="mt-1 w-full rounded border p-2"/></label>
    <label className="block text-sm">密码<input type="password" autoComplete="current-password" value={password}
     onChange={e=>setPassword(e.target.value)} required className="mt-1 w-full rounded border p-2"/></label>
    <button disabled={busy} className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50">
     {busy?'校验中…':'登录沙箱'}</button>
    {message?<p role="alert" className="text-red-700">{message}</p>:null}
   </form>:
   <>
    <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white p-4">
     <p className="text-sm">已通过独立 V2 会话校验：{actor.displayName}（{actor.role==='admin'?'管理员':'业务员'}）</p>
     <button onClick={()=>void logout()} className="rounded border px-3 py-2 text-sm">退出沙箱</button>
    </header>
    <nav aria-label="V2 沙箱只读目录" className="flex gap-2 overflow-x-auto border-b bg-white px-4 py-3">
     {sandboxPages.map(({id,title})=>
      <button key={id} onClick={()=>{setDocumentProduct('');setPage(id);}} aria-current={page===id?'page':undefined}
       className={'rounded px-3 py-2 text-sm '+(page===id?'bg-blue-100 text-blue-800':'bg-slate-100')}>{title}</button>)}
    </nav>
    <main className="mx-auto max-w-[1480px] p-3" data-sandbox-view={page}>
     {page==='patterns'?<PatternLibraryV2 apiFetch={apiFetch} canManage={false}
      resolvePatternImages={EMPTY_IMAGES}/>:
      page==='fabrics'?<FabricWorkspaceV2 apiFetch={apiFetch} canManage={false} isAdmin={false} allowExport={false}/>:
      page==='products'?<ProductCatalogV2 apiFetch={apiFetch} canManage={false} allowExport={false} resolveImages={EMPTY_IMAGES}/>:
      page==='cards'?<SandboxCardsReadOnly apiFetch={apiFetch}/>:
      page==='sessions'?<SandboxSessionsReadOnly apiFetch={apiFetch}/>:
      page==='documents'?<SandboxDocumentsReadOnly key={documentProduct} apiFetch={apiFetch} productName={documentProduct}/>:
      <SandboxStatsReadOnly apiFetch={apiFetch} onProduct={openProductDocuments}/>}
    </main>
   </>}
 </div>;
}

const node=typeof document!=='undefined'?document.getElementById('root'):null;
if(node){
 try{
  // Require exact 127.0.0.1 origin including a named port. Production host
  // or normal Fabric SPA can never bootstrap this isolated sandbox page.
  createSandboxSession(window.location.origin,fetch);
  createRoot(node).render(<SandboxCatalog origin={window.location.origin}/>);
 }catch{
  createRoot(node).render(<p role="alert">V2 沙箱必须从本机受限预览端口访问。</p>);
 }
}
