import React from 'react';
import {createRoot} from 'react-dom/client';
import './index.css';
import {CustomerWorkspace} from './components/customers/CustomerWorkspace';
import {ConfirmProvider} from './components/ui/ConfirmDialog';
import {emptyCustomerProfile,type CustomerDTO} from './components/customers/customerModel';
const customers:CustomerDTO[]=[['1','华锦纺织贸易','王女士','HUAJIN'],['2','杭州云庭女装','陈经理','云庭'],['3','独立设计工作室','小林','']].map(([id,name,contact,brand])=>({id,profile:{...emptyCustomerProfile(),displayName:name,subjectType:'company',invoiceTitle:name,region:'浙江 · 杭州',salesChannel:'both',contacts:[{name:contact,phone:'13800000000',wechat:'fabric_demo'}],brands:brand?[brand]:[],important:id==='1',nextFollowupOn:'2026-10-23',followupNote:'确认秋冬面料选样反馈',notes:'偏好自然花卉、轻薄真丝，主要用于连衣裙。',styleTagIds:['1','2'],commonFabricIds:['10'],prices:[{fabricCategory:'真丝',minPrice:'45',maxPrice:'90',currency:'CNY',unit:'metre',taxBasis:'included',remark:null}]},ownerUserId:'1',rowVersion:'1',archived:false,canEdit:true,canDelete:true,canManageAccess:false,access:[]}));
let customerListReads=0,customerWrites=0;
const apiFetch:typeof fetch=async(input,init)=>{
 const url=new URL(String(input),'http://127.0.0.1'),p=url.pathname;
 const mode=new URLSearchParams(location.search);
 if(init?.signal?.aborted)throw new DOMException('Aborted','AbortError');
 if(p.endsWith('/capability'))return Response.json({enabled:true});
 if(p.endsWith('/tags'))return Response.json({items:['油画花卉','水彩花卉','小碎花','植物剪影','条纹','格纹','几何图案','抽象肌理','动物皮纹','涂鸦插画','佩斯利纹','海洋主题','波点','字母文字','水果图案','建筑风景'].map((name,i)=>({id:String(i+1),name}))});
 const fabrics=[{id:'10',fabricNo:'F001',fabricName:'真丝双绉'},{id:'11',fabricNo:'F002',fabricName:'棉麻平纹'},{id:'12',fabricNo:'F003',fabricName:'轻薄雪纺'}].map(f=>({...f,composition:f.id==='10'?'100%真丝':'棉/聚酯',weightValue:80,weightUnit:'gsm',widthValue:145,remark:null,isActive:true,productCount:1}));
 if(p.endsWith('/fabrics/catalog')&&mode.has('fabricError'))return Response.json({}, {status:503});
 if(p.includes('/fabrics/'))return Response.json(p.endsWith('/catalog')?{items:fabrics.filter(f=>[f.fabricNo,f.fabricName].join(' ').toLowerCase().includes((url.searchParams.get('query')||'').toLowerCase())),total:fabrics.length,limit:50,offset:0}:fabrics.find(f=>p.endsWith('/'+f.id)));
 if(p.endsWith('/deletion-info'))return Response.json(mode.has('deletedSamples')?{sessions:0,sample:0,bulk:0,deposit:0}:{sessions:2,sample:1,bulk:1,deposit:1});
 if(p.endsWith('/activity'))return mode.has('activityError')?Response.json({}, {status:500}):Response.json({items:[{kind:'document',documentType:'bulk',id:'91',summary:'秋季印花面料 · G0008-1',amount:'3600.00',occurredOn:'2026-10-22'},{kind:'document',documentType:'deposit',id:'92',summary:'秋季面料定金',amount:'800.00',occurredOn:'2026-10-21'},{kind:'session',id:'81',summary:'选中 3 款花型，待确认配色',occurredOn:'2026-10-20'},{kind:'sample-followup',id:'82',sessionId:'81',summary:'喜欢水彩花卉，需补充浅色配色',occurredOn:'2026-10-20'}],total:4,limit:20,offset:0,salesAmount:'4200.00'});
 if(p==='/api/v2/customers'&&init?.method==='POST'){document.documentElement.dataset.customerWrites=String(++customerWrites);if(mode.has('saveError'))return Response.json({}, {status:409});const c={...customers[0],id:String(Date.now()),profile:JSON.parse(String(init.body)).profile};customers.push(c);return Response.json(c);}
 const c=customers.find(c=>p==='/api/v2/customers/'+c.id);
 if(c){if(mode.has('detailError')&&!init?.method)return Response.json({}, {status:500});if(init?.method==='PATCH'){document.documentElement.dataset.customerWrites=String(++customerWrites);if(mode.has('saveError'))return Response.json({}, {status:409});c.profile=JSON.parse(String(init.body)).profile;return Response.json(c);}if(init?.method==='DELETE'){if(mode.has('deleteError'))return Response.json({}, {status:500});customers.splice(customers.indexOf(c),1);return Response.json({ok:true});}return Response.json({...c,canEdit:!mode.has('readonly'),canDelete:!mode.has('readonly')});}
 if(p==='/api/v2/customers'){++customerListReads;if(mode.has('revokeList')&&customerListReads>1)return Response.json({}, {status:403});if(mode.has('listError'))return Response.json({}, {status:500});const q=url.searchParams.get('query')||'';const items=mode.has('empty')?[]:customers.filter(c=>[c.profile.displayName,...c.profile.brands,...c.profile.contacts.map(x=>x.name)].join(' ').includes(q));document.documentElement.dataset.customerListReads=String(customerListReads);return Response.json({items:items.map(c=>({...c,canEdit:!mode.has('readonly'),canDelete:!mode.has('readonly')})),total:items.length,limit:20,offset:0});}
 return Response.json({}, {status:404});
};
function open(kind:string,id:string){document.querySelector('[data-review-status]')!.textContent=`已打开${kind} ${id}（模拟跳转）`;}
createRoot(document.getElementById('root')!).render(<div className="min-h-screen bg-slate-50"><div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">模拟数据 · 正式客户组件与 CSS · 不写入业务数据库<span data-review-status className="ml-4" role="status"/></div><ConfirmProvider><CustomerWorkspace apiFetch={apiFetch} onOpenDocument={id=>open('单据',id)} onOpenSession={id=>open('选样',id)}/></ConfirmProvider></div>);
