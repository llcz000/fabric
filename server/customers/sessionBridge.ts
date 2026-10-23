import type {AppPrincipal} from '../access/types';import type {SamplePool,SampleTx} from '../customer-samples/scanRepository';
import {CustomerError,rows,id} from './model';import {lockCustomer,customerScope} from './access';
/** All linked-session operations use identity -> customer -> link/session; no legacy grant bypass. */
export async function lockCustomerSessionAccess(tx:SampleTx,actor:AppPrincipal,sessionId:string,write:boolean){
 if(!tx.customerProfilesEnabled)return null;
 const [located]=await tx.query('SELECT customer_id,row_version FROM customer_session_links WHERE session_id=?',[sessionId]);const found=rows(located)[0];
 let permission:Awaited<ReturnType<typeof lockCustomer>>|null=null;
 if(found?.customer_id!=null)permission=await lockCustomer(tx,actor,id(found.customer_id),write,!write);
 const [session]=await tx.query('SELECT id,status FROM customer_sample_sessions WHERE id=? AND deleted_at IS NULL '+(write?'FOR UPDATE':'FOR SHARE'),[sessionId]);if(rows(session).length!==1)throw new CustomerError(404);
 const [current]=await tx.query('SELECT customer_id,row_version FROM customer_session_links WHERE session_id=? FOR SHARE',[sessionId]);const fresh=rows(current)[0];
 if(Boolean(found)!==Boolean(fresh)||found&&fresh&&(String(found.customer_id)!==String(fresh.customer_id)||String(found.row_version)!==String(fresh.row_version)))throw new CustomerError(409);
 return permission?{customerId:permission.dto.id,canEdit:permission.dto.canEdit&&!permission.dto.archived}:null;
}
export function sampleSessionScope(actor:AppPrincipal,alias='s',write=false){const scope=customerScope(actor,'c',write);return {sql:`(EXISTS (SELECT 1 FROM customer_session_links cl JOIN customers c ON c.id=cl.customer_id WHERE cl.session_id=${alias}.id AND ${scope.sql}${write?" AND c.archived_at IS NULL AND JSON_EXTRACT(c.profile_json,'$.deletedAt') IS NULL":''}) OR (NOT EXISTS (SELECT 1 FROM customer_session_links cl WHERE cl.session_id=${alias}.id AND cl.customer_id IS NOT NULL) AND EXISTS (SELECT 1 FROM customer_sample_session_access a WHERE a.session_id=${alias}.id AND a.user_id=? AND a.can_manage=1)))`,args:[...scope.args,actor.userId]};}
/** Decorate only a schema-verified pool. Missing schema never activates linking/ACL logic. */
export function customerEnabledPool<T extends SamplePool>(pool:T):T&{customerProfilesEnabled:true}{return {...pool,customerProfilesEnabled:true,getConnection:async()=>{const tx=await pool.getConnection();return {customerProfilesEnabled:true,query:tx.query.bind(tx),beginTransaction:tx.beginTransaction.bind(tx),commit:tx.commit.bind(tx),rollback:tx.rollback.bind(tx),release:tx.release.bind(tx)};}};}
