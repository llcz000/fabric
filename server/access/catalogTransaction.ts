import type {AppPrincipal} from './types';
import {canManageProducts} from './policy';
import type {Pool,TxConn} from '../order-v2/lines';

type CatalogErrorFactory=(message:string,status:401|403)=>Error;
function rows(raw:unknown):Record<string,unknown>[]{
 if(!Array.isArray(raw))throw Error('Catalog access records unavailable');
 return raw as Record<string,unknown>[];
}

/** Keep access locks inside the write transaction, before domain row locks.
 * Deprecated grant columns remain in the SELECT for schema compatibility;
 * live registered roles determine current catalog capabilities.
 */
async function requireCatalogManager(db:TxConn,actor:AppPrincipal,error:CatalogErrorFactory,deniedMessage:string):Promise<void>{
 if(!actor?.userId||!actor.sessionId)throw error('Authentication required',401);
 const [users]=await db.query(
  'SELECT id,role,is_active,can_manage_products FROM v2_access_users WHERE id=? FOR SHARE',[actor.userId]);
 const user=rows(users)[0];
 if(!user||Number(user.is_active)!==1||user.role!==actor.role)throw error('Authentication required',401);
 const [sessions]=await db.query(
  'SELECT id FROM v2_access_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR SHARE',
  [actor.sessionId,actor.userId]);
 if(!rows(sessions).length)throw error('Authentication required',401);
 if(!canManageProducts(actor))throw error(deniedMessage,403);
}

/** One connection, one transaction, no retries; domain work owns its row locks. */
export async function withCatalogTransaction<T>(pool:Pool,actor:AppPrincipal,error:CatalogErrorFactory,
 deniedMessage:string,work:(db:TxConn)=>Promise<T>):Promise<T>{
 const db=await pool.getConnection();let started=false;
 try{
  await db.beginTransaction();started=true;
  await requireCatalogManager(db,actor,error,deniedMessage);
  const result=await work(db);
  await db.commit();started=false;
  return result;
 }catch(cause){
  if(started)await db.rollback();
  throw cause;
 }finally{db.release();}
}
