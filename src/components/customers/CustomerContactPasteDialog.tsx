import React,{useEffect,useId,useRef,useState} from 'react';
import {DialogDismissButton} from '../ui/DialogDismissButton';
import {recognizeContactText,type ContactFields} from './customerContactText';
import type {CustomerProfile} from './customerModel';

const fields={name:'联系人姓名',phone:'电话',address:'客户详细地址'} as const;
const field='w-full rounded border';
const secondary='v2-business-button v2-business-touch';

export function CustomerContactPasteDialog({contacts,onClose,onApply}:{
 contacts:CustomerProfile['contacts'];onClose():void;onApply(value:ContactFields,contactIndex:number):void
}){
 const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLTextAreaElement>(null),title=useId();
 const [text,setText]=useState(''),[value,setValue]=useState<ReturnType<typeof recognizeContactText>|null>(null);
 const [target,setTarget]=useState(contacts.length>1?'':'0');
 useEffect(()=>{
  const previous=document.activeElement,node=dialog.current;
  node?.showModal();input.current?.focus();
  return()=>{node?.close();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};
 },[]);
 const addressesOnly=!value?.name.trim()&&!value?.phone.trim();
 const canApply=Boolean(value&&(addressesOnly?value.address.trim():target!==''));
 const apply=()=>{
  if(value&&canApply)onApply({name:value.name.trim(),phone:value.phone.trim(),address:value.address.replace(/[\r\n\t]+/g,' ').trim()},Number(target));
 };
 return <dialog ref={dialog} className="customer-dialog customer-paste-dialog" aria-labelledby={title}
  onCancel={event=>{event.preventDefault();event.stopPropagation();onClose();}}>
  <header className="customer-dialog-header"><h2 id={title}>粘贴识别联系方式</h2><DialogDismissButton label="关闭粘贴识别" onClick={onClose}/></header>
  <div className="customer-dialog-body space-y-3">
   <label className="grid gap-1 text-sm">收货或联系文字<textarea ref={input} className={field} rows={4} maxLength={2000} value={text}
    placeholder={'姓名：张三\n电话：13800138000\n地址：浙江省杭州市西湖区…'}
    onChange={event=>{setText(event.target.value);setValue(null);}}/></label>
   <button type="button" className={secondary} disabled={!text.trim()} onClick={()=>setValue(recognizeContactText(text))}>识别</button>
   {value&&<section className="grid gap-3 rounded-lg border border-slate-200 p-3" aria-label="识别结果">
    {value.ambiguous.length>0&&<p role="status" className="text-amber-800">有多个{value.ambiguous.map(key=>fields[key]).join('、')}，请核对后填写。</p>}
    {!value.name&&!value.phone&&!value.address&&!value.ambiguous.length&&<p role="status">未识别到姓名、电话或地址。可以手动填写。</p>}
    <div className="grid grid-cols-2 gap-2">
     {(['name','phone'] as const).map(key=><label key={key} className="grid gap-1 text-sm">{fields[key]}
      <input type={key==='phone'?'tel':'text'} className={field} maxLength={100} value={value[key]}
       onChange={event=>setValue({...value,[key]:event.target.value})}/></label>)}
    </div>
    <label className="grid gap-1 text-sm">{fields.address}<textarea className={field} rows={3} maxLength={100} value={value.address}
     onChange={event=>setValue({...value,address:event.target.value.replace(/[\r\n\t]+/g,' ')})}/></label>
    {!addressesOnly&&contacts.length>0&&<label className="grid gap-1 text-sm">填入联系人<select className={field} value={target} onChange={event=>setTarget(event.target.value)}>
     <option value="" disabled>选择联系人</option>
     {contacts.map((contact,i)=><option key={contact.id??i} value={i}>{contact.name||'联系人 '+(i+1)}{contact.phone?' · '+contact.phone:''}</option>)}
     {contacts.length<20&&<option value={contacts.length}>新增联系人</option>}
    </select></label>}
   </section>}
  </div>
  <footer className="customer-dialog-footer">
   <button type="button" className={secondary} onClick={onClose}>取消</button>
   <button type="button" className="v2-business-button-primary v2-business-touch" onClick={apply} disabled={!canApply}>填入表单</button>
  </footer>
 </dialog>;
}
