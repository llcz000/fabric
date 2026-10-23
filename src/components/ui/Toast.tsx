import React,{createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {CheckCircle2,AlertTriangle,Info,X} from 'lucide-react';

export type ToastKind='success'|'error'|'info';
export interface ToastItem{id:number;kind:ToastKind;message:string}

interface ToastContextValue{
 show(message:string,kind?:ToastKind):void;
 success(message:string):void;
 error(message:string):void;
 info(message:string):void;
}

const ToastContext=createContext<ToastContextValue|null>(null);

const kindStyle:Record<ToastKind,{icon:React.ReactNode;className:string}>={
 success:{icon:<CheckCircle2 size={17} aria-hidden="true"/>,className:'border-emerald-200 text-emerald-800'},
 error:{icon:<AlertTriangle size={17} aria-hidden="true"/>,className:'border-rose-200 text-rose-800'},
 info:{icon:<Info size={17} aria-hidden="true"/>,className:'border-[#c3c6d7] text-[#434655]'}
};

/** 全局轻提示。替代原生 alert，避免打断式弹窗阻塞操作。 */
export function ToastProvider({children}:{children:React.ReactNode}){
 const [items,setItems]=useState<ToastItem[]>([]);
 const seq=useRef(0);
 const timers=useRef(new Map<number,ReturnType<typeof setTimeout>>());
 const show=useCallback((message:string,kind:ToastKind='info')=>{
  const id=++seq.current;
  setItems(list=>[...list.slice(-3),{id,kind,message}]);
  const timer=setTimeout(()=>{
   setItems(list=>list.filter(item=>item.id!==id));
   timers.current.delete(id);
  },kind==='error'?6000:3600);
  timers.current.set(id,timer);
 },[]);
 useEffect(()=>()=>{timers.current.forEach(timer=>clearTimeout(timer));timers.current.clear();},[]);
 const value=useMemo<ToastContextValue>(()=>({
  show,
  success:(message:string)=>show(message,'success'),
  error:(message:string)=>show(message,'error'),
  info:(message:string)=>show(message,'info')
 }),[show]);
 return <ToastContext.Provider value={value}>
  {children}
  <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(92vw,360px)] flex-col gap-2"
   role="region" aria-label="操作提示">
   {items.map(item=>
    <div key={item.id} role="status" aria-live="polite"
     className={'pointer-events-auto flex items-start gap-2 rounded-xl border bg-white px-3.5 py-3 text-sm shadow-lg '+kindStyle[item.kind].className}>
     <span className="mt-0.5 shrink-0">{kindStyle[item.kind].icon}</span>
     <span className="min-w-0 flex-1 break-words leading-relaxed">{item.message}</span>
     <button type="button" aria-label="关闭提示" className="shrink-0 rounded p-0.5 text-current opacity-60 hover:opacity-100"
      onClick={()=>setItems(list=>list.filter(entry=>entry.id!==item.id))}><X size={15}/></button>
    </div>)}
  </div>
 </ToastContext.Provider>;
}

/**
 * 获取轻提示函数。
 * 若当前树内没有 ToastProvider（例如组件被独立渲染或嵌入到其他宿主），
 * 降级为 console 输出，保证不因缺少 Provider 而崩溃。
 */
export function useToast():ToastContextValue{
 const value=useContext(ToastContext);
 const fallback=useMemo<ToastContextValue>(()=>({
  show:(message:string,kind:ToastKind='info')=>{console.info(`[toast:${kind}]`,message);},
  success:(message:string)=>{console.info('[toast:success]',message);},
  error:(message:string)=>{console.error('[toast:error]',message);},
  info:(message:string)=>{console.info('[toast:info]',message);}
 }),[]);
 return value??fallback;
}
