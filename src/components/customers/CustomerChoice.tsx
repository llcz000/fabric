import React,{useEffect,useMemo,useState} from 'react';
import {createCustomerClient,customerError,emptyCustomerProfile,type CustomerDTO,type CustomerProfile,type Page} from './customerModel';
import {CustomerProfileForm,customerButton as button,customerField as field} from './CustomerProfileForm';
export type CustomerChoiceValue={customerId:string;name:string}|{profile:CustomerProfile};
/** Keeps quick profiles as drafts until their first business transaction is saved. */
export function CustomerChoice({apiFetch,value,onChange,disabled=false,embedded=false}:{apiFetch:typeof fetch;value:CustomerChoiceValue|null;onChange(value:CustomerChoiceValue|null):void;disabled?:boolean;embedded?:boolean}){
 const api=useMemo(()=>createCustomerClient(apiFetch),[apiFetch]);
 const [query,setQuery]=useState(''),[offset,setOffset]=useState(0),[page,setPage]=useState<Page<CustomerDTO>|null>(null),[error,setError]=useState('');
 const creating=!!value&&'profile' in value,search=creating?value.profile.displayName:query;
 useEffect(()=>{const c=new AbortController();setPage(null);setError('');void api.list({query:search,offset},c.signal).then(v=>{if(!c.signal.aborted)setPage(v);}).catch(e=>{if(!c.signal.aborted)setError(customerError(e));});return()=>c.abort();},[api,search,offset]);
 return <fieldset disabled={disabled} aria-label="客户选择" className={embedded?"space-y-3":"space-y-3 rounded-lg border p-3"}>
  <div className="flex gap-2"><button type="button" className={button} aria-pressed={!creating} onClick={()=>onChange(null)}>已有客户</button><button type="button" className={button} aria-pressed={creating} onClick={()=>onChange({profile:{...emptyCustomerProfile(),displayName:query}})}>快速建档</button></div>
  {creating?<CustomerProfileForm quick value={value.profile} onChange={profile=>onChange({profile})}/>:<label className="grid gap-1 text-sm">搜索客户名称、联系人或品牌<input aria-label="搜索客户名称、联系人或品牌" className={field} maxLength={160} value={query} onChange={e=>{setQuery(e.target.value);setOffset(0);}}/></label>}
  {value&&'customerId' in value&&<p role="status">已选择：{value.name}</p>}
  {creating&&page&&page.items.length>0&&search.trim()&&<p className="text-sm text-amber-800">存在相似客户，请核对后选择复用或继续新建；同名不会自动合并。</p>}
  {error&&<p role="alert">{error}</p>}
  {page&&<><ul className="max-h-56 divide-y overflow-auto">{page.items.map(c=><li className="flex items-center justify-between gap-2 py-2 text-sm" key={c.id}><span>{c.profile.displayName} {c.profile.brands.join('、')} {c.profile.contacts.map(x=>x.name).join('、')}</span><button type="button" className={button} disabled={disabled||!c.canEdit||c.archived||c.deleted} aria-pressed={!!value&&'customerId' in value&&value.customerId===c.id} onClick={()=>onChange({customerId:c.id,name:c.profile.displayName})}>选择</button></li>)}</ul>{!creating&&!page.items.length&&<p className="text-sm text-slate-500">没有匹配的客户，可快速建档。</p>}{page.total>20&&<div className="flex gap-2"><button type="button" className={button} disabled={disabled||offset===0} onClick={()=>setOffset(n=>Math.max(0,n-20))}>上一页客户</button><button type="button" className={button} disabled={disabled||offset+20>=page.total} onClick={()=>setOffset(n=>n+20)}>下一页客户</button></div>}</>}
 </fieldset>;
}
