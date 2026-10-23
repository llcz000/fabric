import {useCallback,useEffect,useRef,useState} from 'react';
import type {CompanyProfile,CompanyImageRole} from '../../types';
import {applyCompanyImageMutations} from '../../lib/imageAssets';
import type {CompanyImageMutation} from '../../lib/companyImageState';
import {mapV2Company,parseV2AppPrincipal,type V2AppPrincipal} from './v2AppModel';

type Workspace={token:string;actor:V2AppPrincipal;company:CompanyProfile;shareEnabled:boolean};
const companyRole=(value:string):value is CompanyImageRole=>
 value==='brand_logo'||value==='wechat_qr'||value==='alipay_qr';

/** Loads the current account/company together and owns all temporary image URLs. */
export function useV2Company(apiFetch:typeof fetch,token:string){
 const [data,setData]=useState<Workspace|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const currentToken=useRef(token);currentToken.current=token;
 const reload=useCallback(()=>setRevision(n=>n+1),[]);
 useEffect(()=>{
  if(!token){setData(null);setError('');return;}
  const controller=new AbortController(),urls:string[]=[];
  setData(null);setError('');
  const active=()=>!controller.signal.aborted&&currentToken.current===token;
  void (async()=>{
   try{
    const identity=await apiFetch('/api/v2/access/me',{signal:controller.signal});
    if(!identity.ok)throw Error('登录验证失败，请重新登录');
    const actor=parseV2AppPrincipal(await identity.json());
    if(!active())return;
    const response=await apiFetch('/api/company',{signal:controller.signal});
    if(!response.ok)throw Error('公司设置读取失败');
    const raw=await response.json(),company=mapV2Company(raw);
    const capabilities=await apiFetch('/api/v2/pattern-sharing',{signal:controller.signal});
    const shareEnabled=capabilities.ok&&(await capabilities.json()).cardsEnabled===true;
    for(const [role,value] of Object.entries(raw.images??{})){
     if(!companyRole(role)||!value||typeof value!=='object')continue;
     const image=value as {source:'asset'|'legacy';assetId?:string;displayUrl:string};
     if(!/^\/api\/company\/images\/(brand_logo|wechat_qr|alipay_qr)\/content$/.test(image.displayUrl))throw Error('公司图片地址无效');
     const imageResponse=await apiFetch(image.displayUrl,{signal:controller.signal});
     if(!imageResponse.ok)throw Error('公司图片读取失败');
     const blob=await imageResponse.blob();
     if(!active())return;
     const url=URL.createObjectURL(blob);urls.push(url);
     company.companyImages![role]={role,source:image.source,assetId:image.assetId,displayUrl:url};
     if(role==='brand_logo'){company.logoType='image';company.logoUrl=url;}
     else if(role==='wechat_qr')company.weChatPayUrl=url;else company.aliPayUrl=url;
    }
    if(active())setData({token,actor,company,shareEnabled});
   }catch(cause){if(active())setError(cause instanceof Error?cause.message:'资料读取失败');}
  })();
  return()=>{controller.abort();urls.forEach(url=>URL.revokeObjectURL(url));};
 },[token,apiFetch,revision]);
 const reloadActor=async()=>{
  const issuedFor=token,response=await apiFetch('/api/v2/access/me');
  if(!response.ok)throw Error('身份读取失败');
  const actor=parseV2AppPrincipal(await response.json());
  if(currentToken.current===issuedFor)setData(previous=>previous?.token===issuedFor?{...previous,actor}:previous);
 };
 const saveCompany=async(profile:CompanyProfile,mutations:CompanyImageMutation[])=>{
  const issuedFor=token;
  const response=await apiFetch('/api/company',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company_name:profile.name,brand_name:profile.logoText,address:profile.address,phone:profile.phone,default_terms:profile.defaultTerms,deposit_terms:profile.depositTerms??'',issuer_label:profile.issuerLabel,receiver_label:profile.receiverLabel})});
  if(!response.ok)throw Error('公司资料保存失败');
  const reloadIfCurrent=async()=>{if(currentToken.current===issuedFor)reload();};
  await applyCompanyImageMutations(mutations,{apiFetch,reloadCompanyProfile:reloadIfCurrent});
  await reloadIfCurrent();
 };
 // Never render the prior account for one frame while a new token's effect starts.
 const ready=data?.token===token?data:null;
 return {actor:ready?.actor??null,company:ready?.company??null,shareEnabled:ready?.shareEnabled??false,error,reload,reloadActor,saveCompany};
}
