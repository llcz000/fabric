/** P4-6 LOCAL UI REVIEW ONLY. All data is in memory; never proxy to production.
 * A deliberately separate Vite entry, not imported by src/main.tsx or src/App.tsx.
 */
import type {FabricCatalogItem} from '../components/product-master-v2/fabricModel';
import type {PatternMasterItem} from '../components/product-master-v2/patternModel';
import type {CatalogProduct} from '../components/product-master-v2/catalogModel';
import type {ProductEditorDetails} from '../components/product-master-v2/productEditorModel';
const tags=[
 {id:'1',name:'花卉',dimension:'topic',isArchived:false},
 {id:'2',name:'几何',dimension:'topic',isArchived:false},
 {id:'3',name:'植物',dimension:'topic',isArchived:false},
 {id:'4',name:'条纹',dimension:'topic',isArchived:false},
 {id:'11',name:'蓝色',dimension:'color',isArchived:false},
 {id:'12',name:'粉色',dimension:'color',isArchived:false},
 {id:'13',name:'米白',dimension:'color',isArchived:false},
 {id:'14',name:'绿色',dimension:'color',isArchived:false},
 {id:'15',name:'历史色',dimension:'color',isArchived:true}
];
const asTag=(id:string)=>{const t=tags.find(x=>x.id===id)!;return {id:t.id,name:t.name,isArchived:t.isArchived};};
let customTagNo=800;
function colorTagsInDraft(body:{tagIds?:string[];newColorTags?:string[]}){
 const ids=[...(body.tagIds??[])];
 for(const raw of body.newColorTags??[]){
  const name=raw.trim(),normalized=name.normalize('NFKC').toLowerCase().trim();
  let found=tags.find(x=>x.dimension==='color'&&
   x.name.normalize('NFKC').toLowerCase().trim()===normalized);
  if(!found){
   found={id:String(customTagNo++),name,dimension:'color',isArchived:false};
   tags.push(found);
  }
  ids.push(found.id);
 }
 return [...new Set(ids)].map(asTag);
}

const masters:PatternMasterItem[]=Array.from({length:7},(_,i)=>{
 const id=String(101+i),no='G'+String(179+i).padStart(4,'0');
 const t=i%2?'2':'1';
 return {id,masterNo:no,isActive:i!==6,nextColorwayNo:7,
  topicTags:[asTag(t)],colorTags:(i===0?['11','12','13','14','15']:['11','12','13','14']).map(asTag),versions:Array.from({length:6},(_,v)=>({
   id:String(200+i*10+v),masterId:id,colorwayNo:v+1,patternNo:no+'-'+(v+1),
   patternImageAssetId:null,remark:v===2?'手绘纹理与轻盈层次':'',
   isActive:v!==5,colorTags:[asTag(['11','12','13','14'][v%4])]
  }))};
});
const materials=['轻盈真丝雪纺','棉麻印花布','弹力网纱','软缎','真丝乔其','人造丝斜纹','针织薄纱','贡缎','雪纺皱','亚麻混纺'];
const fabrics:FabricCatalogItem[]=Array.from({length:24},(_,i)=>{
 const number=i+18;
 return {id:String(401+i),fabricNo:'F'+String(number).padStart(3,'0'),fabricName:materials[i%materials.length],
  composition:i%3===0?'100%真丝':i%3===1?'55%棉 45%麻':'92%涤纶 8%氨纶',
  weightValue:i%5===0?null:i%2?78.5:16.5,
  weightUnit:i%5===0?null:i%2?'gsm':'mm',
  widthValue:i%7===0?null:i%2?150:145,
  remark:i===0?'适合轻盈垂坠的服装效果':null,
  isActive:i!==23,productCount:0};
});
const emptyImages=()=>({fabricDisplay:[] as string[],detail:[] as string[],aiEffect:[] as string[]});
type StoredProduct=ProductEditorDetails;
let nextProduct=701,nextFabric=450,nextColor=600;
const productFrom=(colorwayId:string,fabricId:string,fields:Partial<StoredProduct>={}):StoredProduct=>{
 const v=masters.flatMap(m=>m.versions).find(x=>x.id===colorwayId)!;
 const m=masters.find(x=>x.id===v.masterId)!;
 const f=fabrics.find(x=>x.id===fabricId)!;
 return {id:String(nextProduct++),patternColorwayId:v.id,fabricId:f.id,
  masterNo:m.masterNo,colorwayNo:v.colorwayNo,fabricNo:f.fabricNo,fabricName:f.fabricName,
  composition:f.composition,weightValue:f.weightValue,weightUnit:f.weightUnit,widthCm:f.widthValue,
  patternImageAssetId:v.patternImageAssetId,productNo:v.patternNo+'-'+f.fabricNo,remark:'',
  isActive:true,isAvailableForSampling:true,rowVersion:'1',masterActive:m.isActive,colorwayActive:v.isActive,fabricActive:f.isActive,
  images:emptyImages(),...fields};
};
const products:StoredProduct[]=Array.from({length:20},(_,i)=>productFrom(
 masters[i%6].versions[i%5].id,fabrics[i%15].id,{
  remark:i%4===0?'原创手绘花型，轻盈材质适合高级时装系列。':''
 }));
function json(data:unknown,status=200):Response{
 return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
}
const active=(item:{isActive:boolean})=>item.isActive;
const lower=(s:string)=>s.trim().toLowerCase();
const tagsMatch=(selected:string[],available:string[])=>!selected.length||selected.some(x=>available.includes(x));
const selected=(url:URL,field:string)=>(url.searchParams.get(field)??'').split(',').filter(Boolean);
function catalogProduct(p:StoredProduct):CatalogProduct{
 const m=masters.find(x=>x.masterNo===p.masterNo)!;
 const v=m.versions.find(x=>x.id===p.patternColorwayId)!;
 const f=fabrics.find(x=>x.id===p.fabricId)!;
 return {...p,masterId:m.id,fabricName:f.fabricName,composition:f.composition,
  weightValue:f.weightValue,weightUnit:f.weightUnit,widthCm:f.widthValue,
  topicTags:m.topicTags,colorTags:m.colorTags??[],patternImageAssetId:v.patternImageAssetId,
  masterActive:m.isActive,colorwayActive:v.isActive,fabricActive:f.isActive,
  isSelectable:p.isActive&&m.isActive&&v.isActive&&f.isActive,
  imageCounts:{fabricDisplay:p.images.fabricDisplay.length,detail:p.images.detail.length,
   aiEffect:p.images.aiEffect.length},
  totalImages:p.images.fabricDisplay.length+p.images.detail.length+p.images.aiEffect.length};
}
const paginate=<T,>(items:T[],url:URL,defaultLimit:number)=>({
 total:items.length,limit:Number(url.searchParams.get('limit')??defaultLimit),
 offset:Number(url.searchParams.get('offset')??0),
 items:items.slice(Number(url.searchParams.get('offset')??0),
  Number(url.searchParams.get('offset')??0)+Number(url.searchParams.get('limit')??defaultLimit))
});
function matchPatterns(url:URL):PatternMasterItem[]{
 const needle=lower(url.searchParams.get('number')??'');
 const no=Number(url.searchParams.get('colorwayNo')??0);
 const topics=selected(url,'topicTagIds'),colors=selected(url,'colorTagIds'),include=url.searchParams.get('includeInactive')==='true';
 return masters.filter(m=>(include||m.isActive)&&tagsMatch(topics,m.topicTags.map(t=>t.id))&&tagsMatch(colors,(m.colorTags??[]).map(tag=>tag.id))&&
  (!needle||needle.includes('-')||lower(m.masterNo).includes(needle))).map(m=>({
  ...m,versions:m.versions.filter(v=>(include||v.isActive)&&
   (!no||v.colorwayNo===no)&&
   (!needle||!needle.includes('-')||lower(v.patternNo).includes(needle))).map(version=>({...version,colorTags:m.colorTags??[]}))
 })).filter(m=>!needle.includes('-')&&!no||m.versions.length>0);
}
const patternImages=new Map<string,string>();
// Explicit local demo assets. Distinct intrinsic sizes prove thumbnail/original routing.
const demoAssets=new Map<string,Record<'thumbnail'|'display'|'original',string>>();
for(const [id,title,color] of [
 ['aaaaaaaa-1111-4111-8111-111111111111','面料大图 · 本地示例','#dce9ec'],
 ['bbbbbbbb-2222-4222-8222-222222222222','面料细节 · 本地示例','#eedce1'],
 ['cccccccc-3333-4333-8333-333333333333','效果图 · 本地示例','#dddfee'],
 ['dddddddd-4444-4444-8444-444444444444','花型原图 · 本地示例','#dce7d9'],
 ['eeeeeeee-5555-4555-8555-555555555555','花型图 · 配色2','#ead7e6']
]){
 const variants={} as Record<'thumbnail'|'display'|'original',string>;
 for(const variant of ['thumbnail','display','original'] as const){
  const width=variant==='original'?1440:variant==='display'?800:320,height=Math.round(width*0.625);
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 1440 900"><defs><pattern id="p" width="120" height="120" patternUnits="userSpaceOnUse"><circle cx="30" cy="30" r="18" fill="#5a7385" opacity=".35"/><circle cx="90" cy="90" r="26" fill="#fff" opacity=".5"/></pattern></defs><rect width="1440" height="900" fill="'+color+'"/><rect width="1440" height="900" fill="url(#p)"/><rect x="160" y="360" width="1120" height="180" rx="20" fill="white" opacity=".85"/><text x="720" y="440" text-anchor="middle" font-size="52" fill="#31447b">'+title+'</text><text x="720" y="500" text-anchor="middle" font-size="28" fill="#5a7385">'+variant+' '+width+' × '+height+'</text></svg>';
  variants[variant]='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
 }
 demoAssets.set(id,variants);
}
products[0].images={fabricDisplay:['aaaaaaaa-1111-4111-8111-111111111111'],detail:['bbbbbbbb-2222-4222-8222-222222222222'],aiEffect:['cccccccc-3333-4333-8333-333333333333']};
masters[1].versions[1].patternImageAssetId='dddddddd-4444-4444-8444-444444444444';
export async function reviewResolvePatternImages(ids:string[],variant:'thumbnail'|'display'|'original',signal?:AbortSignal):Promise<Map<string,string>>{
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('fabric-review:image-access',{detail:{ids,variant}}));
 return new Map(ids.flatMap(id=>{const url=demoAssets.get(id)?.[variant]??patternImages.get(id);return url?[[id,url] as const]:[];}));
}
/** Only used by the isolated preview: bytes stay in browser memory. */
export async function reviewUploadPatternImage(file:File):Promise<string>{
 if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)||file.size===0||file.size>20*1024*1024)throw Error('请选择20MB以内的图片');
 const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
 for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
 const assetId=crypto.randomUUID();patternImages.set(assetId,'data:'+file.type+';base64,'+btoa(binary));return assetId;
}
let mockImportSerial=0;
let mockImportToken:string|null=null;
const mockImportFileName='仅内存模拟，不实际解析Excel内容';
function mockImportPreview(){
 const old=fabrics.find(f=>f.fabricNo==='F018')!;
 const patch={fabricNo:'F018',fabricName:'轻柔雪纺·示例更新',
  composition:'100%真丝',weightValue:null,weightUnit:null,widthValue:null,remark:null};
 return {token:mockImportToken!,expiresInSeconds:900,sheetName:'面料资料',
  headerRow:1,mapping:{fabricNo:1,fabricName:2,composition:3,weightValue:4,
   weightUnit:5,widthValue:6,remark:7},
  counts:{create:1,skip:3,error:1},
  rows:[
   {rowNumber:2,action:'skip',reason:'品号已存在，默认跳过，管理员可选择更新',fabric:patch,
    existing:{id:old.id,fabricNo:old.fabricNo,fabricName:old.fabricName,
     composition:old.composition,weightValue:old.weightValue,weightUnit:old.weightUnit,
     widthValue:old.widthValue,remark:old.remark,isActive:old.isActive},
    changes:{fabricName:{from:old.fabricName,to:patch.fabricName}}},
   {rowNumber:3,action:'create',reason:'可以新增',fabric:{fabricNo:'F777',fabricName:'导入演示面料',
    composition:'100%真丝',weightValue:16.5,weightUnit:'mm',widthValue:145,remark:'模拟新建'}},
   {rowNumber:4,action:'skip',reason:'文件内重复品号，行号4、5',fabric:{
    fabricNo:'D001',fabricName:'重复甲',composition:null,weightValue:null,weightUnit:null,
    widthValue:null,remark:null}},
   {rowNumber:5,action:'skip',reason:'文件内重复品号，行号4、5',fabric:{
    fabricNo:'D001',fabricName:'重复乙',composition:null,weightValue:null,weightUnit:null,
    widthValue:null,remark:null}},
   {rowNumber:6,action:'error',reason:'纯数值克重缺少单位',fabric:null,fabricNoHint:'F998'}
  ]};
}
/** In-memory, no disk and no outgoing HTTP. */
export const reviewFetch:typeof fetch=async(input,init)=>{
 const u=new URL(String(input),'http://127.0.0.1');
 const path=u.pathname,method=(init?.method??'GET').toUpperCase();
 let body:Record<string,any>={};
 if(init?.body){try{body=JSON.parse(String(init.body))}catch{return json({error:'Invalid JSON'},400);}}
 // Ensure review cannot fetch beyond the explicit fake API allowlist.
 if(path==='/api/v2/tags'&&method==='GET'){
  const dim=u.searchParams.get('dimension');
  return json({items:tags.filter(x=>x.dimension===dim&&(u.searchParams.get('includeArchived')==='true'||!x.isArchived))});
 }
 const exportsByPath:Record<string,'patterns'|'fabrics'|'products'>={
  '/api/v2/pattern-catalog/export.xlsx':'patterns','/api/v2/fabrics/catalog/export.xlsx':'fabrics','/api/v2/products/export.xlsx':'products'
 };
 if(method==='GET'&&exportsByPath[path]){
  const {buildCatalogWorkbook}=await import('../../server/product-master/catalogExportWorkbook');
  const rows:unknown[]=[];let offset=0;
  for(;;){
   const source=new URL(u);source.pathname=path.replace('/export.xlsx','');source.searchParams.set('limit','100');source.searchParams.set('offset',String(offset));
   const response=await reviewFetch(source.pathname+source.search);if(!response.ok)return response;
   const page=await response.json();rows.push(...page.items);offset+=page.items.length;
   if(offset>=page.total)break;if(!page.items.length)return json({error:'资料已变化'},409);
  }
  const bytes=await buildCatalogWorkbook(exportsByPath[path],rows as never);
  return new Response(bytes,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
 }
 if(path==='/api/image-assets/access-urls'&&method==='POST')return json({results:[]});
 if(path==='/api/v2/pattern-catalog'&&method==='GET')return json(paginate(matchPatterns(u),u,20));
 const colorDetails=/^\/api\/v2\/pattern-masters\/(\d+)\/colorway-details$/.exec(path);
 if(colorDetails&&method==='GET'){
  const m=masters.find(x=>x.id===colorDetails[1]);
  return m?json({items:m.versions.map(v=>({...v,masterNo:m.masterNo,colorTags:m.colorTags??[]})),
   nextColorwayNo:m.nextColorwayNo}):json({error:'Not found'},404);
 }
 const addColor=/^\/api\/v2\/pattern-masters\/(\d+)\/colorways$/.exec(path);
 if(addColor&&method==='POST'){
  const m=masters.find(x=>x.id===addColor[1]);if(!m)return json({error:'Not found'},404);
  const v={id:String(nextColor++),masterId:m.id,colorwayNo:m.nextColorwayNo,
   patternNo:m.masterNo+'-'+m.nextColorwayNo,patternImageAssetId:null,
   remark:body.remark??'',isActive:body.isActive??true,
   colorTags:colorTagsInDraft(body) as ReturnType<typeof asTag>[]};
  m.nextColorwayNo++;m.versions.push(v);
  return json({...v,masterNo:m.masterNo},201);
 }
 const masterTag=/^\/api\/v2\/pattern-masters\/(\d+)\/tags$/.exec(path);
 const masterColors=/^\/api\/v2\/pattern-masters\/(\d+)\/color-tags$/.exec(path);
 if(masterColors&&method==='GET'){
  const master=masters.find(item=>item.id===masterColors[1]);return master?json({items:master.colorTags??[]}):json({error:'Not found'},404);
 }
 if(masterColors&&method==='PUT'){
  const master=masters.find(item=>item.id===masterColors[1]);if(!master)return json({error:'Not found'},404);
  if(!Array.isArray(body.tagIds)||body.tagIds.length>10||new Set(body.tagIds).size!==body.tagIds.length||body.tagIds.some((id:string)=>!tags.some(tag=>tag.id===id&&tag.dimension==='color')))return json({error:'Invalid color tags'},400);
  master.colorTags=colorTagsInDraft(body);return json({tagIds:master.colorTags.map(tag=>tag.id)});
 }
 if(masterTag&&method==='PUT'){
  const m=masters.find(x=>x.id===masterTag[1]);if(!m)return json({error:'Not found'},404);
  m.topicTags=(body.tagIds??[]).map(asTag);return json({tagIds:body.tagIds});
 }
 const masterPatch=/^\/api\/v2\/pattern-masters\/(\d+)$/.exec(path);
 if(masterPatch&&method==='PATCH'){
  const m=masters.find(x=>x.id===masterPatch[1]);if(!m)return json({error:'Not found'},404);
  m.isActive=body.isActive??m.isActive;return json(m);
 }
 const colorTag=/^\/api\/v2\/pattern-colorways\/(\d+)\/tags$/.exec(path);
 if(colorTag&&method==='PUT'){
  const v=masters.flatMap(m=>m.versions).find(x=>x.id===colorTag[1]);if(!v)return json({error:'Not found'},404);
  v.colorTags=(body.tagIds??[]).map(asTag);return json({tagIds:body.tagIds});
 }
 const colorPatch=/^\/api\/v2\/pattern-colorways\/(\d+)$/.exec(path);
 if(colorPatch&&method==='PATCH'){
  const v=masters.flatMap(m=>m.versions).find(x=>x.id===colorPatch[1]);if(!v)return json({error:'Not found'},404);
  if(Object.hasOwn(body,'patternImageAssetId')&&body.patternImageAssetId!==null&&!patternImages.has(body.patternImageAssetId))return json({error:'Image is not ready'},409);
  v.remark=body.remark??v.remark;v.isActive=body.isActive??v.isActive;
  if(body.tagIds!==undefined)v.colorTags=colorTagsInDraft(body);
  if(Object.hasOwn(body,'patternImageAssetId')){
   v.patternImageAssetId=body.patternImageAssetId;
  }
  return json(v);
 }
 if(colorPatch&&method==='DELETE'){
  const m=masters.find(x=>x.versions.some(v=>v.id===colorPatch[1]));if(!m)return json({error:'Not found'},404);
  if(products.some(p=>p.patternColorwayId===colorPatch[1]))return json({error:'Referenced'},409);
  m.versions=m.versions.filter(x=>x.id!==colorPatch[1]);return json({deleted:true,id:colorPatch[1]});
 }

 if(path==='/api/v2/fabrics/import/preview'&&method==='POST'){
  if(typeof body.fileBase64!=='string'||!body.fileBase64.startsWith('UEs')||
   !body.options||!String(body.options.filename).toLowerCase().endsWith('.xlsx'))
   return json({error:'本机仅支持XLSX模拟预览'},400);
  mockImportToken='c'.repeat(62)+String(++mockImportSerial).padStart(2,'0');
  return json({...mockImportPreview(),reviewNotice:mockImportFileName});
 }
 if(path==='/api/v2/fabrics/import/commit'&&method==='POST'){
  if(body.token!==mockImportToken||mockImportToken===null)return json({error:'模拟预览已失效'},409);
  if(body.confirm!==true||!Array.isArray(body.updateRows)||
   body.updateRows.some((x:unknown)=>x!==2)||body.updateRows.length>1)
   return json({error:'必须明确确认并选择有效行号'},400);
  const selected=body.updateRows.includes(2);mockImportToken=null;
  const existing=fabrics.find(x=>x.fabricNo==='F018')!;
  if(selected)existing.fabricName='轻柔雪纺·示例更新';
  if(!fabrics.some(f=>f.fabricNo==='F777'))fabrics.push({
   id:String(nextFabric++),fabricNo:'F777',fabricName:'导入演示面料',
   composition:'100%真丝',weightValue:16.5,weightUnit:'mm',widthValue:145,
   remark:'模拟新建',isActive:true,productCount:0
  });
  const results=[
   {rowNumber:2,status:selected?'updated':'skipped',
    reason:selected?'管理员确认后已更新（仅内存模拟）':'重复品号默认跳过',fabricNo:'F018'},
   {rowNumber:3,status:'created',reason:'已新增（仅内存模拟）',fabricNo:'F777'},
   {rowNumber:4,status:'skipped',reason:'文件重复组',fabricNo:'D001'},
   {rowNumber:5,status:'skipped',reason:'文件重复组',fabricNo:'D001'},
   {rowNumber:6,status:'failed',reason:'缺少克重单位',fabricNo:'F998'}
  ] as const;
  return json({rows:results,counts:{created:1,updated:selected?1:0,
   skipped:selected?2:3,failed:1}});
 }
 if(path==='/api/v2/fabrics/catalog'&&method==='GET'){
  const q=lower(u.searchParams.get('query')??'');
  const allowInactive=u.searchParams.get('includeInactive')==='true';
  return json(paginate(fabrics.filter(f=>(allowInactive||f.isActive)&&
   (!q||[f.fabricNo,f.fabricName,f.composition??''].some(x=>lower(x).includes(q)))).map(f=>({
    ...f,productCount:products.filter(p=>p.fabricId===f.id).length
   })),u,50));
 }
 if(path==='/api/v2/fabrics'&&method==='POST'){
  if(fabrics.some(f=>f.fabricNo===body.fabricNo))return json({error:'Duplicate'},409);
  const f:FabricCatalogItem={...body,id:String(nextFabric++),isActive:true,productCount:0} as FabricCatalogItem;
  fabrics.push(f);return json(f,201);
 }
 const fabric=/^\/api\/v2\/fabrics\/(\d+)$/.exec(path);
 if(fabric&&method==='PATCH'){
  const f=fabrics.find(x=>x.id===fabric[1]);if(!f)return json({error:'Not found'},404);
  if(fabrics.some(x=>x.id!==f.id&&x.fabricNo===body.fabricNo))return json({error:'Duplicate'},409);
  Object.assign(f,body);return json(f);
 }
 if(fabric&&method==='DELETE'){
  const index=fabrics.findIndex(x=>x.id===fabric[1]);if(index<0)return json({error:'Not found'},404);
  if(products.some(x=>x.fabricId===fabric[1]))return json({error:'Referenced'},409);
  fabrics.splice(index,1);return json({id:fabric[1],deleted:true});
 }
 if(path==='/api/v2/products'&&method==='GET'){
  const productNo=lower(u.searchParams.get('productNo')??'');
  const fabricName=lower(u.searchParams.get('fabricName')??'');
  const status=u.searchParams.get('status')??'active';
  const topic=selected(u,'topicTagIds'),color=selected(u,'colorTagIds');
  const matches=products.map(catalogProduct).filter(p=>
   (!productNo||lower(p.productNo).includes(productNo))&&
   (!fabricName||lower(p.fabricName).includes(fabricName))&&
   (status==='all'||(status==='inactive'?!p.isActive:p.isActive))&&
   tagsMatch(topic,p.topicTags.map(t=>t.id))&&tagsMatch(color,p.colorTags.map(t=>t.id)));
  return json(paginate(matches,u,50));
 }
 if(path==='/api/v2/products'&&method==='POST'){
  const v=masters.flatMap(m=>m.versions).find(x=>x.id===body.patternColorwayId);
  const f=fabrics.find(x=>x.id===body.fabricId);
  if(!v||!f)return json({error:'Unknown linked identity'},404);
  if(products.some(p=>p.patternColorwayId===v.id&&p.fabricId===f.id))return json({error:'Duplicate'},409);
  const p=productFrom(v.id,f.id,{remark:body.remark??'',isActive:body.isActive??true,
   isAvailableForSampling:body.isAvailableForSampling??true,images:body.images??emptyImages()});
  products.unshift(p);return json(p,201);
 }
 const product=/^\/api\/v2\/products\/(\d+)$/.exec(path);
 if(product&&method==='GET'){
  const p=products.find(x=>x.id===product[1]);return p?json(p):json({error:'Not found'},404);
 }
 if(product&&method==='PATCH'){
  const p=products.find(x=>x.id===product[1]);if(!p)return json({error:'Not found'},404);
  if(body.expectedRowVersion!==p.rowVersion)return json({error:'Conflict'},409);
  if(products.some(x=>x.id!==p.id&&x.patternColorwayId===body.patternColorwayId&&x.fabricId===body.fabricId))
   return json({error:'Duplicate'},409);
  const v=masters.flatMap(m=>m.versions).find(x=>x.id===body.patternColorwayId);
  const f=fabrics.find(x=>x.id===body.fabricId);if(!v||!f)return json({error:'Not found'},404);
  Object.assign(p,productFrom(v.id,f.id,{...p,id:p.id,remark:body.remark,isActive:body.isActive,
   isAvailableForSampling:body.isAvailableForSampling??p.isAvailableForSampling,
   images:body.images,rowVersion:String(Number(p.rowVersion)+1)}));
  return json(p);
 }
 return json({error:'LOCAL_REVIEW_UNSUPPORTED_PATH',path,method},404);
};
export function reviewFacts(){return {
 masters:masters.length,colorways:masters.reduce((n,m)=>n+m.versions.length,0),
 fabrics:fabrics.length,products:products.length,offline:true
};}
