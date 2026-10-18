import React,{useEffect,useRef,useState} from 'react';
export function CardPhotoInput({disabled,onDecoded,onBusyChange}:{disabled:boolean;onDecoded:(token:string)=>void;onBusyChange:(busy:boolean)=>void}){
 const input=useRef<HTMLInputElement>(null),scope=useRef<AbortController|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>()=>{scope.current?.abort();onBusyChange(false);},[onBusyChange]);
 async function read(event:React.ChangeEvent<HTMLInputElement>){
  const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(!file||disabled)return;
  scope.current?.abort();const controller=new AbortController();scope.current=controller;setBusy(true);onBusyChange(true);setError('');
  try{const {readCardPhoto}=await import('./cardPhotoScan');const token=await readCardPhoto(file,controller.signal);if(!controller.signal.aborted)onDecoded(token);}
  catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error&&/^(未识别|不是有效|请选择|图片|当前浏览器)/.test(cause.message)?cause.message:'图片读取失败，请重新拍照或输入色卡编码');}
  finally{if(!controller.signal.aborted){setBusy(false);onBusyChange(false);}}
 }
 return <div className="min-w-0 space-y-1 text-sm"><button type="button" data-scan-start className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-40" disabled={disabled||busy} onClick={()=>input.current?.click()}>扫码加入</button><input ref={input} aria-label="拍照或选图识别色卡" className="sr-only" tabIndex={-1} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={disabled||busy} onChange={event=>{void read(event);}}/><p className="text-xs text-slate-500">拍摄或选择色卡二维码，识别后确认加入</p>{busy&&<p role="status">正在识别色卡…</p>}{error&&<p role="alert" className="text-rose-700">{error}</p>}</div>;
}
