import React,{useState} from 'react';
import type {CatalogTag} from './catalogModel';
import {ensureTopicTag,TOPIC_PRESETS,sortedTopicTags} from './topicCatalog';

/** Presets can be chosen even before corresponding DB tags exist.
 * New tags are written only after an explicit user selection. */
export function TopicTagPicker({apiFetch,options,selected,onChange,onTagCreated,disabled=false,ariaLabel}:{
 apiFetch:typeof fetch;options:CatalogTag[];selected:string[];onChange(ids:string[]):void;
 onTagCreated?(tag:CatalogTag):void;disabled?:boolean;ariaLabel:string;
}){
 const [custom,setCustom]=useState(''),[working,setWorking]=useState(false),[error,setError]=useState('');
 const merged=sortedTopicTags(options);
 const others=merged.filter(t=>!TOPIC_PRESETS.some(name=>name===t.name));
 const add=async(name:string)=>{
  if(working||disabled||selected.length>=10)return;
  const found=options.find(t=>t.name===name);
  if(found&&selected.includes(found.id)){onChange(selected.filter(id=>id!==found.id));return;}
  setWorking(true);setError('');
  try{
   const tag=await ensureTopicTag(apiFetch,options,name);
   if(!found)onTagCreated?.(tag);
   onChange([...selected,tag.id]);setCustom('');
  }catch(e){setError(e instanceof Error?e.message:'题材标签保存失败');}
  finally{setWorking(false);}
 };
 return <div role="group" aria-label={ariaLabel} className="space-y-2">
  <div className="flex flex-wrap gap-1">
   {TOPIC_PRESETS.map(name=>{
    const tag=options.find(t=>t.name===name),on=!!tag&&selected.includes(tag.id);
    return <button key={name} type="button" aria-pressed={on} disabled={disabled||working||!on&&selected.length>=10}
     onClick={()=>void add(name)} className={'rounded-full px-2 py-1 text-[11px] '+(on?'bg-[#346ef6] text-white':'bg-[#eef1fd] text-[#31447b]')}>{name}</button>;
   })}
  </div>
  {others.length?<div className="flex flex-wrap gap-1"><span className="text-[11px] text-slate-500">其他／历史题材</span>
   {others.map(t=><button key={t.id} type="button" aria-pressed={selected.includes(t.id)}
    disabled={disabled||working||(!selected.includes(t.id)&&(selected.length>=10||t.isArchived))}
    onClick={()=>void add(t.name)} className={'rounded px-2 py-1 text-[11px] '+(selected.includes(t.id)?'bg-[#346ef6] text-white':'bg-slate-100 text-slate-600')}>{t.name}</button>)}
  </div>:null}
  <div className="flex flex-wrap gap-2"><input aria-label="自定义题材" value={custom} maxLength={32}
   disabled={disabled||working} onChange={e=>setCustom(e.target.value)}
   onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void add(custom);}}}
   placeholder="输入自定义题材" className="w-44 rounded border border-[#c3c6d7] px-2 py-1 text-xs"/>
   <button type="button" disabled={disabled||working||!custom.trim()||selected.length>=10}
    onClick={()=>void add(custom)} className="rounded border border-blue-200 px-2 py-1 text-xs text-[#0053da]">添加题材</button></div>
  {error?<p role="alert" className="text-xs text-rose-700">{error}</p>:null}
 </div>;
}