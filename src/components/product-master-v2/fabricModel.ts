/** P4-3 V2 fabric row editor/query model, isolated from legacy ProductLibrary. */
export interface FabricCatalogItem{
 id:string;fabricNo:string;fabricName:string;composition:string|null;
 weightValue:number|null;weightUnit:'gsm'|'mm'|null;widthValue:number|null;
 remark:string|null;isActive:boolean;productCount:number;
}
export interface FabricCatalogPage{
 items:FabricCatalogItem[];total:number;limit:number;offset:number;
}
export interface FabricFilters{query:string;includeInactive:boolean;limit:number;offset:number}
export type FabricAction=
 |{type:'query';value:string}
 |{type:'inactive';value:boolean}
 |{type:'page';offset:number}
 |{type:'reset'};
export const emptyFabricFilters:FabricFilters={query:'',includeInactive:false,limit:50,offset:0};
export function reduceFabricFilters(f:FabricFilters,a:FabricAction):FabricFilters{
 switch(a.type){
  case 'reset':return {...emptyFabricFilters};
  case 'page':return {...f,offset:a.offset};
  case 'query':return {...f,query:a.value,offset:0};
  case 'inactive':return {...f,includeInactive:a.value,offset:0};
 }
}
export function buildFabricCatalogUrl(filter:FabricFilters):string{
 const params=new URLSearchParams();
 if(filter.query.trim())params.set('query',filter.query.trim());
 if(filter.includeInactive)params.set('includeInactive','true');
 params.set('limit',String(filter.limit));params.set('offset',String(filter.offset));
 return '/api/v2/fabrics/catalog?'+params.toString();
}
const positiveId=(x:unknown):x is string=>typeof x==='string'&&/^[1-9]\d{0,19}$/.test(x)&&
 BigInt(x)<=18446744073709551615n;
const positive=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>0;
export function parseFabricCatalogPage(raw:unknown):FabricCatalogPage{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('面料列表格式错误');
 const data=raw as Record<string,unknown>;
 if(!Array.isArray(data.items)||!Number.isSafeInteger(data.total)||Number(data.total)<0||
  !Number.isSafeInteger(data.limit)||Number(data.limit)<1||Number(data.limit)>100||
  !Number.isSafeInteger(data.offset)||Number(data.offset)<0||
  data.items.length>Number(data.limit))throw Error('面料分页资料格式错误');
 for(const item of data.items){
  if(!item||typeof item!=='object'||Array.isArray(item))throw Error('面料资料不完整');
  const row=item as Record<string,unknown>;
  if(!positiveId(row.id)||typeof row.fabricNo!=='string'||!/^[A-Z0-9]{1,64}$/.test(row.fabricNo)||
   typeof row.fabricName!=='string'||!row.fabricName||
   !(row.composition===null||typeof row.composition==='string')||
   !(row.remark===null||typeof row.remark==='string')||
   !(row.weightValue===null&&row.weightUnit===null||
    positive(row.weightValue)&&(row.weightUnit==='gsm'||row.weightUnit==='mm'))||
   !(row.widthValue===null||positive(row.widthValue))||
   typeof row.isActive!=='boolean'||!Number.isSafeInteger(row.productCount)||Number(row.productCount)<0)
   throw Error('面料行资料无效');
 }
 return raw as FabricCatalogPage;
}
export type WeightUnit='gsm'|'mm';
export interface FabricDraft{
 fabricNo:string;fabricName:string;composition:string;weightValue:string;
 weightUnit:WeightUnit|'';widthValue:string;remark:string;isActive:boolean;
}
export type FabricPayload={
 fabricNo:string;fabricName:string;composition:string|null;
 weightValue:number|null;weightUnit:WeightUnit|null;
 widthValue:number|null;remark:string|null;isActive?:boolean;
};
export const emptyFabricDraft:FabricDraft={
 fabricNo:'',fabricName:'',composition:'',weightValue:'',weightUnit:'gsm',
 widthValue:'',remark:'',isActive:true
};
export function fabricToDraft(row:FabricCatalogItem):FabricDraft{
 return {fabricNo:row.fabricNo,fabricName:row.fabricName,
  composition:row.composition??'',weightValue:row.weightValue===null?'':String(row.weightValue),
  weightUnit:row.weightUnit??'',widthValue:row.widthValue===null?'':String(row.widthValue),
  remark:row.remark??'',isActive:row.isActive};
}
const text=(value:string,max:number,required:boolean,field:string):string|null=>{
 if(typeof value!=='string')throw Error(field+'格式错误');
 const trimmed=value.trim();
 if([...trimmed].length>max||/[\p{Cc}\p{Cf}]/u.test(trimmed)||(required&&!trimmed))
  throw Error(field+'不能为空或超过长度限制');
 return trimmed||null;
};
const decimal=(raw:string,scale:number,integerDigits:number,label:string):number|null=>{
 if(typeof raw!=='string')throw Error(label+'格式错误');
 const value=raw.trim();
 if(!value)return null;
 if(!/^\d+(?:\.\d+)?$/.test(value))throw Error(label+'必须是正数');
 const [digits,frac='']=value.split('.');
 if(digits.length>integerDigits||frac.length>scale)throw Error(label+'小数位数超过限制');
 const result=Number(value);
 if(!Number.isFinite(result)||result<=0)throw Error(label+'必须大于零');
 // Fail closed if Number stringification would change SQL DECIMAL-scale precision.
 if(!Number.isSafeInteger(Math.round(result*10**scale)))
  throw Error(label+'数值过大');
 return result;
};
export function validateFabricDraft(draft:FabricDraft,mode:'create'|'update'):FabricPayload{
 if(!draft||typeof draft!=='object')throw Error('面料表单错误');
 const fabricNo=draft.fabricNo.trim().toUpperCase();
 if(!/^[A-Z0-9]{1,64}$/.test(fabricNo))throw Error('品号仅支持字母数字，不允许横杠');
 const fabricName=text(draft.fabricName,255,true,'品名')!;
 const composition=text(draft.composition,500,false,'成分');
 const weightValue=decimal(draft.weightValue,3,9,'克重');
 const widthValue=decimal(draft.widthValue,2,10,'门幅');
 const remark=text(draft.remark,5000,false,'备注');
 if(draft.weightUnit!==''&&draft.weightUnit!=='gsm'&&draft.weightUnit!=='mm')
  throw Error('克重单位仅支持gsm/mm');
 const weightUnit=mode==='create'&&weightValue===null&&draft.weightUnit==='gsm'?null:draft.weightUnit||null;
 if((weightValue===null)!==(weightUnit===null))throw Error('克重数值与单位必须同时填写或同时留空');
 if(typeof draft.isActive!=='boolean')throw Error('启停状态错误');
 return {fabricNo,fabricName,composition,weightValue,weightUnit,widthValue,remark,
  ...(mode==='update'?{isActive:draft.isActive}:{})};
}
export class FabricHttpError extends Error{
 constructor(readonly status:number,message:string){
  super(message);
 }
}
async function json(res:Response):Promise<unknown>{
 if(!res.ok){
  // Errors are server-owned, but avoid exposing arbitrary network/SQL diagnostic text in UI.
  const body=await res.json().catch(()=>null);
  const known=body&&typeof body==='object'&&typeof (body as {error?:unknown}).error==='string'?
   String((body as {error:string}).error):'';
  const message=res.status===409?
   '面料数据冲突：品号重复、已被产品引用或其他人员已变更，请核对后再试。':
   res.status===403?'没有面料管理权限':
   res.status===401?'登录已失效':
   res.status===400?'输入资料不符合保存规则':
   res.status===404?'面料记录已不存在':'服务器暂不可用';
  // Do not print server stack/raw SQL in toast.
  void known;
  throw new FabricHttpError(res.status,message+'（HTTP '+res.status+'）');
 }
 return res.json();
}
export async function fetchFabricCatalog(fetcher:typeof fetch,filters:FabricFilters,signal?:AbortSignal){
 return parseFabricCatalogPage(await json(await fetcher(buildFabricCatalogUrl(filters),{signal})));
}
function checkFabricResult(raw:unknown):FabricCatalogItem{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('面料保存响应错误');
 const x=raw as Record<string,unknown>;
 // POST/PATCH returns Fabric without linked count; use 0 until canonical catalog refresh.
 const parsed=parseFabricCatalogPage({items:[{...x,productCount:0}],total:1,limit:1,offset:0});
 return {...parsed.items[0],productCount:0};
}
export async function createFabric(fetcher:typeof fetch,payload:FabricPayload):Promise<FabricCatalogItem>{
 const {isActive:_unused,...create}=payload;
 return checkFabricResult(await json(await fetcher('/api/v2/fabrics',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(create)
 })));
}
export async function updateFabric(fetcher:typeof fetch,id:string,payload:FabricPayload):Promise<FabricCatalogItem>{
 if(!positiveId(id))throw Error('无效面料记录');
 return checkFabricResult(await json(await fetcher('/api/v2/fabrics/'+id,{
  method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
 })));
}
export async function deleteFabric(fetcher:typeof fetch,id:string):Promise<void>{
 if(!positiveId(id))throw Error('无效面料记录');
 const result=await json(await fetcher('/api/v2/fabrics/'+id,{method:'DELETE'}));
 if(!result||typeof result!=='object'||(result as {deleted?:unknown}).deleted!==true||
  (result as {id?:unknown}).id!==id)throw Error('删除响应错误');
}
