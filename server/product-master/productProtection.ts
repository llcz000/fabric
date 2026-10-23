import type {Pool} from '../order-v2/lines';
import type {AppPrincipal} from '../access/types';
import {canManageProducts} from '../access/policy';
import {deleteV2Product,V2ProductError} from './productsV2';
export class ProductMutationError extends Error {
 constructor(message:string,readonly status:400|401|403|404|409=400){super(message);}
}
const MAX='18446744073709551615';
export function assertV2ProductId(value:unknown):asserts value is string {
 if(typeof value!=='string'||!/^[1-9][0-9]{0,19}$/.test(value)||
  BigInt(value)>BigInt(MAX))throw new ProductMutationError('Invalid product id',400);
}
type DB={query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>};
const arr=(raw:unknown):Record<string,unknown>[]=>{
 if(!Array.isArray(raw))throw Error('Product rows unavailable');
 return raw as Record<string,unknown>[];
};
async function lockManager(db:DB,actor:AppPrincipal):Promise<void>{
 if(!actor||!actor.userId||!actor.sessionId)throw new ProductMutationError('Authentication required',401);
 const [users]=await db.query(
  'SELECT id,role,is_active,can_manage_products FROM v2_access_users WHERE id=? FOR SHARE',[actor.userId]);
 const user=arr(users)[0];
 if(!user||Number(user.is_active)!==1||user.role!==actor.role)
  throw new ProductMutationError('Authentication required',401);
 const [sessions]=await db.query(
  'SELECT id FROM v2_access_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR SHARE',
  [actor.sessionId,actor.userId]);
 if(!arr(sessions).length)throw new ProductMutationError('Authentication required',401);
 const actual={...actor,canManageProducts:user.role==='admin'||Number(user.can_manage_products)===1};
 if(!canManageProducts(actual))throw new ProductMutationError('Insufficient product permissions',403);
}
async function inTransaction<T>(pool:Pool,action:(db:DB)=>Promise<T>):Promise<T>{
 const db=await pool.getConnection();let active=false;
 try{
  await db.beginTransaction();active=true;
  const result=await action(db);
  await db.commit();active=false;return result;
 }catch(error){if(active)await db.rollback();throw error;}finally{db.release();}
}
async function lockProduct(db:DB,id:string):Promise<void>{
 const [products]=await db.query('SELECT id,is_active FROM v2_products WHERE id=? FOR UPDATE',[id]);
 if(!arr(products).length)throw new ProductMutationError('Product not found',404);
}
/** Stop usage immediately without detaching order/image references or rewriting snapshots. */
export async function deactivateV2Product(pool:Pool,actor:AppPrincipal,id:string):Promise<{id:string;active:false}>{
 assertV2ProductId(id);
 return inTransaction(pool,async db=>{
  await lockManager(db,actor);
  await lockProduct(db,id);
  await db.query('UPDATE v2_products SET is_active=0,row_version=row_version+1 WHERE id=?',[id]);
  return {id,active:false};
 });
}
/** Legacy P6-5 entrypoint delegates to the SAME P3-4 canonical transaction.
 * That transaction checks order references before mutating any assets, locks
 * product and assets, decrements only its own active links, preserves shared
 * media until the last ref, and maps late MySQL FK races to 409. The wrapper
 * retains ProductMutationError for existing P6 callers and safety routes.
 */
export async function deleteUnusedV2Product(pool:Pool,actor:AppPrincipal,id:string):Promise<{id:string;deleted:true}>{
 assertV2ProductId(id);
 try{return await deleteV2Product(pool,actor,id);}
 catch(error){
  if(error instanceof V2ProductError)throw new ProductMutationError(error.message,error.status);
  throw error;
 }
}
