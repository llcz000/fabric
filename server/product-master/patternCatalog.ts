/** P4-2 read-only server-side grouped pattern matrix for ~2000 colorways.
 * No image reassignment or colorway identity mutation. Unmounted until app integration.
 */
export class PatternCatalogError extends Error{
 constructor(message:string,readonly status:400|404=400){super(message);}
}
export interface PatternCatalogQuery{
 number:string;colorwayNo:number|null;topicTagIds:string[];colorTagIds:string[];
 includeInactive:boolean;limit:number;offset:number;
}
export interface PatternTag{id:string;name:string;isArchived:boolean}
export interface PatternVersion{
 id:string;masterId:string;colorwayNo:number;patternNo:string;
 patternImageAssetId:string|null;remark:string;isActive:boolean;colorTags:PatternTag[];
}
export interface PatternMasterPageItem{
 id:string;masterNo:string;isActive:boolean;nextColorwayNo:number;
 topicTags:PatternTag[];colorTags:PatternTag[];versions:PatternVersion[];
}
export interface PatternCatalogPage{items:PatternMasterPageItem[];total:number;limit:number;offset:number}
type Query={query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>};
type Row=Record<string,unknown>;
const MAX=18446744073709551615n;
const id=(x:unknown):string=>{
 if(typeof x==='number'&&!Number.isSafeInteger(x))throw Error('Unsafe MySQL BIGINT');
 const v=String(x);
 if(!/^[1-9]\d{0,19}$/.test(v)||BigInt(v)>MAX)throw Error('Invalid persistent ID');
 return v;
};
const rows=(x:unknown):Row[]=>{
 if(!Array.isArray(x))throw Error('Unavailable pattern rows');
 return x as Row[];
};
const integer=(x:unknown,name:string):number=>{
 const n=Number(x);
 if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid MySQL '+name);
 return n;
};
const parseIntParam=(value:unknown,name:string,defaultValue:number,min:number,max:number):number=>{
 if(value===undefined)return defaultValue;
 if(typeof value!=='string'||!/^(0|[1-9]\d*)$/.test(value)||value.length>10||
  Number(value)<min||Number(value)>max)throw new PatternCatalogError('Invalid '+name);
 return Number(value);
};
const ids=(raw:unknown):string[]=>{
 if(raw===undefined||raw==='')return [];
 if(typeof raw!=='string'||raw.length>240)throw new PatternCatalogError('Invalid tag IDs');
 const values=raw.split(',');
 if(values.length>10||values.some(v=>!v||!/^[1-9]\d{0,19}$/.test(v)||BigInt(v)>MAX))
  throw new PatternCatalogError('Invalid tag IDs');
 return [...new Set(values)];
};
export function parsePatternCatalogQuery(raw:unknown):PatternCatalogQuery{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new PatternCatalogError('Invalid filters');
 const item=raw as Record<string,unknown>;
 if(Object.keys(item).some(x=>!['number','colorwayNo','topicTagIds','colorTagIds',
  'includeInactive','limit','offset'].includes(x)))throw new PatternCatalogError('Unexpected filter');
 const q=item.number===undefined?'':item.number;
 if(typeof q!=='string'||q.length>160||/[\p{Cc}\p{Cf}]/u.test(q))
  throw new PatternCatalogError('Invalid search text');
 if(item.includeInactive!==undefined&&item.includeInactive!=='true')
  throw new PatternCatalogError('Invalid includeInactive');
 return {number:q.trim(),colorwayNo:item.colorwayNo===undefined?null:
  parseIntParam(item.colorwayNo,'colorwayNo',0,1,4294967295),
  topicTagIds:ids(item.topicTagIds),colorTagIds:ids(item.colorTagIds),
  includeInactive:item.includeInactive==='true',limit:parseIntParam(item.limit,'limit',20,1,50),
  offset:parseIntParam(item.offset,'offset',0,0,1000000)};
}
const like=(text:string)=>'%'+text.toLowerCase().replace(/[!%_]/g,x=>'!'+x)+'%';
function where(input:PatternCatalogQuery):{sql:string;params:unknown[];variant:string;variantParams:unknown[]}{
 const cond:string[]=[],params:unknown[]=[],vCond:string[]=[],vParams:unknown[]=[];
 if(!input.includeInactive){cond.push('m.is_active=1');vCond.push('c.is_active=1');}
 if(input.number){
  if(input.number.includes('-')){
   vCond.push("LOWER(CONCAT(m.master_no,'-',c.colorway_no)) LIKE ? ESCAPE '!'");
   vParams.push(like(input.number));
  }else{
   cond.push("LOWER(m.master_no) LIKE ? ESCAPE '!'");
   params.push(like(input.number));
  }
 }
 if(input.topicTagIds.length){
  cond.push('EXISTS (SELECT 1 FROM pattern_master_tag_links mt JOIN shared_tags t ON t.id=mt.tag_id '+
   "WHERE mt.master_id=m.id AND t.dimension='topic' AND mt.tag_id IN ("+
   input.topicTagIds.map(()=>'?').join(',')+'))');
  params.push(...input.topicTagIds);
 }
 if(input.colorwayNo!==null){vCond.push('c.colorway_no=?');vParams.push(input.colorwayNo);}
 if(input.colorTagIds.length){
  cond.push('EXISTS (SELECT 1 FROM pattern_master_tag_links ct JOIN shared_tags t ON t.id=ct.tag_id '+
   "WHERE ct.master_id=m.id AND t.dimension='color' AND ct.tag_id IN ("+
   input.colorTagIds.map(()=>'?').join(',')+'))');
  params.push(...input.colorTagIds);
 }
 const variant=vCond.length?' AND '+vCond.join(' AND '):'';
 if(input.number.includes('-')||input.colorwayNo!==null){
  cond.push('EXISTS (SELECT 1 FROM pattern_colorways c WHERE c.master_id=m.id'+variant+')');
  params.push(...vParams);
 }
 return {sql:' WHERE '+(cond.length?cond.join(' AND '):'1=1'),params,variant,variantParams:vParams};
}
async function batchTags(db:Query,dimension:'topic'|'color',values:string[]):Promise<Map<string,PatternTag[]>>{
 const result=new Map<string,PatternTag[]>();
 if(!values.length)return result;
 const table='pattern_master_tag_links',field='master_id';
 const [raw]=await db.query('SELECT l.'+field+' AS owner_id,t.id,t.name,t.is_archived '+
  'FROM '+table+' l JOIN shared_tags t ON t.id=l.tag_id WHERE t.dimension='+
  "'"+dimension+"'"+' AND l.'+field+' IN ('+values.map(()=>'?').join(',')+') ORDER BY l.'+field+',t.id',
  values);
 const known=new Set(values);
 for(const row of rows(raw)){
  const owner=id(row.owner_id);
  if(!known.has(owner))throw Error('Tag owner differs from requested set');
  const arr=result.get(owner)??[];
  arr.push({id:id(row.id),name:String(row.name),isArchived:Number(row.is_archived)===1});
  result.set(owner,arr);
 }
 return result;
}
/** Master count/paging first, all qualifying versions for each page master in one batch.
 * Limit is masters; one unusually large master may have many versions (no fixed version cap).
 * Caller should chunk at most 100 asset IDs per signing call.
 */
export async function searchPatternCatalog(db:Query,input:PatternCatalogQuery):Promise<PatternCatalogPage>{
 const filtered=where(input);
 const [countRaw]=await db.query('SELECT COUNT(*) AS total FROM pattern_masters m'+filtered.sql,filtered.params);
 const total=integer(rows(countRaw)[0]?.total,'catalog total');
 if(!total||input.offset>=total)return {items:[],total,limit:input.limit,offset:input.offset};
 const [masterRaw]=await db.query(
  'SELECT m.id,m.master_no,m.is_active,m.next_colorway_no FROM pattern_masters m'+filtered.sql+
  ' ORDER BY m.master_no,m.id LIMIT ? OFFSET ?',
  [...filtered.params,input.limit,input.offset]);
 const data=rows(masterRaw);
 if(data.length>input.limit)throw Error('Unbounded pattern master page');
 const ownerIds=data.map(row=>id(row.id));
 const condition='c.master_id IN ('+ownerIds.map(()=>'?').join(',')+')'+filtered.variant;
 const [variantRaw]=await db.query(
  'SELECT c.id,c.master_id,c.colorway_no,c.pattern_image_asset_id,c.remark,c.is_active,m.master_no '+
  'FROM pattern_colorways c JOIN pattern_masters m ON m.id=c.master_id WHERE '+condition+
  ' ORDER BY m.master_no,c.colorway_no,c.id',
  [...ownerIds,...filtered.variantParams]);
 const variants=rows(variantRaw),known=new Set(ownerIds),versionIds:string[]=[];
 const versionRows=new Map<string,Row[]>();
 for(const row of variants){
  const parent=id(row.master_id),colorId=id(row.id);
  if(!known.has(parent))throw Error('Unexpected colorway owner');
  versionIds.push(colorId);
  const arr=versionRows.get(parent)??[];arr.push(row);versionRows.set(parent,arr);
 }
 const [topicTags,colorTags]=await Promise.all([
  batchTags(db,'topic',ownerIds),batchTags(db,'color',ownerIds)
 ]);
 const items:PatternMasterPageItem[]=data.map(row=>{
  const parent=id(row.id),masterNo=String(row.master_no);
  return {id:parent,masterNo,isActive:Number(row.is_active)===1,
   nextColorwayNo:integer(row.next_colorway_no,'next sequence'),
   topicTags:topicTags.get(parent)??[],colorTags:colorTags.get(parent)??[],
   versions:(versionRows.get(parent)??[]).map(v=>{
    const colorwayNo=integer(v.colorway_no,'colorwayNo');
    if(!colorwayNo)throw Error('Invalid colorway number');
    const colorId=id(v.id);
    return {id:colorId,masterId:parent,colorwayNo,patternNo:masterNo+'-'+colorwayNo,
     patternImageAssetId:v.pattern_image_asset_id==null?null:String(v.pattern_image_asset_id),
     remark:String(v.remark??''),isActive:Number(v.is_active)===1,
     colorTags:colorTags.get(parent)??[]};
   })};
 });
 return {items,total,limit:input.limit,offset:input.offset};
}
/** Opened on demand: one master and all versions with their own color tags, no per-version HTTP requests. */
export async function loadPatternEditor(db:Query,masterId:string):Promise<{
 items:(PatternVersion&{masterNo:string})[];nextColorwayNo:number;
}>{
 if(!/^[1-9]\d{0,19}$/.test(masterId)||BigInt(masterId)>MAX)
  throw new PatternCatalogError('Invalid master identity');
 const [parents]=await db.query(
  'SELECT id,master_no,next_colorway_no FROM pattern_masters WHERE id=?',[masterId]);
 const parent=rows(parents)[0];if(!parent)throw new PatternCatalogError('Pattern master not found',404);
 const masterNo=String(parent.master_no),next=integer(parent.next_colorway_no,'next sequence');
 const [raw]=await db.query(
  'SELECT id,master_id,colorway_no,pattern_image_asset_id,remark,is_active FROM pattern_colorways '+
  'WHERE master_id=? ORDER BY colorway_no,id',[masterId]);
 const versions=rows(raw),colors=versions.length?await batchTags(db,'color',[masterId]):new Map<string,PatternTag[]>();
 return {nextColorwayNo:next,items:versions.map(row=>{
  const colorwayNo=integer(row.colorway_no,'colorwayNo'),colorId=id(row.id);
  if(!colorwayNo)throw Error('Invalid colorway identity');
  return {id:colorId,masterId,masterNo,colorwayNo,patternNo:masterNo+'-'+colorwayNo,
   remark:String(row.remark??''),isActive:Number(row.is_active)===1,
   patternImageAssetId:row.pattern_image_asset_id==null?null:String(row.pattern_image_asset_id),
   colorTags:colors.get(masterId)??[]};
 })};
}
