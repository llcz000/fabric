import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../index.css';
import {createSandboxSession,type SandboxPrincipal} from '../product-master-v2-sandbox/sandboxSession';
import {PatternLibraryV2} from '../components/product-master-v2/PatternLibraryV2';
import {FabricLibraryV2} from '../components/product-master-v2/FabricLibraryV2';
import {FabricImportV2} from '../components/product-master-v2/FabricImportV2';
import {ProductCatalogWorkspaceV2} from '../components/product-master-v2/ProductCatalogWorkspaceV2';
import V2DocumentWorkspace from '../components/document-product-selector/V2DocumentWorkspace';
import {uploadImageAsset} from '../lib/imageAssets';
import type {CompanyProfile} from '../types';
import type {CatalogProduct} from '../components/product-master-v2/catalogModel';
import type {ImageRole} from '../components/product-master-v2/productEditorModel';

import {approvedV2Pages,type ApprovedV2Page} from './navigation';
const companyFields=[
 ['company_name','公司名称'],['brand_name','品牌字标'],['address','公司地址'],
 ['phone','电话'],['default_terms','样布/销售默认条款'],['deposit_terms','定金单专用条款'],
 ['issuer_label','开单人签字栏文案'],['receiver_label','收货人签字栏文案']
] as const;
type CompanyField=(typeof companyFields)[number][0];
const emptySettings:Record<CompanyField,string>={
 company_name:'',brand_name:'',address:'',phone:'',default_terms:'',deposit_terms:'',
 issuer_label:'开单人签字',receiver_label:'收货人签字'
};
function companySettings(value:unknown):Record<CompanyField,string>{
 const record=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
 return Object.fromEntries(companyFields.map(([id])=>[id,typeof record[id]==='string'?record[id]:emptySettings[id]])) as Record<CompanyField,string>;
}
const companyFallback:CompanyProfile={
 name:'',logoText:'',logoType:'text',address:'',phone:'',defaultTerms:'',
 depositTerms:'',issuerLabel:'开单人签字',receiverLabel:'收货人签字'
};
function asProfile(row:Record<string,unknown>):CompanyProfile{
 return {...companyFallback,name:String(row.company_name??''),address:String(row.address??''),
  phone:String(row.phone??''),defaultTerms:String(row.default_terms??''),
  depositTerms:String(row.deposit_terms??''),logoText:String(row.brand_name??''),
  issuerLabel:String(row.issuer_label??'开单人签字'),
  receiverLabel:String(row.receiver_label??'收货人签字')};
}
/** Separate opt-in local frontend. NEVER imported by src/App.tsx. */
export function V2BusinessWorkbench({origin}:{origin:string}){
 const session=useMemo(()=>createSandboxSession(origin,fetch),[origin]);
 const [actor,setActor]=useState<SandboxPrincipal|null>(null);
 const [username,setUsername]=useState(''),[password,setPassword]=useState('');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [page,setPage]=useState<ApprovedV2Page>('patterns');
 const [patternRevision,setPatternRevision]=useState(0);
 const [productRevision,setProductRevision]=useState(0);
 const [fabricRevision,setFabricRevision]=useState(0);
 const [createPattern,setCreatePattern]=useState(false),[masterNo,setMasterNo]=useState('');
 const [formError,setFormError]=useState('');
 const [company,setCompany]=useState<CompanyProfile>(companyFallback);
 const [mediaEnabled,setMediaEnabled]=useState(false),[companyImagesReady,setCompanyImagesReady]=useState(false);
 const [companyOpen,setCompanyOpen]=useState(false),[settings,setSettings]=useState(emptySettings);
 const [settingsError,setSettingsError]=useState(''),[companyBusy,setCompanyBusy]=useState(false);

 const apiFetch=useCallback<typeof fetch>(async(input,init)=>{
  if(typeof input!=='string')throw Error('Only isolated V2 paths are accepted');
  // Existing image upload / preview clients are kept unchanged; only this
  // explicitly isolated workbench maps those calls to Bearer-guarded V2 routes.
  const path=input.startsWith('/api/image-assets/')?'/api/v2/image-assets/'+input.slice('/api/image-assets/'.length):input;
  return session.requestWrite(path,init);
 },[session]);
 useEffect(()=>session.onUnauthenticated(()=>{
  setActor(null);setMediaEnabled(false);setCompanyImagesReady(false);setMessage('会话失效，请重新登录');
 }),[session]);
 useEffect(()=>{
  if(!actor)return;
  let alive=true;
  void Promise.all([
   apiFetch('/api/v2/company-print-settings').then(async res=>res.ok?await res.json():{}),
   apiFetch('/api/v2/media-capabilities').then(async res=>res.ok?await res.json():{available:false})
  ]).then(([details,media])=>{
   if(!alive)return;
   setCompany(asProfile(details as Record<string,unknown>));
   setSettings(companySettings(details));
   setMediaEnabled(media?.available===true);
   setCompanyImagesReady(media?.companyImagesAvailable===true);
  }).catch(()=>{if(alive){setCompany(companyFallback);setMediaEnabled(false);}});
  return ()=>{alive=false};
 },[actor,apiFetch]);
 const login=async(event:React.FormEvent)=>{
  event.preventDefault();if(busy)return;setBusy(true);setMessage('');
  try{setActor(await session.login(username,password));setPassword('');setPage('patterns');}
  catch{setMessage('V2 登录失败，请核对隔离沙箱账号');setPassword('');}
  finally{setBusy(false);}
 };
 const logout=async()=>{setActor(null);setPassword('');setMediaEnabled(false);setCompanyImagesReady(false);await session.logout();};
 const saveCompany=async(event:React.FormEvent)=>{
  event.preventDefault();if(!actor||actor.role!=='admin'||companyBusy)return;
  setCompanyBusy(true);setSettingsError('');
  try{
   const reply=await apiFetch('/api/v2/company-print-settings',{method:'PATCH',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)});
   if(!reply.ok)throw Error(reply.status===403?'当前账号不是管理员':'保存公司设置失败');
   const persisted=companySettings(await reply.json());
   setSettings(persisted);setCompany(asProfile(persisted));setCompanyOpen(false);
   setMessage('统一开单设置已保存，打印时读取最新配置');
  }catch(e){setSettingsError(e instanceof Error?e.message:'保存失败');}
  finally{setCompanyBusy(false);}
 };
 const attachCompanyImage=async(role:'brand_logo'|'wechat_qr'|'alipay_qr',file:File)=>{
  if(!mediaEnabled||!companyImagesReady)throw Error('公司图片服务尚未配置');
  const purpose=role==='brand_logo'?'company_logo':'company_qr';
  const saved=await uploadImageAsset(file,purpose,{apiFetch,directFetch});
  if(saved.status!=='ready')throw Error('图片尚未就绪');
  const reply=await apiFetch('/api/v2/company/images/'+role,{method:'PUT',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({assetId:saved.id})});
  if(!reply.ok)throw Error('公司图片关联失败，原设置未更改');
 };
 const changePage=(next:ApprovedV2Page)=>{
  if(next==='pattern-editor'){setPage('patterns');setMessage('请在花型列表选择“编辑”，进入该花型的配色页面');return;}
  if(next==='product-editor'){setPage('products');setMessage('请在产品列表选择“新增产品”或“编辑产品”');return;}
  setMessage('');setPage(next);
 };
 const createMaster=async(event:React.FormEvent)=>{
  event.preventDefault();if(busy||!masterNo.trim())return;
  setBusy(true);setFormError('');
  try{
   const response=await apiFetch('/api/v2/pattern-masters',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({masterNo:masterNo.trim()})});
   if(!response.ok)throw Error(response.status===409?'花型编号已经存在':'新增花型失败');
   setCreatePattern(false);setMasterNo('');setPatternRevision(v=>v+1);
  }catch(e){setFormError(e instanceof Error?e.message:'新增失败');}
  finally{setBusy(false);}
 };
 const removeProduct=async(product:CatalogProduct)=>{
  const response=await apiFetch('/api/v2/products/'+encodeURIComponent(product.id),{method:'DELETE'});
  if(!response.ok)throw Error(response.status===409?'该产品已被单据引用，不能删除':'删除产品失败，请重试');
 };
 const directFetch=useCallback<typeof fetch>(async(input,init)=>{
  const value=typeof input==='string'?input:input instanceof URL?input.href:null;
  if(!value)throw Error('Invalid upload destination');
  const target=new URL(value,origin),original=new URL(origin);
  if(target.hostname==='127.0.0.1'&&target.protocol==='http:'&&
    /^\/api\/(?:v2\/)?image-assets\/upload-sessions\/[A-Za-z0-9_-]+\/content$/.test(target.pathname)){
   const path='/api/v2/image-assets/'+target.pathname.split('/image-assets/')[1];
   return session.requestWrite(path,init);
  }
  // A COS PUT may use a short-lived signed upload grant; do not attach Bearer.
  if(target.protocol!=='https:')throw Error('Upload destination must be a secure signed URL');
  return fetch(value,{...init,credentials:'omit',redirect:'error'});
 },[session,origin]);
 const upload=async(file:File,_role?:ImageRole):Promise<string>=>{
  if(!mediaEnabled)throw Error('V2 图片服务尚未接入，请先完成隔离环境媒体配置');
  const result=await uploadImageAsset(file,'product_image',{apiFetch,directFetch});
  if(result.status!=='ready')throw Error('图片尚未处理完成');
  return result.id;
 };
 if(!actor)return <div className="mx-auto mt-12 max-w-lg rounded-xl border bg-white p-6">
  <h1 className="text-xl font-semibold">Fabric V2 · 独立业务联调</h1>
  <p className="my-3 text-xs text-amber-800">仅127.0.0.1隔离环境。不是旧系统入口，不允许生产写库。</p>
  <form onSubmit={e=>void login(e)} className="space-y-3">
   <label className="block text-sm">账号<input className="block w-full border p-2" required value={username} onChange={e=>setUsername(e.target.value)}/></label>
   <label className="block text-sm">密码<input type="password" required className="block w-full border p-2" value={password} onChange={e=>setPassword(e.target.value)}/></label>
   <button disabled={busy} className="rounded bg-blue-700 px-4 py-2 text-white">登录隔离沙箱</button>
  </form>{message&&<p role="alert">{message}</p>}
 </div>;
 return <div className="min-h-screen bg-[#faf8ff] text-[#191b24]">
  <header className="flex flex-wrap justify-between gap-3 border-b bg-white p-4">
   <p className="font-semibold">V2 · 七页业务功能联调 · {actor.displayName}（{actor.role}）</p>
   <div className="flex gap-2">{actor.role==='admin'&&
    <button className="rounded border px-4 py-1" type="button" onClick={()=>setCompanyOpen(v=>!v)}>统一开单设置</button>}
    <button className="rounded border px-4 py-1" type="button" onClick={()=>void logout()}>退出</button>
   </div>
  </header>
  <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs">隔离数据库及媒体必须先独立授权。当前图片服务：{mediaEnabled?'已配置':'未配置（上传不可用）'}。生产入口保持旧版。</p>
  <nav aria-label="已批准的 V2 七页" className="flex flex-wrap gap-2 border-b bg-white p-3">
   {approvedV2Pages.map(item=><button key={item.id} type="button"
    aria-current={page===item.id?'page':undefined}
    className={'rounded px-3 py-2 text-sm '+(page===item.id?'bg-blue-700 text-white':'bg-slate-100')}
    onClick={()=>changePage(item.id)}>{item.label}</button>)}
  </nav>
  {companyOpen&&actor.role==='admin'&&<section aria-label="统一开单设置" className="mx-auto my-3 max-w-4xl rounded-lg border bg-white p-4">
   <form onSubmit={e=>void saveCompany(e)} className="space-y-3">
    <h2 className="font-semibold">公司设置（新旧单据打印使用最新数据）</h2>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
     {companyFields.map(([field,label])=><label key={field} className="text-xs">{label}
      {field.endsWith('_terms')?<textarea className="block w-full rounded border p-2" rows={3}
       value={settings[field]} onChange={e=>setSettings(v=>({...v,[field]:e.target.value}))}/>:
       <input className="block w-full rounded border p-2" maxLength={field==='address'?500:field==='company_name'?255:100}
        value={settings[field]} onChange={e=>setSettings(v=>({...v,[field]:e.target.value}))}/>}
     </label>)}
    </div>
    {mediaEnabled&&companyImagesReady?<div className="flex flex-wrap gap-4">
     {(['brand_logo','wechat_qr','alipay_qr'] as const).map(role=><label key={role} className="text-xs">
      {role==='brand_logo'?'公司Logo':role==='wechat_qr'?'微信收款码':'支付宝收款码'}
      <input type="file" accept="image/png,image/jpeg,image/webp" className="block" disabled={companyBusy}
       onChange={e=>{const file=e.target.files?.[0];if(!file)return;setCompanyBusy(true);
        void attachCompanyImage(role,file).then(()=>setMessage('图片已更新'))
         .catch(err=>setSettingsError(err instanceof Error?err.message:'图片关联失败'))
         .finally(()=>setCompanyBusy(false));}}/>
     </label>)}
    </div>:<p className="text-xs text-amber-700">公司图片上传需要先配置V2隔离媒体服务。</p>}
    {settingsError&&<p role="alert" className="text-red-700">{settingsError}</p>}
    <button className="rounded bg-blue-700 px-4 py-2 text-white" disabled={companyBusy}>保存统一公司设置</button>
   </form>
  </section>}
  {message&&<p role="status" className="px-4 py-2 text-sm">{message}</p>}
  <main className="mx-auto max-w-[1480px] p-3" data-v2-business-page={page}>
   {(page==='patterns'||page==='pattern-editor')&&<div>
    {createPattern&&<form onSubmit={e=>void createMaster(e)} className="m-3 flex flex-wrap items-center gap-3 rounded border bg-white p-4">
     <label>花型编号 <input aria-label="新花型编号" maxLength={64} className="rounded border p-2" value={masterNo} onChange={e=>setMasterNo(e.target.value)}/></label>
     <button disabled={busy} className="rounded bg-blue-700 px-3 py-2 text-white">保存新花型</button>
     <button type="button" onClick={()=>setCreatePattern(false)} className="rounded border px-3 py-2">取消</button>
     {formError&&<p role="alert">{formError}</p>}
    </form>}
    <PatternLibraryV2 key={patternRevision} apiFetch={apiFetch} canManage
     onCreateMaster={()=>setCreatePattern(true)}
     onEditorStateChange={active=>setPage(active?'pattern-editor':'patterns')}
     onUploadPatternImage={file=>upload(file)}
    />
   </div>}
   {page==='fabrics'&&<FabricLibraryV2 key={fabricRevision} apiFetch={apiFetch} canManage/>}
   {(page==='products'||page==='product-editor')&&
    <ProductCatalogWorkspaceV2 key={productRevision} apiFetch={apiFetch} canManage
     onEditorStateChange={active=>setPage(active?'product-editor':'products')}
     onPatternLibrary={()=>setPage('patterns')} onFabricLibrary={()=>setPage('fabrics')}
     onUploadImage={upload} onDeleteProduct={removeProduct}/>}
   {page==='fabric-import'&&<FabricImportV2 apiFetch={apiFetch} canManage isAdmin={actor.role==='admin'}
    onCancel={()=>setPage('fabrics')} onFinished={()=>{setFabricRevision(v=>v+1);setPage('fabrics');}}/>}
   {page==='document-selector'&&<V2DocumentWorkspace apiFetch={apiFetch} role={actor.role}
    companyProfile={company} onSaved={()=>{setMessage('单据已经保存到独立V2后端');}}
    onCancel={()=>setPage('products')}/>}
  </main>
 </div>;
}
const node=typeof document==='undefined'?null:document.getElementById('root');
if(node){
 try{
  createSandboxSession(window.location.origin,fetch);
  createRoot(node).render(<V2BusinessWorkbench origin={window.location.origin}/>);
 }catch{
  createRoot(node).render(<p role="alert">七页业务联调只能从127.0.0.1独立端口访问。</p>);
 }
}
