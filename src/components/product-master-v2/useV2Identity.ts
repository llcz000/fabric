import {useCallback,useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {createV2LoginStore,V2_LOGIN_KEY} from './v2LoginStorage';
import {v2AuthenticatedFetch} from './v2AppModel';

/** Owns login storage and request identity. An old request can never expire a newer token. */
export function useV2Identity(){
 const store=useMemo(()=>createV2LoginStore(),[]);
 const [token,setToken]=useState(()=>store.restore()),currentToken=useRef(token);
 currentToken.current=token;
 const [resetVersion,setResetVersion]=useState(0);
 const [username,setUsername]=useState(''),[password,setPassword]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const reset=useCallback((next:string)=>{
  currentToken.current=next;setToken(next);setResetVersion(n=>n+1);setError('');
 },[]);
 const expire=useCallback(()=>{
  if(store.clear(currentToken.current))reset('');else reset(store.restore(true));
 },[store,reset]);
 const apiFetch=useMemo(()=>v2AuthenticatedFetch(fetch,token,()=>{
  if(currentToken.current===token)expire();
 }),[token,expire]);
 useEffect(()=>{
  const sync=(event:StorageEvent)=>{
   if(event.key!==V2_LOGIN_KEY&&event.key!==null)return;
   const next=store.restore(true);
   if(next!==currentToken.current)reset(next);
  };
  window.addEventListener('storage',sync);
  return()=>window.removeEventListener('storage',sync);
 },[store,reset]);
 const login=async(event:FormEvent)=>{
  event.preventDefault();setBusy(true);setError('');
  try{
   const response=await fetch('/api/v2/access/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
   if(!response.ok)throw Error(response.status===429?'登录尝试过多，请稍后重试':'登录失败，请检查账号和密码');
   const result=await response.json();
   if(typeof result.token!=='string'||!(/^[a-f0-9]{64}$/.test(result.token)))throw Error('登录会话无效');
   store.save(result.token,result.expiresIn);currentToken.current=result.token;setPassword('');setToken(result.token);
  }catch(cause){setError(cause instanceof Error?cause.message:'登录失败');}
  finally{setBusy(false);}
 };
 const logout=async()=>{
  const issuedFor=token;
  try{await apiFetch('/api/v2/access/logout',{method:'POST'});}
  finally{if(currentToken.current===issuedFor)expire();}
 };
 return {token,apiFetch,resetVersion,username,setUsername,password,setPassword,busy,error,login,logout,expire};
}
