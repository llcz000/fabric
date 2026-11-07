import React,{useEffect,useRef,useState} from 'react';
/** Internal recognition thumbnail only; it never requests or opens the original image. */
export function SamplePatternThumbnail({url,label,assetId,pending=false,failed=false,reload}:{url?:string;label:string;assetId?:string|null;pending?:boolean;failed?:boolean;reload?:(signal:AbortSignal)=>Promise<string|undefined>}){
 const [broken,setBroken]=useState(false),[renewed,setRenewed]=useState<string>(),[retrying,setRetrying]=useState(false),[revision,setRevision]=useState(0);
 const attempts=useRef(0),scope=useRef<AbortController|null>(null);
 useEffect(()=>{setBroken(false);setRenewed(undefined);setRetrying(false);attempts.current=0;return()=>scope.current?.abort();},[assetId,url]);
 async function retry(){
  if(!reload||scope.current&&!scope.current.signal.aborted)return;
  const c=new AbortController();scope.current=c;attempts.current++;setRetrying(true);
  try{const fresh=await reload(c.signal);if(c.signal.aborted)return;if(!fresh)throw Error('Missing thumbnail');setRenewed(fresh);setRevision(n=>n+1);setBroken(false);}
  catch{if(!c.signal.aborted)setBroken(true);}
  finally{if(!c.signal.aborted)setRetrying(false);c.abort();}
 }
 const source=renewed??url;
 if(source&&!broken)return <img key={revision} className="v2-sample-thumb" src={source} alt={'花型 '+label+' 缩略图'} loading="lazy" decoding="async" width={80} height={80} onError={()=>{setBroken(true);if(attempts.current===0)void retry();}}/>;
 if(assetId&&(broken||failed)&&reload)return <button type="button" className="v2-sample-thumb v2-sample-thumb-empty" aria-label={'重试花型 '+label+' 缩略图'} disabled={retrying} onClick={event=>{event.preventDefault();event.stopPropagation();void retry();}}>{retrying?'加载中…':'加载失败，重试'}</button>;
 return <span className="v2-sample-thumb v2-sample-thumb-empty">{!assetId?'暂无图片':broken||failed?'加载失败':pending?'加载中…':'图片不可用'}</span>;
}
