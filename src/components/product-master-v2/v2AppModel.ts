import type {CompanyProfile} from '../../types';
export interface V2AppPrincipal{id:string;username:string;displayName:string;role:'admin'|'sales'}
export function parseV2AppPrincipal(raw:unknown):V2AppPrincipal{
 if(!raw||typeof raw!=='object')throw Error('登录资料无效');
 const x=raw as Record<string,unknown>;
 if(typeof x.id!=='string'||!(/^[1-9]\d*$/.test(x.id))||!['admin','sales'].includes(String(x.role))||typeof x.username!=='string'||typeof x.displayName!=='string')throw Error('登录资料无效');
 return {id:x.id,username:x.username,displayName:x.displayName,role:x.role as 'admin'|'sales'};
}
export function v2AuthenticatedFetch(transport:typeof fetch,token:string,onExpired:()=>void):typeof fetch{
 return (async(input,init)=>{
  if(typeof input!=='string'||!/^\/api\/[A-Za-z0-9_./-]+(?:\?[^#\r\n]*)?$/.test(input)||input.split('?')[0].includes('..')||input.split('?')[0].includes('//')||!(/^[a-f0-9]{64}$/.test(token)))throw Error('请求地址或登录会话无效');
  const headers=new Headers(init?.headers);headers.set('Authorization','Bearer '+token);
  const response=await transport(input,{...init,headers,credentials:'same-origin',redirect:'error'});
  if(response.status===401)onExpired();return response;
 }) as typeof fetch;
}
export function mapV2Company(raw:unknown):CompanyProfile{
 if(!raw||typeof raw!=='object'||typeof (raw as any).company_name!=='string'||!(raw as any).company_name.trim())throw Error('当前公司设置不可用');
 const x=raw as Record<string,unknown>,str=(key:string)=>typeof x[key]==='string'?x[key] as string:'';
 return {name:str('company_name'),logoText:str('brand_name')||str('company_name'),logoType:'text',logoUrl:'',address:str('address'),phone:str('phone'),defaultTerms:str('default_terms'),depositTerms:str('deposit_terms'),issuerLabel:str('issuer_label')||'开单人签字',receiverLabel:str('receiver_label')||'收货人签字',weChatPayUrl:'',aliPayUrl:'',companyImages:{}};
}
