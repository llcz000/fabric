import type {AppPrincipal} from '../access/types';
import {canManageProducts} from '../access/policy';
import type {Pool} from '../order-v2/lines';
import {hasSampleCardReference} from './sampleCardReferences';

/** P3-1a: isolated master identity service. Tags and HTTP mounting are separate gates. */
export class PatternMasterError extends Error {
 constructor(message:string,readonly status:400|401|403|404|409=400){super(message);}
}
type Row=Record<string,unknown>;
interface Query {query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>}
export interface PatternMaster {id:string;masterNo:string;isActive:boolean;nextColorwayNo:number}
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
  isActive:Number(row.is_active)===1,nextColorwayNo:numberFromDb(row.next_colorway_no)};
}
function normalizeNo(raw:unknown):string {
 if(typeof raw!=='string')throw new PatternMasterError('Invalid master number');
 const value=raw.trim().toUpperCase();
 if(!/^[A-Z0-9]{1,64}$/.test(value))throw new PatternMasterError('Invalid master number');
 return value;
}
function createInput(body:unknown):string {
 if(!body||typeof body!=='object'||Array.isArray(body)||
   Object.keys(body).length!==1||!Object.hasOwn(body,'masterNo'))
  throw new PatternMasterError('Only masterNo may be supplied');
 return normalizeNo((body as Record<string,unknown>).masterNo);
}
function patchInput(body:unknown):{masterNo?:string;isActive?:boolean}{
 if(!body||typeof body!=='object'||Array.isArray(body)||
    Object.keys(body).some(k=>!['masterNo','isActive'].includes(k)))
  throw new PatternMasterError('Only masterNo and isActive may be supplied');
 const input=body as Record<string,unknown>;
 if('isActive' in input&&typeof input.isActive!=='boolean')throw new PatternMasterError('Invalid status');
 return { ...('masterNo' in input?{masterNo:normalizeNo(input.masterNo)}:{}),
  ...('isActive' in input?{isActive:input.isActive as boolean}:{}) };
}
async function verifyManager(db:Query,actor:AppPrincipal):Promise<void>{
 if(!actor?.userId||!actor.sessionId)throw new PatternMasterError('Authentication required',401);
 const [users]=await db.query('SELECT id,role,is_active,can_manage_products FROM v2_access_users WHERE id=? FOR SHARE',[actor.userId]);
 const user=rows(users)[0];
 if(!user||user.role!==actor.role||Number(user.is_active)!==1)
  throw new PatternMasterError('Authentication required',401);
 const [sessions]=await db.query('SELECT id FROM v2_access_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR SHARE',[actor.sessionId,actor.userId]);
 if(!rows(sessions).length)throw new PatternMasterError('Authentication required',401);
 if(!canManageProducts({...actor,canManageProducts:user.role==='admin'||Number(user.can_manage_products)===1}))
  throw new PatternMasterError('Insufficient product permissions',403);
}
async function transaction<T>(pool:Pool,actor:AppPrincipal,fn:(db:Query)=>Promise<T>):Promise<T>{
 const db=await pool.getConnection();let started=false;
 try{
  await db.beginTransaction();started=true;
  await verifyManager(db,actor);
  const value=await fn(db);await db.commit();started=false;return value;
 }catch(error){if(started)await db.rollback();throw error;}finally{db.release();}
}
async function selected(db:Query,identity:string):Promise<Row>{
 const [raw]=await db.query('SELECT id,master_no,is_active,next_colorway_no FROM pattern_masters WHERE id=? FOR UPDATE',[identity]);
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
 const masterNo=createInput(body);
 try{
  return await transaction(pool,actor,async db=>{
   const [result]=await db.query('INSERT INTO pattern_masters(master_no) VALUES (?)',[masterNo]);
   return {id:dbId((result as {insertId:unknown}).insertId),masterNo,isActive:true,nextColorwayNo:1};
  });
 }catch(e){return referenceConflict(e);}
}
/** Internal list only; routes must enforce bearer credentials for this read. */
export async function listPatternMasters(db:Query,options:{includeInactive?:boolean}={}):Promise<PatternMaster[]>{
 const sql='SELECT id,master_no,is_active,next_colorway_no FROM pattern_masters'+
  (options.includeInactive?'':' WHERE is_active=1')+' ORDER BY master_no ASC,id ASC';
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
   await db.query('UPDATE pattern_masters SET master_no=?,is_active=? WHERE id=?',[masterNo,isActive?1:0,identity]);
   return record({...existing,master_no:masterNo,is_active:isActive?1:0});
  });
 }catch(e){return referenceConflict(e);}
}
export async function deletePatternMaster(pool:Pool,actor:AppPrincipal,identity:string):Promise<{id:string;deleted:true}>{
 positiveId(identity);
 try{
  return await transaction(pool,actor,async db=>{
   await selected(db,identity);
   if(await hasSampleCardReference(db,'master',identity))
    throw new PatternMasterError('Pattern master is referenced by sample cards; deactivate instead',409);
   const [versions]=await db.query('SELECT id FROM pattern_colorways WHERE master_id=? LIMIT 1',[identity]);
   if(rows(versions).length)throw new PatternMasterError('Delete colorways before master',409);
   const [products]=await db.query('SELECT p.id FROM v2_products p JOIN pattern_colorways c ON c.id=p.pattern_colorway_id WHERE c.master_id=? LIMIT 1',[identity]);
   if(rows(products).length)throw new PatternMasterError('Pattern master is referenced',409);
   const [result]=await db.query('DELETE FROM pattern_masters WHERE id=?',[identity]);
   if(Number((result as {affectedRows?:number}).affectedRows)!==1)throw new PatternMasterError('Pattern master not found',404);
   return {id:identity,deleted:true as const};
  });
 }catch(e){return referenceConflict(e);}
}