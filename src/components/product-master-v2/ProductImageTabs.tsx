import {ActionIcon} from './ActionIcon';
import React,{useEffect,useId,useRef,useState} from 'react';
import type {CatalogProductImages} from './catalogModel';

export type CatalogImageResolver=(ids:string[],variant:'thumbnail'|'display'|'original',signal?:AbortSignal)=>Promise<Map<string,string>>;
const roles=[['fabricDisplay','面料大图'],['detail','面料细节图'],['aiEffect','效果图']] as const;
type Role=typeof roles[number][0];

/** Session-only cache: mounted originals survive tab switches, and close clears everything. */
export function ProductImageTabs({images,resolveImages}:{images:CatalogProductImages['images'];resolveImages:CatalogImageResolver}){
 const prefix=useId(),[role,setRole]=useState<Role>('fabricDisplay');
 const cache=useRef(new Map<string,string>());
 const [urls,setUrls]=useState(new Map<string,string>()),[loading,setLoading]=useState(false);
 const [error,setError]=useState(''),[retry,setRetry]=useState(0);
 const [failed,setFailed]=useState(new Set<string>());
 useEffect(()=>{
  const controller=new AbortController();let current=true;
  const missing=images[role].filter(id=>!cache.current.has(id));
  setError('');setLoading(missing.length>0);
  if(missing.length)void resolveImages(missing,'original',controller.signal).then(result=>{
   if(!current)return;
   for(const id of missing){const url=result.get(id);if(url)cache.current.set(id,url);}
   setUrls(new Map(cache.current));
   if(missing.some(id=>!result.has(id)))setError('部分原图暂不可用，请重试。');
  }).catch(()=>{if(current)setError('原图加载失败，请重试。');})
   .finally(()=>{if(current)setLoading(false);});
  return ()=>{current=false;controller.abort();};
 },[images,role,resolveImages,retry]);
 const reload=()=>{
  for(const id of images[role])if(failed.has(id))cache.current.delete(id);
  setFailed(previous=>new Set([...previous].filter(id=>!images[role].includes(id))));
  setUrls(new Map(cache.current));setRetry(value=>value+1);
 };
 const loadFailed=images[role].some(id=>failed.has(id));
 return <div>
  <div role="tablist" aria-label="产品图片分类" className="mb-4 flex gap-1 overflow-x-auto border-b">
   {roles.map(([key,label],index)=><button key={key} type="button" role="tab" data-image-role={key}
    id={prefix+'-tab-'+key} aria-selected={role===key} aria-controls={prefix+'-panel-'+key} tabIndex={role===key?0:-1}
    onClick={()=>setRole(key)} onKeyDown={event=>{
     let next:number|undefined;
     if(event.key==='ArrowRight')next=(index+1)%roles.length;
     if(event.key==='ArrowLeft')next=(index+roles.length-1)%roles.length;
     if(event.key==='Home')next=0;if(event.key==='End')next=roles.length-1;
     if(next!==undefined){event.preventDefault();setRole(roles[next][0]);document.getElementById(prefix+'-tab-'+roles[next][0])?.focus();}
    }} className={'whitespace-nowrap border-b-2 px-3 py-2 text-sm '+(role===key?'border-[#346ef6] font-semibold text-[#0053da]':'border-transparent text-slate-500')}>
    {label}（{images[key].length}）
   </button>)}
  </div>
  {roles.map(([key,label])=><section key={key} role="tabpanel" id={prefix+'-panel-'+key}
   aria-labelledby={prefix+'-tab-'+key} hidden={role!==key} tabIndex={0}>
   {role===key&&loading?<p role="status" className="mb-3 text-sm text-slate-500">正在加载原图…</p>:null}
   {role===key&&(error||loadFailed)?<p role="alert" className="mb-3 text-sm text-rose-700">{error||'原图加载失败，请重试。'}
    <button type="button" onClick={reload} className="ml-2 underline"><ActionIcon name="refresh"/>重试原图</button></p>:null}
   {!images[key].length?<p className="py-8 text-center text-sm text-slate-500">暂无{label}</p>:
    <div className="space-y-4">{images[key].map((id,index)=>urls.has(id)?<figure key={id}>
     {failed.has(id)?<div className="rounded border bg-slate-50 p-6 text-center text-sm text-slate-500">图片暂不可用</div>:
      <img src={urls.get(id)} alt={label+'原图 '+(index+1)} loading="lazy"
       onError={()=>setFailed(previous=>new Set(previous).add(id))}
       className="mx-auto max-h-[75vh] max-w-full rounded object-contain"/>}
     <figcaption className="mt-1 text-center text-xs text-slate-500">{index+1} / {images[key].length}</figcaption>
    </figure>:null)}</div>}
  </section>)}
 </div>;
}
