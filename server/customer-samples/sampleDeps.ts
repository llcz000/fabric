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
   if(actor.role!=='sales'||!validId(actor.userId)||!validId(sessionId))return false;
   const [data]=await db.query(`SELECT s.id FROM customer_sample_sessions s
    JOIN customer_sample_session_access a ON a.session_id=s.id
    WHERE s.id=? AND s.status='open' AND a.user_id=? AND a.can_manage=1
    LIMIT 1`,[sessionId,actor.userId]);
   if(!Array.isArray(data))throw Error('Invalid authorization result');
   return data.length===1;
  },
  scan:(input,actor)=>persistSampleCardScan(db,actor,input)
 };
}
