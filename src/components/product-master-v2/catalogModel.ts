/** P4-4 Fabric V2 product list API/interaction model; never use legacy product endpoints. */
export type CatalogStatus='active'|'inactive'|'all';
export type CardAssociation='all'|'linked'|'unlinked';
export interface CatalogFilters{
 productNo:string;fabricName:string;topicTagIds:string[];colorTagIds:string[];
 status:CatalogStatus;limit:number;offset:number;cardAssociation?:CardAssociation;
}
export interface CatalogTag{id:string;name:string;isArchived:boolean}
export interface CatalogProduct{
 id:string;productNo:string;patternColorwayId:string;fabricId:string;masterId:string;
 masterNo:string;colorwayNo:number;fabricNo:string;fabricName:string;
 composition:string|null;weightValue:number|null;weightUnit:'gsm'|'mm'|null;
 fabricRemark?:string|null;
 widthCm:number|null;remark:string;isActive:boolean;isAvailableForSampling:boolean;masterActive:boolean;
 colorwayActive:boolean;fabricActive:boolean;isSelectable:boolean;rowVersion:string;
 patternImageAssetId:string|null;topicTags:CatalogTag[];colorTags:CatalogTag[];
 imageCounts:{fabricDisplay:number;detail:number;aiEffect:number};totalImages:number;
 /** Missing only for an older response; never interpret unread metadata as unlinked. */
 sampleCard?:{id:string;cardNo:string;isActive:boolean;needsReprint:boolean}|null;
}
export interface CatalogPage{items:CatalogProduct[];total:number;limit:number;offset:number}
export type CatalogAction=
 |{type:'productNo'|'fabricName';value:string}
 |{type:'topic'|'color';id:string}
 |{type:'status';value:CatalogStatus}
  |{type:'cardAssociation';value:CardAssociation}
 |{type:'page';offset:number}
 |{type:'reset'};
export const emptyCatalogFilters:CatalogFilters={
 productNo:'',fabricName:'',topicTagIds:[],colorTagIds:[],status:'active',limit:50,offset:0,cardAssociation:'all'
};
export function reduceCatalogFilters(value:CatalogFilters,action:CatalogAction):CatalogFilters{
 if(action.type==='reset')return {...emptyCatalogFilters,topicTagIds:[],colorTagIds:[]};
 if(action.type==='page')return {...value,offset:action.offset};
 if(action.type==='productNo'||action.type==='fabricName')
  return {...value,[action.type]:action.value,offset:0};
 if(action.type==='status')return {...value,status:action.value,offset:0};
 if(action.type==='cardAssociation')return {...value,cardAssociation:action.value,offset:0};
 if(action.type==='topic'||action.type==='color'){
  const key=action.type==='topic'?'topicTagIds':'colorTagIds';
  const old=value[key];
  if(!old.includes(action.id)&&old.length>=10)return value;
  const next=old.includes(action.id)?old.filter(x=>x!==action.id):[...old,action.id];
  return {...value,[key]:next,offset:0};
 }
 return value;
}
export function buildCatalogUrl(endpoint:string,value:CatalogFilters):string{
 const params=new URLSearchParams();
 if(value.productNo.trim())params.set('productNo',value.productNo.trim());
 if(value.fabricName.trim())params.set('fabricName',value.fabricName.trim());
 if(value.topicTagIds.length)params.set('topicTagIds',value.topicTagIds.join(','));
 if(value.colorTagIds.length)params.set('colorTagIds',value.colorTagIds.join(','));
 params.set('status',value.status);
 if(value.cardAssociation&&value.cardAssociation!=='all')params.set('cardAssociation',value.cardAssociation);
 params.set('limit',String(value.limit));params.set('offset',String(value.offset));
 return endpoint+'?'+params.toString();
}
const bigint=(s:unknown):s is string=>typeof s==='string'&&/^[1-9]\d{0,19}$/.test(s)&&BigInt(s)<=18446744073709551615n;
const safeNumber=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
const counts=(raw:any):boolean=>!!raw&&typeof raw==='object'&&
 ['fabricDisplay','detail','aiEffect'].every(k=>Number.isSafeInteger(raw[k])&&raw[k]>=0&&raw[k]<=10);
export function parseCatalogPage(raw:unknown):CatalogPage{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('产品列表数据格式错误');
 const page=raw as Record<string,unknown>;
 if(!Array.isArray(page.items)||!Number.isSafeInteger(page.total)||Number(page.total)<0||
  !Number.isSafeInteger(page.limit)||Number(page.limit)<1||Number(page.limit)>100||
  !Number.isSafeInteger(page.offset)||Number(page.offset)<0||
  page.items.length>Number(page.limit))throw Error('产品分页数据格式错误');
 const isTag=(t:any):boolean=>!!t&&bigint(t.id)&&typeof t.name==='string'&&typeof t.isArchived==='boolean';
 for(const input of page.items){
  if(!input||typeof input!=='object')throw Error('产品数据错误');
  const x=input as Record<string,unknown>,images=x.imageCounts as any;
   if(x.sampleCard!==undefined&&x.sampleCard!==null){
    const card=x.sampleCard as Record<string,unknown>;
    if(typeof card!=='object'||Array.isArray(card)||!bigint(card.id)||typeof card.cardNo!=='string'||
     !card.cardNo.trim()||card.cardNo.length>129||/[\p{Cc}\p{Cf}]/u.test(card.cardNo)||
     typeof card.isActive!=='boolean'||typeof card.needsReprint!=='boolean')throw Error('产品色卡资料格式错误');
   }
  if(!bigint(x.id)||!bigint(x.patternColorwayId)||!bigint(x.fabricId)||
   !bigint(x.masterId)||!bigint(x.rowVersion)||
   !['productNo','masterNo','fabricNo','fabricName','remark'].every(k=>typeof x[k]==='string')||
   !Number.isSafeInteger(x.colorwayNo)||Number(x.colorwayNo)<1||
   !(x.composition===null||typeof x.composition==='string')||
   !(x.fabricRemark===undefined||x.fabricRemark===null||typeof x.fabricRemark==='string')||
   !(x.weightValue===null&&x.weightUnit===null||safeNumber(x.weightValue)&&['gsm','mm'].includes(String(x.weightUnit)))||
   !(x.widthCm===null||safeNumber(x.widthCm))||
   !['isActive','isAvailableForSampling','masterActive','colorwayActive','fabricActive','isSelectable'].every(k=>typeof x[k]==='boolean')||
   !(x.patternImageAssetId===null||typeof x.patternImageAssetId==='string')||
   !Array.isArray(x.topicTags)||!(x.topicTags as unknown[]).every(isTag)||
   !Array.isArray(x.colorTags)||!(x.colorTags as unknown[]).every(isTag)||
   !counts(images)||!Number.isSafeInteger(x.totalImages)||
   Number(x.totalImages)!==images.fabricDisplay+images.detail+images.aiEffect){
    throw Error('产品行数据格式错误');
   }
 }
 return raw as CatalogPage;
}
async function json(response:Response):Promise<unknown>{
 if(!response.ok)throw Error('请求失败（HTTP '+response.status+'）');
 return response.json();
}
export async function fetchCatalogPage(apiFetch:typeof fetch,filter:CatalogFilters,signal?:AbortSignal,endpoint='/api/v2/products'){
 return parseCatalogPage(await json(await apiFetch(buildCatalogUrl(endpoint,filter),{signal})));
}
export async function loadCatalogTags(apiFetch:typeof fetch,dimension:'topic'|'color',signal?:AbortSignal,linkedArchivedOnly=false):Promise<CatalogTag[]>{
 const suffix=linkedArchivedOnly&&dimension==='topic'?'&includeArchived=true&linkedArchivedOnly=true':'';
 const v=await json(await apiFetch('/api/v2/tags?dimension='+dimension+suffix,{signal}));
 if(!v||typeof v!=='object'||!Array.isArray((v as {items?:unknown}).items))
  throw Error('标签返回数据格式错误');
 const items=(v as {items:unknown[]}).items;
 if(!items.every(x=>!!x&&typeof x==='object'&&bigint((x as CatalogTag).id)&&
  typeof (x as CatalogTag).name==='string'&&
  typeof (x as CatalogTag).isArchived==='boolean'&&
  (x as {dimension?:unknown}).dimension===dimension))throw Error('标签行数据格式错误');
 return items.map(x=>{const t=x as CatalogTag;return {id:t.id,name:t.name,isArchived:t.isArchived};});
}
/** A ref-checked revision counter; outdated completions must not overwrite newer filters. */
export function createLatestRequestGuard(){
 let epoch=0;
 return {next:()=>++epoch,isCurrent:(token:number)=>token===epoch,cancel:()=>{epoch++;}};
}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function validAssetId(id:string):boolean{return UUID.test(id);}
export async function resolveImageUrls(apiFetch:typeof fetch,ids:string[],
 variant:'thumbnail'|'display'|'original',signal?:AbortSignal):Promise<Map<string,string>>{
 const unique=[...new Set(ids.filter(Boolean))];
 if(unique.some(id=>!validAssetId(id))||unique.length>100)throw Error('非法图片资产编号');
 const urls=new Map<string,string>();
 if(unique.length===0)return urls;
 const res=await json(await apiFetch('/api/image-assets/access-urls',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({requests:unique.map(assetId=>({assetId,variant}))}),signal
 }));
 if(!res||typeof res!=='object'||!Array.isArray((res as {results?:unknown}).results))throw Error('图片地址响应错误');
 for(const r of (res as {results:unknown[]}).results){
  if(!r||typeof r!=='object')throw Error('图片地址响应错误');
  const item=r as {assetId?:unknown;variant?:unknown;url?:unknown};
  if(typeof item.assetId!=='string'||!unique.includes(item.assetId)||
   item.variant!==variant||typeof item.url!=='string'||
   !/^https:\/\/[^\s]+$/.test(item.url))throw Error('图片签名地址无效');
  urls.set(item.assetId,item.url);
 }
 return urls;
}
export interface CatalogProductImages{
 id:string;productNo:string;images:{fabricDisplay:string[];detail:string[];aiEffect:string[]};
}
export async function getCatalogProductImages(apiFetch:typeof fetch,id:string,signal?:AbortSignal):Promise<CatalogProductImages>{
 if(!bigint(id))throw Error('无效产品编号');
 const raw=await json(await apiFetch('/api/v2/products/'+id,{signal}));
 if(!raw||typeof raw!=='object')throw Error('产品图片数据错误');
 const x=raw as any;
 if(x.id!==id||typeof x.productNo!=='string'||!x.images||typeof x.images!=='object'||
  !['fabricDisplay','detail','aiEffect'].every(k=>Array.isArray(x.images[k])&&
   x.images[k].length<=10&&x.images[k].every((v:unknown)=>typeof v==='string'&&validAssetId(v)))){
  throw Error('产品图片数据错误');
 }
 return {id,productNo:x.productNo,images:x.images};
}
