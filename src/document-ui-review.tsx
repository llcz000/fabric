import React,{useCallback,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './index.css';
import V2DocumentWorkspace from './components/document-product-selector/V2DocumentWorkspace';
import {ConfirmProvider} from './components/ui/ConfirmDialog';
import {emptyCustomerProfile} from './components/customers/customerModel';
import type {CompanyProfile} from './types';

const company={name:'印花面料设计有限公司',address:'浙江省绍兴市',phone:'0575-00000000',defaultTerms:'签收前请核对米数与颜色。',depositTerms:'定金收到后安排生产。'} as CompanyProfile;
const customers=[
 {id:'21',name:'华锦纺织贸易',brands:['HUAJIN'],contact:'王女士'},
 {id:'22',name:'柯桥云庭设计',brands:['云庭'],contact:'陈经理'},
 {id:'23',name:'新美服饰',brands:[],contact:'小张'}
];
const products=[
 {id:'31',productNo:'G0008-1',fabricName:'真丝印花面料',masterNo:'G0008',colorwayNo:1,composition:'100%真丝',weight:16,weightUnit:'mm',widthCm:140,patternImageAssetId:'11111111-1111-4111-8111-111111111111',thumbnailUrl:null},
 {id:'32',productNo:'G0236-2',fabricName:'棉麻印花面料',masterNo:'G0236',colorwayNo:2,composition:'棉/麻',weight:130,weightUnit:'gsm',widthCm:150,patternImageAssetId:null,thumbnailUrl:null}
];
let imageReads=0;
const mockFetch:typeof fetch=async(input,init)=>{
 const url=new URL(String(input),'http://127.0.0.1');
 if(url.pathname==='/api/image-assets/access-urls'){document.documentElement.dataset.imageReads=String(++imageReads);if(new URLSearchParams(location.search).has('imageDelay'))await new Promise(r=>setTimeout(r,700));if(new URLSearchParams(location.search).has('imageError'))return Response.json({}, {status:503});return Response.json({results:[{assetId:'11111111-1111-4111-8111-111111111111',variant:'thumbnail',url:'https://preview.fabric.invalid/pattern.webp'}]});}
 if(url.pathname.endsWith('/customers/capability'))return Response.json({enabled:true});
 if(url.pathname.endsWith('/reserve-number'))return Response.json({orderNo:'YB-20261022-001'});
 if(url.pathname.endsWith('/customers')){
  const q=(url.searchParams.get('query')||'').toLowerCase();
  const found=customers.filter(c=>[c.name,c.contact,...c.brands].join(' ').toLowerCase().includes(q));
  const offset=Number(url.searchParams.get('offset')||0);
  return Response.json({items:found.slice(offset,offset+20).map(c=>({id:c.id,profile:{...emptyCustomerProfile(),displayName:c.name,brands:c.brands,contacts:[{name:c.contact,phone:null,wechat:null}]},canEdit:true,archived:false,deleted:false})),total:found.length,limit:20,offset});
 }
 if(url.pathname.endsWith('/document-products/selector')){
  const num=url.searchParams.get('productNo')||'',name=url.searchParams.get('fabricName')||'';
  const found=products.filter(p=>p.productNo.includes(num)&&p.fabricName.includes(name));
  const offset=Number(url.searchParams.get('offset')||0);
  return Response.json({items:found.slice(offset,offset+20),total:found.length,limit:20,offset});
 }
 if(url.pathname==='/api/v2/documents'&&init?.method==='POST')return Response.json({}, {status:422});
 return Response.json({}, {status:404});
};
function Review(){
 const [status,setStatus]=useState('');
 const apiFetch=useCallback<typeof fetch>((input,init)=>mockFetch(input,init),[]);
 return <div className="min-h-screen bg-[#f8f9fc] p-3 sm:p-7">
  <div className="mx-auto mb-3 max-w-7xl rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">仅本机模拟数据 · 挂载真实业务组件与正式 CSS · 不写入数据库</div>
  {status&&<p data-review-status className="mx-auto mb-3 max-w-7xl rounded border bg-white p-3">{status}</p>}
  <ConfirmProvider><V2DocumentWorkspace role="admin" apiFetch={apiFetch} companyProfile={company}
   onSaved={()=>setStatus('模拟单据已保存')} onCancel={()=>setStatus('已返回，未保存草稿')}/></ConfirmProvider>
 </div>;
}
createRoot(document.getElementById('root')!).render(<Review/>);
