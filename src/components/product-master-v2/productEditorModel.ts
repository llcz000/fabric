/** P4-5 product edit draft and single-request V2 transactional persistence. No legacy fallback. */
import type {FabricCatalogItem,FabricCatalogPage} from './fabricModel';
import {fetchFabricCatalog,emptyFabricFilters} from './fabricModel';
import type {PatternVersionItem,PatternPage} from './patternModel';
import type {CatalogTag} from './catalogModel';
export type ProductPatternChoice=PatternVersionItem&{topicTags:CatalogTag[]};
import {fetchPatternPage,initialPatternFilters} from './patternModel';
export type ImageRole='fabricDisplay'|'detail'|'aiEffect';
export const IMAGE_ROLES=['fabricDisplay','detail','aiEffect'] as const;
export type EditorImages=Record<ImageRole,string[]>;
export const EMPTY_IMAGES:Readonly<EditorImages>={fabricDisplay:[],detail:[],aiEffect:[]};
export interface ProductEditorDetails{
 id:string;patternColorwayId:string;fabricId:string;masterNo:string;colorwayNo:number;
 fabricNo:string;fabricName:string;composition:string|null;weightValue:number|null;
 weightUnit:'gsm'|'mm'|null;widthCm:number|null;patternImageAssetId:string|null;
 productNo:string;remark:string;isActive:boolean;isAvailableForSampling:boolean;rowVersion:string;masterActive:boolean;
 colorwayActive:boolean;fabricActive:boolean;images:EditorImages;
}
export interface ProductEditorDraft{
 patternColorwayId:string;fabricId:string;remark:string;isActive:boolean;isAvailableForSampling:boolean;
 images:EditorImages;rowVersion:string|null;
}
type Payload={
 patternColorwayId:string;fabricId:string;remark:string;isActive:boolean;isAvailableForSampling:boolean;
 images:EditorImages;expectedRowVersion?:string;
};
const ID=(id:unknown):id is string=>typeof id==='string'&&/^[1-9]\d{0,19}$/.test(id)&&
 BigInt(id)<=18446744073709551615n;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const clean=()=>({fabricDisplay:[],detail:[],aiEffect:[]} as EditorImages);
export function emptyProductDraft():ProductEditorDraft{
 return {patternColorwayId:'',fabricId:'',remark:'',isActive:true,isAvailableForSampling:true,images:clean(),rowVersion:null};
}
export function initialProductDraft(item:ProductEditorDetails):ProductEditorDraft{
 return {patternColorwayId:item.patternColorwayId,fabricId:item.fabricId,
  remark:item.remark,isActive:item.isActive,isAvailableForSampling:item.isAvailableForSampling,
  rowVersion:item.rowVersion,
  images:{fabricDisplay:[...item.images.fabricDisplay],detail:[...item.images.detail],
   aiEffect:[...item.images.aiEffect]}};
}
export function buildProductNumberPreview(version:PatternVersionItem|null,fabric:FabricCatalogItem|null):string|null{
 if(!version)return '待选花型';
 if(!fabric)return '待选面料';
 if(!/^[A-Z0-9]{1,64}-[1-9]\d*$/.test(version.patternNo)||
  !/^[A-Z0-9]{1,64}$/.test(fabric.fabricNo))return null;
 return version.patternNo+'-'+fabric.fabricNo;
}
export function validateImages(value:EditorImages):EditorImages{
 if(!value||typeof value!=='object'||Array.isArray(value)||
  Object.keys(value).some(x=>!IMAGE_ROLES.includes(x as ImageRole)))
  throw Error('图片分类无效');
 const seen=new Set<string>(),out=clean();
 for(const role of IMAGE_ROLES){
  const items=value[role];
  if(!Array.isArray(items)||items.length>10)throw Error('每类图片最多10张');
  for(const asset of items){
   if(typeof asset!=='string'||!UUID.test(asset))throw Error('图片资产编号无效');
   if(seen.has(asset.toLowerCase()))throw Error('图片重复：不得跨分类复用同一图片资产');
   seen.add(asset.toLowerCase());out[role].push(asset.toLowerCase());
  }
 }
 return out;
}
export function addDraftAsset(state:ProductEditorDraft,role:ImageRole,assetId:string):ProductEditorDraft{
 const draft=validateImages(state.images);
 if(!UUID.test(assetId))throw Error('图片资产编号无效');
 const normalized=assetId.toLowerCase();
 if(IMAGE_ROLES.some(x=>draft[x].includes(normalized)))throw Error('图片重复');
 if(draft[role].length>=10)throw Error('每类图片最多10张');
 draft[role].push(normalized);
 return {...state,images:draft};
}
export function replaceDraftAsset(
 state:ProductEditorDraft,role:ImageRole,index:number,assetId:string
):ProductEditorDraft{
 const images=validateImages(state.images);
 if(!UUID.test(assetId)||!Number.isSafeInteger(index)||index<0||index>=images[role].length)
  throw Error('图片或位置无效');
 const replacement=assetId.toLowerCase(),previous=images[role][index];
 if(replacement===previous)return {...state,images};
 if(IMAGE_ROLES.some(key=>images[key].includes(replacement)))throw Error('图片重复');
 images[role][index]=replacement;
 return {...state,images};
}
export function updateSelectedImages(selected:string[],assetId:string,on:boolean):string[]{
 if(!UUID.test(assetId))throw Error('图片资产编号无效');
 const id=assetId.toLowerCase();
 return on?[...new Set([...selected,id])]:selected.filter(x=>x!==id);
}
export function removeDraftAssets(state:ProductEditorDraft,role:ImageRole,selected:string[]):ProductEditorDraft{
 const images=validateImages(state.images),ids=new Set(selected.map(x=>x.toLowerCase()));
 images[role]=images[role].filter(x=>!ids.has(x));
 return {...state,images};
}
export function moveDraftAsset(state:ProductEditorDraft,role:ImageRole,index:number,direction:-1|1):ProductEditorDraft{
 const images=validateImages(state.images),list=images[role],to=index+direction;
 if(!Number.isSafeInteger(index)||index<0||index>=list.length||to<0||to>=list.length)
  return {...state,images};
 [list[index],list[to]]=[list[to],list[index]];
 return {...state,images};
}
export function productEditorPayload(state:ProductEditorDraft,mode:'create'|'edit'):Payload{
 if(!ID(state.patternColorwayId)||!ID(state.fabricId))throw Error('请选择有效的花型版本和面料');
 if(typeof state.remark!=='string'||[...state.remark].length>5000||
  /[\p{Cc}\p{Cf}]/u.test(state.remark))throw Error('产品备注不符合要求');
 if(typeof state.isActive!=='boolean')throw Error('启停状态无效');
 if(typeof state.isAvailableForSampling!=='boolean')throw Error('供样状态无效');
 if(mode==='edit'&&!ID(state.rowVersion))throw Error('产品版本无效，请刷新后重试');
 return {patternColorwayId:state.patternColorwayId,fabricId:state.fabricId,
  remark:state.remark.trim(),isActive:state.isActive,isAvailableForSampling:state.isAvailableForSampling,images:validateImages(state.images),
  ...(mode==='edit'?{expectedRowVersion:state.rowVersion!}:{})};
}
export function parseProductDetails(raw:unknown):ProductEditorDetails{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('产品详情无效');
 const x=raw as Record<string,unknown>;
 if(!ID(x.id)||!ID(x.patternColorwayId)||!ID(x.fabricId)||!ID(x.rowVersion)||
  typeof x.masterNo!=='string'||!/^[A-Z0-9]{1,64}$/.test(x.masterNo)||
  !Number.isSafeInteger(x.colorwayNo)||Number(x.colorwayNo)<1||
  typeof x.fabricNo!=='string'||!/^[A-Z0-9]{1,64}$/.test(x.fabricNo)||
  typeof x.fabricName!=='string'||!x.fabricName||
  x.productNo!==x.masterNo+'-'+x.colorwayNo+'-'+x.fabricNo||
  typeof x.remark!=='string'||typeof x.isActive!=='boolean'||typeof x.isAvailableForSampling!=='boolean'||
  !['masterActive','colorwayActive','fabricActive'].every(k=>typeof x[k]==='boolean')||
  !(x.composition===null||typeof x.composition==='string')||
  !(x.weightValue===null&&x.weightUnit===null||
   typeof x.weightValue==='number'&&x.weightValue>0&&['gsm','mm'].includes(String(x.weightUnit)))||
  !(x.widthCm===null||typeof x.widthCm==='number'&&x.widthCm>0)||
  !(x.patternImageAssetId===null||typeof x.patternImageAssetId==='string'))
  throw Error('产品详情格式错误');
 return {...x,images:validateImages(x.images as EditorImages)} as ProductEditorDetails;
}
export class ProductEditorHttpError extends Error{
 constructor(readonly status:number,message:string){super(message);}
}
async function responseJson(res:Response):Promise<unknown>{
 if(!res.ok){
  throw new ProductEditorHttpError(res.status,
   (res.status===409?'产品组合已存在、编辑版本冲突或已开单锁定身份；请检查最新数据':
    res.status===401?'登录已失效':
    res.status===403?'没有产品管理权限':
    res.status===400?'输入内容不符合产品保存规则':
    res.status===404?'所选产品或关联资料已不存在':'产品服务暂不可用')+
    '（HTTP '+res.status+'）');
 }
 return res.json();
}
export async function loadProductForEdit(fetcher:typeof fetch,id:string,signal?:AbortSignal){
 if(!ID(id))throw Error('产品ID无效');
 return parseProductDetails(await responseJson(await fetcher('/api/v2/products/'+id,{signal})));
}
export async function saveProductDraft(
 fetcher:typeof fetch,mode:'create'|'edit',draft:ProductEditorDraft,id?:string
):Promise<ProductEditorDetails>{
 const body=productEditorPayload(draft,mode);
 if(mode==='edit'&&!ID(id))throw Error('产品ID无效');
 // A single POST or PATCH with complete ordered layout. Server tx validates identity,
 // optimistic revision, uniqueness, references and image ledger atomically.
 const res=await fetcher(mode==='create'?'/api/v2/products':'/api/v2/products/'+id,{
  method:mode==='create'?'POST':'PATCH',
  headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
 });
 return parseProductDetails(await responseJson(res));
}
export async function fetchColorwayChoices(fetcher:typeof fetch,query:string,signal?:AbortSignal):
 Promise<{items:ProductPatternChoice[];total:number;limit:number}>{
 const page:PatternPage=await fetchPatternPage(fetcher,{
  ...initialPatternFilters,number:query.trim(),limit:20,offset:0
 },signal);
 return {items:page.items.filter(x=>x.isActive).flatMap(x=>x.versions.filter(v=>v.isActive)
  .map(v=>({...v,topicTags:x.topicTags}))),
  total:page.total,limit:page.limit};
}
export async function fetchFabricChoices(fetcher:typeof fetch,query:string,signal?:AbortSignal):
 Promise<FabricCatalogPage>{
 return fetchFabricCatalog(fetcher,{...emptyFabricFilters,query:query.trim(),limit:50,offset:0},signal);
}
