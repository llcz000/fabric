import {ActionIcon} from '../product-master-v2/ActionIcon';
import React,{useEffect,useState} from 'react';
import {PublicPatternGallery} from './PublicPatternGallery';
import {parsePublicPatternResponse,publicPatternImagePath} from './publicPatternClient';
import type {PublicPattern} from '../../../server/customer-share/publicPatternProjection';
export default function PublicPatternPage({token}:{token:string}){
 const [pattern,setPattern]=useState<PublicPattern|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();setPattern(null);setLoading(true);setError('');
  void fetch('/api/public/patterns/'+token,{signal:controller.signal,cache:'no-store',credentials:'omit',redirect:'error',headers:{Accept:'application/json'}}).then(async response=>{
   if(response.status===404)return null;if(!response.ok)throw Error('花型资料暂不可用，请稍后重试');return parsePublicPatternResponse(await response.json());
  }).then(value=>{if(!controller.signal.aborted)setPattern(value);}).catch(()=>{if(!controller.signal.aborted)setError('花型资料暂不可用，请稍后重试');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[token,revision]);
 if(loading)return <main className="p-6" role="status">正在读取花型…</main>;
 return <>{error?<main className="p-6" role="alert">{error}</main>:<PublicPatternGallery key={token} pattern={pattern} renderPreview={(previewRef,description)=><img loading="lazy" referrerPolicy="no-referrer" src={publicPatternImagePath(token,previewRef)} alt={description} className="max-h-[420px] w-full object-contain"/>}/>}<div className="mx-auto max-w-4xl px-4 pb-6"><button className="rounded border px-3 py-2 text-sm" onClick={()=>setRevision(n=>n+1)}><ActionIcon name="refresh"/>刷新花型</button></div></>;
}
