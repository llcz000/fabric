import React from 'react';
import '../../src/components/customers/customerWorkspace.css';
import {CustomerWorkspace} from '../../src/components/customers/CustomerWorkspace';
import {emptyCustomerProfile} from '../../src/components/customers/customerModel';
import {ConfirmProvider} from '../../src/components/ui/ConfirmDialog';
import {V2Shell} from '../../src/components/product-master-v2/V2Shell';
const state={selections:2,previewSelections:null as number|null,deletes:0,deleted:false,profile:{...emptyCustomerProfile(),displayName:'林女士客户',contacts:[{name:'林女士',phone:null,wechat:null}],region:'浙江省杭州市西湖区文一路88号3幢201室'},rowVersion:'1'};
Object.assign(window,{customerQa:state});
const dto=()=>({id:'1',profile:state.profile,rowVersion:state.rowVersion,ownerUserId:'1',archived:false,canEdit:true,canDelete:true,canManageAccess:true,canTransferOwner:true,access:[]});
const fake:typeof fetch=async(input,init)=>{
 const u=new URL(String(input),location.href),p=u.pathname;
 if(p.endsWith('/access/me'))return Response.json({id:'1',username:'admin',displayName:'预览管理员',role:'admin'});
 if(p.endsWith('/capability'))return Response.json({enabled:true});
 if(p.endsWith('/deletion-info'))return Response.json({sessions:state.previewSelections??state.selections,sample:0,bulk:0,deposit:0});
 if(p.endsWith('/activity'))return Response.json({items:[],total:0,limit:20,offset:0,salesAmount:'0'});
 if(p.endsWith('/customers/1')){
  if(init?.method==='DELETE'){state.deletes++;if(state.selections>0)return Response.json({code:'customer_has_selections',selectionCount:state.selections},{status:409});state.deleted=true;return Response.json({deleted:true});}
  if(init?.method==='PATCH'){
   const profile=JSON.parse(String(init.body)).profile;
   if(profile.displayName==='已用客户名称')return Response.json({code:'customer_name_taken'},{status:409});
   state.profile=profile;state.rowVersion=String(Number(state.rowVersion)+1);
  }
  return Response.json(dto());
 }
 if(p.endsWith('/customers'))return Response.json({items:state.deleted?[]:[dto()],total:state.deleted?0:1,limit:20,offset:0});
 if(p.endsWith('/tags'))return Response.json({items:[]});
 if(p.endsWith('/fabrics'))return Response.json({items:[],total:0,limit:20,offset:0});
 return Response.json({}, {status:404});
};
export function CustomerWorkspaceReview(){return <V2Shell actor={{id:'1',username:'admin',displayName:'预览管理员',role:'admin'}} view="customers" onNavigate={()=>{}} onLogout={()=>{}}><ConfirmProvider><CustomerWorkspace apiFetch={fake}/></ConfirmProvider></V2Shell>;}
