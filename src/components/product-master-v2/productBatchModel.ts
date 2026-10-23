import type {ProductPatternChoice} from './productEditorModel';
import type {FabricCatalogItem} from './fabricModel';

const validId=(value:unknown):value is string=>typeof value==='string'&&/^[1-9][0-9]{0,19}$/.test(value)&&BigInt(value)<=18446744073709551615n;
/** Read every colorway from one master, not the abbreviated catalogue row. */
export async function loadBatchMasterVersions(fetcher:typeof fetch,masterId:string):Promise<ProductPatternChoice[]>{
 if(!validId(masterId))throw Error('无效花型母版号');
 const res=await fetcher('/api/v2/pattern-masters/'+masterId+'/colorway-details');
 if(!res.ok)throw Error('无法读取该花型的完整配色资料');
 const payload=await res.json() as {items?:unknown};
 if(!payload||!Array.isArray(payload.items))throw Error('配色资料格式错误');
 const items:ProductPatternChoice[]=[];
 for(const raw of payload.items){
  if(!raw||typeof raw!=='object')throw Error('配色资料格式错误');
  const v=raw as Record<string,unknown>;
  if(!validId(v.id)||v.masterId!==masterId||typeof v.masterNo!=='string'||
   !/^G[0-9]+$/.test(v.masterNo)||!Number.isSafeInteger(v.colorwayNo)||Number(v.colorwayNo)<1||
   v.patternNo!==v.masterNo+'-'+v.colorwayNo||typeof v.isActive!=='boolean')
   throw Error('配色资料校验失败');
  if(v.isActive)items.push({
   ...(v as unknown as ProductPatternChoice),
   topicTags:[],
   colorTags:Array.isArray(v.colorTags)?v.colorTags:[],
  });
 }
 return items.sort((a,b)=>a.colorwayNo-b.colorwayNo);
}

export interface BatchPreviewItem{patternColorwayId:string;productNo:string;existing:boolean;id?:string}
export interface BatchSaveItem{patternColorwayId:string;productNo:string;id:string}
export interface BatchSaveResult{created:BatchSaveItem[];skipped:BatchSaveItem[]}
export function toggleBatchVersion(current:ProductPatternChoice[],next:ProductPatternChoice,max=20):ProductPatternChoice[]{
 if(current.some(v=>v.id===next.id))return current.filter(v=>v.id!==next.id);
 if(current.length>=max)throw Error('每次最多创建20个配色产品');
 return [...current,next];
}
function payload(selected:ProductPatternChoice[],fabric:FabricCatalogItem|null){
 if(!fabric||!validId(fabric.id)||!fabric.isActive)throw Error('请选择启用中的面料');
 if(!selected.length||selected.length>20||selected.some(v=>!validId(v.id)||!v.isActive)||
   new Set(selected.map(v=>v.id)).size!==selected.length)throw Error('请选择1至20个有效配色');
 return {colorwayIds:selected.map(v=>v.id),fabricId:fabric.id};
}
const getJson=async(res:Response)=>{
 if(!res.ok)throw Error(res.status===409?'资料已发生变化或组合冲突，请重新预览':res.status===403?'没有创建产品权限':'产品批量操作失败（HTTP '+res.status+'）');
 return res.json() as Promise<unknown>;
};
function parseLine(raw:unknown):raw is BatchPreviewItem&{id?:string}{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
 const v=raw as Record<string,unknown>;
 return validId(v.patternColorwayId)&&typeof v.productNo==='string'&&v.productNo.length>2&&
  typeof v.existing==='boolean'&&(v.id===undefined||validId(v.id));
}
export async function previewProductBatch(fetcher:typeof fetch,selected:ProductPatternChoice[],fabric:FabricCatalogItem|null){
 const body=payload(selected,fabric),raw=await getJson(await fetcher('/api/v2/products/batch/preview',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
 }));
 if(!raw||typeof raw!=='object'||!Array.isArray((raw as {items?:unknown}).items))throw Error('批量预览返回无效');
 const items=(raw as {items:unknown[]}).items;
 if(items.length!==selected.length||!items.every(parseLine)||items.some((v,i)=>(v as BatchPreviewItem).patternColorwayId!==selected[i].id))
  throw Error('批量预览与选择不一致，请重新预览');
 return items as BatchPreviewItem[];
}
export async function saveProductBatch(fetcher:typeof fetch,selected:ProductPatternChoice[],fabric:FabricCatalogItem|null):Promise<BatchSaveResult>{
 const body=payload(selected,fabric),raw=await getJson(await fetcher('/api/v2/products/batch',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
 }));
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('批量保存结果不明确，请检查产品库');
 const value=raw as Record<string,unknown>;
 if(!Array.isArray(value.created)||!Array.isArray(value.skipped)||
  [...value.created,...value.skipped].length!==selected.length||
  ![...value.created,...value.skipped].every(v=>parseLine({...v,existing:true})&&validId((v as {id?:unknown}).id)))
  throw Error('批量保存结果不明确，请检查产品库');
 return value as unknown as BatchSaveResult;
}
