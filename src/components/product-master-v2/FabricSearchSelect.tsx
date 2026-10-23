import React,{useEffect,useId,useRef,useState} from 'react';
import {Check,ChevronDown,Search} from 'lucide-react';
import type {FabricCatalogItem} from './fabricModel';
import {fetchFabricChoices} from './productEditorModel';
import {ProductFabricChoiceContent} from './ProductChoiceDialog';

/** Inline searchable fabric combobox. Opening without a query browses active fabrics. */
type FabricSearchSelectProps={apiFetch:typeof fetch;disabled?:boolean;inputLabel?:string}&(
 {multiple?:false;fabric:FabricCatalogItem|null;onSelect(item:FabricCatalogItem):void}|
 {multiple:true;selectedIds:string[];onToggle(item:FabricCatalogItem,selected:boolean):void}
);
export function FabricSearchSelect(props:FabricSearchSelectProps){
 const {apiFetch,disabled=false,inputLabel='输入面料品号或品名'}=props;
 const optionsId=useId();
 const selected=(id:string)=>props.multiple===true?props.selectedIds.includes(id):props.fabric?.id===id;
 const [query,setQuery]=useState(''),[open,setOpen]=useState(false);
 const [items,setItems]=useState<FabricCatalogItem[]>([]);
 const [loading,setLoading]=useState(false),[error,setError]=useState('');
 const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!open||disabled)return;
  const controller=new AbortController();setLoading(true);setError('');setItems([]);
  const timer=setTimeout(()=>{
   void fetchFabricChoices(apiFetch,query,controller.signal).then(page=>{
    if(!controller.signal.aborted)setItems(page.items.filter(item=>item.isActive));
   }).catch(()=>{
    if(!controller.signal.aborted)setError('面料查询失败，请重试');
   }).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  },180);
  return()=>{clearTimeout(timer);controller.abort();};
 },[apiFetch,query,open,disabled]);
 useEffect(()=>{
  if(!open)return;
  const outside=(event:MouseEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
  document.addEventListener('mousedown',outside);return()=>document.removeEventListener('mousedown',outside);
 },[open]);
 return <div ref={root} className="relative mt-2" onKeyDown={e=>{if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();root.current?.querySelector('input')?.focus();setOpen(false);}}}>
  <div className="flex items-center rounded-md border border-[#c3c6d7] bg-white focus-within:ring-2 focus-within:ring-blue-200">
   <Search size={15} className="ml-2 shrink-0 text-slate-500" aria-hidden="true"/>
   <input role="combobox" aria-label={inputLabel} aria-expanded={open&&!disabled} aria-controls={optionsId} aria-autocomplete="list"
    value={open?query:props.multiple===true?props.selectedIds.length?'已选 '+props.selectedIds.length+' 种面料':'':props.fabric?props.fabric.fabricNo+' · '+props.fabric.fabricName:query}
    disabled={disabled} placeholder="输入面料品号或品名"
    onFocus={()=>{setQuery('');setOpen(true);}}
    onChange={e=>{setQuery(e.target.value);setOpen(true);}}
    onKeyDown={e=>{if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();setOpen(false);}if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);}}}
    className="w-full min-w-0 bg-transparent px-2 py-2 text-xs outline-none disabled:bg-slate-50"/>
   <button type="button" aria-label="展开面料选项" aria-expanded={open} disabled={disabled}
    className="rounded-r px-3 py-2 text-[#0053da] disabled:opacity-40"
    onClick={()=>{setQuery('');setOpen(value=>!value);}}><ChevronDown size={15}/></button>
  </div>
  {open&&!disabled?<div id={optionsId} role="listbox" aria-label="面料选项" aria-multiselectable={props.multiple||undefined}
   className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-[#c3c6d7] bg-white shadow-lg">
   {loading?<p role="status" className="p-2 text-xs text-slate-500">正在搜索面料…</p>:null}
   {error?<p role="alert" className="p-2 text-xs text-rose-700">{error}</p>:null}
   {!loading&&!error&&items.length===0?<p className="p-2 text-xs text-slate-500">没有匹配的面料</p>:null}
   {items.map(item=><button key={item.id} type="button" role="option" aria-selected={selected(item.id)}
    aria-label={'选择面料 '+item.fabricNo}
    className="block w-full min-w-0 border-b px-3 py-3 text-left hover:bg-[#eef1fd] focus:bg-[#eef1fd]"
    onClick={()=>{if(props.multiple===true){props.onToggle(item,!selected(item.id));root.current?.querySelector('input')?.focus();}else{props.onSelect(item);setOpen(false);}setQuery('');}}>
    <span className="flex items-start gap-2">{props.multiple&&<span aria-hidden="true" className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-slate-300">{selected(item.id)&&<Check size={13}/>}</span>}<span className="min-w-0 flex-1"><ProductFabricChoiceContent item={item}/></span></span>
   </button>)}
  </div>:null}
 </div>;
}
