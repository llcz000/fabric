/** P1-7 topic filter: 16 preset + custom topics collapse into one dropdown,
 * selected topics are listed on their own row and can be removed one by one. */
import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {Check,ChevronDown,Trash2,X} from 'lucide-react';
import type {CatalogTag} from './catalogModel';
import {TOPIC_PRESETS,sortedTopicTags} from './topicCatalog';

export interface TopicFilterOption{
 key:string;name:string;id:string;available:boolean;checked:boolean;
}

export interface TopicFilterGroups{
 presets:TopicFilterOption[];others:TopicFilterOption[];
}

/** Pure helper: build dropdown options from catalog tags.
 * Presets stay listed even when the DB tag has not been seeded yet. */
export function buildTopicFilterGroups(topics:CatalogTag[],selected:string[]):TopicFilterGroups{
 const merged=sortedTopicTags(topics);
 const selectedSet=new Set(selected);
 const presets:TopicFilterOption[]=TOPIC_PRESETS.map(name=>{
  const tag=merged.find(t=>t.name===name);
  return {key:'preset:'+name,name,id:tag?.id??'',available:true,checked:!!tag&&selectedSet.has(tag.id)};
 });
 const others:TopicFilterOption[]=merged
  .filter(t=>!TOPIC_PRESETS.some(name=>name===t.name))
  .map(t=>({key:'tag:'+t.id,name:t.name,id:t.id,available:!t.isArchived,checked:selectedSet.has(t.id)}));
 return {presets,others};
}

/** Pure helper: resolve the label of every selected tag id, keeping unknown ids visible. */
export function resolveSelectedTopicLabels(topics:CatalogTag[],selected:string[]):{id:string;name:string}[]{
 return selected.map(id=>{
  const tag=topics.find(t=>t.id===id);
  return {id,name:tag?tag.name:'题材 #'+id};
 });
}

export function TopicFilterDropdown({topics,selected,onToggle,onResolveMissing,onAddCustom,onArchiveCustom,label='题材标签',max=10}:{
 topics:CatalogTag[];selected:string[];onToggle(id:string):void;
 onResolveMissing?(name:string):Promise<void>;
 onAddCustom?(name:string):Promise<void>;
 onArchiveCustom?(tag:CatalogTag):Promise<void>;
 label?:string;max?:number;
}){
 const [open,setOpen]=useState(false);
 const [pending,setPending]=useState(false),[custom,setCustom]=useState(''),[error,setError]=useState('');
 const rootRef=useRef<HTMLDivElement>(null);
 const panelId=useId();
 useEffect(()=>{
  if(!open)return;
  const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!rootRef.current?.contains(event.target))setOpen(false);};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return ()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[open]);
 const groups=useMemo(()=>buildTopicFilterGroups(topics,selected),[topics,selected]);
 const chips=useMemo(()=>resolveSelectedTopicLabels(topics,selected),[topics,selected]);
 const atLimit=selected.length>=max;
 const options=[...groups.presets,...groups.others];
 const run=async(work:()=>Promise<void>)=>{
  if(pending)return;
  setPending(true);setError('');
  try{await work();}catch(e){setError(e instanceof Error?e.message:'题材操作失败，请重试');}
  finally{setPending(false);}
 };
 const toggle=(option:TopicFilterOption)=>{
  if(!option.available||pending||!option.checked&&atLimit)return;
  if(option.id)onToggle(option.id);
  else if(onResolveMissing)void run(()=>onResolveMissing(option.name));
 };
 return <div ref={rootRef} className="v2-topic-select" aria-label={label}>
  <button type="button" className="v2-topic-trigger" aria-expanded={open} aria-controls={panelId}
   onClick={()=>setOpen(v=>!v)}>
   <span className="v2-topic-trigger-label">{label}</span>
   <span className="v2-topic-trigger-count" data-testid="topic-selected-count">{selected.length}</span>
   <ChevronDown size={16} aria-hidden="true" className={open?'v2-topic-caret v2-topic-caret-open':"v2-topic-caret"}/>
  </button>
  <div id={panelId} className={open?'v2-topic-panel v2-topic-panel-open':'v2-topic-panel'} hidden={!open}
   role="group" aria-label={label+' 选项'}>
   <p className="v2-topic-panel-title">预设题材</p>
   <ul className="v2-topic-option-list">
    {groups.presets.map(option=><li key={option.key}>
     <button type="button" className="v2-topic-option" aria-pressed={option.checked}
      disabled={pending||(!option.checked&&atLimit)}
      title={option.name}
      onClick={()=>toggle(option)}>
      <span className="v2-topic-check" aria-hidden="true">{option.checked?<Check size={13}/>:null}</span>
      <span>{option.name}</span>
     </button></li>)}
   </ul>
   {groups.others.length?<>
    <p className="v2-topic-panel-title">自定义／历史题材</p>
    <ul className="v2-topic-option-list">
     {groups.others.map(option=><li key={option.key}>
      <button type="button" className="v2-topic-option" aria-pressed={option.checked}
       disabled={pending||!option.available||(!option.checked&&atLimit)}
       title={option.available?option.name:'该题材已归档'}
       onClick={()=>toggle(option)}>
       <span className="v2-topic-check" aria-hidden="true">{option.checked?<Check size={13}/>:null}</span>
       <span>{option.name}</span>
      </button>
      {onArchiveCustom?<button type="button" className="v2-topic-custom-remove" disabled={pending}
       aria-label={'删除自定义题材 '+option.name} title={'删除自定义题材 '+option.name}
       onClick={()=>{const tag=topics.find(t=>t.id===option.id);if(tag)void run(()=>onArchiveCustom(tag));}}><Trash2 size={13}/></button>:null}
     </li>)}
    </ul></>:null}
   {onAddCustom?<div className="v2-topic-add-custom">
    <input aria-label="添加自定义题材" placeholder="输入自定义题材" value={custom} maxLength={32}
     disabled={pending} onChange={event=>setCustom(event.target.value)}
     onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();if(custom.trim()&&!atLimit)void run(async()=>{await onAddCustom(custom);setCustom('');});}}}/>
    <button type="button" disabled={pending||!custom.trim()||atLimit}
     onClick={()=>void run(async()=>{await onAddCustom(custom);setCustom('');})}>添加</button>
   </div>:null}
   {error?<p role="alert" className="v2-topic-panel-note text-rose-700">{error}</p>:null}
   {atLimit?<p className="v2-topic-panel-note">最多可选择 {max} 个题材</p>:null}
  </div>
  {chips.length?<div className="v2-topic-selected" aria-label="已选题材">
   <span className="v2-topic-selected-label">已选题材</span>
   {chips.map(chip=><span key={chip.id} className="v2-topic-chip">
    <span>{chip.name}</span>
    <button type="button" className="v2-topic-chip-remove" aria-label={'移除题材 '+chip.name}
     title={'移除题材 '+chip.name} onClick={()=>onToggle(chip.id)}><X size={12}/></button>
   </span>)}
  </div>:null}
  <span className="sr-only" aria-live="polite">{label}已选 {selected.length} 项，共 {options.length} 个可选项</span>
 </div>;
}
