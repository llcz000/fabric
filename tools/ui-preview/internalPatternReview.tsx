import {relatedProductsPreview} from './fixtures/relatedProducts';
import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/index.css';
import '../../src/components/product-master-v2/v2Experience.css';
import PatternLibraryV2 from '../../src/components/product-master-v2/PatternLibraryV2';
import {ConfirmProvider} from '../../src/components/ui/ConfirmDialog';
const all=Array.from({length:76},(_,i)=>{
 const id=String(i+1),masterNo='G'+String(i+1).padStart(4,'0');
 return {id,masterNo,productCount:i===75?21:0,isActive:true,nextColorwayNo:3,topicTags:[],colorTags:[],versions:Array.from({length:i<68?2:1},(_,j)=>({id:id+'0'+j,masterId:id,colorwayNo:j+1,patternNo:masterNo+'-'+(j+1),patternImageAssetId:null,remark:'',isActive:true,colorTags:[]}))};
}).reverse();
let shrunk=false;
const apiFetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
 const u=new URL(String(input),location.href);
 if(u.pathname==='/api/v2/products')return relatedProductsPreview(u,init);
 if(u.pathname==='/api/v2/pattern-catalog'){
  const limit=Number(u.searchParams.get('limit')||20),offset=Number(u.searchParams.get('offset')||0);
  if(location.search.includes('shrink')&&offset>=60)shrunk=true;
  const q=u.searchParams.get('number')||'';
  const matched=(shrunk?all.slice(0,2):all).filter(m=>m.masterNo.includes(q));
  return Response.json({items:matched.slice(offset,offset+limit),total:matched.length,totalColorways:matched.reduce((n,m)=>n+m.versions.length,0),limit,offset});
 }
 return Response.json({items:[]});
}) as typeof fetch;
createRoot(document.getElementById('root')!).render(<ConfirmProvider><PatternLibraryV2 apiFetch={apiFetch} canManage onUploadPatternImage={async file=>{if(file.name.endsWith('-1.jpg'))throw Error('图片校验失败');return 'a1111111-1111-4111-8111-111111111111';}}/></ConfirmProvider>);
