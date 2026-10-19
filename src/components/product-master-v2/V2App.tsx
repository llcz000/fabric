import {ActionIcon} from './ActionIcon';
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
import {createV2LoginStore,V2_LOGIN_KEY} from './v2LoginStorage';
import {installV2BackGuard,dismissV2Modal} from './v2BackGuard';
import {V2Shell,V2DiscardDialog} from './V2Shell';
import {V2LeaveContext,readLeaveState,type LeaveRegistry} from './useV2LeaveProtection';
import {readV2Route,v2Route,V2_ROUTE_INDEX,type V2View} from './v2Navigation';
type View=V2View;
export default function V2App(){
 const loginStore=useMemo(()=>createV2LoginStore(),[]);
 const [token,setToken]=useState(()=>loginStore.restore()),currentToken=useRef(token);currentToken.current=token;
 const [actor,setActor]=useState<V2AppPrincipal|null>(null),[company,setCompany]=useState<CompanyProfile|null>(null);
 const initialRoute=useRef(readV2Route(typeof window==='undefined'?'':window.location.hash));
 const [view,setView]=useState<View>(initialRoute.current.view),[productName,setProductName]=useState(initialRoute.current.productName),[previewId,setPreviewId]=useState(initialRoute.current.previewId);
 const protectedEditors=useRef(new Map()) as LeaveRegistry;
 const [pendingLeave,setPendingLeave]=useState<(()=>void)|null>(null),[notice,setNotice]=useState('');
 const routeIndex=useRef(0),restoringRoute=useRef(false),[routeRevision,setRouteRevision]=useState(0);
 const applyRoute=useCallback((hash:string)=>{const route=readV2Route(hash);setView(route.view);setProductName(route.productName);setPreviewId(route.previewId);setRouteRevision(n=>n+1);},[]);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 const [username,setUsername]=useState(''),[password,setPassword]=useState('');
 const [shareEnabled,setShareEnabled]=useState(false),[sharingMaster,setSharingMaster]=useState<{id:string;masterNo:string}|null>(null);
 const leaveGuard=useRef<()=>boolean>(()=>true);
 const registerSampleLeaveGuard=useCallback((guard:(()=>boolean)|null)=>{leaveGuard.current=guard??(()=>true);},[]);
 const resetIdentity=useCallback((next:string)=>{currentToken.current=next;setToken(next);setActor(null);setCompany(null);setView('stats');setProductName('');setPreviewId('');setPendingLeave(null);window.history.replaceState(window.history.state,'',v2Route('stats'));setShareEnabled(false);setSharingMaster(null);},[]);
 const expire=useCallback(()=>{if(loginStore.clear(currentToken.current))resetIdentity('');else resetIdentity(loginStore.restore(true));},[loginStore,resetIdentity]);
 const apiFetch=useMemo(()=>v2AuthenticatedFetch(fetch,token,()=>{if(currentToken.current===token)expire();}),[token,expire]);
 useEffect(()=>{const sync=(event:StorageEvent)=>{if(event.key!==V2_LOGIN_KEY&&event.key!==null)return;const next=loginStore.restore(true);if(next!==currentToken.current){currentToken.current=next;resetIdentity(next);}};window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);},[loginStore,resetIdentity]);
 useEffect(()=>{
  if(!actor)return;
  const cleanup=installV2BackGuard(window,()=>!readLeaveState(protectedEditors).busy&&leaveGuard.current());
  const savedIndex=window.history.state?.[V2_ROUTE_INDEX];routeIndex.current=Number.isInteger(savedIndex)?savedIndex:0;
  window.history.replaceState({...window.history.state,[V2_ROUTE_INDEX]:routeIndex.current},'',window.location.href);
  const back=()=>{
   const target=window.history.state?.[V2_ROUTE_INDEX];if(typeof target!=='number')return;
   if(restoringRoute.current){restoringRoute.current=false;return;}
   const delta=routeIndex.current-target,state=readLeaveState(protectedEditors);
   if(dismissV2Modal(window)){if(delta){restoringRoute.current=true;window.history.go(delta);}return;}
   if(state.busy||(state.dirty&&!window.confirm('放弃尚未保存的修改并返回上一页吗？'))||!leaveGuard.current()){
    if(state.busy)setNotice('正在保存或上传，请完成后再离开');
    if(delta){restoringRoute.current=true;window.history.go(delta);}return;
   }
   routeIndex.current=target;applyRoute(window.location.hash);
  };
  window.addEventListener('popstate',back);return()=>{cleanup();window.removeEventListener('popstate',back);};
 },[Boolean(actor),applyRoute]);
 const navigate=(next:View,params:Record<string,string>={})=>{
  const hash=v2Route(next,params);if(window.location.hash===hash)return;
  window.history.pushState({...window.history.state,[V2_ROUTE_INDEX]:++routeIndex.current},'',hash);applyRoute(hash);setNotice('');
 };
 const requestLeave=(action:()=>void)=>{
  const state=readLeaveState(protectedEditors);
  if(state.busy){setNotice('正在保存或上传，请完成后再离开');return;}
  const proceed=()=>{if(leaveGuard.current())action();};
  if(state.dirty)setPendingLeave(()=>proceed);else proceed();
 };
 const cancelLeave=useCallback(()=>setPendingLeave(null),[]);
 useEffect(()=>{if(actor&&((view==='members'&&actor.role!=='admin')||(view==='preview'&&!previewId))){window.history.replaceState(window.history.state,'',v2Route('stats'));applyRoute(v2Route('stats'));}},[actor,view,previewId,applyRoute]);
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
  loginStore.save(result.token,result.expiresIn);currentToken.current=result.token;setPassword('');setToken(result.token);
 }catch(cause){setError(cause instanceof Error?cause.message:'登录失败');}finally{setBusy(false);}};
 const logout=async()=>{const issuedFor=token;try{await apiFetch('/api/v2/access/logout',{method:'POST'});}finally{if(currentToken.current===issuedFor)expire();}};
 const saveCompany=async(profile:CompanyProfile,mutations:CompanyImageMutation[])=>{
  const response=await apiFetch('/api/company',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company_name:profile.name,brand_name:profile.logoText,address:profile.address,phone:profile.phone,default_terms:profile.defaultTerms,deposit_terms:profile.depositTerms??'',issuer_label:profile.issuerLabel,receiver_label:profile.receiverLabel})});
  if(!response.ok)throw Error('公司资料保存失败');await applyCompanyImageMutations(mutations,{apiFetch,reloadCompanyProfile:async()=>{setRevision(n=>n+1);}});setRevision(n=>n+1);
 };
 const resolveImages=useCallback((ids:string[],variant:'thumbnail'|'display'|'original',signal?:AbortSignal)=>resolveImageUrls(apiFetch,ids,variant,signal),[apiFetch]);
 if(!token)return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4"><form onSubmit={login} className="w-full max-w-sm space-y-4 rounded-xl border bg-white p-6 shadow-sm" aria-label="账号登录"><h1 className="text-xl font-semibold">Fabric</h1><label className="block">登录名<input required autoComplete="username" name="username" className="mt-1 w-full rounded border p-2" value={username} onChange={e=>setUsername(e.target.value)}/></label><label className="block">密码<input required autoComplete="current-password" type="password" name="password" className="mt-1 w-full rounded border p-2" value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}<button disabled={busy} className="w-full rounded bg-blue-700 p-2 text-white"><ActionIcon name="login"/>{busy?'正在登录…':'登录'}</button></form></main>;
 if(!actor||!company)return <main className="space-y-4 p-6">{error?<p role="alert">{error}</p>:<p role="status">正在读取账号与公司资料…</p>}<button className="rounded border p-2" onClick={()=>setRevision(n=>n+1)}><ActionIcon name="refresh"/>重新读取</button><button className="ml-3 rounded border p-2" onClick={expire}><ActionIcon name="back"/>返回登录</button></main>;
 return <V2LeaveContext.Provider value={protectedEditors}><V2Shell actor={actor} view={view} blocked={Boolean(pendingLeave)} onNavigate={id=>{if(id!==view)requestLeave(()=>navigate(id));}} onLogout={()=>requestLeave(()=>void logout())}>
 {notice&&<p role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{notice}</p>}
  {view==='stats'&&<V2DocumentStats apiFetch={apiFetch} onProduct={name=>requestLeave(()=>navigate('documents',{productName:name}))} onDocument={id=>requestLeave(()=>navigate('preview',{id}))}/>}
  {view==='documents'&&<V2DocumentBrowser key={productName+':'+routeRevision} apiFetch={apiFetch} role={actor.role} companyProfile={company} initialFilters={productName?{productName}:undefined}/>}
  {view==='create'&&<V2DocumentWorkspace apiFetch={apiFetch} role={actor.role} companyProfile={company} onSaved={doc=>navigate('preview',{id:doc.id})} onCancel={()=>navigate('documents')}/>}
  {view==='preview'&&<V2DocumentPrintView apiFetch={apiFetch} documentId={previewId} backLabel="返回单据列表" onBack={()=>requestLeave(()=>navigate('documents'))}/>}
  {view==='pattern'&&<PatternWorkspaceV2 apiFetch={apiFetch} canManage resolvePatternImages={resolveImages} onShareMaster={shareEnabled?setSharingMaster:undefined}/>}
  {view==='fabric'&&<FabricWorkspaceV2 apiFetch={apiFetch} canManage isAdmin={actor.role==='admin'}/>}
  {view==='products'&&<ProductCatalogWorkspaceV2 key={routeRevision} apiFetch={apiFetch} canManage resolveImages={resolveImages} onUploadImage={async file=>(await uploadImageAsset(file,'product_image',{apiFetch})).id} onDeleteProduct={async product=>{const response=await apiFetch('/api/v2/products/'+product.id,{method:'DELETE'});if(!response.ok)throw Error(response.status===409?'产品已被引用，请改为停用':'产品删除失败');}} onPatternLibrary={()=>requestLeave(()=>navigate('pattern'))} onFabricLibrary={()=>requestLeave(()=>navigate('fabric'))}/>}
  {view==='cards'&&<SampleCardLibraryV2 apiFetch={apiFetch}/>}
  {view==='samples'&&<SampleBusinessWorkspaceV2 apiFetch={apiFetch} onRegisterLeaveGuard={registerSampleLeaveGuard}/>}
  {view==='settings'&&<CompanyProfileEditor profile={company} onSave={saveCompany} apiFetch={apiFetch}/>}
  {view==='inventory'&&<V2InventoryWorkspace apiFetch={apiFetch}/>}
  {view==='members'&&actor.role==='admin'&&<V2MemberManager apiFetch={apiFetch} onProfileChanged={async()=>{const response=await apiFetch('/api/v2/access/me');if(!response.ok)throw Error('身份读取失败');setActor(parseV2AppPrincipal(await response.json()));}}/>}
 </V2Shell>{pendingLeave&&<V2DiscardDialog onCancel={cancelLeave} onDiscard={()=>{if(readLeaveState(protectedEditors).busy)return;const action=pendingLeave;setPendingLeave(null);action();}}/>}{sharingMaster&&<PatternShareDialog master={sharingMaster} apiFetch={apiFetch} onClose={()=>setSharingMaster(null)}/>}</V2LeaveContext.Provider>;
}
