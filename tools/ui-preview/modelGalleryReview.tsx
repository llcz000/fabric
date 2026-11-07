import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/index.css';
import '../../src/components/product-master-v2/v2Experience.css';
import {ModelGalleryV2} from '../../src/components/product-master-v2/ModelGalleryV2';
import {ProductTryOnDialog} from '../../src/components/product-master-v2/ProductTryOnDialog';
import {ToastProvider} from '../../src/components/ui/Toast';
import type {ModelImage} from '../../src/components/product-master-v2/modelGalleryClient';
const pattern='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const modelAsset='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const replacementAsset='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const replaceMode=new URLSearchParams(location.search).get('replace');
let models:ModelImage[]=[{id:'2',modelNo:'M00002',assetId:modelAsset,category:'dress',angle:'front',note:'柔软轻薄',referenceCm:replaceMode?75:null,width:1024,height:1536}];
if(new URLSearchParams(location.search).get('layout')==='mixed')models=[models[0],
 {...models[0],id:'3',modelNo:'M00003',assetId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',width:420,height:210,note:''},
 {...models[0],id:'4',modelNo:'M00004',assetId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',width:280,height:280,note:'这是一条需要截断显示但保留完整内容的较长模特备注，检查资料区与操作按钮对齐。'}];
const product:any={id:'12',productNo:'G0393-1-F018',masterId:'11',masterNo:'G0393',colorwayNo:1,
 fabricName:'轻薄雪纺',composition:'聚酯纤维',weightValue:75,weightUnit:'gsm',widthCm:145,patternImageAssetId:pattern};
const apiFetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
 const url=new URL(String(input),location.href);
 if(url.pathname==='/api/image-assets/upload-sessions')return Response.json({sessionId:'test',uploadUrl:'/__fixtures__/model-upload',method:'PUT',headers:{}});
 if(url.pathname==='/api/image-assets/upload-sessions/test/finalize')return Response.json({id:replaceMode?replacementAsset:modelAsset,status:'ready'});
 if(url.pathname==='/api/v2/models'&&init?.method==='POST'){
  if(new URLSearchParams(location.search).get('import')==='duplicate')return Response.json({error:'该图片已在模特图库中（M00002），无需重复导入'},{status:409});
  if(new URLSearchParams(location.search).get('import')==='partial'&&models.length>1)return Response.json({error:'failed'},{status:500});
  const item={...models[0],id:String(models.length+2),modelNo:'M0000'+(models.length+2),...JSON.parse(String(init.body))};
  models=[...models,item];return Response.json(item);
 }
 if(url.pathname==='/api/v2/models'){
  const offset=Number(url.searchParams.get('offset')||0);
  return Response.json({items:models.slice(offset,offset+50),total:models.length});
 }
 if(url.pathname==='/api/image-assets/access-urls'){
  const data=JSON.parse(String(init?.body));
  return Response.json({results:data.requests.map((x:{assetId:string;variant:string})=>({...x,url:'https://fabric-model-preview.invalid/'+x.assetId+'/'+x.variant+'.svg'}))});
 }
 if(url.pathname==='/api/v2/pattern-masters/11/colorway-details')return Response.json({widthCm:48,heightCm:32,items:[]});
 if(url.pathname.match(/^\/api\/image-assets\/[a-f0-9-]+\/content$/)){
  if(new URLSearchParams(location.search).get('original')==='fail')return new Response('',{status:503});
  const bytes=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
  return new Response(bytes,{headers:{'Content-Type':'image/png'}});
 }
 if(url.pathname==='/api/v2/models/2'&&init?.method==='PATCH'){
  const {expectedAssetId,...changes}=JSON.parse(String(init.body));
  if(changes.assetId&&expectedAssetId!==models[0].assetId)return Response.json({error:'模特图片已更新，请刷新后重试'},{status:409});
  if(changes.assetId&&replaceMode==='conflict')return Response.json({error:'该图片已关联模特 M00003'},{status:409});
  models=[{...models[0],...changes}];return Response.json(models[0]);
 }
 if(url.pathname==='/api/v2/models/2'&&init?.method==='DELETE'){
  models=[];return Response.json({id:'2',deleted:true});
 }
 if(url.pathname==='/api/v2/products/12')return Response.json({...product,rowVersion:'1',images:{fabricDisplay:[],detail:[],aiEffect:[]}});
 return Response.json({error:'unexpected fixture: '+url.pathname},{status:404});
}) as typeof fetch;
function Preview(){
 const [open,setOpen]=useState(false);
 const mode=new URLSearchParams(location.search).get('mode');
 return mode==='tryon'?<div className="p-4">
  <button onClick={()=>setOpen(true)}>打开换装</button>
  {open&&<ProductTryOnDialog product={product} apiFetch={apiFetch} onClose={()=>setOpen(false)} onSaved={()=>{}}/>}
 </div>:<ModelGalleryV2 apiFetch={apiFetch}/>;
}
createRoot(document.getElementById('root')!).render(<ToastProvider><Preview/></ToastProvider>);
