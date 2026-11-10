import React,{useId,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';

type LibraryPage={offset:number;limit:number;total:number};

const control='h-11 sm:h-10 rounded border border-slate-300 bg-white text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#346ef6] disabled:opacity-40';
const button=control+' hover:enabled:bg-slate-50';

export function LibraryPagination({page,label,summary,onPage,disabled=false,className=''}:{
 page:LibraryPage;
 label:string;
 summary:React.ReactNode;
 onPage(offset:number):void;
 disabled?:boolean;
 className?:string;
}){
 const {offset,limit,total}=page;
 const pages=Math.max(1,Math.ceil(total/limit));
 const current=Math.floor(offset/limit)+1;

 return <nav aria-label={label} className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-slate-600 ${className}`}>
  <span>{summary}</span>
  <div className="flex flex-wrap items-center gap-2">
   <button type="button" aria-label="上一页" className={button+' grid w-11 place-items-center sm:w-10'}
    disabled={disabled||current<=1} onClick={()=>onPage((Math.min(current-1,pages)-1)*limit)}><ChevronLeft size={16}/></button>
   <span aria-live="polite" className="whitespace-nowrap tabular-nums">第 {current} / {pages} 页</span>
   <button type="button" aria-label="下一页" className={button+' grid w-11 place-items-center sm:w-10'}
    disabled={disabled||current>=pages} onClick={()=>onPage(current*limit)}><ChevronRight size={16}/></button>
   <PageJump key={`${current}/${pages}`} current={current} pages={pages} disabled={disabled||pages===1}
    onJump={target=>onPage((target-1)*limit)}/>
  </div>
 </nav>;
}

function PageJump({current,pages,disabled,onJump}:{
 current:number;pages:number;disabled:boolean;onJump(page:number):void;
}){
 const [value,setValue]=useState('');
 const [invalid,setInvalid]=useState(false);
 const inputRef=useRef<HTMLInputElement>(null);
 const errorId=useId();

 return <form onSubmit={event=>{
  event.preventDefault();
  if(disabled)return;
  const input=value.trim();
  const target=Number(input);
  if(!/^\d+$/.test(input)||!Number.isSafeInteger(target)||target<1||target>pages){
   setInvalid(true);
   inputRef.current?.focus();
   return;
  }
  setInvalid(false);
  setValue('');
  if(target!==current)onJump(target);
 }}>
  <div className="flex items-center gap-2">
   <input ref={inputRef} aria-label="目标页码" aria-invalid={invalid||undefined}
    aria-describedby={invalid?errorId:undefined} inputMode="numeric" placeholder="页码"
    className={control+' w-16 px-2 text-center tabular-nums aria-invalid:border-rose-600'} value={value} disabled={disabled}
    onChange={event=>{setValue(event.target.value);setInvalid(false);}}
    onKeyDown={event=>{
     if(event.key==='Escape'&&(value||invalid)){
      event.preventDefault();
      event.stopPropagation();
      setValue('');
      setInvalid(false);
     }
    }}/>
   <button type="submit" className={button+' px-2.5 font-medium text-[#0053da]'} disabled={disabled}>跳转</button>
  </div>
  {invalid&&<p id={errorId} role="alert" className="mt-1 text-rose-700">请输入 1–{pages} 之间的整数页码</p>}
 </form>;
}
