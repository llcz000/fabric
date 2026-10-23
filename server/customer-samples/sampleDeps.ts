import {transaction} from '../customers/access';
import {lockCustomerSessionAccess} from '../customers/sessionBridge';
import type {AppPrincipal} from '../access/types';
import type {CardScanDependencies} from './cardScanRoutes';
import {persistSampleCardScan,type SamplePool} from './scanRepository';

export interface SampleDb extends SamplePool {
 query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>;
}
const validId=(id:string)=>/^[1-9][0-9]{0,19}$/.test(id)&&BigInt(id)<=18446744073709551615n;
/**
 * B2-2 real dependency wiring for the independent, unmounted card-scan route.
 * The preliminary authorization is only a UX fast-fail: the transaction
 * rechecks session ownership/grant under row locks before touching card data.
 */
export function createMySQLSampleScanDependencies(db:SampleDb):CardScanDependencies {
 return {
  authorize:async (actor:AppPrincipal,sessionId:string)=>{
   if((actor.role!=='sales'&&actor.role!=='admin')||!validId(actor.userId)||!validId(sessionId))return false;
   if(db.customerProfilesEnabled){try{return await transaction(db,actor,async tx=>{const linked=await lockCustomerSessionAccess(tx,actor,sessionId,true);if(linked)return true;const [raw]=await tx.query('SELECT can_manage FROM customer_sample_session_access WHERE session_id=? AND user_id=? AND can_manage=1 FOR SHARE',[sessionId,actor.userId]);return Array.isArray(raw)&&raw.length===1;});}catch{return false;}}
   const [data]=await db.query(`SELECT s.id FROM customer_sample_sessions s
    JOIN customer_sample_session_access a ON a.session_id=s.id
    WHERE s.id=? AND s.status='open' AND s.deleted_at IS NULL AND a.user_id=? AND a.can_manage=1
    LIMIT 1`,[sessionId,actor.userId]);
   if(!Array.isArray(data))throw Error('Invalid authorization result');
   return data.length===1;
  },
  scan:(input,actor)=>persistSampleCardScan(db,actor,input)
 };
}
