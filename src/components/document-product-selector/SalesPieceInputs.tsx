import {ActionIcon} from '../product-master-v2/ActionIcon';
import React,{useEffect,useRef,useState} from 'react';
export function initialPieceSlots(value:string):string[]{
 const pieces=value.trim()?value.trim().split(/[,，\s]+/):[];
 return [...pieces,...Array.from({length:Math.max(0,10-pieces.length)},()=>'')];
}
export function salesPieceDraft(slots:readonly string[]){
 const filled=slots.map(value=>value.trim()).filter(Boolean),rollNo=filled.join(', ');
 if(filled.some(value=>! /^(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)||!Number.isFinite(Number(value))||Number(value)<=0||Number(value)>999999999.99))
  return {rollNo,meters:0,pieces:filled.length,error:'每匹米数须大于0，最多两位小数'};
 const cents=filled.reduce((sum,value)=>sum+Math.round(Number(value)*100),0);
 if(!Number.isSafeInteger(cents)||cents>99999999999)return {rollNo,meters:0,pieces:filled.length,error:'分匹合计米数超出可保存范围'};
 return {rollNo,meters:cents/100,pieces:filled.length,error:''};
}
/** Keep blank positions in UI; only filled pieces are serialized to the existing V2 contract. */
export function SalesPieceInputs({value,grossMeters,disabled,onChange}:{value:string;grossMeters:number;disabled:boolean;onChange:(patch:{rollNo:string;meters:number})=>void}){
 const [slots,setSlots]=useState(()=>initialPieceSlots(value)),lastSent=useRef(value);
 useEffect(()=>{if(value!==lastSent.current){lastSent.current=value;setSlots(initialPieceSlots(value));}},[value]);
 const state=salesPieceDraft(slots);
 const update=(next:string[])=>{
  setSlots(next);const nextState=salesPieceDraft(next);lastSent.current=nextState.rollNo;
  onChange({rollNo:nextState.rollNo,meters:nextState.meters});
 };
 return <section aria-label="逐匹米数" className="my-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
   <strong>分匹米数 · 已填 {state.pieces} 匹 · 毛米数 {grossMeters.toFixed(2)} 米</strong>
   <button type="button" disabled={disabled} onClick={()=>setSlots(previous=>[...previous,...Array.from({length:10},()=>'')])}
    className="rounded border bg-white px-3 py-1 text-sky-700 disabled:opacity-40"><ActionIcon name="add"/>增加10匹输入位</button>
  </div>
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
   {slots.map((text,index)=><label key={index} className="text-xs text-slate-600">第{index+1}匹
    <input type="text" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" aria-label={'第'+(index+1)+'匹米数'} value={text} disabled={disabled}
     onChange={event=>update(slots.map((value,i)=>i===index?event.target.value:value))}
     className="mt-1 w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1"/>
   </label>)}
  </div>
  {state.error?<p role="alert" className="mt-2 text-xs text-rose-700">{state.error}</p>:null}
  {!state.pieces&&grossMeters>0?<p className="mt-2 text-xs text-amber-700">历史明细未记录分匹，暂保留原毛米数；填写后按各匹米数合计。</p>:null}
 </section>;
}
