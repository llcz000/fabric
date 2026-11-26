import {relatedProductsPreview,relatedProductImagesPreview,relatedImageId} from './fixtures/relatedProducts';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {V2DocumentLookupContext} from '../../src/components/product-master-v2/useV2Identity';
import '../../src/index.css';
import '../../src/components/product-master-v2/v2Experience.css';
import PatternLibraryV2 from '../../src/components/product-master-v2/PatternLibraryV2';
import {ToastProvider} from '../../src/components/ui/Toast';
import {PatternWorkspaceV2} from '../../src/components/product-master-v2/PatternWorkspaceV2';
import {ConfirmProvider} from '../../src/components/ui/ConfirmDialog';
const gridReview=location.search.includes('grid-review');
const catalogSize=location.search.includes('grid-large')?2000:76;
const all=Array.from({length:catalogSize},(_,i)=>{
 const id=String(i+1),masterNo='G'+String(i+1).padStart(4,'0');
 return {id,masterNo,productCount:i===75?21:0,isActive:true,nextColorwayNo:3,
  topicTags:gridReview&&i%2===0?[{id:'1',name:'油画花卉',isArchived:false}]:[],colorTags:[],
  versions:Array.from({length:i<68?2:1},(_,j)=>({id:id+'0'+j,masterId:id,colorwayNo:j+1,patternNo:masterNo+'-'+(j+1),
   patternImageAssetId:gridReview||location.search.includes('gallery=1')&&id==='68'?relatedImageId(id+String(j+1)):null,
   remark:'',isActive:true,colorTags:[]}))};
}).reverse();
let failGridPage=location.search.includes('grid-page-error');
let failGridThumbnail=location.search.includes('grid-thumbnail-error');
const gridRequests:{path:string;variant?:string;ids?:string[]}[]=[];
if(gridReview)Object.assign(window,{gridRequests});

function gridImage(id:string, variant:string):string{
 const seed=Number(id.slice(-5));
 const palettes=[
  ['#dbe3d2','#486348','#aba06b'],['#edded9','#743d54','#b87861'],['#dbe9ea','#366164','#8ba1a2'],
  ['#eee5d3','#795d42','#b3925b'],['#dfdfec','#4a4c73','#9a85a0'],['#e8e9d8','#4c5140','#b2814a'],
 ];
 const [background,ink,accent]=palettes[seed%palettes.length];
 const [width,height]=[[176,176],[224,160],[144,196]][seed%3];
 const motifs=[
  '<path d="M10 44Q6 18 44 5Q44 29 10 44M47 49Q36 23 62 19Q70 38 47 49" fill="'+ink+'"/><path d="M26 57L51 10" stroke="'+accent+'" stroke-width="3"/>',
  '<path d="M0 16H80M0 42H80M22 0V80M55 0V80" stroke="'+ink+'" stroke-width="6"/><path d="M0 7H80M0 51H80M12 0V80M64 0V80" stroke="'+accent+'" stroke-width="2"/>',
  '<path d="M9 33L29 11L49 33L29 55Z" fill="'+ink+'"/><path d="M38 7L51 0L67 10L51 23Z" fill="'+accent+'"/><circle cx="61" cy="49" r="7" fill="'+accent+'"/>',
  '<path d="M30 46C3 37 13 13 28 24C26 4 52 8 48 26C71 17 68 42 50 44C55 66 29 66 30 46Z" fill="'+ink+'"/><circle cx="41" cy="35" r="5" fill="'+accent+'"/>',
 ];
 const size=variant==='original'?2:1;
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+width*size+'" height="'+height*size+'" viewBox="0 0 '+width+' '+height+'"><defs><pattern id="repeat" width="'+(70+seed%14)+'" height="'+(62+seed%22)+'" patternUnits="userSpaceOnUse" patternTransform="rotate('+((seed%9)*8)+')"><rect width="100%" height="100%" fill="'+background+'"/>'+motifs[Math.floor(seed/10)%motifs.length]+'</pattern></defs><rect width="100%" height="100%" fill="url(#repeat)"/></svg>';
 return 'data:image/svg+xml,'+encodeURIComponent(svg);
}
let shrunk=false,failDimensionSave=location.search.includes('fail-dimensions'),catalogReads=0;
const dimensionMode=location.search.includes('dimensions');
const importAttempts=new Map<string,number>();
let imageRequest=0;
const deletionReview=location.search.includes('deletion-review');
let deletionRaced=false,deletionReadFailed=false;
const dimensionValues=new Map<string,{widthCm:number|null;heightCm:number|null}>([['76',{widthCm:48,heightCm:32}]]);
const apiFetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
 const u=new URL(String(input),location.href);
 if(gridReview&&u.pathname.startsWith('/api/v2/'))gridRequests.push({path:u.pathname+u.search});
 if(deletionReview){
  const impact=/^\/api\/v2\/pattern-(masters|colorways)\/(\d+)\/deletion-impact$/.exec(u.pathname);
  if(impact){
   if(impact[2]==='73'&&!deletionReadFailed){deletionReadFailed=true;return Response.json({}, {status:503});}
   const colorway=impact[1]==='colorways',id=colorway?impact[2].slice(0,-2):impact[2];
   const master=all.find(item=>item.id===id);
   if(!master)return Response.json({}, {status:404});
   const productCount=id==='74'&&deletionRaced?1:master.productCount;
   return Response.json({colorwayCount:colorway?1:master.versions.length,productCount,
    orderedProductCount:productCount?1:0,independentCardCount:!colorway&&id==='72'?1:0});
  }
  const removal=/^\/api\/v2\/pattern-(masters|colorways)\/(\d+)$/.exec(u.pathname);
  if(removal&&init?.method==='DELETE'){
   const id=removal[2];
   if(id==='74'){deletionRaced=true;return Response.json({}, {status:409});}
   const index=all.findIndex(item=>item.id===id&&item.productCount===0);
   if(index<0)return Response.json({}, {status:409});
   all.splice(index,1);
   return Response.json({id,deleted:true});
  }
 }
 if(dimensionMode||deletionReview){
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
 if(u.pathname==='/api/v2/tags')return Response.json({items:[{id:'1',name:'油画花卉',isArchived:false,dimension:'topic'},{id:'2',name:'已归档题材',isArchived:true,dimension:'topic'}]});
 if(u.pathname==='/api/v2/pattern-catalog/import-preview'){
  const targets=JSON.parse(String(init?.body)) as {masterNo:string;colorwayNo:number}[];
  return Response.json({items:targets.flatMap(target=>{
   const item=all.find(master=>master.masterNo===target.masterNo)?.versions.find(version=>version.colorwayNo===target.colorwayNo);
   return item?[{...target,id:item.id,imageId:item.patternImageAssetId}]:[];
  })});
 }
 if(u.pathname==='/api/v2/pattern-catalog/import'){
  const {masterNo,colorwayNo}=JSON.parse(String(init?.body));
  const key=masterNo+'-'+colorwayNo,count=(importAttempts.get(key)??0)+1;
  importAttempts.set(key,count);
  if(location.search.includes('retry-import')&&colorwayNo===1&&count===1)return Response.json({}, {status:400});
  if(location.search.includes('retry-import')&&colorwayNo===2&&count>1)return Response.json({}, {status:503});
  return Response.json({patternNo:key});
 }
 if(u.pathname==='/api/image-assets/access-urls'){
  const response=await relatedProductImagesPreview(init);
  if(!location.search.includes('image-variants')||!response.ok)return response;
  const {results}=await response.json();
  return Response.json({results:results.map((item:{url:string;variant:string})=>({
   ...item,url:item.url+'?variant='+item.variant+'&request='+String(++imageRequest)
  }))});
 }
 if(u.pathname==='/api/v2/products')return relatedProductsPreview(u,init);
 if(u.pathname==='/api/v2/pattern-catalog'){
  const limit=Number(u.searchParams.get('limit')||20),offset=Number(u.searchParams.get('offset')||0);
  if(failGridPage&&offset>0){failGridPage=false;return Response.json({},{status:503});}
  if(location.search.includes('shrink')&&offset>=60)shrunk=true;
  const q=u.searchParams.get('number')||'';
  const topic=u.searchParams.get('topicTagIds');
  const matched=(shrunk?all.slice(0,2):all).filter(m=>(!topic||m.topicTags.some(tag=>tag.id===topic))&&
   (m.masterNo.includes(q)||m.versions.some(version=>version.patternNo===q)));
  const sort=u.searchParams.get('sort');
  if(sort==='numberAsc'||sort==='numberDesc'){const direction=sort==='numberAsc'?1:-1;matched.sort((a,b)=>direction*(Number(a.masterNo.slice(1))-Number(b.masterNo.slice(1))||Number(a.id)-Number(b.id)));}
  const matchedVersions=matched.map(m=>gridReview&&q.includes('-')?{...m,versions:m.versions.filter(v=>v.patternNo===q)}:m);
  const result=Response.json({items:matchedVersions.slice(offset,offset+limit).map(m=>dimensionMode?{...m,...(dimensionValues.get(m.id)??{widthCm:null,heightCm:null})}:m),total:matched.length,totalColorways:matchedVersions.reduce((n,m)=>n+m.versions.length,0),limit,offset});
  if(dimensionMode&&location.search.includes('delay-list')&&++catalogReads===2)await new Promise(resolve=>setTimeout(resolve,900));
  return result;
 }
 return Response.json({items:[]});
}) as typeof fetch;
let createUploadAttempts=0;
const uploadPatternImage=async(file:File)=>{
 if(file.name.endsWith('-1.jpg'))throw Error('图片校验失败');
 if(location.search.includes('create-upload-review')){
  await new Promise(resolve=>setTimeout(resolve,550));
  if(++createUploadAttempts===1)throw Error('图片服务暂时不可用。');
 }
 return 'a1111111-1111-4111-8111-111111111111';
};
const Library=dimensionMode?PatternWorkspaceV2:PatternLibraryV2;
const resolveGridImages=async(ids:string[],variant:'thumbnail'|'display'|'original')=>{
 gridRequests.push({path:'/api/image-assets/access-urls',variant,ids});
 return new Map(ids.map(id=>{
  if(failGridThumbnail&&variant==='thumbnail'&&id===relatedImageId('761')){
   failGridThumbnail=false;
   return [id,'data:image/svg+xml,broken'];
  }
  return [id,gridImage(id,variant)];
 }));
};
createRoot(document.getElementById('root')!).render(<V2DocumentLookupContext.Provider value={!new URLSearchParams(location.search).has('sales')}>
 <ToastProvider><ConfirmProvider><Library apiFetch={apiFetch} canManage onUploadPatternImage={uploadPatternImage}
  resolvePatternImages={gridReview?resolveGridImages:undefined}/></ConfirmProvider></ToastProvider>
</V2DocumentLookupContext.Provider>);
if(gridReview&&location.search.includes('start-grid')){
 const observer=new MutationObserver(()=>{
  const button=Array.from(document.querySelectorAll<HTMLButtonElement>('.pattern-view-switch button'))
   .find(element=>element.textContent==='看图');
  if(button){observer.disconnect();button.click();}
 });
 observer.observe(document.getElementById('root')!,{childList:true,subtree:true});
}
