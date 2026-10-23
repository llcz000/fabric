/** P4-2 V2 grouped mother-pattern/colorway UI contract; no legacy product migration. */
import type {CatalogTag} from './catalogModel';
export type PatternFilterAction=
 |{type:'number'|'colorwayNo';value:string}
 |{type:'topic'|'color';id:string}
 |{type:'includeInactive';value:boolean}
 |{type:'sort';value:'numberAsc'|'numberDesc'}
 |{type:'page';offset:number}
 |{type:'reset'};
export interface PatternFilters{
 number:string;colorwayNo:string;topicTagIds:string[];colorTagIds:string[];
 includeInactive:boolean;sort:'newest'|'numberAsc'|'numberDesc';limit:number;offset:number;
}
export interface PatternVersionItem{
 id:string;masterId:string;colorwayNo:number;patternNo:string;
 patternImageAssetId:string|null;remark:string;isActive:boolean;colorTags:CatalogTag[];
}
export interface PatternMasterItem{
 id:string;masterNo:string;isActive:boolean;nextColorwayNo:number;
 topicTags:CatalogTag[];colorTags?:CatalogTag[];versions:PatternVersionItem[];
}
export interface PatternPage{items:PatternMasterItem[];total:number;totalColorways?:number;limit:number;offset:number}
export const initialPatternFilters:PatternFilters={
 number:'',colorwayNo:'',topicTagIds:[],colorTagIds:[],includeInactive:false,sort:'newest',limit:20,offset:0
};
export function reducePatternFilters(state:PatternFilters,action:PatternFilterAction):PatternFilters{
 if(action.type==='reset')return {...initialPatternFilters,topicTagIds:[],colorTagIds:[]};
 if(action.type==='page')return {...state,offset:action.offset};
 if(action.type==='number'||action.type==='colorwayNo')return {...state,[action.type]:action.value,offset:0};
 if(action.type==='includeInactive')return {...state,includeInactive:action.value,offset:0};
 if(action.type==='sort')return {...state,sort:action.value,offset:0};
 if(action.type==='topic'||action.type==='color'){
  const key=action.type==='topic'?'topicTagIds':'colorTagIds',items=state[key];
  if(!items.includes(action.id)&&items.length>=10)return state;
  return {...state,[key]:items.includes(action.id)?items.filter(x=>x!==action.id):[...items,action.id],offset:0};
 }
 return state;
}
export function buildPatternUrl(base:string,filters:PatternFilters):string{
 const q=new URLSearchParams();
 if(filters.number.trim())q.set('number',filters.number.trim());
 if(filters.colorwayNo.trim())q.set('colorwayNo',filters.colorwayNo.trim());
 if(filters.topicTagIds.length)q.set('topicTagIds',filters.topicTagIds.join(','));
 if(filters.colorTagIds.length)q.set('colorTagIds',filters.colorTagIds.join(','));
 if(filters.includeInactive)q.set('includeInactive','true');
 if(filters.sort!=='newest')q.set('sort',filters.sort);
 q.set('limit',String(filters.limit));q.set('offset',String(filters.offset));
 return base+'?'+q.toString();
}
const goodId=(input:unknown):input is string=>typeof input==='string'&&/^[1-9]\d{0,19}$/.test(input)&&BigInt(input)<=18446744073709551615n;
const obj=(input:unknown):Record<string,unknown>=>{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('花型资料响应错误');
 return input as Record<string,unknown>;
};
function tags(input:unknown):input is CatalogTag[]{
 return Array.isArray(input)&&input.length<=10&&input.every(t=>t&&goodId(t.id)&&
  typeof t.name==='string'&&typeof t.isArchived==='boolean');
}
function version(input:unknown,masterId:string,masterNo:string):PatternVersionItem{
 const v=obj(input);
 if(!goodId(v.id)||v.masterId!==masterId||!Number.isSafeInteger(v.colorwayNo)||
  Number(v.colorwayNo)<1||Number(v.colorwayNo)>4294967295||
  v.patternNo!==masterNo+'-'+v.colorwayNo||
  !(v.patternImageAssetId===null||typeof v.patternImageAssetId==='string')||
  typeof v.remark!=='string'||typeof v.isActive!=='boolean'||!tags(v.colorTags))
  throw Error('无效的配色版本资料');
 return v as unknown as PatternVersionItem;
}
export function parsePatternPage(input:unknown):PatternPage{
 const page=obj(input);
 if(page.totalColorways!==undefined&&(!Number.isSafeInteger(page.totalColorways)||Number(page.totalColorways)<0))throw Error('无效的配色统计');
 if(!Array.isArray(page.items)||!Number.isSafeInteger(page.total)||Number(page.total)<0||
  !Number.isSafeInteger(page.limit)||Number(page.limit)<1||Number(page.limit)>50||
  !Number.isSafeInteger(page.offset)||Number(page.offset)<0||
  page.items.length>Number(page.limit))throw Error('无效的花型分页资料');
 for(const item of page.items){
  const m=obj(item);
  if(!goodId(m.id)||typeof m.masterNo!=='string'||!/^[A-Z0-9]{1,64}$/.test(m.masterNo)||
   typeof m.isActive!=='boolean'||!Number.isSafeInteger(m.nextColorwayNo)||
   Number(m.nextColorwayNo)<1||!tags(m.topicTags)||(m.colorTags!==undefined&&!tags(m.colorTags))||!Array.isArray(m.versions))
   throw Error('无效的花型母版');
  const ids=new Set<string>(),numbers=new Set<number>();
  for(const entry of m.versions){
   const v=version(entry,m.id as string,m.masterNo as string);
   if(ids.has(v.id)||numbers.has(v.colorwayNo))throw Error('重复配色版本');
   ids.add(v.id);numbers.add(v.colorwayNo);
  }
 }
 return input as PatternPage;
}
async function responseJson(res:Response):Promise<unknown>{
 if(!res.ok)throw Error('花型接口请求失败 (HTTP '+res.status+')');
 return res.json();
}
export async function fetchPatternPage(fetcher:typeof fetch,filters:PatternFilters,signal?:AbortSignal):Promise<PatternPage>{
 return parsePatternPage(await responseJson(await fetcher(buildPatternUrl('/api/v2/pattern-catalog',filters),{signal})));
}
export interface PatternEditorLoad{items:PatternVersionItem[];nextColorwayNo:number}
export async function fetchMasterColorways(apiFetch:typeof fetch,master:PatternMasterItem,signal?:AbortSignal):Promise<PatternEditorLoad>{
 const raw=obj(await responseJson(await apiFetch('/api/v2/pattern-masters/'+master.id+'/colorway-details',{signal})));
 if(!Array.isArray(raw.items)||!Number.isSafeInteger(raw.nextColorwayNo)||Number(raw.nextColorwayNo)<1)
  throw Error('配色编辑响应错误');
 const items=raw.items.map(v=>{
  const source=obj(v);
  if(source.masterNo!==master.masterNo)throw Error('配色所属母版错误');
  return version(source,master.id,master.masterNo);
 });
 return {items,nextColorwayNo:Number(raw.nextColorwayNo)};
}
/** Inline custom colors are prevalidated but persistent normalized uniqueness
 * and archived-link rules are always checked in the same server transaction.
 */
export function addColorTagChoice(options:CatalogTag[],tagIds:string[],newColorTags:string[],raw:string):
 {tagIds:string[];newColorTags:string[]}{
 if(typeof raw!=='string')throw Error('颜色标签名称无效');
 const name=raw.trim(),normalized=name.normalize('NFKC').toLowerCase().trim();
 if(!name||/[\p{Cc}\p{Cf}]/u.test(name))throw Error('颜色标签不能为空');
 if([...name].length>32||[...normalized].length>64)throw Error('颜色标签最多32字');
 if(tagIds.length+newColorTags.length>=10)throw Error('每个花型最多10个颜色标签');
 const matched=options.find(x=>x.name.normalize('NFKC').toLowerCase().trim()===normalized);
 if(matched){
  if(matched.isArchived)throw Error('归档颜色标签不能新增关联');
  if(tagIds.includes(matched.id))throw Error('重复颜色标签');
  return {tagIds:[...tagIds,matched.id],newColorTags:[...newColorTags]};
 }
 if(newColorTags.some(x=>x.normalize('NFKC').toLowerCase().trim()===normalized))
  throw Error('重复颜色标签');
 return {tagIds:[...tagIds],newColorTags:[...newColorTags,name]};
}
function validateCustomColorNames(names:string[],tagIds?:string[]):void{
 if(!Array.isArray(names)||tagIds===undefined||names.length+tagIds.length>10)
  throw Error('无效自定义颜色标签');
 const normalized=new Set<string>();
 for(const name of names){
  if(typeof name!=='string'||![...name.trim()].length||[...name.trim()].length>32||
   /[\p{Cc}\p{Cf}]/u.test(name))throw Error('无效自定义颜色标签');
  const value=name.trim().normalize('NFKC').toLowerCase().trim();
  if(!value||normalized.has(value))throw Error('重复自定义颜色标签');
  normalized.add(value);
 }
}
export async function createNextColorway(
 apiFetch:typeof fetch,masterId:string,details:{remark?:string;isActive?:boolean;tagIds?:string[];newColorTags?:string[];patternImageAssetId?:string|null}
):Promise<PatternVersionItem>{
 if(!goodId(masterId))throw Error('无效母版');
 if(details.tagIds!==undefined)validColorTagIds(details.tagIds);
 if(details.newColorTags!==undefined)validateCustomColorNames(details.newColorTags,details.tagIds);
 const result=obj(await responseJson(await apiFetch('/api/v2/pattern-masters/'+masterId+'/colorways',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...details,isActive:undefined})
 })));
 if(typeof result.masterNo!=='string')throw Error('创建配色未返回母版号');
 return version({...result,colorTags:[]},masterId,result.masterNo);
}
function validColorTagIds(tagIds:string[]):void{
 if(!Array.isArray(tagIds)||tagIds.length>10||new Set(tagIds).size!==tagIds.length||!tagIds.every(goodId))
  throw Error('无效颜色标签');
}
export async function saveColorwayProperties(
 apiFetch:typeof fetch,original:PatternVersionItem,
 patch:{remark:string;isActive:boolean;tagIds?:string[];newColorTags?:string[];patternImageAssetId?:string|null}
):Promise<void>{
 if(!goodId(original.id)||typeof patch.remark!=='string'||[...patch.remark].length>500||
  typeof patch.isActive!=='boolean')throw Error('无效配色属性');
 if(patch.tagIds!==undefined)validColorTagIds(patch.tagIds);
 if(patch.newColorTags!==undefined)validateCustomColorNames(patch.newColorTags,patch.tagIds);
 await responseJson(await apiFetch('/api/v2/pattern-colorways/'+original.id,{
  method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...patch,isActive:undefined})
 }));
}
export async function fetchMasterColorTags(apiFetch:typeof fetch,masterId:string):Promise<CatalogTag[]>{
 if(!goodId(masterId))throw Error('无效花型');
 const result=obj(await responseJson(await apiFetch('/api/v2/pattern-masters/'+masterId+'/color-tags')));
 if(!tags(result.items))throw Error('无效颜色标签');
 return result.items;
}
export async function saveMasterColorTags(apiFetch:typeof fetch,masterId:string,tagIds:string[],newColorTags:string[]=[]):Promise<string[]>{
 if(!goodId(masterId))throw Error('无效花型');validColorTagIds(tagIds);
 validateCustomColorNames(newColorTags,tagIds);
 const result=obj(await responseJson(await apiFetch('/api/v2/pattern-masters/'+masterId+'/color-tags',{
  method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({tagIds,newColorTags})
 })));
 validColorTagIds(result.tagIds as string[]);return result.tagIds as string[];
}
export async function saveVersionTags(apiFetch:typeof fetch,colorwayId:string,tagIds:string[]):Promise<void>{
 if(!goodId(colorwayId)||tagIds.length>10||new Set(tagIds).size!==tagIds.length||!tagIds.every(goodId))
  throw Error('无效颜色标签');
 await responseJson(await apiFetch('/api/v2/pattern-colorways/'+colorwayId+'/tags',{
  method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({tagIds})
 }));
}
export async function saveMasterTopicTags(apiFetch:typeof fetch,masterId:string,tagIds:string[]):Promise<void>{
 if(!goodId(masterId)||tagIds.length>10||new Set(tagIds).size!==tagIds.length||!tagIds.every(goodId))
  throw Error('无效题材标签');
 await responseJson(await apiFetch('/api/v2/pattern-masters/'+masterId+'/tags',{
  method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({tagIds})
 }));
}
export async function deleteUnreferencedColorway(apiFetch:typeof fetch,id:string):Promise<void>{
 if(!goodId(id))throw Error('无效配色');
 await responseJson(await apiFetch('/api/v2/pattern-colorways/'+id,{method:'DELETE'}));
}
export async function patchMasterStatus(apiFetch:typeof fetch,masterId:string,isActive:boolean):Promise<void>{
 if(!goodId(masterId))throw Error('无效母版');
 await responseJson(await apiFetch('/api/v2/pattern-masters/'+masterId,{
  method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({isActive})
 }));
}
