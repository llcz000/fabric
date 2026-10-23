import type {AppPrincipal} from '../access/types';import type {SamplePool,SampleTx} from '../customer-samples/scanRepository';
import {CustomerError,rows,id,validCustomerId,type CustomerDTO,parseCustomerProfile} from './model';
export type CustomerPool=SamplePool&{customerProfilesEnabled?:boolean};
export async function identity(tx:SampleTx,actor:AppPrincipal){
 if(!actor||!['admin','sales'].includes(actor.role)||!validCustomerId(actor.userId)||!validCustomerId(actor.sessionId))throw new CustomerError(403);
 const [u]=await tx.query('SELECT id,role,is_active FROM v2_access_users WHERE id=? FOR SHARE',[actor.userId]);const user=rows(u)[0];if(!user||Number(user.is_active)!==1||user.role!==actor.role)throw new CustomerError(403);
 const [s]=await tx.query('SELECT id FROM v2_access_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR SHARE',[actor.sessionId,actor.userId]);if(rows(s).length!==1)throw new CustomerError(403);
}
export async function transaction<T>(pool:SamplePool,actor:AppPrincipal,run:(tx:SampleTx)=>Promise<T>){const tx=await pool.getConnection();let began=false;try{await tx.beginTransaction();began=true;await identity(tx,actor);const result=await run(tx);await tx.commit();began=false;return result;}catch(e){if(began)await tx.rollback();throw e;}finally{tx.release();}}
export function customerScope(actor:AppPrincipal,alias='c',write=false){if(!/^[a-z]+$/.test(alias))throw new CustomerError(503);if(actor.role==='admin')return {sql:'1=1',args:[] as unknown[]};return {sql:`(${alias}.owner_user_id=? OR EXISTS (SELECT 1 FROM customer_access ca WHERE ca.customer_id=${alias}.id AND ca.user_id=?${write?" AND ca.permission='edit'":''}))`,args:[actor.userId,actor.userId] as unknown[]};}
export async function lockCustomer(tx:SampleTx,actor:AppPrincipal,customerId:string,write=false,allowArchived=true){
 if(!validCustomerId(customerId))throw new CustomerError(400);
 const [raw]=await tx.query('SELECT * FROM customers WHERE id=? '+(write?'FOR UPDATE':'FOR SHARE'),[customerId]);const c=rows(raw)[0];if(!c)throw new CustomerError(404);
 const [grants]=await tx.query('SELECT user_id,permission FROM customer_access WHERE customer_id=? ORDER BY user_id FOR SHARE',[customerId]);const access=rows(grants).map(g=>({userId:id(g.user_id),permission:g.permission as 'view'|'edit'}));if(access.some(g=>!['view','edit'].includes(g.permission)))throw new CustomerError(503);
 const owner=String(c.owner_user_id)===actor.userId,admin=actor.role==='admin',permission=access.find(g=>g.userId===actor.userId)?.permission;
 const stored=typeof c.profile_json==='string'?JSON.parse(c.profile_json):c.profile_json;const {deletedAt=null,...profile}=stored;const deleted=deletedAt!==null;
 const canEdit=admin||owner||permission==='edit';if(!(admin||owner||permission)||write&&!canEdit)throw new CustomerError(404);if((!allowArchived&&(c.archived_at!==null||deleted))||(write&&deleted))throw new CustomerError(409);
 return {row:c,dto:{id:id(c.id),profile:parseCustomerProfile(profile),ownerUserId:id(c.owner_user_id),rowVersion:String(c.row_version),archived:c.archived_at!==null,deleted,canDelete:admin&&!deleted,canEdit:canEdit&&!deleted,canManageAccess:admin||owner,canTransferOwner:admin,access:admin||owner?access:[]} as CustomerDTO};
}
