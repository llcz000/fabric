import {recordDeletion} from '../audit/deletionAudit';
import type {AppPrincipal} from '../access/types';
import {withCatalogTransaction} from '../access/catalogTransaction';
import type {Pool} from '../order-v2/lines';
import {hasSampleCardReference} from './sampleCardReferences';
import {replacePatternImage} from './colorwayIdentity';
import {validatePatternDimensions,type PatternDimensions} from '../../src/lib/patternDimensions';

/** P3-1a: isolated master identity service. Tags and HTTP mounting are separate gates. */
export class PatternMasterError extends Error {
 constructor(message:string,readonly status:400|401|403|404|409=400){super(message);}
}
type Row=Record<string,unknown>;
interface Query {query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>}
export interface PatternMaster extends PatternDimensions {id:string;masterNo:string;isActive:boolean;nextColorwayNo:number}
const MAX_ID=18446744073709551615n;
function positiveId(value:unknown):asserts value is string {
 if(typeof value!=='string'||!/^[1-9][0-9]{0,19}$/.test(value)||BigInt(value)>MAX_ID)
  throw new PatternMasterError('Invalid identity');
}
function dbId(value:unknown):string{
 if(typeof value==='number'&&!Number.isSafeInteger(value))throw Error('Unsafe database identity');
 const result=String(value);positiveId(result);return result;
}
function rows(raw:unknown):Row[]{
 if(!Array.isArray(raw))throw Error('Master records unavailable');return raw as Row[];
}
function numberFromDb(value:unknown):number{
 const raw=String(value);
 if(!/^[1-9][0-9]*$/.test(raw)||!Number.isSafeInteger(Number(raw)))throw Error('Invalid persistent counter');
 return Number(raw);
}
function record(row:Row):PatternMaster {
 return {id:dbId(row.id),masterNo:String(row.master_no),
  isActive:Number(row.is_active)===1,nextColorwayNo:numberFromDb(row.next_colorway_no),
  widthCm:row.width_cm==null?null:Number(row.width_cm),heightCm:row.height_cm==null?null:Number(row.height_cm)};
}
function normalizeNo(raw:unknown):string {
 if(typeof raw!=='string')throw new PatternMasterError('Invalid master number');
 const value=raw.trim().toUpperCase();
 if(!/^[A-Z0-9]{1,64}$/.test(value))throw new PatternMasterError('Invalid master number');
 return value;
}
function dimensions(input:Record<string,unknown>):Partial<PatternDimensions>{
 if(!Object.hasOwn(input,'widthCm')&&!Object.hasOwn(input,'heightCm'))return {};
 try{return validatePatternDimensions(input.widthCm,input.heightCm);}
 catch(e){throw new PatternMasterError((e as Error).message);}
}
function createInput(body:unknown):{masterNo:string}&Partial<PatternDimensions> {
 if(!body||typeof body!=='object'||Array.isArray(body)||
   Object.keys(body).some(k=>!['masterNo','widthCm','heightCm'].includes(k))||!Object.hasOwn(body,'masterNo'))
  throw new PatternMasterError('Only masterNo and dimensions may be supplied');
 const input=body as Record<string,unknown>;
 return {masterNo:normalizeNo(input.masterNo),...dimensions(input)};
}
function patchInput(body:unknown):{masterNo?:string;isActive?:boolean}&Partial<PatternDimensions>{
 if(!body||typeof body!=='object'||Array.isArray(body)||
    Object.keys(body).some(k=>!['masterNo','isActive','widthCm','heightCm'].includes(k)))
  throw new PatternMasterError('Only masterNo, isActive and dimensions may be supplied');
 const input=body as Record<string,unknown>;
 if('isActive' in input&&input.isActive!==true)throw new PatternMasterError('Invalid status');
 return { ...('masterNo' in input?{masterNo:normalizeNo(input.masterNo)}:{}),
  ...('isActive' in input?{isActive:input.isActive as boolean}:{}),...dimensions(input) };
}
async function transaction<T>(pool:Pool,actor:AppPrincipal,work:(db:Query)=>Promise<T>):Promise<T>{
 return withCatalogTransaction(pool,actor,(message,status)=>new PatternMasterError(message,status),'Insufficient product permissions',work);
}
async function selected(db:Query,identity:string):Promise<Row>{
 const [raw]=await db.query('SELECT id,master_no,is_active,next_colorway_no,width_cm,height_cm FROM pattern_masters WHERE id=? AND deleted_at IS NULL FOR UPDATE',[identity]);
 const row=rows(raw)[0];if(!row)throw new PatternMasterError('Pattern master not found',404);
 return row;
}
function referenceConflict(error:unknown):never{
 if(error&&typeof error==='object'&&
  ['ER_ROW_IS_REFERENCED','ER_ROW_IS_REFERENCED_2'].includes(String((error as {code?:unknown}).code)))
  throw new PatternMasterError('Pattern master is referenced',409);
 if(error&&typeof error==='object'&&String((error as {code?:unknown}).code)==='ER_DUP_ENTRY')
  throw new PatternMasterError('Master number already exists',409);
 throw error;
}
export async function createPatternMaster(pool:Pool,actor:AppPrincipal,body:unknown):Promise<PatternMaster>{
 const input=createInput(body),{masterNo}=input;
 try{
  return await transaction(pool,actor,async db=>{
   const widthCm=input.widthCm??null,heightCm=input.heightCm??null;
   const [result]=await db.query('INSERT INTO pattern_masters(master_no,width_cm,height_cm) VALUES (?,?,?)',[masterNo,widthCm,heightCm]);
   return {id:dbId((result as {insertId:unknown}).insertId),masterNo,isActive:true,nextColorwayNo:1,widthCm,heightCm};
  });
 }catch(e){return referenceConflict(e);}
}
/** Internal list only; routes must enforce bearer credentials for this read. */
export async function listPatternMasters(db:Query,options:{includeInactive?:boolean}={}):Promise<PatternMaster[]>{
 const sql='SELECT id,master_no,is_active,next_colorway_no,width_cm,height_cm FROM pattern_masters'+
  ' WHERE deleted_at IS NULL'+(options.includeInactive?'':' AND is_active=1')+' ORDER BY master_no ASC,id ASC';
 const [raw]=await db.query(sql);
 return rows(raw).map(record);
}
export async function updatePatternMaster(pool:Pool,actor:AppPrincipal,identity:string,body:unknown):Promise<PatternMaster>{
 positiveId(identity);const patch=patchInput(body);
 try{
  return await transaction(pool,actor,async db=>{
   const existing=await selected(db,identity);
   const masterNo=patch.masterNo??String(existing.master_no);
   const isActive=patch.isActive??(Number(existing.is_active)===1);
   if(masterNo!==String(existing.master_no)){
    if(await hasSampleCardReference(db,'master',identity))
     throw new PatternMasterError('Pattern master is referenced by sample cards; number cannot change',409);
    // Hold locks on child rows before reading product references: a concurrent
    // product insert needs an FK SHARE lock on its colorway, and must wait.
    await db.query('SELECT id FROM pattern_colorways WHERE master_id=? FOR UPDATE',[identity]);
    const [raw]=await db.query('SELECT p.id FROM v2_products p JOIN pattern_colorways c ON c.id=p.pattern_colorway_id WHERE c.master_id=? LIMIT 1',[identity]);
    if(rows(raw).length)throw new PatternMasterError('Referenced master number cannot change',409);
   }
   const width=patch.widthCm===undefined?(existing.width_cm??null):patch.widthCm;
   const height=patch.heightCm===undefined?(existing.height_cm??null):patch.heightCm;
   await db.query('UPDATE pattern_masters SET master_no=?,is_active=?,width_cm=?,height_cm=? WHERE id=?',[masterNo,isActive?1:0,width,height,identity]);
   return record({...existing,master_no:masterNo,is_active:isActive?1:0,width_cm:width,height_cm:height});
  });
 }catch(e){return referenceConflict(e);}
}
export async function deletePatternMaster(pool:Pool,actor:AppPrincipal,identity:string):Promise<{id:string;deleted:true}>{
 positiveId(identity);
 try{
  return await transaction(pool,actor,async db=>{
   const current=await selected(db,identity);
   if(await hasSampleCardReference(db,'master',identity,true))
    throw new PatternMasterError('Pattern master is referenced by sample cards',409);
   // Lock all child rows first to serialize against concurrent product FK inserts.
   const [versionsRaw]=await db.query(
    'SELECT id,pattern_image_asset_id FROM pattern_colorways WHERE master_id=? ORDER BY id FOR UPDATE',[identity]);
   const versions=rows(versionsRaw);
   const [products]=await db.query('SELECT p.id FROM v2_products p JOIN pattern_colorways c ON c.id=p.pattern_colorway_id WHERE c.master_id=? LIMIT 1',[identity]);
   if(rows(products).length)throw new PatternMasterError('Pattern master is referenced by products',409);
   await recordDeletion(db,actor,{type:'pattern',id:identity,label:String(current.master_no)});
   // Shared asset reference counts and all deletions are in one transaction.
   for(const version of versions)if(version.pattern_image_asset_id!=null)
    await replacePatternImage(db,dbId(version.id),String(version.pattern_image_asset_id),null);
   if(versions.length){
    const [removed]=await db.query('DELETE FROM pattern_colorways WHERE master_id=?',[identity]);
    if(Number((removed as {affectedRows?:number}).affectedRows)!==versions.length)
     throw Error('Pattern colorway deletion count mismatch');
   }
   const [result]=await db.query('UPDATE pattern_masters SET deleted_at=UTC_TIMESTAMP(),is_active=0 WHERE id=? AND deleted_at IS NULL',[identity]);
   if(Number((result as {affectedRows?:number}).affectedRows)!==1)throw new PatternMasterError('Pattern master not found',404);
   return {id:identity,deleted:true as const};
  });
 }catch(e){return referenceConflict(e);}
}
