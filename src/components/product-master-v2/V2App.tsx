import { ActionIcon } from './ActionIcon';
import { useCallback,useEffect,useRef,useState } from 'react';
import { PatternWorkspaceV2 } from './PatternWorkspaceV2';
import { FabricWorkspaceV2 } from './FabricImportV2';
import { ProductCatalogWorkspaceV2 } from './ProductCatalogWorkspaceV2';
import { SampleCardLibraryV2 } from './SampleCardLibraryV2';
import { V2DocumentBrowser } from '../document-product-selector/V2DocumentBrowser';
import V2DocumentWorkspace from '../document-product-selector/V2DocumentWorkspace';
import V2DocumentPrintView from '../document-product-selector/V2DocumentPrintView';
import { V2DocumentStats } from '../document-product-selector/V2DocumentStats';
import CompanyProfileEditor from '../CompanyProfileEditor';
import V2MemberManager from './V2MemberManager';
import V2InventoryWorkspace from './V2InventoryWorkspace';
import { SampleBusinessWorkspaceV2,Session,type RegisterSampleLeaveGuard } from './SampleBusinessWorkspaceV2';
import {CustomerWorkspace} from '../customers/CustomerWorkspace';
import type {SampleSessionSummary} from './sampleOperationsModel';
import {useV2LeaveProtection} from './useV2LeaveProtection';
import { uploadImageAsset } from '../../lib/imageAssets';
import { resolveImageUrls } from './catalogModel';
import { V2Shell, V2DiscardDialog } from './V2Shell';
import { V2LeaveContext } from './useV2LeaveProtection';
import { readV2Route } from './v2Navigation';
import { useV2Identity } from './useV2Identity';
import { useV2Company } from './useV2Company';
import { useV2Navigation } from './useV2Navigation';
import { V2ViewBoundary } from './V2ViewBoundary';

const VIEW_LABELS:Record<string,string>={
 stats:'经营大盘',documents:'单据列表',create:'新增单据',preview:'单据预览',
 pattern:'花型库',fabric:'面料库',products:'产品库',cards:'色卡库',
 samples:'客户选样',customers:'客户管理',settings:'开单设置',inventory:'库存',members:'成员管理'
};

export default function V2App(){
 const {token,apiFetch,resetVersion,username,setUsername,password,setPassword,busy,error:loginError,login,logout,expire}=useV2Identity();
 const {actor,company,shareEnabled,error:companyError,reload,reloadActor,saveCompany}=useV2Company(apiFetch,token);
 const {view,productName,previewId,routeRevision,protectedEditors,pendingLeave,notice,navigate,requestLeave,cancelLeave,discardLeave,registerSampleLeaveGuard,scannedCardToken}=useV2Navigation(actor,resetVersion);
 const error=token?companyError:loginError;
 const resolveImages=useCallback((ids:string[],variant:'thumbnail'|'display'|'original',signal?:AbortSignal)=>resolveImageUrls(apiFetch,ids,variant,signal),[apiFetch]);
 if(!token)return <main className="v2-login">
  <form onSubmit={login} className="v2-login-card" aria-label="账号登录">
   <div className="v2-login-brand"><span className="v2-brand-mark" aria-hidden="true">F</span><strong>Fabric</strong></div>
   <h1 className="v2-login-title">面料单据管理系统</h1>
   <p className="v2-login-subtitle">花型、面料、产品与单据的一体化工作台</p>
   <label className="v2-login-field">登录名<input required autoComplete="username" name="username" className="v2-login-input" value={username} onChange={e=>setUsername(e.target.value)}/></label>
   <label className="v2-login-field">密码<input required autoComplete="current-password" type="password" name="password" className="v2-login-input" value={password} onChange={e=>setPassword(e.target.value)}/></label>
   {error&&<p role="alert" className="v2-login-error">{error}</p>}
   <button disabled={busy} className="v2-login-submit"><ActionIcon name="login"/>{busy?'正在登录…':'登录'}</button>
  </form>
 </main>;
 if(!actor||!company)return <main className="space-y-4 p-6">{error?<p role="alert">{error}</p>:<p role="status">正在读取账号与公司资料…</p>}<button className="rounded border p-2" onClick={reload}><ActionIcon name="refresh"/>重新读取</button><button className="ml-3 rounded border p-2" onClick={expire}><ActionIcon name="back"/>返回登录</button></main>;
 return <V2LeaveContext.Provider value={protectedEditors}><V2Shell actor={actor} view={view} blocked={Boolean(pendingLeave)} onNavigate={id=>{if(id!==view)requestLeave(()=>navigate(id));}} onLogout={()=>requestLeave(()=>void logout())}>
  {notice&&<p role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{notice}</p>}
  <V2ViewBoundary key={view} label={VIEW_LABELS[view]??'页面'} onBack={()=>requestLeave(()=>navigate('stats'))}>
  {view==='stats'&&<V2DocumentStats apiFetch={apiFetch} onProduct={name=>requestLeave(()=>navigate('documents',{productName:name}))} onDocument={id=>requestLeave(()=>navigate('preview',{id}))}/>}
  {view==='documents'&&<V2DocumentBrowser key={productName+':'+routeRevision} apiFetch={apiFetch} role={actor.role} companyProfile={company} initialFilters={productName?{productName}:undefined}/>}
  {view==='create'&&<V2DocumentWorkspace apiFetch={apiFetch} role={actor.role} companyProfile={company} onSaved={doc=>navigate('preview',{id:doc.id})} onCancel={()=>navigate('documents')}/>}
  {view==='preview'&&<V2DocumentPrintView apiFetch={apiFetch} documentId={previewId} backLabel="返回单据列表" onBack={()=>requestLeave(()=>navigate('documents'))}/>}
  {view==='pattern'&&<PatternWorkspaceV2 apiFetch={apiFetch} canManage resolvePatternImages={resolveImages} onCreateProduct={master=>requestLeave(()=>navigate('products',{batchMasterId:master.id}))}/>}
  {view==='fabric'&&<FabricWorkspaceV2 apiFetch={apiFetch} canManage/>}
  {view==='products'&&<ProductCatalogWorkspaceV2 key={routeRevision} apiFetch={apiFetch} canManage resolveImages={resolveImages} initialPatternId={readV2Route(window.location.hash).params.get('patternId')??undefined} initialPatternNo={readV2Route(window.location.hash).params.get('createPattern')??undefined} initialBatchMasterId={readV2Route(window.location.hash).params.get('batchMasterId')??undefined} onExitPrefill={()=>navigate('products')} onUploadImage={async file=>(await uploadImageAsset(file,'product_image',{apiFetch})).id} onDeleteProduct={async product=>{const response=await apiFetch('/api/v2/products/'+product.id,{method:'DELETE'});if(!response.ok)throw Error(response.status===409?'产品已被引用，请改为停用':'产品删除失败');}} onPatternLibrary={()=>requestLeave(()=>navigate('pattern'))} onFabricLibrary={()=>requestLeave(()=>navigate('fabric'))}/>}
   {view==='cards'&&<SampleCardLibraryV2 apiFetch={apiFetch} shareEnabled={shareEnabled}/>}
   {view==='samples'&&<SampleBusinessWorkspaceV2 apiFetch={apiFetch} resolveImages={resolveImages} initialCardToken={scannedCardToken??undefined} onRegisterLeaveGuard={registerSampleLeaveGuard}/>}
   {view==='customers'&&<CustomerRoute apiFetch={apiFetch} onRegisterLeaveGuard={registerSampleLeaveGuard} onOpenDocument={id=>requestLeave(()=>navigate('preview',{id}))}/>}
  {view==='settings'&&<CompanyProfileEditor profile={company} onSave={saveCompany} apiFetch={apiFetch}/>}
  {view==='inventory'&&<V2InventoryWorkspace apiFetch={apiFetch}/>}
  {view==='members'&&actor.role==='admin'&&<V2MemberManager apiFetch={apiFetch} onProfileChanged={reloadActor}/>}
  </V2ViewBoundary>
 </V2Shell>{pendingLeave&&<V2DiscardDialog onCancel={cancelLeave} onDiscard={discardLeave}/>}</V2LeaveContext.Provider>;
}

function CustomerRoute(props:{apiFetch:typeof fetch;onRegisterLeaveGuard:RegisterSampleLeaveGuard;onOpenDocument?(id:string):void}){
 const identity=useRef({fetch:props.apiFetch,revision:0});if(identity.current.fetch!==props.apiFetch)identity.current={fetch:props.apiFetch,revision:identity.current.revision+1};
 return <CustomerRouteBody key={identity.current.revision} {...props}/>;
}
function CustomerRouteBody({apiFetch,onRegisterLeaveGuard,onOpenDocument}:{apiFetch:typeof fetch;onRegisterLeaveGuard:RegisterSampleLeaveGuard;onOpenDocument?(id:string):void}){
 const [active,setActive]=useState<SampleSessionSummary|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),pending=useRef(false),scope=useRef(new AbortController());
 useV2LeaveProtection(false,loading);
 useEffect(()=>{const c=new AbortController();scope.current=c;return()=>c.abort();},[]);
 async function open(id:string){if(pending.current||scope.current.signal.aborted)return;pending.current=true;setLoading(true);setError('');const signal=scope.current.signal;try{const r=await apiFetch('/api/v2/customer-samples/sessions/'+encodeURIComponent(id)+'?limit=1&offset=0',{signal,cache:'no-store'});if(!r.ok)throw Error();const data=await r.json(),session=data.session;if(!session||session.id!==id||typeof session.customerReference!=='string')throw Error();if(!signal.aborted)setActive(session);}catch{if(!signal.aborted)setError('选样资料不可读取，请检查当前权限后重试。');}finally{pending.current=false;if(!signal.aborted)setLoading(false);}}
 if(active)return <Session key={active.id} session={active} mode="details" apiFetch={apiFetch} readOnly={active.canManage===false} onStatusChanged={setActive} onRegisterLeaveGuard={onRegisterLeaveGuard} onBack={()=>setActive(null)}/>;
 return <>{error&&<p role="alert" className="p-4 text-rose-700">{error}</p>}{loading&&<p role="status" className="p-4">正在读取选样详情…</p>}<div inert={loading||undefined}><CustomerWorkspace apiFetch={apiFetch} onOpenDocument={onOpenDocument} onOpenSession={id=>void open(id)}/></div></>;
}
