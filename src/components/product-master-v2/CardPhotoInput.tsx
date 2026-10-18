import React,{useEffect,useRef,useState} from 'react';
export function CardPhotoInput({disabled,onDecoded,onBusyChange}:{disabled:boolean;onDecoded:(token:string)=>void;onBusyChange:(busy:boolean)=>void}){
 const scope=useRef<AbortController|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>()=>{scope.current?.abort();onBusyChange(false);},[onBusyChange]);
 async function read(event:React.ChangeEvent<HTMLInputElement>){
  const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(!file||disabled)return;
  scope.current?.abort();const controller=new AbortController();scope.current=controller;setBusy(true);onBusyChange(true);setError('');
  try{const {readCardPhoto}=await import('./cardPhotoScan');const token=await readCardPhoto(file,controller.signal);if(!controller.signal.aborted)onDecoded(token);}
  catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error&&/^(未识别|不是有效|请选择|图片|当前浏览器)/.test(cause.message)?cause.message:'图片读取失败，请重新拍照或输入色卡编码');}
  finally{if(!controller.signal.aborted){setBusy(false);onBusyChange(false);}}
 }
 const locked=disabled||busy;
 return <div className="min-w-0 space-y-1 text-sm"><div className="flex flex-wrap gap-2">
  <label className={'relative rounded bg-blue-700 px-4 py-2 text-white focus-within:ring-2 focus-within:ring-blue-400 '+(locked?'opacity-40':'cursor-pointer')}>扫码加入<input data-scan-start aria-label="拍照或选图识别色卡" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" type="file" accept="image/*" capture="environment" disabled={locked} onChange={event=>{void read(event);}}/></label>
  <label className={'relative rounded border border-slate-300 bg-white px-3 py-2 focus-within:ring-2 focus-within:ring-blue-400 '+(locked?'opacity-40':'cursor-pointer')}>从相册识别<input aria-label="从相册识别色卡" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" type="file" accept="image/*" disabled={locked} onChange={event=>{void read(event);}}/></label>
 </div><p className="text-xs text-slate-500">无法打开相机时，可先拍摄色卡，再从相册选择；识别后确认加入</p>{busy&&<p role="status">正在识别色卡…</p>}{error&&<p role="alert" className="text-rose-700">{error}</p>}</div>;
}
