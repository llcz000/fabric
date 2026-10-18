/** P3-5 V2 catalog searching: all filters in MySQL before paging.
 * Deliberately separate from legacy product and order-picking paths.
 * The future UI must discard stale requests; that is not a server-side capability.
 */
export class ProductSearchError extends Error {
 readonly status=400;
 constructor(message:string){super(message);}
}
export type ProductStatus='active'|'inactive'|'all';
export interface ProductSearchFilters{
 fabricId?:string;masterId?:string;
 productNo:string;fabricName:string;topicTagIds:string[];colorTagIds:string[];
 status:ProductStatus;limit:number;offset:number;
}
export interface ProductTagLabel{id:string;name:string;isArchived:boolean}
export interface ProductImageCounts{
 fabricDisplay:number;detail:number;aiEffect:number;
}
export interface CatalogProduct{
 id:string;productNo:string;patternColorwayId:string;fabricId:string;
 masterId:string;masterNo:string;colorwayNo:number;
 fabricNo:string;fabricName:string;composition:string|null;
 weightValue:number|null;weightUnit:'gsm'|'mm'|null;widthCm:number|null;
 remark:string;isActive:boolean;isAvailableForSampling:boolean;masterActive:boolean;colorwayActive:boolean;
 fabricActive:boolean;isSelectable:boolean;rowVersion:string;
 patternImageAssetId:string|null;topicTags:ProductTagLabel[];colorTags:ProductTagLabel[];
 imageCounts:ProductImageCounts;totalImages:number;
}
export interface CatalogPage{items:CatalogProduct[];total:number;limit:number;offset:number}
type Query={query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>};
type Row=Record<string,unknown>;
const MAX_ID=18446744073709551615n;
const FILTER_KEYS=new Set(['productNo','fabricName','topicTagIds','colorTagIds',
 'status','includeInactive','limit','offset','fabricId','masterId']);
const inspect=(text:unknown,key:string,max:number):string=>{
 if(text===undefined)return '';
 if(typeof text!=='string'||[...text].length>max||/[\p{Cc}\p{Cf}]/u.test(text))
  throw new ProductSearchError('Invalid '+key+' search');
 return text.trim();
};
const positiveId=(raw:unknown):string=>{
 if(typeof raw==='number'&&!Number.isSafeInteger(raw))
  throw new Error('Unsafe database identity');
 const text=String(raw);
 if(!/^[1-9][0-9]{0,19}$/.test(text)||BigInt(text)>MAX_ID)
  throw new ProductSearchError('Invalid tag identity');
 return text;
};
function selectedTags(raw:unknown,label:string):string[]{
 if(raw===undefined||raw==='')return [];
 if(typeof raw!=='string'||[...raw].length>256)
  throw new ProductSearchError('Invalid '+label);
 const value=raw.split(',');
 if(value.length>10||value.some(v=>!v))
  throw new ProductSearchError('Invalid '+label);
 const unique=[...new Set(value.map(x=>positiveId(x)))];
 if(unique.length>10)throw new ProductSearchError('Too many '+label);
 return unique;
}
function page(raw:unknown,key:string,fallback:number,min:number,max:number):number{
 if(raw===undefined)return fallback;
 if(typeof raw!=='string'||!/^(0|[1-9][0-9]*)$/.test(raw)||
    raw.length>8||Number(raw)<min||Number(raw)>max)
  throw new ProductSearchError('Invalid '+key);
 return Number(raw);
}
/** HTTP query parser: no arbitrarily typed request objects or raw SQL fragments. */
export function parseProductSearchQuery(input:unknown):ProductSearchFilters{
 if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(k=>!FILTER_KEYS.has(k)))
  throw new ProductSearchError('Invalid product search');
 const raw=input as Record<string,unknown>;
 if(raw.fabricId!==undefined&&typeof raw.fabricId!=='string')throw new ProductSearchError('Invalid fabric identity');
 if(raw.masterId!==undefined&&typeof raw.masterId!=='string')throw new ProductSearchError('Invalid master identity');
 if(raw.includeInactive!==undefined&&raw.includeInactive!=='true')
  throw new ProductSearchError('Invalid includeInactive');
 if(raw.includeInactive!==undefined&&raw.status!==undefined)
  throw new ProductSearchError('Ambiguous status filter');
 const status=raw.status??(raw.includeInactive==='true'?'all':'active');
 if(status!=='active'&&status!=='inactive'&&status!=='all')
  throw new ProductSearchError('Invalid status filter');
 return {
  ...(raw.fabricId===undefined?{}:{fabricId:positiveId(raw.fabricId)}),
  ...(raw.masterId===undefined?{}:{masterId:positiveId(raw.masterId)}),
  productNo:inspect(raw.productNo,'productNo',160),
  fabricName:inspect(raw.fabricName,'fabricName',255),
  topicTagIds:selectedTags(raw.topicTagIds,'topicTagIds'),
  colorTagIds:selectedTags(raw.colorTagIds,'colorTagIds'),
  status,limit:page(raw.limit,'limit',50,1,100),
  offset:page(raw.offset,'offset',0,0,1000000)
 };
}
function rows(raw:unknown):Row[]{
 if(!Array.isArray(raw))throw Error('Invalid product catalog result');
 return raw as Row[];
}
function int(raw:unknown,label:string):number{
 const n=Number(raw);
 if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid '+label+' from database');
 return n;
}
function boolean(raw:unknown):boolean{
 if(Number(raw)!==0&&Number(raw)!==1)throw Error('Invalid product status from database');
 return Number(raw)===1;
}
const distinct=(values:unknown[]):string[]=>[...new Set(values.map(positiveId))];
function escapeLike(text:string):string{
 return '%'+text.replace(/[!%_]/g,ch=>'!'+ch)+'%';
}
function queryConditions(filter:ProductSearchFilters):{sql:string;params:unknown[]}{
 const conditions:string[]=[];const params:unknown[]=[];
 if(filter.fabricId){conditions.push('p.fabric_id=?');params.push(filter.fabricId);}
 if(filter.masterId){conditions.push('m.id=?');params.push(filter.masterId);}
 if(filter.status!=='all'){
  conditions.push('p.is_active=?');params.push(filter.status==='active'?1:0);
 }
 if(filter.productNo){
  conditions.push("LOWER(p.product_no) LIKE ? ESCAPE '!'");
  params.push(escapeLike(filter.productNo.toLowerCase()));
 }
 if(filter.fabricName){
  conditions.push("LOWER(f.fabric_name) LIKE ? ESCAPE '!'");
  params.push(escapeLike(filter.fabricName.toLowerCase()));
 }
 if(filter.topicTagIds.length){
  conditions.push("EXISTS (SELECT 1 FROM pattern_master_tag_links mt "+
   "JOIN shared_tags t ON t.id=mt.tag_id WHERE mt.master_id=m.id "+
   "AND t.dimension='topic' AND mt.tag_id IN ("+filter.topicTagIds.map(()=>'?').join(',')+'))');
  params.push(...filter.topicTagIds);
 }
 if(filter.colorTagIds.length){
  conditions.push("EXISTS (SELECT 1 FROM pattern_master_tag_links ct "+
   "JOIN shared_tags t ON t.id=ct.tag_id WHERE ct.master_id=m.id "+
   "AND t.dimension='color' AND ct.tag_id IN ("+filter.colorTagIds.map(()=>'?').join(',')+'))');
  params.push(...filter.colorTagIds);
 }
 return {sql:' WHERE '+(conditions.length?conditions.join(' AND '):'1=1'),params};
}
const JOINS=' FROM v2_products p JOIN pattern_colorways c ON c.id=p.pattern_colorway_id'+
 ' JOIN pattern_masters m ON m.id=c.master_id JOIN v2_fabrics f ON f.id=p.fabric_id';
const FIELDS='p.id,p.pattern_colorway_id,p.fabric_id,p.product_no,p.remark,p.is_active,p.is_available_for_sampling,p.row_version,'+
 'c.master_id,c.colorway_no,c.pattern_image_asset_id,m.master_no,'+
 'f.fabric_no,f.fabric_name,f.composition,f.weight_value,f.weight_unit,f.width_value,'+
 'm.is_active AS master_active,c.is_active AS colorway_active,f.is_active AS fabric_active';
async function labels(db:Query,dimension:'topic'|'color',ids:string[]):Promise<Map<string,ProductTagLabel[]>>{
 const result=new Map<string,ProductTagLabel[]>();
 if(ids.length===0)return result;
 const topic=dimension==='topic';
 const link='pattern_master_tag_links';
 const key='master_id';
 const [raw]=await db.query(
  'SELECT l.'+key+' AS owner_id,t.id,t.name,t.is_archived FROM '+link+
  " l JOIN shared_tags t ON t.id=l.tag_id WHERE t.dimension='"+dimension+"' AND l."+
  key+' IN ('+ids.map(()=>'?').join(',')+') ORDER BY l.'+key+',t.name,t.id',
  ids);
 const allowed=new Set(ids);
 for(const row of rows(raw)){
  const owner=positiveId(row.owner_id),identity=positiveId(row.id);
  if(!allowed.has(owner))throw Error('Tag query returned unrelated owner');
  const arr=result.get(owner)??[];
  arr.push({id:identity,name:String(row.name),isArchived:boolean(row.is_archived)});
  result.set(owner,arr);
 }
 return result;
}
async function counts(db:Query,ids:string[]):Promise<Map<string,ProductImageCounts>>{
 const result=new Map<string,ProductImageCounts>();
 if(ids.length===0)return result;
 const [raw]=await db.query(
  'SELECT product_id,role,COUNT(*) AS image_count FROM v2_product_image_assets '+
  'WHERE deleted_at IS NULL AND product_id IN ('+ids.map(()=>'?').join(',')+
  ') GROUP BY product_id,role',ids);
 const allowed=new Set(ids);
 for(const row of rows(raw)){
  const owner=positiveId(row.product_id);
  if(!allowed.has(owner))throw Error('Image counts returned unrelated product');
  const item=result.get(owner)??{fabricDisplay:0,detail:0,aiEffect:0};
  const count=int(row.image_count,'image count');
  switch(row.role){
   case 'fabric_display':item.fabricDisplay=count;break;
   case 'detail':item.detail=count;break;
   case 'ai_effect':item.aiEffect=count;break;
   default:throw Error('Unexpected image role');
  }
  result.set(owner,item);
 }
 return result;
}
/** SQL-side filters then bounded page; page-only batched labels and image counts. */
export async function searchProductCatalog(db:Query,filter:ProductSearchFilters):Promise<CatalogPage>{
 // Always call parseProductSearchQuery in public HTTP routes; internal code receives parsed input.
 const {sql,params}=queryConditions(filter);
 const [totalRaw]=await db.query('SELECT COUNT(*) AS total'+JOINS+sql,params);
 const total=int(rows(totalRaw)[0]?.total,'total');
 if(total===0||filter.offset>=total)return {items:[],total,limit:filter.limit,offset:filter.offset};
 const [raw]=await db.query('SELECT '+FIELDS+JOINS+sql+
  ' ORDER BY p.product_no ASC,p.id ASC LIMIT ? OFFSET ?',
  [...params,filter.limit,filter.offset]);
 const data=rows(raw),ids=distinct(data.map(row=>row.id));
 if(data.length>filter.limit)throw Error('Unexpected unbounded product result');
 const [topic,color,images]=await Promise.all([
  labels(db,'topic',distinct(data.map(row=>row.master_id))),
  labels(db,'color',distinct(data.map(row=>row.master_id))),
  counts(db,ids)
 ]);
 const items:CatalogProduct[]=data.map(row=>{
  const productId=positiveId(row.id);
  const imageCounts=images.get(productId)??{fabricDisplay:0,detail:0,aiEffect:0};
  const isActive=boolean(row.is_active),isAvailableForSampling=boolean(row.is_available_for_sampling),masterActive=boolean(row.master_active);
  const colorwayActive=boolean(row.colorway_active),fabricActive=boolean(row.fabric_active);
  const colorwayNo=int(row.colorway_no,'colorway number');
  if(colorwayNo<1)throw Error('Invalid colorway number');
  let weightUnit:'gsm'|'mm'|null=null;
  if(row.weight_unit!=null){
   if(row.weight_unit!=='gsm'&&row.weight_unit!=='mm')throw Error('Invalid weight unit');
   weightUnit=row.weight_unit;
  }
  return {
   id:productId,productNo:String(row.product_no),patternColorwayId:positiveId(row.pattern_colorway_id),
   fabricId:positiveId(row.fabric_id),masterId:positiveId(row.master_id),masterNo:String(row.master_no),
   colorwayNo,fabricNo:String(row.fabric_no),fabricName:String(row.fabric_name),
   composition:row.composition==null?null:String(row.composition),
   weightValue:row.weight_value==null?null:Number(row.weight_value),
   weightUnit,widthCm:row.width_value==null?null:Number(row.width_value),
   remark:row.remark==null?'':String(row.remark),isActive,isAvailableForSampling,masterActive,colorwayActive,fabricActive,
   isSelectable:isActive&&masterActive&&colorwayActive&&fabricActive,
   rowVersion:positiveId(row.row_version),
   patternImageAssetId:row.pattern_image_asset_id==null?null:String(row.pattern_image_asset_id),
   topicTags:topic.get(positiveId(row.master_id))??[],
   colorTags:color.get(positiveId(row.master_id))??[],
   imageCounts,totalImages:imageCounts.fabricDisplay+imageCounts.detail+imageCounts.aiEffect
  };
 });
 return {items,total,limit:filter.limit,offset:filter.offset};
}
