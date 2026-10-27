import React,{useState,useEffect,lazy,Suspense} from 'react';
import {ErrorBoundary} from './components/ErrorBoundary';
import {ToastProvider} from './components/ui/Toast';
import {ConfirmProvider} from './components/ui/ConfirmDialog';
import {readSampleCardScanToken} from './lib/sampleCardScanLink';
const V2App=lazy(()=>import('./components/product-master-v2/V2App'));
const PublicPatternPage=lazy(()=>import('./components/customer-share/PublicPatternPage'));
const CardScanGateway=lazy(()=>import('./components/customer-share/CardScanGateway'));

/** V2 is the only internal application; unsupported runtimes fail closed. Public shares stay read-only. */
export default function App(){
 const share=typeof window!=='undefined'?/^\/(p|s|c)\/([A-Za-z0-9_-]{43})$/.exec(window.location.pathname):undefined;
 if(share)return <ErrorBoundary><Suspense fallback={<p role="status">正在读取公开资料…</p>}><PublicPatternPage token={share[2]} productOnly={share[1]==='s'} cardOnly={share[1]==='c'}/></Suspense></ErrorBoundary>;
 const scan=typeof window==='undefined'?null:readSampleCardScanToken(window.location.hash);
 if(scan)return <ErrorBoundary><Suspense fallback={<p role="status">正在加载色卡…</p>}><CardScanGateway token={scan} internal={<ToastProvider><ConfirmProvider><RuntimeApp/></ConfirmProvider></ToastProvider>}/></Suspense></ErrorBoundary>;
 return <ToastProvider><ConfirmProvider><RuntimeApp/></ConfirmProvider></ToastProvider>;
}
function RuntimeApp(){
 const [mode,setMode]=useState<'loading'|'v2'|'error'>('loading'),[retry,setRetry]=useState(0);
 useEffect(()=>{const abort=new AbortController();fetch('/api/runtime',{signal:abort.signal,cache:'no-store'}).then(async response=>{
  if(!response.ok)throw Error('Runtime unavailable');const value=await response.json();
  if(value.mode!=='v2')throw Error('Invalid runtime');if(!abort.signal.aborted)setMode(value.mode);
 }).catch(()=>{if(!abort.signal.aborted)setMode('error');});return()=>abort.abort();},[retry]);
 if(mode==='v2')return <ErrorBoundary><Suspense fallback={<p role="status">正在加载…</p>}><V2App/></Suspense></ErrorBoundary>;
 return <main className="p-6">{mode==='error'?<><p role="alert">服务暂时不可用，请稍后重试。</p><button onClick={()=>{setMode('loading');setRetry(n=>n+1);}}>重试</button></>:<p role="status">正在连接服务…</p>}</main>;
}
