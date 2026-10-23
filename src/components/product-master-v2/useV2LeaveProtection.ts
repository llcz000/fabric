import {createContext,useContext,useEffect,useLayoutEffect,useRef} from 'react';
import {useConfirm} from '../ui/ConfirmDialog';
export type LeaveState={dirty:boolean;busy:boolean};
export type LeaveRegistry={current:Map<symbol,()=>LeaveState>};
export const V2LeaveContext=createContext<LeaveRegistry|null>(null);
export function readLeaveState(registry:LeaveRegistry):LeaveState{
 const states=[...registry.current.values()].map(read=>read());
 return {dirty:states.some(s=>s.dirty),busy:states.some(s=>s.busy)};
}
/**
 * A guard owns only its own registration, including nested editor cleanup.
 * 只负责同步的「是否可离开」判断（写入中禁止离开）。
 * 丢弃未保存修改的确认由 useV2DiscardGuard 异步完成，不再退化为浏览器原生 confirm。
 */
export function useV2LeaveProtection(dirty:boolean,busy=false):()=>boolean{
 const registry=useContext(V2LeaveContext),key=useRef(Symbol('editor')),latest=useRef({dirty,busy});
 latest.current={dirty,busy};
 useLayoutEffect(()=>{registry?.current.set(key.current,()=>latest.current);return()=>{registry?.current.delete(key.current);};},[registry]);
 useEffect(()=>{
  if(typeof window==='undefined')return;
  const beforeUnload=(e:BeforeUnloadEvent)=>{if(latest.current.dirty||latest.current.busy){e.preventDefault();e.returnValue='';}};
  window.addEventListener('beforeunload',beforeUnload);return()=>window.removeEventListener('beforeunload',beforeUnload);
 },[]);
 return ()=>!latest.current.busy;
}

/**
 * 离开时若有未保存修改，先弹统一确认框；用户确认后才允许离开。
 * 返回 Promise<boolean>：true 表示可以离开。
 */
export function useV2DiscardGuard(dirty:boolean,busy=false,options:{title?:string;message?:string}={}){
 const confirm=useConfirm();
 const latest=useRef({dirty,busy});
 latest.current={dirty,busy};
 const guard=async function ():Promise<boolean>{
  if(latest.current.busy)return false;
  if(!latest.current.dirty)return true;
  return confirm({title:options.title??'放弃尚未保存的修改？',message:options.message??'当前内容尚未保存，放弃后无法恢复。',confirmText:'放弃修改',danger:true});
 };
 return guard;
}
