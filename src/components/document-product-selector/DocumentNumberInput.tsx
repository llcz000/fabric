import React,{useEffect,useRef,useState} from 'react';
/** UI decimal contract: blank optional amounts mean zero; incomplete text stays visible. */
export function parseDocumentNumber(raw:string|number,label:string,max=999999999.99):number{
 const message=label+(max===100?'须在0～100之间，最多两位小数':'须为0或正数，最多两位小数');
 if(typeof raw==='string'){const text=raw.trim();if(!text)return 0;if(!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})?$/.test(text))throw Error(message);raw=Number(text);}
 if(!Number.isFinite(raw)||raw<0||raw>max||Math.abs(raw*100-Math.round(raw*100))>1e-5)throw Error(message);return raw;
}
export function DocumentNumberInput({value,label,className,disabled,readOnly=false,onChange}:{value:number;label:string;className:string;disabled:boolean;readOnly?:boolean;onChange(value:number):void}){
 const display=(n:number)=>Number.isFinite(n)?n===0&&!readOnly?'':String(n):'';
 const [text,setText]=useState(()=>display(value)),lastSent=useRef(value);
 useEffect(()=>{if(!Object.is(value,lastSent.current)){lastSent.current=value;setText(display(value));}},[value,readOnly]);
 let error='';try{parseDocumentNumber(text,label);}catch(cause){error=(cause as Error).message;}
 return <><input aria-label={label} aria-invalid={!!error} className={className} type="text" inputMode="decimal" maxLength={16} disabled={disabled} readOnly={readOnly} value={text} onChange={event=>{const raw=event.target.value;setText(raw);let next:number;try{next=parseDocumentNumber(raw,label);}catch{next=NaN;}lastSent.current=next;onChange(next);}}/>{error&&<span className="mt-1 block text-[10px] text-rose-700">{error}</span>}</>;
}
