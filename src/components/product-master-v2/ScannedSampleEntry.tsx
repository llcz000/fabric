import React,{useEffect,useState} from 'react';
import {SampleScanCustomerStep} from './SampleScanCustomerStep';
import {FocusedSampleSelection} from './FocusedSampleSelection';
import type {CatalogImageResolver} from './ProductImageTabs';
import {resolveScannedSampleCard} from './sampleCardModel';
import type {SampleSessionSummary} from './sampleOperationsModel';
import type {RegisterSampleLeaveGuard} from './SampleBusinessWorkspaceV2';
export function ScannedSampleEntry({apiFetch,cardToken,onFinish,onRegisterLeaveGuard,resolveImages}:{resolveImages?:CatalogImageResolver;apiFetch:typeof fetch;cardToken:string;onFinish(session?:SampleSessionSummary):void;onRegisterLeaveGuard?:RegisterSampleLeaveGuard}){
 const [session,setSession]=useState<SampleSessionSummary|null>(null),[ready,setReady]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{if(session)return;const c=new AbortController();setReady(false);setError('');void resolveScannedSampleCard(apiFetch,cardToken,c.signal).then(()=>{if(!c.signal.aborted)setReady(true);}).catch(e=>{if(!c.signal.aborted)setError(e instanceof Error?e.message:'色卡不可用，请重新扫码');});return()=>c.abort();},[apiFetch,cardToken,retry,session]);
 if(session)return <FocusedSampleSelection session={session} apiFetch={apiFetch} resolveImages={resolveImages} initialCardToken={cardToken} onFinish={()=>onFinish(session)} onRegisterLeaveGuard={onRegisterLeaveGuard}/>;
 return <>{error?<div role="alert" className="mx-auto max-w-xl rounded-lg bg-rose-50 p-4 text-sm text-rose-700">{error} <button type="button" className="min-h-11 px-2 underline" onClick={()=>setRetry(n=>n+1)}>重新读取</button></div>:!ready&&<p role="status" className="px-4 pt-4 text-center text-xs text-slate-500">正在核对扫码…</p>}<SampleScanCustomerStep onRegisterLeaveGuard={onRegisterLeaveGuard} apiFetch={apiFetch} disabled={!ready} onSelected={setSession} onCancel={()=>onFinish()}/></>;
}
