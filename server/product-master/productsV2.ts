import type {AppPrincipal} from '../access/types';
import {canManageProducts} from '../access/policy';
import type {Pool} from '../order-v2/lines';

/** P3-4 standalone V2 product catalog. Deliberately not mounted on server.ts. */
export class V2ProductError extends Error {
 constructor(message:string,readonly status:400|401|403|404|409=400){super(message);}
}
type Row=Record<string,unknown>;
type Query={query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>};
export type V2ImageRole='fabric_display'|'detail'|'ai_effect';
export type ProductImages={fabricDisplay:string[];detail:string[];aiEffect:string[]};
export interface V2Product{
 id:string;patternColorwayId:string;fabricId:string;masterNo:string;colorwayNo:number;
 fabricNo:string;fabricName:string;composition:string|null;weightValue:number|null;
 weightUnit:'gsm'|'mm'|null;widthCm:number|null;patternImageAssetId:string|null;
 productNo:string;remark:string;isActive:boolean;isAvailableForSampling:boolean;rowVersion:string;
 masterActive:boolean;colorwayActive:boolean;fabricActive:boolean;images:ProductImages;
}
type Patch={patternColorwayId?:string;fabricId?:string;remark?:string;isActive?:boolean;isAvailableForSampling?:boolean;images?:ProductImages;expectedRowVersion?:string};
const MAX_ID=18446744073709551615n;
const emptyImages=():ProductImages=>({fabricDisplay:[],detail:[],aiEffect:[]});
function id(input:unknown):asserts input is string{
 if(typeof input!=='string'||!/^[1-9][0-9]{0,19}$/.test(input)||BigInt(input)>MAX_ID)
  throw new V2ProductError('Invalid identity');
}
function sqlId(raw:unknown):string {
 if(typeof raw==='number'&&!Number.isSafeInteger(raw))throw Error('Unsafe BIGINT identity');
 const text=String(raw);id(text);return text;
}
function version(raw:unknown):string{
 if(typeof raw!=='string'||!/^[1-9][0-9]{0,19}$/.test(raw)||BigInt(raw)>MAX_ID)
  throw new V2ProductError('Invalid product revision');
 return raw;
}
function rows(raw:unknown):Row[]{
 if(!Array.isArray(raw))throw Error('Product rows unavailable');
 return raw as Row[];
}
function remark(raw:unknown):string{
 if(typeof raw!=='string'||[...raw].length>5000||/[\p{Cc}\p{Cf}]/u.test(raw))
  throw new V2ProductError('Invalid product remark');
 return raw.trim();
}
const roleKeys:{key:keyof ProductImages;role:V2ImageRole}[]=[
 {key:'fabricDisplay',role:'fabric_display'}, {key:'detail',role:'detail'},
 {key:'aiEffect',role:'ai_effect'}
];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function layout(value:unknown):ProductImages{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new V2ProductError('Invalid images');
 const raw=value as Record<string,unknown>;
 if(Object.keys(raw).some(k=>!roleKeys.some(r=>r.key===k))||
    roleKeys.some(r=>!Array.isArray(raw[r.key])))throw new V2ProductError('Invalid image categories');
 const seen=new Set<string>();const result=emptyImages();
 for(const {key} of roleKeys){
  const ids=raw[key] as unknown[];
  if(ids.length>10)throw new V2ProductError('At most ten images per category');
  for(const asset of ids){
   if(typeof asset!=='string'||!UUID.test(asset)||seen.has(asset.toLowerCase()))
    throw new V2ProductError('Invalid or duplicate image identity');
   seen.add(asset.toLowerCase());result[key].push(asset.toLowerCase());
  }
 }
 return result;
}
function parse(body:unknown,create:boolean):Patch{
 if(!body||typeof body!=='object'||Array.isArray(body))throw new V2ProductError('Invalid product fields');
 const obj=body as Record<string,unknown>;
 const allowed=['patternColorwayId','fabricId','remark','isActive','isAvailableForSampling','images',
  ...(create?[]:['expectedRowVersion'])];
 if(Object.keys(obj).some(key=>!allowed.includes(key)))throw new V2ProductError('Unknown product field');
 if(create&&(!('patternColorwayId' in obj)||!('fabricId' in obj))||
   !create&&!('expectedRowVersion' in obj))throw new V2ProductError('Missing product identity or revision');
 const output:Patch={};
 if('patternColorwayId' in obj){id(obj.patternColorwayId);output.patternColorwayId=obj.patternColorwayId;}
 if('fabricId' in obj){id(obj.fabricId);output.fabricId=obj.fabricId;}
 if('remark' in obj)output.remark=remark(obj.remark);
 if('isActive' in obj){
  if(typeof obj.isActive!=='boolean')throw new V2ProductError('Invalid product status');
  output.isActive=obj.isActive;
 }
 if('isAvailableForSampling' in obj){
  if(typeof obj.isAvailableForSampling!=='boolean')throw new V2ProductError('Invalid sampling availability');
  output.isAvailableForSampling=obj.isAvailableForSampling;
 }
 if('images' in obj)output.images=layout(obj.images);
 if('expectedRowVersion' in obj)output.expectedRowVersion=version(obj.expectedRowVersion);
 return output;
}
function dbVersion(raw:unknown):string {
 if(typeof raw==='number'&&!Number.isSafeInteger(raw))throw Error('Unsafe row revision');
 return version(String(raw));
}
function product(row:Row,images:ProductImages):V2Product{
 const n=Number(row.colorway_no);
 if(!Number.isSafeInteger(n)||n<1||n>4294967295)throw Error('Invalid colorway number');
 return {
  id:sqlId(row.id),patternColorwayId:sqlId(row.pattern_colorway_id),
  fabricId:sqlId(row.fabric_id),masterNo:String(row.master_no),colorwayNo:n,
  fabricNo:String(row.fabric_no),fabricName:String(row.fabric_name),
  composition:row.composition==null?null:String(row.composition),
  weightValue:row.weight_value==null?null:Number(row.weight_value),
  weightUnit:row.weight_unit==null?null:row.weight_unit as 'gsm'|'mm',
  widthCm:row.width_value==null?null:Number(row.width_value),
  patternImageAssetId:row.pattern_image_asset_id==null?null:String(row.pattern_image_asset_id),
  productNo:String(row.product_no),remark:String(row.remark??''),isActive:Number(row.is_active)===1,
  isAvailableForSampling:Number(row.is_available_for_sampling)===1,
  rowVersion:dbVersion(row.row_version),masterActive:Number(row.master_active)===1,
  colorwayActive:Number(row.colorway_active)===1,fabricActive:Number(row.fabric_active)===1,images
 };
}
async function authorize(db:Query,actor:AppPrincipal):Promise<void>{
 if(!actor?.userId||!actor.sessionId)throw new V2ProductError('Authentication required',401);
 const [u]=await db.query('SELECT id,role,is_active,can_manage_products FROM v2_access_users WHERE id=? FOR SHARE',[actor.userId]);
 const user=rows(u)[0];
 if(!user||user.role!==actor.role||Number(user.is_active)!==1)
  throw new V2ProductError('Authentication required',401);
 const [sessions]=await db.query('SELECT id FROM v2_access_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR SHARE',[actor.sessionId,actor.userId]);
 if(!rows(sessions).length)throw new V2ProductError('Authentication required',401);
 if(!canManageProducts({...actor,canManageProducts:user.role==='admin'||Number(user.can_manage_products)===1}))
  throw new V2ProductError('Insufficient product permissions',403);
}
async function tx<T>(pool:Pool,actor:AppPrincipal,fn:(db:Query)=>Promise<T>):Promise<T>{
 const db=await pool.getConnection();let started=false;
 try{
  await db.beginTransaction();started=true;await authorize(db,actor);
  const data=await fn(db);await db.commit();started=false;return data;
 }catch(e){if(started)await db.rollback();throw e;}finally{db.release();}
}
function mapConflict(e:unknown):never{
 const code=e&&typeof e==='object'?String((e as {code?:unknown}).code):'';
 if(code==='ER_DUP_ENTRY')throw new V2ProductError('Product combination or number already exists',409);
 if(code.startsWith('ER_ROW_IS_REFERENCED')||code==='ER_NO_REFERENCED_ROW_2')
  throw new V2ProductError('Product is referenced and cannot be deleted',409);
 throw e;
}
async function identity(db:Query,colorwayId:string,fabricId:string):Promise<string>{
 // SHARE locks on identity parents synchronize with master/fabric renames and status changes.
 const [colors]=await db.query(
  'SELECT c.id,c.master_id,c.colorway_no,c.is_active,m.master_no,m.is_active AS master_active FROM pattern_colorways c JOIN pattern_masters m ON m.id=c.master_id WHERE c.id=? FOR SHARE',
  [colorwayId]);
 const color=rows(colors)[0];if(!color)throw new V2ProductError('Colorway not found',404);
 const [fabrics]=await db.query('SELECT id,fabric_no,is_active FROM v2_fabrics WHERE id=? FOR SHARE',[fabricId]);
 const fabric=rows(fabrics)[0];if(!fabric)throw new V2ProductError('Fabric not found',404);
 if(Number(color.is_active)!==1||Number(color.master_active)!==1||Number(fabric.is_active)!==1)
  throw new V2ProductError('Inactive pattern or fabric cannot be selected',409);
 const n=Number(color.colorway_no);
 if(!Number.isSafeInteger(n)||n<1||n>4294967295)throw Error('Invalid colorway identity');
 const master=String(color.master_no),fabricNo=String(fabric.fabric_no);
 if(!/^[A-Z0-9]{1,64}$/.test(master)||!/^[A-Z0-9]{1,64}$/.test(fabricNo))
  throw Error('Invalid persisted business number');
 return master+'-'+n+'-'+fabricNo;
}
const columns='p.id,p.pattern_colorway_id,p.fabric_id,p.product_no,p.remark,p.is_active,p.is_available_for_sampling,p.row_version,'+
 'c.colorway_no,m.master_no,f.fabric_no,f.fabric_name,f.composition,f.weight_value,f.weight_unit,'+
 'f.width_value,c.pattern_image_asset_id,m.is_active AS master_active,c.is_active AS colorway_active,'+
 'f.is_active AS fabric_active';
const from=' FROM v2_products p JOIN pattern_colorways c ON c.id=p.pattern_colorway_id'+
 ' JOIN pattern_masters m ON m.id=c.master_id JOIN v2_fabrics f ON f.id=p.fabric_id';
async function findRow(db:Query,productId:string):Promise<Row>{
 const [raw]=await db.query('SELECT '+columns+from+' WHERE p.id=?',[productId]);
 const row=rows(raw)[0];if(!row)throw new V2ProductError('Product not found',404);
 return row;
}
async function imageRows(db:Query,productId:string):Promise<Row[]>{
 const [raw]=await db.query(
  'SELECT id,product_id,asset_id,role,sort_order FROM v2_product_image_assets WHERE product_id=? AND deleted_at IS NULL ORDER BY role,sort_order,id',[productId]);
 return rows(raw);
}
async function batchedImageRows(db:Query,ids:string[]):Promise<Map<string,Row[]>>{
 const result=new Map<string,Row[]>();
 if(ids.length===0)return result;
 const [raw]=await db.query(
  'SELECT id,product_id,asset_id,role,sort_order FROM v2_product_image_assets WHERE product_id IN ('+
  ids.map(()=>'?').join(',')+') AND deleted_at IS NULL ORDER BY product_id,role,sort_order,id',ids);
 for(const row of rows(raw)){
  const key=sqlId(row.product_id);
  if(!ids.includes(key))throw Error('Product image batch contained an unexpected product');
  const list=result.get(key)??[];list.push(row);result.set(key,list);
 }
 return result;
}

function fromImages(raw:Row[]):ProductImages{
 const images=emptyImages();
 for(const item of raw){
  const r=roleKeys.find(x=>x.role===item.role);
  if(!r)throw Error('Unknown product image role');
  images[r.key].push(String(item.asset_id));
 }
 return images;
}
export async function getV2Product(db:Query,productId:string):Promise<V2Product>{
 id(productId);const row=await findRow(db,productId);
 return product(row,fromImages(await imageRows(db,productId)));
}
export async function listV2Products(db:Query,filter:{includeInactive?:boolean;limit?:number;offset?:number}={}):Promise<V2Product[]>{
 if(filter.includeInactive!==undefined&&typeof filter.includeInactive!=='boolean')
  throw new V2ProductError('Invalid inactive filter');
 const limit=filter.limit??50,offset=filter.offset??0;
 if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>1000000)
  throw new V2ProductError('Invalid pagination');
 const [raw]=await db.query('SELECT '+columns+from+(filter.includeInactive?'':' WHERE p.is_active=1')+
  ' ORDER BY p.product_no ASC,p.id ASC LIMIT ? OFFSET ?',[limit,offset]);
 const found=rows(raw),images=await batchedImageRows(db,found.map(row=>sqlId(row.id)));
 return found.map(row=>product(row,fromImages(images.get(sqlId(row.id))??[])));
}
async function locked(db:Query,productId:string):Promise<Row>{
 const [raw]=await db.query('SELECT id,pattern_colorway_id,fabric_id,product_no,remark,is_active,is_available_for_sampling,row_version FROM v2_products WHERE id=? FOR UPDATE',[productId]);
 const data=rows(raw)[0];if(!data)throw new V2ProductError('Product not found',404);
 return data;
}
async function used(db:Query,productId:string):Promise<boolean>{
 const [raw]=await db.query('SELECT COUNT(*) AS total FROM order_items WHERE v2_product_id=?',[productId]);
 const count=Number(rows(raw)[0]?.total);
 if(!Number.isSafeInteger(count)||count<0)throw Error('Invalid order reference count');
 return count>0;
}
async function assetState(db:Query,ids:string[]):Promise<Map<string,Row>>{
 if(ids.length===0)return new Map();
 const unique=[...new Set(ids)].sort();
 const [raw]=await db.query('SELECT id,status,ref_count FROM image_assets WHERE id IN ('+
  unique.map(()=>'?').join(',')+') ORDER BY id FOR UPDATE',unique);
 return new Map(rows(raw).map(x=>[String(x.id).toLowerCase(),x]));
}
async function applyImages(db:Query,productId:string,next:ProductImages,hardDelete=false):Promise<void>{
 const prev=await imageRows(db,productId);
 const desired=new Map<string,{role:V2ImageRole;order:number}>();
 for(const {key,role} of roleKeys)next[key].forEach((assetId,order)=>desired.set(assetId,{role,order}));
 const previous=new Map(prev.map(row=>[String(row.asset_id).toLowerCase(),row]));
 const additions=[...desired.keys()].filter(x=>!previous.has(x));
 const removals=[...previous.keys()].filter(x=>!desired.has(x));
 const assets=await assetState(db,[...additions,...removals]);
 for(const assetId of additions){
  if(assets.get(assetId)?.status!=='ready')throw new V2ProductError('Image asset is missing or not ready',409);
 }
 for(const assetId of removals){
  const current=assets.get(assetId);
  if(!current||!Number.isSafeInteger(Number(current.ref_count))||Number(current.ref_count)<1)
   throw new V2ProductError('Image reference ledger is inconsistent',409);
 }
 for(const [assetId,item] of previous){
  if(!desired.has(assetId)){
   if(!hardDelete)await db.query('UPDATE v2_product_image_assets SET deleted_at=NOW() WHERE id=?',[sqlId(item.id)]);
   const [decremented]=await db.query(
    "UPDATE image_assets SET status=IF(ref_count=1,'recycled',status),"+
    'recycled_at=IF(ref_count=1,NOW(),recycled_at),'+
    'purge_after=IF(ref_count=1,DATE_ADD(NOW(), INTERVAL 30 DAY),purge_after),'+
    'ref_count=ref_count-1 WHERE id=? AND ref_count>0',[assetId]);
   if(Number((decremented as {affectedRows?:number}).affectedRows)!==1)
    throw new V2ProductError('Image reference ledger is inconsistent',409);
  }else{
   const target=desired.get(assetId)!;
   if(item.role!==target.role||Number(item.sort_order)!==target.order)
    await db.query('UPDATE v2_product_image_assets SET role=?,sort_order=? WHERE id=?',
     [target.role,target.order,sqlId(item.id)]);
  }
 }
 for(const [assetId,target] of desired){
  if(previous.has(assetId))continue;
  await db.query('INSERT INTO v2_product_image_assets(product_id,asset_id,role,sort_order) VALUES (?,?,?,?)',
   [productId,assetId,target.role,target.order]);
  const [incremented]=await db.query('UPDATE image_assets SET ref_count=ref_count+1 WHERE id=? AND status=\'ready\'',
   [assetId]);
  if(Number((incremented as {affectedRows?:number}).affectedRows)!==1)
   throw new V2ProductError('Image asset is missing or not ready',409);
 }
 if(hardDelete)await db.query('DELETE FROM v2_product_image_assets WHERE product_id=?',[productId]);
}
export async function createV2Product(pool:Pool,actor:AppPrincipal,body:unknown):Promise<V2Product>{
 const patch=parse(body,true),images=patch.images??emptyImages();
 try{return await tx(pool,actor,async db=>{
  const productNo=await identity(db,patch.patternColorwayId!,patch.fabricId!);
  const [record]=await db.query(
   'INSERT INTO v2_products(pattern_colorway_id,fabric_id,product_no,remark,is_active,is_available_for_sampling) VALUES (?,?,?,?,?,?)',
   [patch.patternColorwayId,patch.fabricId,productNo,patch.remark??'',patch.isActive===false?0:1,patch.isAvailableForSampling===false?0:1]);
  const newId=sqlId((record as {insertId:unknown}).insertId);
  await applyImages(db,newId,images);
  return getV2Product(db,newId);
 });}catch(e){return mapConflict(e);}
}
export async function updateV2Product(pool:Pool,actor:AppPrincipal,productId:string,body:unknown):Promise<V2Product>{
 id(productId);const patch=parse(body,false);
 try{return await tx(pool,actor,async db=>{
  const current=await locked(db,productId),oldVersion=dbVersion(current.row_version);
  if(oldVersion!==patch.expectedRowVersion)throw new V2ProductError('Product revision conflict',409);
  const colorId=patch.patternColorwayId??sqlId(current.pattern_colorway_id);
  const fabricId=patch.fabricId??sqlId(current.fabric_id);
  const changing=colorId!==sqlId(current.pattern_colorway_id)||fabricId!==sqlId(current.fabric_id);
  if(changing&&await used(db,productId))throw new V2ProductError('Ordered product identity is locked',409);
  const code=changing?await identity(db,colorId,fabricId):String(current.product_no);
  const [saved]=await db.query(
   'UPDATE v2_products SET pattern_colorway_id=?,fabric_id=?,product_no=?,remark=?,is_active=?,is_available_for_sampling=?,row_version=row_version+1 WHERE id=? AND row_version=?',
   [colorId,fabricId,code,patch.remark??String(current.remark??''),
    (patch.isActive??(Number(current.is_active)===1))?1:0,
    (patch.isAvailableForSampling??(Number(current.is_available_for_sampling)===1))?1:0,productId,oldVersion]);
  if(Number((saved as {affectedRows?:number}).affectedRows)!==1)
   throw new V2ProductError('Product revision conflict',409);
  if(patch.images)await applyImages(db,productId,patch.images);
  return getV2Product(db,productId);
 });}catch(e){return mapConflict(e);}
}
export async function deleteV2Product(pool:Pool,actor:AppPrincipal,productId:string):Promise<{id:string;deleted:true}>{
 id(productId);
 try{return await tx(pool,actor,async db=>{
  await locked(db,productId);
  if(await used(db,productId))throw new V2ProductError('Ordered product cannot be deleted; deactivate instead',409);
  await applyImages(db,productId,emptyImages(),true);
  const [deleted]=await db.query('DELETE FROM v2_products WHERE id=?',[productId]);
  if(Number((deleted as {affectedRows?:number}).affectedRows)!==1)
   throw new V2ProductError('Product not found',404);
  return {id:productId,deleted:true};
 });}catch(e){return mapConflict(e);}
}