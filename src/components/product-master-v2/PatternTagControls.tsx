import { ActionIcon } from './ActionIcon';
import { useState } from 'react';
import type { CatalogTag } from './catalogModel';
import { addColorTagChoice } from './patternModel';

export function TagSelector({options,selected,onChange,disabled=false,ariaLabel,reserved=0}:{
 options:CatalogTag[];selected:string[];onChange(value:string[]):void;disabled?:boolean;ariaLabel:string;
 reserved?:number;
}){
 return <div className="flex max-w-full flex-wrap gap-1" role="group" aria-label={ariaLabel}>
  {options.length?options.map(tag=>{
   const on=selected.includes(tag.id);
   return <button key={tag.id} type="button" aria-pressed={on} disabled={disabled||(!on&&(selected.length+reserved>=10||tag.isArchived))}
    onClick={()=>onChange(on?selected.filter(x=>x!==tag.id):[...selected,tag.id])}
    title={tag.isArchived?'已归档标签（仅可从历史关联移除）':tag.name}
    className={'rounded-full px-2 py-1 text-[11px] '+(on?
     'bg-[#346ef6] text-white':'bg-[#eef1fd] text-[#31447b]')}>{tag.name}</button>;
  }):<span className="text-[11px] text-[#737686]">暂无可选标签</span>}
 </div>;
}

export function InlineColorTagEditor({options,tagIds,newColorTags,onChange,disabled=false,label}:{
 options:CatalogTag[];tagIds:string[];newColorTags:string[];
 onChange(value:{tagIds:string[];newColorTags:string[]}):void;
 disabled?:boolean;label:string;
}){
 const [text,setText]=useState(''),[error,setError]=useState('');
 const add=()=>{
  try{onChange(addColorTagChoice(options,tagIds,newColorTags,text));setText('');setError('');}
  catch(e){setError(e instanceof Error?e.message:'颜色名称错误');}
 };
 return <div className="space-y-1">
  <TagSelector ariaLabel={label} options={options} selected={tagIds}
   onChange={next=>onChange({tagIds:next,newColorTags})}
   reserved={newColorTags.length} disabled={disabled}/>
  {newColorTags.length?<div className="flex flex-wrap gap-1" aria-label={'待创建颜色 '+label}>
   {newColorTags.map(name=><button key={name} type="button" disabled={disabled}
    aria-label={'移除自定义颜色 '+name}
    title="取消本次新颜色标签"
    onClick={()=>onChange({tagIds,newColorTags:newColorTags.filter(x=>x!==name)})}
    className="rounded bg-[#e9f0ff] px-1.5 py-0.5 text-[11px] text-[#0053da]">{name} ×</button>)}
   </div>:null}
  <div className="flex max-w-[250px] items-center gap-1">
   <input type="text" aria-label={'自定义颜色 '+label} maxLength={32} value={text}
    disabled={disabled} onChange={e=>{setText(e.target.value);setError('');}}
    onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();add();}}}
    placeholder="输入自定义颜色" className="w-32 min-w-0 rounded border border-[#c3c6d7] px-1.5 py-1 text-[11px]"/>
   <button type="button" disabled={disabled||tagIds.length+newColorTags.length>=10}
    onClick={add} className="whitespace-nowrap rounded border px-1.5 py-1 text-[11px] text-[#0053da]"><ActionIcon name="add"/>添加颜色</button>
  </div>
  {error?<span role="alert" className="block text-[11px] text-rose-700">{error}</span>:null}
 </div>;
}

