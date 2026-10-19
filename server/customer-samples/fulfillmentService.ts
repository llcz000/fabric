import type {AppPrincipal} from '../access/types';
import type {SamplePool,SampleTx} from './scanRepository';
import {lockSelectionAccess,SampleSessionManualError,validSelectionId} from './sessionManual';
import {prepareShipmentBatch,ShipmentBatchError} from './shipmentBatch';
import {prepareSampleFollowup,SampleFollowupError} from './followupDraft';

export class SampleFulfillmentError extends Error {
 constructor(readonly status:400|403|404|409){super('Sample fulfillment unavailable');this.name='SampleFulfillmentError';}
}
type Row=Record<string,unknown>;
function rows(value:unknown):Row[]{
 if(!Array.isArray(value)||value.some(v=>!v||typeof v!=='object'||Array.isArray(v)))throw new SampleFulfillmentError(409);
 return value as Row[];
}
function inserted(value:unknown):string{
 if(!value||typeof value!=='object'||(value as {affectedRows?:unknown}).affectedRows!==1)throw new SampleFulfillmentError(409);
 const raw=(value as {insertId?:unknown}).insertId;
 if(typeof raw==='number'&&!Number.isSafeInteger(raw))throw new SampleFulfillmentError(409);
 const id=String(raw);if(!validSelectionId(id))throw new SampleFulfillmentError(409);return id;
}
function written(value:unknown):void{
 if(!value||typeof value!=='object'||(value as {affectedRows?:unknown}).affectedRows!==1)throw new SampleFulfillmentError(409);
}
function serverSelected(value:unknown):{itemId:string;productId:string;removedAt:null}[]{
 const selected=rows(value),seen=new Set<string>(),items=new Set<string>();
 return selected.map(x=>{
  const rawId=x.id,rawProduct=x.product_id;
  if(typeof rawId==='number'&&!Number.isSafeInteger(rawId)||
   typeof rawProduct==='number'&&!Number.isSafeInteger(rawProduct))throw new SampleFulfillmentError(409);
  const itemId=String(rawId),productId=String(rawProduct);
  if(!validSelectionId(itemId)||!validSelectionId(productId)||x.removed_at!==null||
   seen.has(productId)||items.has(itemId))throw new SampleFulfillmentError(409);
  seen.add(productId);items.add(itemId);
  return {itemId,productId,removedAt:null};
 });
}
const sqlItems='SELECT id,product_id,removed_at FROM customer_sample_items WHERE session_id=? AND removed_at IS NULL ORDER BY id FOR UPDATE';
async function authorizedWrite<T>(
 pool:SamplePool,actor:AppPrincipal,sessionId:string,run:(tx:SampleTx,selected:ReturnType<typeof serverSelected>)=>Promise<T>
):Promise<T>{
 if(!actor||(actor.role!=='admin'&&actor.role!=='sales')||!validSelectionId(actor.userId)||
  !validSelectionId(actor.sessionId))throw new SampleFulfillmentError(403);
 if(!validSelectionId(sessionId))throw new SampleFulfillmentError(400);
 const tx=await pool.getConnection();let began=false;
 try{
  await tx.beginTransaction();began=true;
  await lockSelectionAccess(tx,actor,sessionId,true);
  const [raw]=await tx.query(sqlItems,[sessionId]);
  const selected=serverSelected(raw);
  const result=await run(tx,selected);
  await tx.commit();began=false;
  return result;
 }catch(error){
  if(began)await tx.rollback();
  if(error instanceof SampleSessionManualError)throw new SampleFulfillmentError(error.status);
  if(error instanceof ShipmentBatchError||error instanceof SampleFollowupError)throw new SampleFulfillmentError(409);
  throw error;
 }finally{tx.release();}
}
export async function saveShipmentBatch(pool:SamplePool,actor:AppPrincipal,input:unknown){
 const sessionId=(input as {sessionId?:unknown}|null)?.sessionId;
 if(!validSelectionId(sessionId))throw new SampleFulfillmentError(400);
 return authorizedWrite(pool,actor,sessionId,async(tx,selected)=>{
  const batch=prepareShipmentBatch(input,selected,{sessionId});
  const [header]=await tx.query(
   'INSERT INTO sample_shipments (session_id,actor_user_id,shipped_at,carrier,tracking_no) VALUES (?,?,STR_TO_DATE(?,\'%Y-%m-%dT%H:%i:%s.%fZ\'),?,?)',
   [sessionId,actor.userId,batch.shippedAt,batch.carrier,batch.trackingNo]);
  const id=inserted(header);
  for(const line of batch.items){
   const [write]=await tx.query(
    'INSERT INTO sample_shipment_items (shipment_id,session_id,product_id,quantity) VALUES (?,?,?,?)',
    [id,sessionId,line.productId,line.quantity]);
   written(write);
  }
  return {id,sessionId,itemCount:batch.items.length};
 });
}
export async function saveSampleFollowup(pool:SamplePool,actor:AppPrincipal,input:unknown){
 const sessionId=(input as {sessionId?:unknown}|null)?.sessionId;
 if(!validSelectionId(sessionId))throw new SampleFulfillmentError(400);
 return authorizedWrite(pool,actor,sessionId,async(tx,selected)=>{
  const draft=prepareSampleFollowup(input,selected,{sessionId});
  const [header]=await tx.query(
   'INSERT INTO sample_followups (session_id,actor_user_id,contacted_on,customer_confirmed,feedback,outcome,next_action,next_followup_on) VALUES (?,?,?,?,?,?,?,?)',
   [sessionId,actor.userId,draft.contactedOn,draft.customerConfirmed===null?null:Number(draft.customerConfirmed),
    draft.feedback,draft.outcome,draft.nextAction,draft.nextFollowupOn]);
  const id=inserted(header);
  for(const productId of draft.productIds){
   const [write]=await tx.query(
    'INSERT INTO sample_followup_products (followup_id,session_id,product_id) VALUES (?,?,?)',
    [id,sessionId,productId]);
   written(write);
  }
  return {id,sessionId,linkedProductCount:draft.productIds.length};
 });
}
