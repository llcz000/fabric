import {verifyCustomerOrderSchema} from './orderLinkSchema';
import type {SamplePool} from '../customer-samples/scanRepository';import {customerEnabledPool} from './sessionBridge';import {verifyCustomerSchema,type CustomerSchemaTarget} from './schema';
/** SELECT-only capability gate. A damaged existing module cannot fall back to stale legacy grants. */
export async function prepareCustomerRuntime<T extends SamplePool>(pool:T,target:CustomerSchemaTarget,verify:typeof verifyCustomerSchema=async(p,t)=>{await verifyCustomerSchema(p,t);await verifyCustomerOrderSchema(p,t);}){
 try{await verify(pool,target);return {pool:customerEnabledPool(pool),enabled:true,unavailable:false};}
 catch{
  let unavailable=true;const tx=await pool.getConnection();
  try{const [raw]=await tx.query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('customers','customer_access','customer_session_links','customer_requests','customer_followups','customer_followup_tasks','customer_profile_events')");if(Array.isArray(raw))unavailable=raw.length!==0;}catch{/* Unknown schema fails closed for sample operations. */}finally{tx.release();}
  return {pool,enabled:false,unavailable};
 }
}
