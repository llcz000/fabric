/** P1-8 reusable library table chrome: column visibility menu + sortable header button. */
import {useEffect,useId,useRef,useState} from 'react';
import {ArrowDown,ArrowUp,ChevronDown,Settings2} from 'lucide-react';
import type {ColumnVisibility,LibraryColumn,SortState} from './libraryTableChromeModel';

export function SortableHeader<T>({column,sort,onSort,className}:{
 column:LibraryColumn<T>;sort:SortState|null;onSort(key:string):void;className?:string;
}){
 const active=sort&&sort.key===column.key?sort:null;
 if(!column.sortable)return <th scope="col" className={className}>{column.label}</th>;
 return <th scope="col" className={className} aria-sort={active?(active.direction==='asc'?'ascending':'descending'):'none'}>
  <button type="button" className="v2-sort-header" onClick={()=>onSort(column.key)}
   title={'按'+column.label+(active?(active.direction==='asc'?'降序':'升序'):'排序')}>
   <span className="v2-sort-label">{column.label}</span>
   {active?<span className="v2-sort-indicator">{active.direction==='asc'?<ArrowUp size={13}/>:<ArrowDown size={13}/>}</span>:null}
  </button></th>;
}

export function ColumnSettingsMenu<T>({columns,visibility,onToggle,onReset,label='列设置'}:{
 columns:LibraryColumn<T>[];visibility:ColumnVisibility;
 onToggle(key:string):void;onReset():void;label?:string;
}){
 const [open,setOpen]=useState(false);
 const ref=useRef<HTMLDivElement|null>(null),triggerRef=useRef<HTMLButtonElement|null>(null);
 const panelId=useId();
 useEffect(()=>{
  if(!open)return;
  const onDown=(event:MouseEvent)=>{
   if(ref.current&&!ref.current.contains(event.target as Node))setOpen(false);
  };
  const onKey=(event:KeyboardEvent)=>{
   if(event.key==='Escape'&&ref.current?.contains(document.activeElement)){
    event.preventDefault();setOpen(false);triggerRef.current?.focus();
   }
  };
  document.addEventListener('mousedown',onDown);
  document.addEventListener('keydown',onKey);
  return ()=>{document.removeEventListener('mousedown',onDown);document.removeEventListener('keydown',onKey);};
 },[open]);
 const hiddenCount=columns.filter(c=>!c.locked&&visibility[c.key]===false).length;
 return <div className="v2-column-menu" ref={ref}>
  <button ref={triggerRef} type="button" className="v2-column-menu-trigger" aria-expanded={open} aria-controls={open?panelId:undefined}
   onClick={()=>setOpen(v=>!v)} title="选择要显示的列">
   <Settings2 size={15} aria-hidden="true"/><span>{label}</span>
   {hiddenCount?<span className="v2-column-menu-count">{hiddenCount}</span>:null}
   <ChevronDown size={14} aria-hidden="true" className={open?'v2-topic-caret v2-topic-caret-open':'v2-topic-caret'}/>
  </button>
  {open?<div id={panelId} className="v2-column-menu-panel" role="group" aria-label="列显示设置">
   {columns.filter(c=>!c.locked).map(column=>
    <label key={column.key} className="v2-column-menu-item">
     <input type="checkbox" checked={visibility[column.key]!==false}
      onChange={()=>onToggle(column.key)}/>
     <span>{column.label}</span>
    </label>)}
   <button type="button" className="v2-column-menu-reset" onClick={()=>{onReset();setOpen(false);triggerRef.current?.focus();}}>恢复默认列</button>
  </div>:null}
 </div>;
}
