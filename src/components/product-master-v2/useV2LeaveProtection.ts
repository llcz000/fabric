import {createContext,useContext,useEffect,useLayoutEffect,useRef} from 'react';
export type LeaveState={dirty:boolean;busy:boolean};
export type LeaveRegistry={current:Map<symbol,()=>LeaveState>};
export const V2LeaveContext=createContext<LeaveRegistry|null>(null);
export function readLeaveState(registry:LeaveRegistry):LeaveState{
 const states=[...registry.current.values()].map(read=>read());
 return {dirty:states.some(s=>s.dirty),busy:states.some(s=>s.busy)};
}
/** A guard owns only its own registration, including nested editor cleanup. */
export function useV2LeaveProtection(dirty:boolean,busy=false){
 const registry=useContext(V2LeaveContext),key=useRef(Symbol('editor')),latest=useRef({dirty,busy});
 latest.current={dirty,busy};
 useLayoutEffect(()=>{registry?.current.set(key.current,()=>latest.current);return()=>{registry?.current.delete(key.current);};},[registry]);
 useEffect(()=>{
  if(typeof window==='undefined')return;
  const beforeUnload=(e:BeforeUnloadEvent)=>{if(latest.current.dirty||latest.current.busy){e.preventDefault();e.returnValue='';}};
  window.addEventListener('beforeunload',beforeUnload);return()=>window.removeEventListener('beforeunload',beforeUnload);
 },[]);
 return ()=>!latest.current.busy&&(!latest.current.dirty||typeof window==='undefined'||window.confirm('放弃尚未保存的修改吗？选择取消可继续编辑。'));
}
