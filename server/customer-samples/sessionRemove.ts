import type {AppPrincipal} from '../access/types';
import type {SamplePool} from './scanRepository';

export class SampleSessionRemoveError extends Error{
 constructor(readonly status:400|403|404|409){super('Sample selection unavailable');this.name='SampleSessionRemoveError';}
}
export interface SampleSessionRemoval{
 sessionId:string;itemId:string;productId:string;removed:true;
}
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[1-9]\d{0,19}$/.test(value)&&BigInt(value)<=18446744073709551615n;
type Row=Record<string,unknown>;
function rows(raw:unknown):Row[]{
 if(!Array.isArray(raw)||raw.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw new SampleSessionRemoveError(409);
 return raw as Row[];
}
function dbId(raw:unknown):string{
 if(typeof raw==='number'&&!Number.isSafeInteger(raw))throw new SampleSessionRemoveError(409);
 const value=String(raw);if(!validId(value))throw new SampleSessionRemoveError(409);return value;
}
function requireOneWrite(raw:unknown):void{
 if(!raw||typeof raw!=='object'||(raw as {affectedRows?:unknown}).affectedRows!==1)throw new SampleSessionRemoveError(409);
}
/** Soft removal only. Lock order matches scan: current user/login -> session -> grant -> item.
 * The session lock serializes remove/rescan; source rows and first selection stay intact.
 * Removal events are append-only: restoration never updates or deletes their history.
 */
export async function removeSampleSessionItem(
 pool:SamplePool,actor:AppPrincipal,sessionId:string,itemId:string
):Promise<SampleSessionRemoval>{
 if(!actor||(actor.role!=='sales'&&actor.role!=='admin')||!validId(actor.userId)||!validId(actor.sessionId))throw new SampleSessionRemoveError(403);
 if(!validId(sessionId)||!validId(itemId))throw new SampleSessionRemoveError(400);
 const tx=await pool.getConnection();let began=false;
 try{
  await tx.beginTransaction();began=true;
  const [userRaw]=await tx.query('SELECT id,role,is_active FROM v2_access_users WHERE id=? FOR SHARE',[actor.userId]);
  const user=rows(userRaw)[0];
  if(!user||user.role!==actor.role||Number(user.is_active)!==1)throw new SampleSessionRemoveError(403);
  const [loginRaw]=await tx.query('SELECT id FROM v2_access_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR SHARE',[actor.sessionId,actor.userId]);
  if(rows(loginRaw).length!==1)throw new SampleSessionRemoveError(403);
  const [sessionRaw]=await tx.query('SELECT id,status FROM customer_sample_sessions WHERE id=? FOR UPDATE',[sessionId]);
  const session=rows(sessionRaw)[0];if(!session)throw new SampleSessionRemoveError(404);
  const [grantRaw]=await tx.query('SELECT can_manage FROM customer_sample_session_access WHERE session_id=? AND user_id=? AND can_manage=1 FOR UPDATE',[sessionId,actor.userId]);
  const grant=rows(grantRaw);if(grant.length!==1||Number(grant[0].can_manage)!==1)throw new SampleSessionRemoveError(404);
  const [itemRaw]=await tx.query('SELECT id,product_id,removed_at,removed_by_user_id FROM customer_sample_items WHERE session_id=? AND id=? FOR UPDATE',[sessionId,itemId]);
  const selected=rows(itemRaw);if(selected.length===0)throw new SampleSessionRemoveError(404);
  const item=selected[0];if(selected.length!==1||dbId(item.id)!==itemId)throw new SampleSessionRemoveError(409);
  // Missing targets remain 404; only a granted caller with an existing item
  // can learn that this session is read-only.
  if(session.status!=='open')throw new SampleSessionRemoveError(409);
  const productId=dbId(item.product_id);
  if(!Object.hasOwn(item,'removed_at')||!Object.hasOwn(item,'removed_by_user_id')||
   (item.removed_at===null)!==(item.removed_by_user_id===null))throw new SampleSessionRemoveError(409);
  if(item.removed_at===null){
   const [updated]=await tx.query('UPDATE customer_sample_items SET removed_at=UTC_TIMESTAMP(),removed_by_user_id=? WHERE session_id=? AND id=? AND removed_at IS NULL',[actor.userId,sessionId,itemId]);
   requireOneWrite(updated);
   // Copy the exact removal timestamp/actor; no attribute snapshots or source rewrites.
   const [inserted]=await tx.query('INSERT INTO customer_sample_item_removal_events (session_id,product_id,actor_user_id,removed_at) '+
    'SELECT session_id,product_id,removed_by_user_id,removed_at FROM customer_sample_items WHERE session_id=? AND id=?',[sessionId,itemId]);
   requireOneWrite(inserted);
  }else dbId(item.removed_by_user_id);
  await tx.commit();began=false;
  return {sessionId,itemId,productId,removed:true};
 }catch(error){if(began)await tx.rollback();throw error;}finally{tx.release();}
}