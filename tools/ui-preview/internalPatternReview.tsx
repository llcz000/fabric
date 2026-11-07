import {relatedProductsPreview,relatedProductImagesPreview} from './fixtures/relatedProducts';
import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/index.css';
import '../../src/components/product-master-v2/v2Experience.css';
import PatternLibraryV2 from '../../src/components/product-master-v2/PatternLibraryV2';
import {PatternWorkspaceV2} from '../../src/components/product-master-v2/PatternWorkspaceV2';
import {ConfirmProvider} from '../../src/components/ui/ConfirmDialog';
const all=Array.from({length:76},(_,i)=>{
 const id=String(i+1),masterNo='G'+String(i+1).padStart(4,'0');
 return {id,masterNo,productCount:i===75?21:0,isActive:true,nextColorwayNo:3,topicTags:[],colorTags:[],versions:Array.from({length:i<68?2:1},(_,j)=>({id:id+'0'+j,masterId:id,colorwayNo:j+1,patternNo:masterNo+'-'+(j+1),patternImageAssetId:null,remark:'',isActive:true,colorTags:[]}))};
}).reverse();
let shrunk=false,failDimensionSave=location.search.includes('fail-dimensions'),catalogReads=0;
const dimensionMode=location.search.includes('dimensions');
const dimensionValues=new Map<string,{widthCm:number|null;heightCm:number|null}>([['76',{widthCm:48,heightCm:32}]]);
const apiFetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
 const u=new URL(String(input),location.href);
 if(dimensionMode){
  const editor=/^\/api\/v2\/pattern-masters\/(\d+)\/colorway-details$/.exec(u.pathname);
  if(editor){const m=all.find(x=>x.id===editor[1])!;return Response.json({items:m.versions.map(v=>({...v,masterNo:m.masterNo})),nextColorwayNo:m.nextColorwayNo,...(dimensionValues.get(m.id)??{widthCm:null,heightCm:null})});}
  const patch=/^\/api\/v2\/pattern-masters\/(\d+)$/.exec(u.pathname);
  if(patch&&init?.method==='PATCH'){
   if(failDimensionSave){failDimensionSave=false;return Response.json({error:'保存失败'},{status:503});}
   const data=JSON.parse(String(init.body));dimensionValues.set(patch[1],data);return Response.json({id:patch[1],...data});
  }
  if(u.pathname==='/api/v2/pattern-masters'&&init?.method==='POST'){
   const body=JSON.parse(String(init.body)),id=String(100+all.length);
   all.unshift({id,masterNo:body.masterNo,productCount:0,isActive:true,nextColorwayNo:1,topicTags:[],colorTags:[],versions:[]});dimensionValues.set(id,{widthCm:body.widthCm,heightCm:body.heightCm});
   return Response.json({id,...body});
  }
  const add=/^\/api\/v2\/pattern-masters\/(\d+)\/colorways$/.exec(u.pathname);
  if(add&&init?.method==='POST'){
   const m=all.find(x=>x.id===add[1])!,body=JSON.parse(String(init.body)),n=m.nextColorwayNo++;
   const v={id:m.id+'0'+n,masterId:m.id,colorwayNo:n,patternNo:m.masterNo+'-'+n,patternImageAssetId:body.patternImageAssetId??null,remark:body.remark??'',isActive:true,colorTags:[]};m.versions.push(v);
   return Response.json({...v,masterNo:m.masterNo});
  }
 }
 if(u.pathname==='/api/image-assets/access-urls')return relatedProductImagesPreview(init);
 if(u.pathname==='/api/v2/products')return relatedProductsPreview(u,init);
 if(u.pathname==='/api/v2/pattern-catalog'){
  const limit=Number(u.searchParams.get('limit')||20),offset=Number(u.searchParams.get('offset')||0);
  if(location.search.includes('shrink')&&offset>=60)shrunk=true;
  const q=u.searchParams.get('number')||'';
  const matched=(shrunk?all.slice(0,2):all).filter(m=>m.masterNo.includes(q));
  const sort=u.searchParams.get('sort');
  if(sort==='numberAsc'||sort==='numberDesc'){const direction=sort==='numberAsc'?1:-1;matched.sort((a,b)=>direction*(Number(a.masterNo.slice(1))-Number(b.masterNo.slice(1))||Number(a.id)-Number(b.id)));}
  const result=Response.json({items:matched.slice(offset,offset+limit).map(m=>dimensionMode?{...m,...(dimensionValues.get(m.id)??{widthCm:null,heightCm:null})}:m),total:matched.length,totalColorways:matched.reduce((n,m)=>n+m.versions.length,0),limit,offset});
  if(dimensionMode&&location.search.includes('delay-list')&&++catalogReads===2)await new Promise(resolve=>setTimeout(resolve,900));
  return result;
 }
 return Response.json({items:[]});
}) as typeof fetch;
const Library=dimensionMode?PatternWorkspaceV2:PatternLibraryV2;
createRoot(document.getElementById('root')!).render(<ConfirmProvider><Library apiFetch={apiFetch} canManage onUploadPatternImage={async file=>{if(file.name.endsWith('-1.jpg'))throw Error('图片校验失败');return 'a1111111-1111-4111-8111-111111111111';}}/></ConfirmProvider>);
