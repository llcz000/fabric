import type {AppPrincipal} from '../access/types';
import {canManageProducts} from '../access/policy';
import type {Pool} from '../order-v2/lines';

/** Shared V2 topic/color dictionary and stable tag associations.
 * Isolated domain slice: the caller/HTTP router must enforce read authentication.
 * No server.ts registration or automatic retries of a failed write.
 */
export type TagDimension='topic'|'color';
export type TagEntity='master'|'masterColor'|'colorway';
export interface SharedTag{id:string;dimension:TagDimension;name:string;isArchived:boolean}
export interface TagImpact extends SharedTag{affectedCount:number}
export interface TagQuery{query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>}
export class TagError extends Error {
 constructor(message:string,readonly status:400|401|403|404|409=400){super(message);}
}
type Row=Record<string,unknown>;
const MAX_ID=18446744073709551615n;
const isDimension=(value:unknown):value is TagDimension=>value==='topic'||value==='color';
const isEntity=(value:unknown):value is TagEntity=>value==='master'||value==='masterColor'||value==='colorway';
function validDimension(d:unknown):asserts d is TagDimension{
 if(!isDimension(d))throw new TagError('Invalid tag dimension');
}
function validEntity(k:unknown):asserts k is TagEntity{
 if(!isEntity(k))throw new TagError('Invalid tag target');
}
function validId(input:unknown):asserts input is string{
 if(typeof input!=='string'||!/^[1-9][0-9]{0,19}$/.test(input)||BigInt(input)>MAX_ID)
  throw new TagError('Invalid identity');
}
function sqlId(input:unknown):string{
 if(typeof input==='number'&&!Number.isSafeInteger(input))throw Error('Unsafe database identity');
 const result=String(input);validId(result);return result;
}
function rows(raw:unknown):Row[]{if(!Array.isArray(raw))throw Error('Tag rows unavailable');return raw as Row[];}
function normalizeName(input:unknown):{name:string;normalized:string}{
 if(typeof input!=='string')throw new TagError('Invalid tag name');
 const name=input.trim();
 const normalized=name.normalize('NFKC').toLowerCase().trim();
 if([...name].length<1||[...name].length>32||!normalized||
    /[\p{Cc}\p{Cf}]/u.test(name)||[...normalized].length>64)
  throw new TagError('Tag name must contain 1–32 visible characters');
 return {name,normalized};
}
function asTag(raw:Row):SharedTag{
 const dimension=raw.dimension;validDimension(dimension);
 return {id:sqlId(raw.id),dimension,name:String(raw.name),isArchived:Number(raw.is_archived)===1};
}
async function permission(db:TagQuery,actor:AppPrincipal,adminOnly=false):Promise<void>{
 if(!actor?.userId||!actor.sessionId)throw new TagError('Authentication required',401);
 const [u]=await db.query(
  'SELECT id,role,is_active,can_manage_products FROM v2_access_users WHERE id=? FOR SHARE',[actor.userId]);
 const user=rows(u)[0];
 if(!user||user.role!==actor.role||Number(user.is_active)!==1)throw new TagError('Authentication required',401);
 const [sessions]=await db.query(
  'SELECT id FROM v2_access_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR SHARE',
  [actor.sessionId,actor.userId]);
 if(!rows(sessions).length)throw new TagError('Authentication required',401);
 // Shared business operations are available to both registered active roles;
 // archive/merge still enforce server-side impact and reference confirmation.
 if(!canManageProducts({...actor,canManageProducts:true}))
  throw new TagError('Insufficient tag permissions',403);
}
async function tx<T>(pool:Pool,actor:AppPrincipal,adminOnly:boolean,work:(db:TagQuery)=>Promise<T>):Promise<T>{
 const db=await pool.getConnection();let started=false;
 try{
  await db.beginTransaction();started=true;await permission(db,actor,adminOnly);
  const result=await work(db);await db.commit();started=false;return result;
 }catch(error){if(started)await db.rollback();throw error;}finally{db.release();}
}
function duplicate(e:unknown):never{
 if(e&&typeof e==='object'&&String((e as {code?:unknown}).code)==='ER_DUP_ENTRY')
  throw new TagError('Tag name conflicts with an existing value',409);
 throw e;
}
export async function createSharedTag(pool:Pool,actor:AppPrincipal,dimension:TagDimension,name:unknown):Promise<SharedTag>{
 validDimension(dimension);const text=normalizeName(name);
 try{return await tx(pool,actor,false,async db=>{
  await db.query(
   'INSERT INTO shared_tags(dimension,name,normalized_name) VALUES (?,?,?) ON DUPLICATE KEY UPDATE id=id',
   [dimension,text.name,text.normalized]);
  const [raw]=await db.query(
   'SELECT id,dimension,name,normalized_name,is_archived FROM shared_tags WHERE dimension=? AND normalized_name=? FOR SHARE',
   [dimension,text.normalized]);
  const saved=rows(raw)[0];if(!saved)throw Error('Tag upsert did not persist');
  return asTag(saved);
 });}catch(e){return duplicate(e);}
}
export async function listSharedTags(db:TagQuery,dimension:TagDimension,
 options:{includeArchived?:boolean;search?:string}={}):Promise<SharedTag[]>{
 validDimension(dimension);
 if(options.search!==undefined&&(typeof options.search!=='string'||[...options.search].length>64||
    /[\p{Cc}\p{Cf}]/u.test(options.search)))throw new TagError('Invalid tag search');
 const needle=options.search?.trim().normalize('NFKC').toLowerCase()??'';
 const params:unknown[]=[dimension];
 let sql='SELECT id,dimension,name,normalized_name,is_archived FROM shared_tags WHERE dimension=?'+
   (options.includeArchived?'':' AND is_archived=0');
 if(needle){
  // Explicit '!' escape handles % and _ under any MySQL backslash mode.
  sql+=" AND normalized_name LIKE ? ESCAPE '!'";
  params.push('%'+needle.replace(/[!%_]/g,character=>'!'+character)+'%');
 }
 const [raw]=await db.query(sql+' ORDER BY name ASC,id ASC',params);
 return rows(raw).map(asTag);
}
function linkTable(kind:TagEntity):{table:string;key:string;domain:TagDimension;entityTable:string}{
 validEntity(kind);
 return kind!=='colorway'
  ?{table:'pattern_master_tag_links',key:'master_id',domain:kind==='master'?'topic':'color',entityTable:'pattern_masters'}
  :{table:'pattern_colorway_tag_links',key:'colorway_id',domain:'color',entityTable:'pattern_colorways'};
}
/** Read always includes linked archived values for historical traceability. */
export async function readEntityTags(db:TagQuery,kind:TagEntity,entityId:string):Promise<SharedTag[]>{
 const {table,key,domain,entityTable}=linkTable(kind);
 validId(entityId);
 const [parent]=await db.query('SELECT id FROM '+entityTable+' WHERE id=?',[entityId]);
 if(!rows(parent).length)throw new TagError('Tag target not found',404);
 const [raw]=await db.query(
  'SELECT t.id,t.dimension,t.name,t.is_archived FROM shared_tags t JOIN '+table+
  ' l ON l.tag_id=t.id WHERE l.'+key+'=? ORDER BY t.name ASC,t.id ASC',[entityId]);
 return rows(raw).map(asTag).filter(tag=>tag.dimension===domain);
}
/** Atomic replacement, locking the parent first to serialize competing edits.
 * Archived tags may remain attached only if already present on this exact entity.
 */
export async function replaceEntityTags(pool:Pool,actor:AppPrincipal,kind:TagEntity,entityId:string,ids:unknown,newColorTags:unknown=[]):Promise<string[]>{
 const {table,key,domain,entityTable}=linkTable(kind);
 validId(entityId);
 if(!Array.isArray(ids)||ids.length>10||ids.some(x=>typeof x!=='string'))throw new TagError('Expected up to ten tag IDs');
 for(const x of ids)validId(x);
 const tags=[...ids] as string[];
 if(new Set(tags).size!==tags.length)throw new TagError('Duplicate tag IDs');
 if(!Array.isArray(newColorTags)||(newColorTags.length>0&&kind!=='masterColor')||newColorTags.length+tags.length>10)throw new TagError('Invalid custom colors');
 const names=newColorTags.map(normalizeName);
 if(new Set(names.map(name=>name.normalized)).size!==names.length)throw new TagError('Duplicate custom colors');
 return tx(pool,actor,false,async db=>{
  const [target]=await db.query('SELECT id FROM '+entityTable+' WHERE id=? FOR UPDATE',[entityId]);
  if(!rows(target).length)throw new TagError('Tag target not found',404);
  const [oldRaw]=await db.query('SELECT tag_id FROM '+table+' WHERE '+key+'=?',[entityId]);
  const previousIds=rows(oldRaw).map(x=>sqlId(x.tag_id));
  const [oldTags]=previousIds.length?await db.query('SELECT id,dimension FROM shared_tags WHERE id IN ('+previousIds.map(()=>'?').join(',')+') FOR SHARE',previousIds):[[],[]];
  const previous=new Set(rows(oldTags).filter(tag=>tag.dimension===domain).map(tag=>sqlId(tag.id)));
  for(const name of names){
   await db.query('INSERT INTO shared_tags(dimension,name,normalized_name) VALUES (?,?,?) ON DUPLICATE KEY UPDATE id=id',['color',name.name,name.normalized]);
   const [raw]=await db.query('SELECT id,dimension,name,normalized_name,is_archived FROM shared_tags WHERE dimension=? AND normalized_name=? FOR SHARE',['color',name.normalized]);
   const tag=rows(raw)[0];if(!tag||tag.dimension!=='color')throw Error('Cannot resolve pattern color');
   const resolved=sqlId(tag.id);if(tags.includes(resolved))throw new TagError('Duplicate color selection');tags.push(resolved);
  }
  if(tags.length){
   const placeholders=tags.map(()=>'?').join(',');
   const [tagRaw]=await db.query('SELECT id,dimension,name,is_archived FROM shared_tags WHERE id IN ('+placeholders+') FOR SHARE',tags);
   const found=new Map(rows(tagRaw).map(x=>[sqlId(x.id),x]));
   for(const id of tags){
    const entry=found.get(id);
    if(!entry||entry.dimension!==domain)throw new TagError('Tag does not belong to this dimension');
    if(Number(entry.is_archived)===1&&!previous.has(id))throw new TagError('Archived tag cannot be newly attached',409);
   }
  }
  for(const old of previous)if(!tags.includes(old))await db.query('DELETE FROM '+table+' WHERE '+key+'=? AND tag_id=?',[entityId,old]);
  for(const id of tags)if(!previous.has(id))await db.query('INSERT INTO '+table+'('+key+',tag_id) VALUES (?,?)',[entityId,id]);
  return tags;
 });
}
async function impact(db:TagQuery,raw:Row):Promise<TagImpact>{
 const tag=asTag(raw);
 let n=0;
 for(const table of tag.dimension==='topic'?['pattern_master_tag_links']:['pattern_master_tag_links','pattern_colorway_tag_links']){
  const [results]=await db.query('SELECT COUNT(*) AS n FROM '+table+' WHERE tag_id=?',[tag.id]);
  const count=Number(rows(results)[0]?.n);if(!Number.isSafeInteger(count)||count<0)throw Error('Tag impact count unavailable');n+=count;
 }
 if(!Number.isSafeInteger(n)||n<0)throw Error('Tag impact count unavailable');
 return {...tag,affectedCount:n};
}
async function getTag(db:TagQuery,tagId:string,lock=false):Promise<Row>{
 const [raw]=await db.query(
  'SELECT id,dimension,name,normalized_name,is_archived FROM shared_tags WHERE id=?'+(lock?' FOR UPDATE':''),[tagId]);
 const row=rows(raw)[0];if(!row)throw new TagError('Tag not found',404);return row;
}
export async function previewTagImpact(db:TagQuery,tagId:string):Promise<TagImpact>{
 validId(tagId);return impact(db,await getTag(db,tagId));
}
/** UI must show the previewed impact; changing count needs a new confirmation. */
export async function renameSharedTag(pool:Pool,actor:AppPrincipal,tagId:string,name:unknown,confirmAffectedCount:number):Promise<TagImpact>{
 validId(tagId);const text=normalizeName(name);
 if(!Number.isSafeInteger(confirmAffectedCount)||confirmAffectedCount<0)throw new TagError('Impact confirmation required');
 try{return await tx(pool,actor,true,async db=>{
  const old=await getTag(db,tagId,true);
  const before=await impact(db,old);
  if(before.affectedCount!==confirmAffectedCount)throw new TagError('Tag usage changed; refresh the impact preview',409);
  await db.query('UPDATE shared_tags SET name=?,normalized_name=? WHERE id=?',[text.name,text.normalized,tagId]);
  return {...before,name:text.name};
 });}catch(e){return duplicate(e);}
}
export async function archiveSharedTag(pool:Pool,actor:AppPrincipal,tagId:string):Promise<TagImpact>{
 validId(tagId);
 return tx(pool,actor,true,async db=>{
  const old=await getTag(db,tagId,true);
  const before=await impact(db,old);
  await db.query('UPDATE shared_tags SET is_archived=1 WHERE id=?',[tagId]);
  return {...before,isArchived:true};
 });
}

/** Merge moves all live associations to an existing, non-archived tag and
 * archives the source; the source row is retained for audit/reference history.
 * Exclusive locks on both tag rows stop any new association during the merge.
 * An owner can never exceed ten tags: replacement removes one source first.
 */
export async function mergeSharedTags(pool:Pool,actor:AppPrincipal,sourceId:string,targetId:string,
 confirmAffectedCount:number):Promise<{source:SharedTag;target:SharedTag;affectedCount:number}>{
 validId(sourceId);validId(targetId);
 if(sourceId===targetId)throw new TagError('Cannot merge a tag into itself');
 if(!Number.isSafeInteger(confirmAffectedCount)||confirmAffectedCount<0)throw new TagError('Impact confirmation required');
 return tx(pool,actor,true,async db=>{
  const ordered=[sourceId,targetId].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
  const [lockRaw]=await db.query(
   'SELECT id,dimension,name,is_archived FROM shared_tags WHERE id IN (?,?) ORDER BY id FOR UPDATE',ordered);
  const locked=new Map(rows(lockRaw).map(x=>[sqlId(x.id),x]));
  const src=locked.get(sourceId),dst=locked.get(targetId);
  if(!src||!dst)throw new TagError('Tag not found',404);
  if(src.dimension!==dst.dimension)throw new TagError('Cannot merge different dimensions');
  if(Number(dst.is_archived)===1)throw new TagError('Cannot merge into an archived tag',409);
  const current=await impact(db,src);
  if(current.affectedCount!==confirmAffectedCount)throw new TagError('Tag usage changed; refresh the impact preview',409);
  let affected=0;
  for(const isMaster of src.dimension==='topic'?[true]:[true,false]){
  const table=isMaster?'pattern_master_tag_links':'pattern_colorway_tag_links';
  const entityTable=isMaster?'pattern_masters':'pattern_colorways';
  const key=isMaster?'master_id':'colorway_id';
  const [ownersRaw]=await db.query(
   'SELECT '+key+' AS entity_id FROM '+table+' WHERE tag_id=? ORDER BY '+key+' FOR UPDATE',[sourceId]);
  const owners=rows(ownersRaw).map(x=>sqlId(x.entity_id));
  affected+=owners.length;
  for(const ownerId of owners){
   const [parent]=await db.query('SELECT id FROM '+entityTable+' WHERE id=? FOR UPDATE',[ownerId]);
   if(!rows(parent).length)throw new TagError('Tag target not found',404);
   const [itemsRaw]=await db.query('SELECT tag_id FROM '+table+' WHERE '+key+'=? FOR UPDATE',[ownerId]);
   const linked=rows(itemsRaw).map(x=>sqlId(x.tag_id));
   const [linkedTags]=linked.length?await db.query('SELECT id,dimension FROM shared_tags WHERE id IN ('+linked.map(()=>'?').join(',')+') FOR SHARE',linked):[[],[]];
   const existing=new Set(rows(linkedTags).filter(tag=>tag.dimension===src.dimension).map(x=>sqlId(x.id)));
   if(!existing.has(sourceId))throw new TagError('Tag associations changed',409);
   const after=new Set([...existing].filter(id=>id!==sourceId));after.add(targetId);
   if(after.size>10)throw new TagError('Tag count exceeds ten',409);
   await db.query('DELETE FROM '+table+' WHERE '+key+'=? AND tag_id=?',[ownerId,sourceId]);
   if(!existing.has(targetId)){
    await db.query('INSERT INTO '+table+'('+key+',tag_id) VALUES (?,?)',[ownerId,targetId]);
   }
  }
  }
  if(affected!==current.affectedCount)throw new TagError('Tag usage changed; refresh the impact preview',409);
  await db.query('UPDATE shared_tags SET is_archived=1 WHERE id=?',[sourceId]);
  return {source:{...asTag(src),isArchived:true},target:asTag(dst),affectedCount:affected};
 });
}
