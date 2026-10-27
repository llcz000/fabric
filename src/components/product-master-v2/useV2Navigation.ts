import {useCallback,useEffect,useRef,useState} from 'react';
import type {V2AppPrincipal} from './v2AppModel';
import {installV2BackGuard,dismissV2Modal} from './v2BackGuard';
import {readLeaveState,type LeaveRegistry} from './useV2LeaveProtection';
import {readV2Route,v2Route,V2_ROUTE_INDEX,type V2View} from './v2Navigation';
import {readSampleCardScanToken} from '../../lib/sampleCardScanLink';
import {useConfirm} from '../ui/ConfirmDialog';

/** 离开守卫可以是同步布尔，也可以是异步确认结果。 */
export type LeaveGuard=()=>boolean|Promise<boolean>;

/** Route history, modal-first back handling and draft protection share one owner. */
export function useV2Navigation(actor:V2AppPrincipal|null,identityResetVersion:number){
 const confirm=useConfirm();
 const initial=useRef(readV2Route(typeof window==='undefined'?'':window.location.hash));
 const [view,setView]=useState<V2View>(initial.current.view),[productName,setProductName]=useState(initial.current.productName),[previewId,setPreviewId]=useState(initial.current.previewId);
 const protectedEditors=useRef(new Map()) as LeaveRegistry;
 const [pendingLeave,setPendingLeave]=useState<(()=>void)|null>(null),[notice,setNotice]=useState('');
 const routeIndex=useRef(0),restoringRoute=useRef(false),[routeRevision,setRouteRevision]=useState(0);
 const leaveGuard=useRef<LeaveGuard>(()=>true);
 const appliedReset=useRef(identityResetVersion);
 const registerSampleLeaveGuard=useCallback((guard:LeaveGuard|null)=>{leaveGuard.current=guard??(()=>true);},[]);
 const applyRoute=useCallback((hash:string)=>{
  const route=readV2Route(hash);setView(route.view);setProductName(route.productName);setPreviewId(route.previewId);setRouteRevision(n=>n+1);
 },[]);
 useEffect(()=>{
  if(appliedReset.current===identityResetVersion)return;
  appliedReset.current=identityResetVersion;
  const scan=readSampleCardScanToken(readV2Route(window.location.hash).params.get('scan'));
  setView(scan?'samples':'stats');setProductName('');setPreviewId('');setPendingLeave(null);
  window.history.replaceState(window.history.state,'',scan?v2Route('samples',{scan}):v2Route('stats'));
 },[identityResetVersion]);
 useEffect(()=>{
  if(!actor)return;
  const cleanup=installV2BackGuard(window,()=>!readLeaveState(protectedEditors).busy,
   async()=>confirm({title:'确定离开 Fabric 页面？',message:'未保存的内容可能丢失。',confirmText:'离开页面',danger:true}));
  const savedIndex=window.history.state?.[V2_ROUTE_INDEX];routeIndex.current=Number.isInteger(savedIndex)?savedIndex:0;
  window.history.replaceState({...window.history.state,[V2_ROUTE_INDEX]:routeIndex.current},'',window.location.href);
  const back=async()=>{
   const target=window.history.state?.[V2_ROUTE_INDEX];if(typeof target!=='number')return;
   if(restoringRoute.current){restoringRoute.current=false;return;}
   const delta=routeIndex.current-target,state=readLeaveState(protectedEditors);
   if(dismissV2Modal(window)){if(delta){restoringRoute.current=true;window.history.go(delta);}return;}
   const restore=()=>{if(delta){restoringRoute.current=true;window.history.go(delta);}};
   if(state.busy){setNotice('正在保存或上传，请完成后再离开');restore();return;}
   if(state.dirty){
    const ok=await confirm({title:'放弃尚未保存的修改并返回上一页？',message:'当前内容尚未保存，放弃后无法恢复。',confirmText:'放弃并返回',danger:true});
    if(!ok){restore();return;}
   }
   if(!(await leaveGuard.current())){restore();return;}
   routeIndex.current=target;applyRoute(window.location.hash);
  };
  window.addEventListener('popstate',back);
  return()=>{cleanup();window.removeEventListener('popstate',back);};
 },[Boolean(actor),applyRoute,confirm]);
 const navigate=(next:V2View,params:Record<string,string>={})=>{
  const hash=v2Route(next,params);if(window.location.hash===hash)return;
  window.history.pushState({...window.history.state,[V2_ROUTE_INDEX]:++routeIndex.current},'',hash);applyRoute(hash);setNotice('');window.dispatchEvent(new Event('fabric-route'));
 };
 const requestLeave=(action:()=>void)=>{
  const state=readLeaveState(protectedEditors);
  if(state.busy){setNotice('正在保存或上传，请完成后再离开');return;}
  const proceed=async()=>{if(await leaveGuard.current())action();};
  // React 会把函数型 setState 当作 updater 调用，因此这里必须由 updater
  // **返回**待执行的函数，pendingLeave 才是那个函数本身而不是 undefined。
  if(state.dirty)setPendingLeave(()=>()=>{void proceed();});else void proceed();
 };
 const cancelLeave=useCallback(()=>setPendingLeave(null),[]);
 const discardLeave=()=>{
  if(readLeaveState(protectedEditors).busy)return;
  const action=pendingLeave;setPendingLeave(null);action?.();
 };
 useEffect(()=>{
  if(actor&&((view==='members'&&actor.role!=='admin')||(view==='preview'&&!previewId))){
   window.history.replaceState(window.history.state,'',v2Route('stats'));applyRoute(v2Route('stats'));
  }
 },[actor,view,previewId,applyRoute]);
 const scannedCardToken=typeof window==='undefined'?null:readSampleCardScanToken(readV2Route(window.location.hash).params.get('scan'));
 useEffect(()=>{
  if(actor&&scannedCardToken&&view==='samples'&&window.location.hash.startsWith('#/cards?'))window.history.replaceState(window.history.state,'',v2Route('samples',{scan:scannedCardToken}));
 },[actor,scannedCardToken,view]);
 return {view,productName,previewId,routeRevision,protectedEditors,pendingLeave,notice,navigate,requestLeave,cancelLeave,discardLeave,registerSampleLeaveGuard,scannedCardToken};
}
