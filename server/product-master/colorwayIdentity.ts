import type {AppPrincipal} from '../access/types';
import type {Pool} from '../order-v2/lines';
import {canManageProducts} from '../access/policy';
export class ColorwayIdentityError extends Error{constructor(message:string,readonly status:400|401|403|404|409=400){super(message);}}
export interface ColorwayIdentity{id:string;masterId:string;masterNo:string;colorwayNo:number;patternNo:string;patternImageAssetId:string|null;remark:string;isActive:boolean}
export interface ColorwayQuery {query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>}
type Row=Record<string,unknown>;
const MAX_ID=18446744073709551615n,MAX_COLORWAY=4294967295n;
function id(value:unknown):asserts value is string{
 if(typeof value!=='string'||!/^[1-9][0-9]{0,19}$/.test(value)||BigInt(value)>MAX_ID)
  throw new ColorwayIdentityError('Invalid identity');
}
function rows(raw:unknown):Row[]{if(!Array.isArray(raw))throw Error('Colorway rows unavailable');return raw as Row[];}
function databaseId(raw:unknown):string{
 if(typeof raw==='number'&&!Number.isSafeInteger(raw))throw Error('Unsafe database identity; configure BIGINT string handling');
 const value=String(raw);id(value);return value;
}
type ColorwayAttributes={remark?:string;isActive?:boolean;tagIds?:string[];newColorTags?:string[];patternImageAssetId?:string|null};
function colorName(raw:unknown):{name:string;normalized:string}{
 if(typeof raw!=='string')throw new ColorwayIdentityError('Invalid custom color name');
 const name=raw.trim(),normalized=name.normalize('NFKC').toLowerCase().trim();
 if([...name].length<1||[...name].length>32||!normalized||
  /[\p{Cc}\p{Cf}]/u.test(name)||[...normalized].length>64)
  throw new ColorwayIdentityError('Color tag must contain 1–32 visible characters');
 return {name,normalized};
}
function attributes(body:unknown):ColorwayAttributes{
 if(!body||typeof body!=='object'||Array.isArray(body)||
  Object.keys(body).some(k=>!['remark','isActive','tagIds','newColorTags','patternImageAssetId'].includes(k)))
  throw new ColorwayIdentityError('Only remark, isActive and color tags may be supplied');
 const value=body as Record<string,unknown>;
 if('patternImageAssetId' in value&&value.patternImageAssetId!==null&&
  (typeof value.patternImageAssetId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.patternImageAssetId)))
  throw new ColorwayIdentityError('Invalid pattern image asset');
 if(('remark' in value&&(typeof value.remark!=='string'||[...value.remark].length>500))||
    ('isActive' in value&&typeof value.isActive!=='boolean'))throw new ColorwayIdentityError('Invalid colorway attributes');
 if('tagIds' in value){
  if(!Array.isArray(value.tagIds)||value.tagIds.length>10||
   value.tagIds.some(x=>typeof x!=='string'||!/^[1-9][0-9]{0,19}$/.test(x)||BigInt(x)>MAX_ID)||
   new Set(value.tagIds).size!==value.tagIds.length)
   throw new ColorwayIdentityError('Invalid color tag IDs');
 }
 if('newColorTags' in value){
  if(!Array.isArray(value.newColorTags)||value.tagIds===undefined||
   value.newColorTags.length>10||
   value.newColorTags.length+(value.tagIds as string[]).length>10)
   throw new ColorwayIdentityError('Invalid custom color tags');
  const names=value.newColorTags.map(colorName);
  if(new Set(names.map(x=>x.normalized)).size!==names.length)
   throw new ColorwayIdentityError('Duplicate custom colors');
 }
 return value as ColorwayAttributes;
}
/** Replace only this colorway's color tags inside the SAME version transaction.
 * Caller holds the version FOR UPDATE (or has just inserted it); lock order
 * matches sharedTags.replaceEntityTags. Existing archived links may be kept.
 */
async function replaceVersionColorTags(db:ColorwayQuery,colorwayId:string,
 tagIds:string[],isNew:boolean,customNames:string[]=[]):Promise<void>{
 const [oldRows]=isNew?[[],[]]:await db.query(
  'SELECT tag_id FROM pattern_colorway_tag_links WHERE colorway_id=?',[colorwayId]);
 const previous=new Set(rows(oldRows).map(x=>databaseId(x.tag_id)));
 const effective=[...tagIds];
 for(const input of customNames){
  const color=colorName(input);
  await db.query('INSERT INTO shared_tags(dimension,name,normalized_name) VALUES (?,?,?) '+
   'ON DUPLICATE KEY UPDATE id=id',['color',color.name,color.normalized]);
  const [resolved]=await db.query('SELECT id,dimension,is_archived FROM shared_tags '+
   'WHERE dimension=? AND normalized_name=? FOR SHARE',['color',color.normalized]);
  const linked=rows(resolved)[0];
  if(!linked||linked.dimension!=='color')throw Error('Cannot resolve new color tag');
  const linkedId=databaseId(linked.id);
  if(Number(linked.is_archived)===1&&!previous.has(linkedId))
   throw new ColorwayIdentityError('Archived color tag cannot be reused',409);
  if(effective.includes(linkedId))throw new ColorwayIdentityError('Duplicate color tag selection');
  effective.push(linkedId);
 }
 if(effective.length>10)throw new ColorwayIdentityError('Too many color tags');
 if(effective.length){
  const [all]=await db.query('SELECT id,dimension,is_archived FROM shared_tags WHERE id IN ('+
   effective.map(()=>'?').join(',')+') FOR SHARE',effective);
  const known=new Map(rows(all).map(x=>[databaseId(x.id),x]));
  for(const tagId of effective){
   const tag=known.get(tagId);
   if(!tag||tag.dimension!=='color')throw new ColorwayIdentityError('Tag is not a color tag');
   if(Number(tag.is_archived)===1&&!previous.has(tagId))
    throw new ColorwayIdentityError('Archived color tag cannot be newly attached',409);
  }
 }
 for(const old of previous)if(!effective.includes(old))
  await db.query('DELETE FROM pattern_colorway_tag_links WHERE colorway_id=? AND tag_id=?',[colorwayId,old]);
 for(const next of effective)if(!previous.has(next))
  await db.query('INSERT INTO pattern_colorway_tag_links(colorway_id,tag_id) VALUES (?,?)',[colorwayId,next]);
}
function counter(raw:unknown):bigint{
 if((typeof raw!=='string'&&typeof raw!=='number'&&typeof raw!=='bigint')||
   (typeof raw==='number'&&!Number.isSafeInteger(raw))||!/^[1-9][0-9]*$/.test(String(raw)))
  throw Error('Invalid persistent colorway counter');
 return BigInt(raw);
}
function record(row:Row,master:Row):ColorwayIdentity{
 const colorwayNo=Number(counter(row.colorway_no));
 if(!Number.isSafeInteger(colorwayNo)||colorwayNo>Number(MAX_COLORWAY))throw Error('Invalid saved colorway identity');
 const masterNo=String(master.master_no);
 return {id:databaseId(row.id),masterId:databaseId(row.master_id),masterNo,colorwayNo,patternNo:masterNo+'-'+colorwayNo,
  patternImageAssetId:row.pattern_image_asset_id==null?null:String(row.pattern_image_asset_id),
  remark:String(row.remark),isActive:Number(row.is_active)===1};
}
async function manager(db:ColorwayQuery,actor:AppPrincipal):Promise<void>{
 if(!actor?.userId||!actor.sessionId)throw new ColorwayIdentityError('Authentication required',401);
 const [users]=await db.query('SELECT id,role,is_active,can_manage_products FROM v2_access_users WHERE id=? FOR SHARE',[actor.userId]);
 const user=rows(users)[0];
 if(!user||Number(user.is_active)!==1||user.role!==actor.role)throw new ColorwayIdentityError('Authentication required',401);
 const [sessions]=await db.query('SELECT id FROM v2_access_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR SHARE',[actor.sessionId,actor.userId]);
 if(!rows(sessions).length)throw new ColorwayIdentityError('Authentication required',401);
 if(!canManageProducts({...actor,canManageProducts:user.role==='admin'||Number(user.can_manage_products)===1}))
  throw new ColorwayIdentityError('Insufficient product permissions',403);
}
async function transaction<T>(pool:Pool,actor:AppPrincipal,action:(db:ColorwayQuery)=>Promise<T>):Promise<T>{
 const db=await pool.getConnection();let active=false;
 try{await db.beginTransaction();active=true;await manager(db,actor);const result=await action(db);
  await db.commit();active=false;return result;
 }catch(error){if(active)await db.rollback();throw error;}finally{db.release();}
}
async function master(db:ColorwayQuery,masterId:string,lock=false):Promise<Row>{
 const [raw]=await db.query('SELECT id,master_no,next_colorway_no FROM pattern_masters WHERE id=?'+(lock?' FOR UPDATE':''),[masterId]);
 const row=rows(raw)[0];if(!row)throw new ColorwayIdentityError('Pattern master not found',404);return row;
}
async function saved(db:ColorwayQuery,colorwayId:string):Promise<Row>{
 const [raw]=await db.query('SELECT id,master_id,colorway_no,pattern_image_asset_id,remark,is_active FROM pattern_colorways WHERE id=? FOR UPDATE',[colorwayId]);
 const row=rows(raw)[0];if(!row)throw new ColorwayIdentityError('Colorway not found',404);return row;
}
async function replacePatternImage(db:ColorwayQuery,colorwayId:string,previous:string|null,next:string|null):Promise<void>{
 if(previous===next)return;
 const identities=[...new Set([previous,next].filter((id):id is string=>id!==null))].sort();
 const [raw]=await db.query('SELECT id,status,purpose,ref_count FROM image_assets WHERE id IN ('+identities.map(()=>'?').join(',')+') ORDER BY id FOR UPDATE',identities);
 const assets=new Map(rows(raw).map(row=>[String(row.id),row]));
 if(next&&(assets.get(next)?.status!=='ready'||assets.get(next)?.purpose!=='product_image'))
  throw new ColorwayIdentityError('Pattern image is missing or not ready',409);
 if(previous&&(!assets.has(previous)||!Number.isSafeInteger(Number(assets.get(previous)!.ref_count))||Number(assets.get(previous)!.ref_count)<1))
  throw new ColorwayIdentityError('Image reference ledger is inconsistent',409);
 if(next){
  const [result]=await db.query("UPDATE image_assets SET ref_count=ref_count+1 WHERE id=? AND status='ready'",[next]);
  if(Number((result as {affectedRows:number}).affectedRows)!==1)throw new ColorwayIdentityError('Pattern image is not ready',409);
 }
 await db.query('UPDATE pattern_colorways SET pattern_image_asset_id=? WHERE id=?',[next,colorwayId]);
 if(previous){
  const [result]=await db.query("UPDATE image_assets SET status=IF(ref_count=1,'recycled',status),recycled_at=IF(ref_count=1,NOW(),recycled_at),purge_after=IF(ref_count=1,DATE_ADD(NOW(), INTERVAL 30 DAY),purge_after),ref_count=ref_count-1 WHERE id=? AND ref_count>0",[previous]);
  if(Number((result as {affectedRows:number}).affectedRows)!==1)throw new ColorwayIdentityError('Image reference ledger is inconsistent',409);
 }
}
/** D-01: commit consumes one number; no automatic retry or request idempotency.
 * Lock order is current account/session then master. Never derive from remaining rows.
 */
export async function createColorway(pool:Pool,actor:AppPrincipal,masterId:string,body:unknown):Promise<ColorwayIdentity>{
 id(masterId);const value=attributes(body);
 return transaction(pool,actor,async db=>{
  const parent=await master(db,masterId,true),next=counter(parent.next_colorway_no);
  if(next>MAX_COLORWAY)throw new ColorwayIdentityError('Colorway sequence exhausted',409);
  const [updated]=await db.query('UPDATE pattern_masters SET next_colorway_no=next_colorway_no+1 WHERE id=?',[masterId]);
  if(Number((updated as {affectedRows?:number}).affectedRows)!==1)throw Error('Master counter update failed');
  const remark=value.remark??'',isActive=value.isActive??true;
  const [inserted]=await db.query('INSERT INTO pattern_colorways(master_id,colorway_no,remark,is_active) VALUES (?,?,?,?)',[masterId,next.toString(),remark,isActive?1:0]);
  const result=inserted as {insertId:unknown};const newId=databaseId(result.insertId);
  if(value.patternImageAssetId)await replacePatternImage(db,newId,null,value.patternImageAssetId);
  if(value.tagIds!==undefined)await replaceVersionColorTags(db,newId,value.tagIds,true,value.newColorTags);
  return record({id:newId,master_id:masterId,colorway_no:next.toString(),pattern_image_asset_id:value.patternImageAssetId??null,remark,is_active:isActive?1:0},parent);
 });
}
/** Expected next number is informational; reading/cancelling a draft reserves nothing. */
export async function listColorways(db:ColorwayQuery,masterId:string):Promise<{items:ColorwayIdentity[];nextColorwayNo:number}>{
 id(masterId);const parent=await master(db,masterId);const next=counter(parent.next_colorway_no);
 if(next>MAX_COLORWAY+1n)throw Error('Persistent counter outside supported range');
 const [raw]=await db.query('SELECT id,master_id,colorway_no,pattern_image_asset_id,remark,is_active FROM pattern_colorways WHERE master_id=? ORDER BY colorway_no ASC,id ASC',[masterId]);
 return {items:rows(raw).map(row=>record(row,parent)),nextColorwayNo:Number(next)};
}
export async function updateColorway(pool:Pool,actor:AppPrincipal,colorwayId:string,body:unknown):Promise<ColorwayIdentity>{
 id(colorwayId);const value=attributes(body);
 return transaction(pool,actor,async db=>{
  const row=await saved(db,colorwayId),parent=await master(db,databaseId(row.master_id));
  const remark=value.remark??String(row.remark),isActive=value.isActive??(Number(row.is_active)===1);
  if(value.tagIds!==undefined)await replaceVersionColorTags(db,colorwayId,value.tagIds,false,value.newColorTags);
  const image=value.patternImageAssetId===undefined?(row.pattern_image_asset_id==null?null:String(row.pattern_image_asset_id)):value.patternImageAssetId;
  if(value.patternImageAssetId!==undefined)await replacePatternImage(db,colorwayId,row.pattern_image_asset_id==null?null:String(row.pattern_image_asset_id),image);
  await db.query('UPDATE pattern_colorways SET remark=?,is_active=? WHERE id=?',[remark,isActive?1:0,colorwayId]);
  return record({...row,remark,is_active:isActive?1:0,pattern_image_asset_id:image},parent);
 });
}
export async function deleteColorway(pool:Pool,actor:AppPrincipal,colorwayId:string):Promise<{id:string;deleted:true}>{
 id(colorwayId);
 try{return await transaction(pool,actor,async db=>{
  const row=await saved(db,colorwayId);
  if(row.pattern_image_asset_id!=null)throw new ColorwayIdentityError('Remove the linked image through the image service first',409);
  const [references]=await db.query('SELECT id FROM v2_products WHERE pattern_colorway_id=? LIMIT 1',[colorwayId]);
  if(rows(references).length)throw new ColorwayIdentityError('Colorway is referenced by a product',409);
  const [deleted]=await db.query('DELETE FROM pattern_colorways WHERE id=?',[colorwayId]);
  if(Number((deleted as {affectedRows?:number}).affectedRows)!==1)throw new ColorwayIdentityError('Colorway not found',404);
  return {id:colorwayId,deleted:true as const};
 });}catch(error){
  if(error&&typeof error==='object'&&['ER_ROW_IS_REFERENCED','ER_ROW_IS_REFERENCED_2'].includes(String((error as {code?:unknown}).code)))
   throw new ColorwayIdentityError('Colorway is referenced and cannot be deleted',409);
  throw error;
 }
}
