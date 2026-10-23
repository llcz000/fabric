import {recordDeletion} from '../audit/deletionAudit';
import type {AppPrincipal} from '../access/types';
import {withCatalogTransaction} from '../access/catalogTransaction';
import type {Pool} from '../order-v2/lines';
import {markCardsForReprintOnFabricChange} from '../customer-samples/reprint';
import {hasSampleCardReference} from './sampleCardReferences';
import {isDecimalValue} from '../../src/lib/businessRules';

/** P3-3 standalone Fabric V2 domain service; NOT mounted to server.ts. */
export class FabricError extends Error{
 constructor(message:string,readonly status:400|401|403|404|409=400){super(message);}
}
type Row=Record<string,unknown>;
type Query={query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>};
export type WeightUnit='gsm'|'mm';
export interface Fabric{
 id:string;fabricNo:string;fabricName:string;composition:string|null;
 weightValue:number|null;weightUnit:WeightUnit|null;widthValue:number|null;
 remark:string|null;isActive:boolean;
}
type FabricFields=Omit<Fabric,'id'>;
type FabricChanges=Partial<FabricFields>;
const MAX_ID=18446744073709551615n;
function strictId(value:unknown):asserts value is string{
 if(typeof value!=='string'||!/^[1-9][0-9]{0,19}$/.test(value)||BigInt(value)>MAX_ID)
  throw new FabricError('Invalid fabric identity');
}
function dbId(raw:unknown):string{
 if(typeof raw==='number'&&!Number.isSafeInteger(raw))throw Error('Unsafe fabric ID from database');
 const id=String(raw);strictId(id);return id;
}
function rows(raw:unknown):Row[]{
 if(!Array.isArray(raw))throw Error('Fabric rows unavailable');
 return raw as Row[];
}
function normalizedNo(value:unknown):string{
 if(typeof value!=='string')throw new FabricError('Invalid fabric number');
 const code=value.trim().toUpperCase();
 if(!code)throw new FabricError('Fabric number is required');
 return code;
}
function validText(value:unknown,max:number,required:boolean,field:string):string|null{
 if(value===null&&!required)return null;
 if(typeof value!=='string')throw new FabricError('Invalid '+field);
 const normalized=value.trim();
 if([...normalized].length>max||/[\p{Cc}\p{Cf}]/u.test(normalized)||required&&!normalized)
  throw new FabricError('Invalid '+field);
 return normalized||null;
}
/** Check numeric precision against MySQL DECIMAL scale without silently rounding. */
function decimal(value:unknown,scale:number,integerDigits:number,field:string):number|null{
 if(value===null)return null;
 if(typeof value!=='number'||!Number.isFinite(value)||value<=0)
  throw new FabricError('Invalid '+field);
 if(!isDecimalValue(value,scale,integerDigits))
  throw new FabricError('Invalid '+field+' precision');
 return value;
}
function weightUnit(value:unknown):WeightUnit|null{
 if(value===null)return null;
 if(value==='gsm'||value==='mm')return value;
 throw new FabricError('Weight unit must be gsm or mm');
}
function checkWeight(v:number|null,u:WeightUnit|null):void{
 if((v===null)!==(u===null))throw new FabricError('Weight and unit must both be set or both empty');
}
const columns=[
 'fabricNo','fabricName','composition','weightValue','weightUnit','widthValue','remark','isActive'
] as const;
function changes(body:unknown,create:boolean):FabricChanges{
 if(!body||typeof body!=='object'||Array.isArray(body))throw new FabricError('Invalid fabric fields');
 const raw=body as Record<string,unknown>;
 if(Object.keys(raw).some(k=>!columns.includes(k as typeof columns[number])||create&&k==='isActive'))
  throw new FabricError('Unknown or immutable fabric field');
 if(create&&(!Object.hasOwn(raw,'fabricNo')||!Object.hasOwn(raw,'fabricName')))
  throw new FabricError('Fabric number and name are required');
 const result:FabricChanges={};
 if('fabricNo' in raw)result.fabricNo=normalizedNo(raw.fabricNo);
 if('fabricName' in raw)result.fabricName=validText(raw.fabricName,255,true,'fabric name')!;
 if('composition' in raw)result.composition=validText(raw.composition,500,false,'composition');
 if('weightValue' in raw)result.weightValue=decimal(raw.weightValue,3,9,'weight');
 if('weightUnit' in raw)result.weightUnit=weightUnit(raw.weightUnit);
 if('widthValue' in raw)result.widthValue=decimal(raw.widthValue,2,10,'width');
 if('remark' in raw)result.remark=validText(raw.remark,5000,false,'remark');
 if('isActive' in raw){
  if(raw.isActive!==true)throw new FabricError('Invalid active state');
  result.isActive=raw.isActive;
 }
 return result;
}
function asDbNumber(raw:unknown,scale:number,integerDigits:number):number|null{
 if(raw===null||raw===undefined)return null;
 const number=Number(raw);
 if(!Number.isFinite(number))throw Error('Invalid database fabric decimal');
 return decimal(number,scale,integerDigits,'database number');
}
function fabric(row:Row):Fabric{
 const unit=weightUnit(row.weight_unit??null);
 const weight=asDbNumber(row.weight_value,3,9);
 checkWeight(weight,unit);
 return {id:dbId(row.id),fabricNo:String(row.fabric_no),fabricName:String(row.fabric_name),
  composition:row.composition==null?null:String(row.composition),
  weightValue:weight,weightUnit:unit,widthValue:asDbNumber(row.width_value,2,10),
  remark:row.remark==null?null:String(row.remark),isActive:Number(row.is_active)===1};
}
const columnsSql='id,fabric_no,fabric_name,composition,weight_value,weight_unit,width_value,remark,is_active';
async function transaction<T>(pool:Pool,actor:AppPrincipal,work:(db:Query)=>Promise<T>):Promise<T>{
 return withCatalogTransaction(pool,actor,(message,status)=>new FabricError(message,status),'Insufficient fabric permissions',work);
}
function dbConflict(e:unknown):never{
 const code=e&&typeof e==='object'?String((e as {code?:unknown}).code):'';
 if(code==='ER_DUP_ENTRY')throw new FabricError('Fabric number already exists',409);
 if(['ER_ROW_IS_REFERENCED_2','ER_ROW_IS_REFERENCED'].includes(code))
  throw new FabricError('Fabric is referenced',409);
 throw e;
}
function dbFields(x:FabricFields):unknown[]{
 return [x.fabricNo,x.fabricName,x.composition,x.weightValue,x.weightUnit,x.widthValue,x.remark,
  x.isActive?1:0];
}
export async function createFabric(pool:Pool,actor:AppPrincipal,body:unknown):Promise<Fabric>{
 const patch=changes(body,true);
 const fields:FabricFields={fabricNo:patch.fabricNo!,fabricName:patch.fabricName!,
  composition:patch.composition??null,weightValue:patch.weightValue??null,
  weightUnit:patch.weightUnit??null,widthValue:patch.widthValue??null,
  remark:patch.remark??null,isActive:true};
 checkWeight(fields.weightValue,fields.weightUnit);
 try{return await transaction(pool,actor,async db=>{
  const [raw]=await db.query(
   'INSERT INTO v2_fabrics(fabric_no,fabric_name,composition,weight_value,weight_unit,width_value,remark) VALUES (?,?,?,?,?,?,?)',
   dbFields(fields).slice(0,7));
  return {id:dbId((raw as {insertId:unknown}).insertId),...fields};
 });}catch(e){return dbConflict(e);}
}
function listOptions(input:{includeInactive?:boolean;query?:string;fabricNo?:string;fabricName?:string;composition?:string;limit?:number;offset?:number}={}):{
 includeInactive:boolean;query:string;fabricNo?:string;fabricName?:string;composition?:string;limit:number;offset:number
}{
 if(typeof input.includeInactive!=='undefined'&&typeof input.includeInactive!=='boolean')
  throw new FabricError('Invalid inactive filter');
 if(input.query!==undefined&&(typeof input.query!=='string'||[...input.query].length>100||
   /[\p{Cc}\p{Cf}]/u.test(input.query)))throw new FabricError('Invalid search text');
 const limit=input.limit??50,offset=input.offset??0;
 if(!Number.isSafeInteger(limit)||limit<1||limit>100||
    !Number.isSafeInteger(offset)||offset<0||offset>1000000)
  throw new FabricError('Invalid pagination');
 const fields:{fabricNo?:string;fabricName?:string;composition?:string}={};
 for(const key of ['fabricNo','fabricName','composition'] as const){
  const value=input[key];if(value===undefined)continue;
  if(typeof value!=='string'||[...value].length>100||/[\p{Cc}\p{Cf}]/u.test(value))throw new FabricError('Invalid '+key);
  fields[key]=value.trim();
 }
 return {...fields,includeInactive:input.includeInactive??false,query:input.query?.trim()??'',limit,offset};
}
export async function listFabrics(db:Query,options:{
 includeInactive?:boolean;query?:string;fabricNo?:string;fabricName?:string;composition?:string;limit?:number;offset?:number
}={}):Promise<Fabric[]>{
 const params:unknown[]=[];
 const config=listOptions(options);
 let sql='SELECT '+columnsSql+' FROM v2_fabrics WHERE deleted_at IS NULL';
 if(!config.includeInactive)sql+=' AND is_active=1';
 if(config.query){
  const escaped='%'+config.query.replace(/[!%_]/g,c=>'!'+c)+'%';
  sql+=" AND (fabric_no LIKE ? ESCAPE '!' OR fabric_name LIKE ? ESCAPE '!' OR composition LIKE ? ESCAPE '!')";
  params.push(escaped,escaped,escaped);
 }
 for(const [key,column] of [['fabricNo','fabric_no'],['fabricName','fabric_name'],['composition','composition']] as const){
  if(config[key]){sql+=' AND '+column+" LIKE ? ESCAPE '!'";params.push('%'+config[key].replace(/[!%_]/g,c=>'!'+c)+'%');}
 }
 sql+=' ORDER BY fabric_no ASC,id ASC LIMIT ? OFFSET ?';
 params.push(config.limit,config.offset);
 const [raw]=await db.query(sql,params);
 return rows(raw).map(fabric);
}
export async function getFabric(db:Query,id:string):Promise<Fabric>{
 strictId(id);
 const [raw]=await db.query('SELECT '+columnsSql+' FROM v2_fabrics WHERE id=? AND deleted_at IS NULL',[id]);
 const record=rows(raw)[0];if(!record)throw new FabricError('Fabric not found',404);
 return fabric(record);
}
async function locked(db:Query,id:string):Promise<Fabric>{
 const [raw]=await db.query('SELECT '+columnsSql+' FROM v2_fabrics WHERE id=? AND deleted_at IS NULL FOR UPDATE',[id]);
 const record=rows(raw)[0];if(!record)throw new FabricError('Fabric not found',404);
 return fabric(record);
}
async function checkProductReference(db:Query,id:string):Promise<void>{
 const [raw]=await db.query('SELECT id FROM v2_products WHERE fabric_id=? LIMIT 1',[id]);
 if(rows(raw).length)throw new FabricError('Fabric is referenced by products',409);
}
export async function updateFabric(pool:Pool,actor:AppPrincipal,id:string,body:unknown):Promise<Fabric>{
 strictId(id);const patch=changes(body,false);
 try{return await transaction(pool,actor,async db=>{
  const current=await locked(db,id);
  const merged:FabricFields={...current,...patch};
  checkWeight(merged.weightValue,merged.weightUnit);
  if(merged.fabricNo!==current.fabricNo){
   if(await hasSampleCardReference(db,'fabric',id))
    throw new FabricError('Fabric is referenced by sample cards; number cannot change',409);
   await checkProductReference(db,id);
  }
  const [result]=await db.query(
   'UPDATE v2_fabrics SET fabric_no=?,fabric_name=?,composition=?,weight_value=?,weight_unit=?,width_value=?,remark=?,is_active=? WHERE id=?',
   [...dbFields(merged),id]);
  if(Number((result as {affectedRows?:number}).affectedRows)!==1)
   throw new FabricError('Fabric not found',404);
  await markCardsForReprintOnFabricChange(db,id,current,merged);
  return {id,...merged};
 });}catch(e){return dbConflict(e);}
}

/** P5 import uses the same manager/session transaction and domain validator as CRUD.
 * The original fabric number is NEVER writable during an import update.
 */
export async function withFabricImportTransaction<T>(
 pool:Pool,actor:AppPrincipal,run:(db:Query)=>Promise<T>
):Promise<T>{return transaction(pool,actor,run);}
export async function lockedFabricByNumber(db:Query,number:string):Promise<Fabric|null>{
 const code=normalizedNo(number);
 const [raw]=await db.query('SELECT '+columnsSql+' FROM v2_fabrics WHERE fabric_no=? AND deleted_at IS NULL FOR UPDATE',[code]);
 const list=rows(raw);return list.length?fabric(list[0]):null;
}
export async function writeFabricImportRow(
 db:Query,input:Record<string,unknown>,current:Fabric|null
):Promise<Fabric>{
 // No caller-supplied IDs or active flag, no renames, no null-clearing on update.
 const patch=changes(input,true);
 if(current&&patch.fabricNo!==current.fabricNo)
  throw new FabricError('Import cannot rename fabric identity');
 const update=current!==null;
 const output:FabricFields={
  fabricNo:patch.fabricNo!,fabricName:patch.fabricName!,
  composition:patch.composition??(update?current.composition:null),
  weightValue:patch.weightValue??(update?current.weightValue:null),
  weightUnit:patch.weightUnit??(update?current.weightUnit:null),
  widthValue:patch.widthValue??(update?current.widthValue:null),
  remark:patch.remark??(update?current.remark:null),
  isActive:update?current.isActive:true
 };
 checkWeight(output.weightValue,output.weightUnit);
 if(!current){
  const [written]=await db.query(
   'INSERT INTO v2_fabrics(fabric_no,fabric_name,composition,weight_value,weight_unit,width_value,remark) VALUES (?,?,?,?,?,?,?)',
   dbFields(output).slice(0,7));
  return {id:dbId((written as {insertId:unknown}).insertId),...output};
 }
 const [written]=await db.query(
  'UPDATE v2_fabrics SET fabric_name=?,composition=?,weight_value=?,weight_unit=?,width_value=?,remark=? WHERE id=?',
  [output.fabricName,output.composition,output.weightValue,output.weightUnit,output.widthValue,output.remark,current.id]);
 if(Number((written as {affectedRows?:number}).affectedRows)!==1)
  throw new FabricError('Fabric not found',404);
 await markCardsForReprintOnFabricChange(db,current.id,current,output);
 return {id:current.id,...output};
}
export async function deleteFabric(pool:Pool,actor:AppPrincipal,id:string):Promise<{id:string;deleted:true}>{
 strictId(id);
 try{return await transaction(pool,actor,async db=>{
  const current=await locked(db,id);
  await checkProductReference(db,id);
  const hasCards=await hasSampleCardReference(db,'fabric',id);
  await recordDeletion(db,actor,{type:'fabric',id,label:current.fabricNo});
  if(hasCards){
   await db.query("INSERT INTO business_delete_events(entity_type,entity_id,entity_label,actor_user_id) SELECT 'card',CAST(id AS CHAR),card_no,? FROM sample_cards WHERE fabric_id=? AND deleted_at IS NULL",[actor.userId,id]);
   // Keep historical foreign keys; all current cards and QR tokens become unavailable.
   await db.query('UPDATE sample_cards SET deleted_at=UTC_TIMESTAMP(),is_active=0 WHERE fabric_id=? AND deleted_at IS NULL',[id]);
   await db.query('UPDATE sample_card_tokens t JOIN sample_cards c ON c.id=t.card_id SET t.revoked_at=UTC_TIMESTAMP() WHERE c.fabric_id=? AND t.revoked_at IS NULL',[id]);
  }
  const [result]=await db.query(hasCards?
   'UPDATE v2_fabrics SET deleted_at=UTC_TIMESTAMP(),is_active=0 WHERE id=? AND deleted_at IS NULL':
   'DELETE FROM v2_fabrics WHERE id=?',[id]);
  if(Number((result as {affectedRows?:number}).affectedRows)!==1)
   throw new FabricError('Fabric not found',404);
  return {id,deleted:true};
 });}catch(e){return dbConflict(e);}
}
