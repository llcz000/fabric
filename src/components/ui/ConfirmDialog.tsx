import React,{createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {AlertTriangle,ShieldQuestion} from 'lucide-react';

export interface ConfirmOptions{
 title:string;
 message?:React.ReactNode;
 confirmText?:string;
 cancelText?:string;
 danger?:boolean;
}

interface ConfirmRequest extends ConfirmOptions{
 resolve(value:boolean):void;
}

type ConfirmFn=(options:ConfirmOptions)=>Promise<boolean>;

const ConfirmContext=createContext<ConfirmFn|null>(null);

/**
 * 全局确认对话框。替代原生 window.confirm：
 * 样式与业务界面一致、可异步等待、支持危险操作红色强调。
 */
export function ConfirmProvider({children}:{children:React.ReactNode}){
 const [request,setRequest]=useState<ConfirmRequest|null>(null);
 const active=useRef<ConfirmRequest|null>(null),queue=useRef<ConfirmRequest[]>([]);
 const confirm=useCallback<ConfirmFn>(options=>new Promise<boolean>(resolve=>{
  const next={...options,resolve};if(active.current){queue.current.push(next);}else{active.current=next;setRequest(next);}
 }),[]);
 const settle=useCallback((value:boolean)=>{
  active.current?.resolve(value);const next=queue.current.shift()??null;active.current=next;setRequest(next);
 },[]);
 useEffect(()=>()=>{active.current?.resolve(false);active.current=null;queue.current.splice(0).forEach(r=>r.resolve(false));},[]);
 const value=useMemo(()=>confirm,[confirm]);
 return <ConfirmContext.Provider value={value}>
  {children}
  {request?<ConfirmModal request={request} settle={settle}/>:null}
 </ConfirmContext.Provider>;
}
function ConfirmModal({request,settle}:{request:ConfirmRequest;settle(value:boolean):void}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const node=ref.current,before=typeof document==='undefined'?null:document.activeElement;node?.showModal();return()=>{node?.close();if(typeof HTMLElement!=='undefined'&&before instanceof HTMLElement&&before.isConnected)before.focus();};},[request]);
 return <dialog ref={ref} role="alertdialog" aria-modal="true" aria-label={request.title}
    onCancel={event=>{event.preventDefault();settle(false);}}
    className="m-auto w-[min(92vw,448px)] rounded-2xl border-0 bg-white p-6 shadow-2xl backdrop:bg-[#0f172a66]">
    <div className="flex items-start gap-3">
     <span className={'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl '+
      (request.danger?'bg-rose-50 text-rose-600':'bg-[#eef1fd] text-[#346ef6]')}>
      {request.danger?<AlertTriangle size={19} aria-hidden="true"/>:<ShieldQuestion size={19} aria-hidden="true"/>}
     </span>
     <div className="min-w-0 flex-1">
      <h2 className="text-base font-semibold text-slate-800">{request.title}</h2>
      {request.message?<div className="mt-2 text-sm leading-relaxed text-slate-600">{request.message}</div>:null}
     </div>
    </div>
    <div className="mt-6 flex justify-end gap-2">
     <button type="button" onClick={()=>settle(false)}
      className="rounded-lg border border-[#dbe1e9] px-4 py-2 text-sm text-[#434655] hover:bg-[#f3f4fa]">{request.cancelText??'取消'}</button>
     <button type="button" onClick={()=>settle(true)} autoFocus
      className={'rounded-lg px-4 py-2 text-sm font-medium text-white '+
       (request.danger?'bg-rose-700 hover:bg-rose-800':'bg-[#346ef6] hover:bg-[#275ee0]')}>
      {request.confirmText??'确认'}
     </button>
    </div>
 </dialog>;
}

/**
 * 获取确认函数。
 * 若当前树内没有 ConfirmProvider（例如组件被独立渲染或嵌入到其他宿主），
 * 降级为原生 window.confirm，保证业务逻辑不因缺少 Provider 而崩溃。
 */
export function useConfirm():ConfirmFn{
 const value=useContext(ConfirmContext);
 const fallback=useMemo<ConfirmFn>(()=>options=>Promise.resolve(
  typeof window!=='undefined'&&typeof window.confirm==='function'
   ?window.confirm(options.message?`${options.title}\n${String(options.message)}`:options.title)
   :true
 ),[]);
 return value??fallback;
}
