import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {CompanyProfile} from '../../types';
import {PatternWorkspaceV2} from './PatternWorkspaceV2';
import {FabricWorkspaceV2} from './FabricImportV2';
import {ProductCatalogWorkspaceV2} from './ProductCatalogWorkspaceV2';
import {SampleCardLibraryV2} from './SampleCardLibraryV2';
import {V2DocumentBrowser} from '../document-product-selector/V2DocumentBrowser';
import V2DocumentWorkspace from '../document-product-selector/V2DocumentWorkspace';
import V2DocumentPrintView from '../document-product-selector/V2DocumentPrintView';
import {V2DocumentStats} from '../document-product-selector/V2DocumentStats';
import CompanyProfileEditor from '../CompanyProfileEditor';
import V2MemberManager from './V2MemberManager';
import V2InventoryWorkspace from './V2InventoryWorkspace';
import {SampleBusinessWorkspaceV2} from './SampleBusinessWorkspaceV2';
import {PatternShareDialog} from '../customer-share/PatternShareDialog';
import {uploadImageAsset,applyCompanyImageMutations} from '../../lib/imageAssets';
import type {CompanyImageMutation} from '../../lib/companyImageState';
import {resolveImageUrls} from './catalogModel';
import {parseV2AppPrincipal,v2AuthenticatedFetch,mapV2Company,type V2AppPrincipal} from './v2AppModel';
const SESSION='fabric-v2-session';
type View='stats'|'documents'|'create'|'pattern'|'fabric'|'products'|'cards'|'samples'|'settings'|'members'|'preview'|'inventory';
export default function V2App(){
 const [token,setToken]=useState(()=>{try{return sessionStorage.getItem(SESSION)??'';}catch{return '';}});
 const [actor,setActor]=useState<V2AppPrincipal|null>(null),[company,setCompany]=useState<CompanyProfile|null>(null);
 const [view,setView]=useState<View>('stats'),[productName,setProductName]=useState(''),[previewId,setPreviewId]=useState('');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 const [username,setUsername]=useState(''),[password,setPassword]=useState('');
 const [shareEnabled,setShareEnabled]=useState(false),[sharingMaster,setSharingMaster]=useState<{id:string;masterNo:string}|null>(null);
 const leaveGuard=useRef<()=>boolean>(()=>true);
 const registerSampleLeaveGuard=useCallback((guard:(()=>boolean)|null)=>{leaveGuard.current=guard??(()=>true);},[]);
 const expire=useCallback(()=>{sessionStorage.removeItem(SESSION);setToken('');setActor(null);setCompany(null);setView('stats');setShareEnabled(false);setSharingMaster(null);},[]);
 const apiFetch=useMemo(()=>v2AuthenticatedFetch(fetch,token,expire),[token,expire]);
 useEffect(()=>{
  if(!token)return;const controller=new AbortController(),urls:string[]=[];setError('');setActor(null);setCompany(null);
  (async()=>{try{
   const identity=await apiFetch('/api/v2/access/me',{signal:controller.signal});if(!identity.ok)throw Error('登录验证失败，请重新登录');
   const me=parseV2AppPrincipal(await identity.json());
   const response=await apiFetch('/api/company',{signal:controller.signal});if(!response.ok)throw Error('公司设置读取失败');
   const raw=await response.json(),profile=mapV2Company(raw);
   const shareCapabilities=await apiFetch('/api/v2/pattern-sharing',{signal:controller.signal});
   const sharing=shareCapabilities.ok&&(await shareCapabilities.json()).enabled===true;
   for(const [role,value] of Object.entries(raw.images??{})){
    if(!['brand_logo','wechat_qr','alipay_qr'].includes(role)||!value||typeof value!=='object')continue;
    const image=value as {source:'asset'|'legacy';assetId?:string;displayUrl:string};
    if(!/^\/api\/company\/images\/(brand_logo|wechat_qr|alipay_qr)\/content$/.test(image.displayUrl))throw Error('公司图片地址无效');
    const imageResponse=await apiFetch(image.displayUrl,{signal:controller.signal});if(!imageResponse.ok)throw Error('公司图片读取失败');
    const url=URL.createObjectURL(await imageResponse.blob());urls.push(url);
    profile.companyImages![role as keyof NonNullable<CompanyProfile['companyImages']>]={role:role as any,source:image.source,assetId:image.assetId,displayUrl:url};
    if(role==='brand_logo'){profile.logoType='image';profile.logoUrl=url;}else if(role==='wechat_qr')profile.weChatPayUrl=url;else profile.aliPayUrl=url;
   }
   if(!controller.signal.aborted){setActor(me);setCompany(profile);setShareEnabled(sharing);}
  }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'资料读取失败');}})();
  return()=>{controller.abort();for(const url of urls)URL.revokeObjectURL(url);};
 },[token,apiFetch,revision]);
 const login=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError('');try{
  const response=await fetch('/api/v2/access/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
  if(!response.ok)throw Error(response.status===429?'登录尝试过多，请稍后重试':'登录失败，请检查账号和密码');
  const result=await response.json();if(typeof result.token!=='string'||!(/^[a-f0-9]{64}$/.test(result.token)))throw Error('登录会话无效');
  sessionStorage.setItem(SESSION,result.token);setPassword('');setToken(result.token);
 }catch(cause){setError(cause instanceof Error?cause.message:'登录失败');}finally{setBusy(false);}};
 const logout=async()=>{if(!leaveGuard.current())return;try{await apiFetch('/api/v2/access/logout',{method:'POST'});}finally{expire();}};
 const saveCompany=async(profile:CompanyProfile,mutations:CompanyImageMutation[])=>{
  const response=await apiFetch('/api/company',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company_name:profile.name,brand_name:profile.logoText,address:profile.address,phone:profile.phone,default_terms:profile.defaultTerms,deposit_terms:profile.depositTerms??'',issuer_label:profile.issuerLabel,receiver_label:profile.receiverLabel})});
  if(!response.ok)throw Error('公司资料保存失败');await applyCompanyImageMutations(mutations,{apiFetch,reloadCompanyProfile:async()=>{setRevision(n=>n+1);}});setRevision(n=>n+1);
 };
 const resolveImages=useCallback((ids:string[],variant:'thumbnail'|'display'|'original',signal?:AbortSignal)=>resolveImageUrls(apiFetch,ids,variant,signal),[apiFetch]);
 if(!token)return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4"><form onSubmit={login} className="w-full max-w-sm space-y-4 rounded-xl border bg-white p-6 shadow-sm" aria-label="账号登录"><h1 className="text-xl font-semibold">Fabric</h1><label className="block">登录名<input required autoComplete="username" name="username" className="mt-1 w-full rounded border p-2" value={username} onChange={e=>setUsername(e.target.value)}/></label><label className="block">密码<input required autoComplete="current-password" type="password" name="password" className="mt-1 w-full rounded border p-2" value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}<button disabled={busy} className="w-full rounded bg-blue-700 p-2 text-white">{busy?'正在登录…':'登录'}</button></form></main>;
 if(!actor||!company)return <main className="space-y-4 p-6">{error?<p role="alert">{error}</p>:<p role="status">正在读取账号与公司资料…</p>}<button className="rounded border p-2" onClick={()=>setRevision(n=>n+1)}>重新读取</button><button className="ml-3 rounded border p-2" onClick={expire}>返回登录</button></main>;
 const items:[View,string][]=[['stats','经营大盘'],['documents','单据列表'],['create','新增单据'],['pattern','花型库'],['fabric','面料库'],['products','产品库'],['cards','色卡库'],['samples','客户选样'],['inventory','库存'],['settings','开单设置'],...(actor.role==='admin'?[['members','成员管理'] as [View,string]]:[])];
 return <div className="min-h-screen bg-[#faf8ff]"><header className="border-b bg-white p-4"><div className="mx-auto flex max-w-[1480px] items-center justify-between gap-3"><h1 className="text-xl font-semibold">Fabric</h1><span className="text-sm">{actor.displayName} · {actor.role==='admin'?'管理员':'业务员'} <button className="ml-3 text-blue-700" onClick={()=>void logout()}>退出登录</button></span></div><nav className="mx-auto mt-4 flex max-w-[1480px] gap-2 overflow-x-auto" aria-label="主导航">{items.map(([id,label])=><button className={'whitespace-nowrap rounded px-4 py-2 text-sm '+(id===view?'bg-blue-50 font-semibold text-blue-700':'text-slate-600')} key={id} aria-current={id===view?'page':undefined} onClick={()=>{if(!leaveGuard.current())return;setProductName('');setView(id);}}>{label}</button>)}</nav></header>
 <main className="mx-auto max-w-[1480px]">
  {view==='stats'&&<V2DocumentStats apiFetch={apiFetch} onProduct={name=>{setProductName(name);setView('documents');}} onDocument={id=>{setPreviewId(id);setView('preview');}}/>}
  {view==='documents'&&<V2DocumentBrowser key={productName} apiFetch={apiFetch} role={actor.role} companyProfile={company} initialFilters={productName?{productName}:undefined}/>}
  {view==='create'&&<V2DocumentWorkspace apiFetch={apiFetch} role={actor.role} companyProfile={company} onSaved={doc=>{setPreviewId(doc.id);setView('preview');}} onCancel={()=>setView('documents')}/>}
  {view==='preview'&&<V2DocumentPrintView apiFetch={apiFetch} documentId={previewId} backLabel="返回单据列表" onBack={()=>setView('documents')}/>}
  {view==='pattern'&&<PatternWorkspaceV2 apiFetch={apiFetch} canManage resolvePatternImages={resolveImages} onShareMaster={shareEnabled?setSharingMaster:undefined}/>}
  {view==='fabric'&&<FabricWorkspaceV2 apiFetch={apiFetch} canManage isAdmin={actor.role==='admin'}/>}
  {view==='products'&&<ProductCatalogWorkspaceV2 apiFetch={apiFetch} canManage resolveImages={resolveImages} onUploadImage={async file=>(await uploadImageAsset(file,'product_image',{apiFetch})).id} onDeleteProduct={async product=>{if(!window.confirm('确认删除产品 '+product.productNo+'？已被单据引用的产品不能删除。'))return;const response=await apiFetch('/api/v2/products/'+product.id,{method:'DELETE'});if(!response.ok)throw Error(response.status===409?'产品已被引用，请改为停用':'产品删除失败');}} onPatternLibrary={()=>setView('pattern')} onFabricLibrary={()=>setView('fabric')}/>}
  {view==='cards'&&<SampleCardLibraryV2 apiFetch={apiFetch}/>}
  {view==='samples'&&<SampleBusinessWorkspaceV2 apiFetch={apiFetch} onRegisterLeaveGuard={registerSampleLeaveGuard}/>}
  {view==='settings'&&<CompanyProfileEditor profile={company} onSave={saveCompany} apiFetch={apiFetch}/>}
  {view==='inventory'&&<V2InventoryWorkspace apiFetch={apiFetch}/>}
  {view==='members'&&actor.role==='admin'&&<V2MemberManager apiFetch={apiFetch} onProfileChanged={async()=>{const response=await apiFetch('/api/v2/access/me');if(!response.ok)throw Error('身份读取失败');setActor(parseV2AppPrincipal(await response.json()));}}/>}
 </main>{sharingMaster&&<PatternShareDialog master={sharingMaster} apiFetch={apiFetch} onClose={()=>setSharingMaster(null)}/>}</div>;
}
