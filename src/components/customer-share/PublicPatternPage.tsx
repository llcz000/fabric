import {ActionIcon} from '../product-master-v2/ActionIcon';
import React,{useEffect,useState} from 'react';
import {PublicPatternGallery} from './PublicPatternGallery';
import {PublicProductImage} from './PublicProductImage';
import {PublicCardGallery} from './PublicCardGallery';
import type {PublicCard} from '../../../server/customer-share/cardShareCatalog';
import {parsePublicPatternResponse,parsePublicProductResponse,publicPatternImagePath,parsePublicCardResponse,publicCardImagePath} from './publicPatternClient';
import type {PublicPattern} from '../../../server/customer-share/publicPatternProjection';
export default function PublicPatternPage({token,productOnly=false,cardOnly=false}:{token:string;productOnly?:boolean;cardOnly?:boolean}){
 const [card,setCard]=useState<PublicCard|null>(null);
 const [productNo,setProductNo]=useState('');
 const [pattern,setPattern]=useState<PublicPattern|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 // The public /c/ page owns a customer-facing title; restore the normal app title on exit.
 useEffect(()=>{if(!cardOnly)return;const previous=document.title;return()=>{document.title=previous;};},[cardOnly]);
 useEffect(()=>{if(cardOnly)document.title=card?card.cardNo+' · '+card.fabricName+'｜面料花型展示':'面料花型展示｜Fabric';},[cardOnly,card?.cardNo,card?.fabricName]);
 useEffect(()=>{
  const controller=new AbortController();setPattern(null);setCard(null);setProductNo('');setLoading(true);setError('');
  void fetch('/api/public/'+(cardOnly?'cards':productOnly?'products':'patterns')+'/'+token,{signal:controller.signal,cache:'no-store',credentials:'omit',redirect:'error',headers:{Accept:'application/json'}}).then(async response=>{
   if(response.status===404)return {pattern:null,productNo:'',card:null};if(!response.ok)throw Error();const raw=await response.json();
   return cardOnly?{pattern:null,productNo:'',card:parsePublicCardResponse(raw)}:productOnly?{...parsePublicProductResponse(raw),card:null}:{pattern:parsePublicPatternResponse(raw),productNo:'',card:null};
  }).then(value=>{if(!controller.signal.aborted){setPattern(value.pattern);setCard(value.card);setProductNo(value.productNo);}}).catch(()=>{if(!controller.signal.aborted)setError('资料暂不可用，请稍后重试');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[token,revision,productOnly,cardOnly]);
 if(loading)return <main className="p-6" role="status">{cardOnly?'正在读取色卡产品…':'正在读取花型…'}</main>;
 return <>{error?<main className="p-6" role="alert">{error}{cardOnly?<div className="mt-4"><button type="button" className="min-h-11 rounded-lg border border-[#d9dfd8] bg-white px-5 py-2 text-sm text-[#344a3b]" onClick={()=>setRevision(n=>n+1)}>重试加载</button></div>:null}</main>:cardOnly?<PublicCardGallery card={card} renderPreview={(ref,description,priority)=><PublicProductImage src={publicCardImagePath(token,ref)} description={description} priority={priority}/>}/>:<PublicPatternGallery key={token} pattern={pattern} productOnly={productOnly} productNo={productNo||undefined} renderPreview={(previewRef,description)=>productOnly?<PublicProductImage src={publicPatternImagePath(token,previewRef,true)} description={description}/>:<img loading="lazy" referrerPolicy="no-referrer" src={publicPatternImagePath(token,previewRef)} alt={description} className="max-h-[420px] w-full object-contain"/>}/>}{!cardOnly?<div className="mx-auto max-w-4xl px-4 pb-6"><button className="rounded border px-3 py-2 text-sm" onClick={()=>setRevision(n=>n+1)}><ActionIcon name="refresh"/>{productOnly?'刷新产品':'刷新花型'}</button></div>:null}</>;
}
