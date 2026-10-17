import {hashPassword} from './password';
import type {AppPrincipal,AppRole} from './types';

interface TxConnection {
 beginTransaction():Promise<void>;
 commit():Promise<void>;
 rollback():Promise<void>;
 release():void;
 query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>;
}
export interface MemberTransactionPool {getConnection():Promise<TxConnection>}
export class MemberAccessError extends Error {
 constructor(public readonly status:400|403|404|409,message:string){super(message);}
}
interface NewMember {
 username:string;displayName:string;password:string;role:AppRole;
}
interface MemberPatch {
 role?:AppRole;
 isActive?:boolean;
}
type MemberRow={id:string;role:AppRole;active:boolean};

const usernameOk=(value:unknown):value is string=>
 typeof value==='string' && /^[A-Za-z0-9._]{3,64}$/.test(value);
const userIdOk=(value:string):boolean=>/^[1-9]\d*$/.test(value);
const isRole=(role:unknown):role is AppRole=>role==='admin'||role==='sales';
const bool=(value:unknown):value is boolean=>typeof value==='boolean';

function memberRows(raw:unknown):Record<string,unknown>[] {
 if(!Array.isArray(raw))throw Error('Unexpected user SQL rows');
 return raw as Record<string,unknown>[];
}
async function withTx<T>(pool:MemberTransactionPool,task:(connection:TxConnection)=>Promise<T>):Promise<T>{
 const db=await pool.getConnection();
 let opened=false;
 try{
  await db.beginTransaction();opened=true;
  const value=await task(db);
  await db.commit();opened=false;
  return value;
 }catch(error){
  if(opened) {try {await db.rollback();}catch{/* original exception wins */}}
  throw error;
 }finally{db.release();}
}
async function authorizeAndLockAdmins(connection:TxConnection,actor:AppPrincipal):Promise<number> {
 // Serializable admin mutations: all active admins are locked in a consistent
 // order before changes. Never trust a stale HTTP principal for writes.
 const [activeRaw]=await connection.query(
   "SELECT id FROM v2_access_users WHERE role='admin' AND is_active=1 ORDER BY id FOR UPDATE"
 );
 const active=memberRows(activeRaw);
 const [actorRaw]=await connection.query(
   'SELECT id,role,is_active FROM v2_access_users WHERE id=? FOR UPDATE',[actor.userId]
 );
 const current=memberRows(actorRaw)[0];
 if(!current||current.role!=='admin'||Number(current.is_active)!==1 ||
  !active.some(row=>String(row.id)===actor.userId)) {
  throw new MemberAccessError(403,'Forbidden');
 }
 return active.length;
}
async function lockTarget(connection:TxConnection,id:string):Promise<MemberRow> {
 const [raw]=await connection.query(
   'SELECT id,role,is_active FROM v2_access_users WHERE id=? FOR UPDATE',[id]
 );
 const row=memberRows(raw)[0];
 if(!row||!isRole(row.role))throw new MemberAccessError(404,'Member not found');
 return {id:String(row.id),role:row.role,active:Number(row.is_active)===1};
}
async function revokeSessions(connection:TxConnection,id:string):Promise<void>{
 await connection.query(
   'UPDATE v2_access_sessions SET revoked_at=UTC_TIMESTAMP() WHERE user_id=? AND revoked_at IS NULL',[id]
 );
}
function isDuplicate(error:unknown):boolean{
 return !!error && typeof error==='object' && 'code' in error &&
   (error as {code:unknown}).code==='ER_DUP_ENTRY';
}

export async function createMember(pool:MemberTransactionPool,actor:AppPrincipal,
 input:NewMember):Promise<{id:string;username:string;displayName:string;role:AppRole}> {
 if(actor?.role!=='admin')throw new MemberAccessError(403,'Forbidden');
 if(!input||typeof input!=='object'||Array.isArray(input)||
  Object.keys(input).some(key=>!['username','displayName','password','role'].includes(key))||
  !usernameOk(input.username)||typeof input.displayName!=='string'||
  input.displayName.trim().length<1||input.displayName.trim().length>100||!isRole(input.role)) {
  throw new MemberAccessError(400,'Invalid member');
 }
 // Work outside the lock: scrypt may be slow, and failing passwords do not
 // cause an account transaction.
 let hashed:string;
 try{hashed=await hashPassword(input.password);}catch{throw new MemberAccessError(400,'Invalid password');}
 const usernameNormalized=input.username.toLowerCase();
 try{
  return await withTx(pool,async db=>{
   await authorizeAndLockAdmins(db,actor);
   const [result]=await db.query(
    'INSERT INTO v2_access_users (username,username_normalized,display_name,password_hash,role,can_manage_own_orders,can_manage_products) VALUES (?,?,?,?,?,?,?)',
    [input.username,usernameNormalized,input.displayName.trim(),hashed,input.role,1,1]
   );
   const id=(result as {insertId?:number|bigint|string}).insertId;
   if(id===undefined)throw Error('User creation did not return identity');
   return {id:String(id),username:usernameNormalized,displayName:input.displayName.trim(),role:input.role};
  });
 }catch(error){
  if(isDuplicate(error))throw new MemberAccessError(409,'Member could not be created');
  throw error;
 }
}

export async function changeMember(pool:MemberTransactionPool,actor:AppPrincipal,id:string,patch:MemberPatch):Promise<void>{
 if(actor?.role!=='admin')throw new MemberAccessError(403,'Forbidden');
 if(!userIdOk(id)||!patch||typeof patch!=='object'||Array.isArray(patch)||
  !Object.keys(patch).length||Object.keys(patch).some(key=>!['role','isActive'].includes(key))||
  ('role' in patch && !isRole(patch.role))||
  ('isActive' in patch && !bool(patch.isActive))) {
  throw new MemberAccessError(400,'Invalid member update');
 }
 await withTx(pool,async db=>{
  const activeAdmins=await authorizeAndLockAdmins(db,actor);
  const target=await lockTarget(db,id);
  const newRole=patch.role??target.role;
  const newActive=patch.isActive??target.active;
  if(target.role==='admin'&&target.active && (newRole!=='admin'||!newActive) && activeAdmins<=1)
   throw new MemberAccessError(409,'At least one active administrator is required');
  if('role' in patch) {
   await db.query('UPDATE v2_access_users SET role=? WHERE id=?',[patch.role,id]);
  }
  if('isActive' in patch) {
   await db.query('UPDATE v2_access_users SET is_active=? WHERE id=?',[Number(patch.isActive),id]);
  }
  if(('isActive' in patch && !patch.isActive)||('role' in patch && patch.role!==target.role)){
   await revokeSessions(db,id);
  }
 });
}
export async function resetMemberPassword(pool:MemberTransactionPool,actor:AppPrincipal,id:string,password:string):Promise<void>{
 if(actor?.role!=='admin')throw new MemberAccessError(403,'Forbidden');
 if(!userIdOk(id))throw new MemberAccessError(400,'Invalid member');
 let hashed:string;
 try{hashed=await hashPassword(password);}catch{throw new MemberAccessError(400,'Invalid password');}
 await withTx(pool,async db=>{
  await authorizeAndLockAdmins(db,actor);
  await lockTarget(db,id);
  await db.query('UPDATE v2_access_users SET password_hash=? WHERE id=?',[hashed,id]);
  await revokeSessions(db,id);
 });
}
