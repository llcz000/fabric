import {ActionIcon} from './ActionIcon';
import React,{useEffect,useRef,useState} from 'react';
import {openCardCamera} from './cameraBridge';
export function CardPhotoInput({disabled,onDecoded,onBusyChange,label='扫码加入',compact=false}:{label?:string;compact?:boolean;disabled:boolean;onDecoded:(token:string)=>void;onBusyChange:(busy:boolean)=>void}){
 const live=useRef<(()=>void)|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>()=>{live.current?.();onBusyChange(false);},[onBusyChange]);
 function scan(){if(disabled||busy)return;setError('');setBusy(true);onBusyChange(true);try{live.current=openCardCamera(onDecoded,()=>{live.current=null;setBusy(false);onBusyChange(false);});}catch(cause){setBusy(false);onBusyChange(false);setError((cause as Error).message);}}
 useEffect(()=>{if(disabled)live.current?.();},[disabled]);
 return <div className="min-w-0 space-y-1 text-sm"><div className="flex flex-wrap gap-2"><button type="button" data-live-scan disabled={disabled||busy} onClick={scan} className={'min-h-11 rounded-lg bg-blue-700 px-4 py-2 text-white disabled:opacity-40 '+(compact?'w-full':'')}><ActionIcon name="scan"/>{label}</button>{busy&&live.current&&<button type="button" onClick={()=>live.current?.()} className="rounded border px-3 py-2"><ActionIcon name="close"/>取消扫码</button>}</div>{!compact&&<p className="text-xs text-slate-500">对准色卡二维码，识别成功后自动加入选样</p>}{busy&&<p role="status">正在识别色卡…</p>}{error&&<p role="alert" className="text-rose-700">{error}</p>}</div>;
}
