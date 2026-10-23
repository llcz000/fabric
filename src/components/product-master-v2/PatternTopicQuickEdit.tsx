import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Check,X} from 'lucide-react';
import type {CatalogTag} from './catalogModel';
import type {PatternMasterItem} from './patternModel';
import {saveMasterTopicTags} from './patternModel';
import {ensureTopicTag,sortedTopicTags,TOPIC_PRESETS} from './topicCatalog';

export interface TopicQuickDraft{tagIds:string[];newNames:string[]}
const normal=(name:string)=>name.trim().normalize('NFKC').toLowerCase();
export function toggleQuickTopic(draft:TopicQuickDraft,choice:{id?:string;name:string},max=10):TopicQuickDraft{
 const {id,name}=choice;
 if(id&&draft.tagIds.includes(id))return {...draft,tagIds:draft.tagIds.filter(x=>x!==id)};
 if(!id&&draft.newNames.some(x=>normal(x)===normal(name)))
  return {...draft,newNames:draft.newNames.filter(x=>normal(x)!==normal(name))};
 if(draft.tagIds.length+draft.newNames.length>=max)throw Error('每个花型最多10个题材');
 return id?{...draft,tagIds:[...draft.tagIds,id]}:{...draft,newNames:[...draft.newNames,name.trim()]};
}
/** All new dictionary tags are staged until Save, then the master association is committed. */
export async function persistQuickTopics(apiFetch:typeof fetch,masterId:string,available:CatalogTag[],draft:TopicQuickDraft){
 if(draft.tagIds.length+draft.newNames.length>10||new Set(draft.tagIds).size!==draft.tagIds.length)
  throw Error('题材数量或编号无效');
 const additions:CatalogTag[]=[],resolved=[...draft.tagIds];
 for(const name of draft.newNames){
  const tag=await ensureTopicTag(apiFetch,[...available,...additions],name);
  additions.push(tag);
  if(!resolved.includes(tag.id))resolved.push(tag.id);
 }
 await saveMasterTopicTags(apiFetch,masterId,resolved);
 return {ids:resolved,added:additions};
}
export function PatternTopicQuickEdit({master,topics,apiFetch,onCancel,onSaved}:{
 master:PatternMasterItem;topics:CatalogTag[];apiFetch:typeof fetch;onCancel():void;
 onSaved(ids:string[],added:CatalogTag[]):void;
}){
 const [draft,setDraft]=useState<TopicQuickDraft>(()=>({
  tagIds:master.topicTags.map(t=>t.id),newNames:[]
 }));
 const [custom,setCustom]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const saving=useRef(false),closeRef=useRef<HTMLButtonElement>(null);
 const available=useMemo(()=>sortedTopicTags([...topics,
  ...master.topicTags.filter(t=>!topics.some(e=>e.id===t.id))]),[master.topicTags,topics]);
 const selectedCount=draft.tagIds.length+draft.newNames.length,full=selectedCount>=10;
 const byName=(name:string)=>available.find(t=>normal(t.name)===normal(name));
 useEffect(()=>{
  closeRef.current?.focus();
  const handle=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!saving.current){event.preventDefault();event.stopPropagation();onCancel();}};
  document.addEventListener('keydown',handle,true);
  return ()=>document.removeEventListener('keydown',handle,true);
 },[onCancel]);
 const pick=(choice:{id?:string;name:string;isArchived?:boolean})=>{
  if(busy||choice.isArchived&&!draft.tagIds.includes(choice.id??''))return;
  try{setDraft(old=>toggleQuickTopic(old,choice));setError('');}
  catch(e){setError(e instanceof Error?e.message:'题材选择失败');}
 };
 const addCustom=()=>{
  const name=custom.trim();
  if(!name||[...name].length>32||/[\p{Cc}\p{Cf}]/u.test(name)){setError('题材名称须为1至32个可见字符');return;}
  const found=byName(name);
  if(found?.isArchived){setError('已删除的题材不可直接关联');return;}
  if(found&&draft.tagIds.includes(found.id)||draft.newNames.some(x=>normal(x)===normal(name))){
   setError('该题材已选中');return;
  }
  if(full){setError('每个花型最多10个题材');return;}
  pick(found??{name});setCustom('');
 };
 const save=async()=>{
  if(busy||saving.current)return;
  saving.current=true;setBusy(true);setError('');
  try{
   const result=await persistQuickTopics(apiFetch,master.id,available,draft);
   onSaved(result.ids,result.added);
  }catch(e){setError(e instanceof Error?e.message:'题材保存失败，请重试');}
  finally{saving.current=false;setBusy(false);}
 };
 const changed=draft.newNames.length>0||
  draft.tagIds.length!==master.topicTags.length||
  master.topicTags.some(x=>!draft.tagIds.includes(x.id));
 return <div role="presentation" className="fixed inset-0 z-[65] flex items-center justify-center bg-black/45 p-3"
  onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onCancel();}}>
  <div role="dialog" aria-modal="true" aria-label={'直接修改题材 '+master.masterNo}
   className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[#d8deea] bg-white shadow-xl">
   <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
    <div><strong className="text-sm text-[#191b24]">{master.masterNo} · 题材标签</strong>
     <p className="mt-1 text-xs text-slate-500">直接调整花型题材，不影响配色及图片</p></div>
    <button ref={closeRef} aria-label="取消修改题材" type="button" disabled={busy} onClick={onCancel}
     className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"><X size={18}/></button>
   </header>
   <div className="space-y-3 overflow-auto px-4 py-3 text-xs">
    <div className="flex items-center justify-between"><span className="font-medium text-[#434655]">预设题材</span>
     <span className="text-slate-500">已选 {selectedCount}/10</span></div>
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="预设题材">
     {TOPIC_PRESETS.map(name=>{
      const existing=byName(name),id=existing?.id,on=id?draft.tagIds.includes(id):draft.newNames.some(n=>normal(n)===normal(name));
      return <button type="button" key={name} aria-pressed={on} disabled={busy||(!on&&(full||existing?.isArchived))}
       onClick={()=>pick({id,name,isArchived:existing?.isArchived})}
       className={'inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 '+(on?
        'border-[#346ef6] bg-[#e8efff] text-[#004dcc]':'border-slate-200 bg-white text-slate-600 hover:border-[#346ef6]')}>{on?<Check size={12}/>:null}{name}</button>;
     })}
    </div>
    {available.some(t=>!TOPIC_PRESETS.some(name=>name===t.name))?<div className="space-y-1.5">
     <p className="font-medium text-[#434655]">自定义题材</p>
     <div role="group" aria-label="自定义题材选项" className="flex flex-wrap gap-1.5">
      {available.filter(t=>!TOPIC_PRESETS.some(name=>name===t.name)).map(tag=>{
       const on=draft.tagIds.includes(tag.id);
       return <button key={tag.id} type="button" aria-pressed={on}
        disabled={busy||(!on&&(full||tag.isArchived))}
        onClick={()=>pick({id:tag.id,name:tag.name,isArchived:tag.isArchived})}
        className={'rounded-full border px-2.5 py-1.5 '+(on?'border-[#346ef6] bg-[#e8efff] text-[#004dcc]':
         'border-slate-200 bg-white text-slate-600 hover:border-[#346ef6]')}>{tag.name}</button>;
      })}
     </div>
    </div>:null}
    {draft.newNames.filter(name=>!TOPIC_PRESETS.some(p=>p===name)).length?<div className="flex flex-wrap gap-1.5" aria-label="待新增自定义题材">
     {draft.newNames.filter(name=>!TOPIC_PRESETS.some(p=>p===name)).map(name=><button key={name} type="button" disabled={busy}
      onClick={()=>pick({name})} className="rounded-full bg-[#e8efff] px-2.5 py-1.5 text-[#004dcc]">{name} ×</button>)}
    </div>:null}
    <div className="flex gap-2"><input value={custom} disabled={busy} maxLength={32}
     aria-label="输入新的题材" placeholder="新增自定义题材" onChange={e=>{setCustom(e.target.value);setError('');}}
     onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addCustom();}}}
     className="min-w-0 flex-1 rounded-md border border-slate-300 px-2.5 py-2 outline-[#346ef6]"/>
     <button type="button" disabled={busy||!custom.trim()||full} onClick={addCustom}
      className="rounded-md border border-[#346ef6] px-3 py-2 text-[#0053da] disabled:opacity-40">添加</button></div>
    {error?<p role="alert" className="rounded-md bg-rose-50 p-2 text-rose-700">{error}</p>:null}
   </div>
   <footer className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-3">
    <button type="button" disabled={busy} onClick={onCancel} className="rounded-md px-4 py-2 text-xs text-slate-600 hover:bg-slate-100">取消</button>
    <button type="button" onClick={()=>void save()} disabled={busy||!changed}
     className="rounded-md bg-[#346ef6] px-4 py-2 text-xs font-medium text-white disabled:opacity-40">{busy?'正在保存…':'保存题材'}</button>
   </footer>
  </div>
 </div>;
}
