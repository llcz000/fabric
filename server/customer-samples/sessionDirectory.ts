import type {AppPrincipal} from '../access/types';
import type {SamplePool,SampleTx} from './scanRepository';
import {lockSelectionIdentity,lockSelectionAccess,selectionRows,selectionDbId,validSelectionId,SampleSessionManualError} from './sessionManual';
export interface SampleSessionSummary{id:string;customerReference:string;status:'open'|'closed'}
export async function updateSampleSession(pool:SamplePool,actor:AppPrincipal,sessionId:string,input:unknown):Promise<SampleSessionSummary>{
 if(!validSelectionId(sessionId)||!input||typeof input!=='object'||Array.isArray(input))throw invalid();
 const body=input as Record<string,unknown>;
 if(Object.keys(body).length!==2||typeof body.customerReference!=='string'||typeof body.expectedCustomerReference!=='string'||!body.customerReference.trim()||body.customerReference.trim().length>160||/[\p{Cc}\p{Cf}]/u.test(body.customerReference))throw invalid();
 return transaction(pool,async tx=>{
  await lockSelectionAccess(tx,actor,sessionId,true);
  const [raw]=await tx.query('SELECT id,customer_reference,status FROM customer_sample_sessions WHERE id=? AND deleted_at IS NULL FOR UPDATE',[sessionId]);
  const current=selectionRows(raw)[0];if(!current)throw new SampleSessionManualError(404);
  if(current.customer_reference!==body.expectedCustomerReference)throw new SampleSessionManualError(409);
  const name=(body.customerReference as string).trim();
  const [write]=await tx.query('UPDATE customer_sample_sessions SET customer_reference=? WHERE id=? AND customer_reference=? AND deleted_at IS NULL',[name,sessionId,body.expectedCustomerReference]);
  if((write as {affectedRows?:unknown})?.affectedRows!==1)throw new SampleSessionManualError(409);
  return summary({...current,customer_reference:name});
 });
}
export async function deleteSampleSession(pool:SamplePool,actor:AppPrincipal,sessionId:string):Promise<{id:string;deleted:true}>{
 if(!validSelectionId(sessionId))throw invalid();
 return transaction(pool,async tx=>{
  await lockSelectionAccess(tx,actor,sessionId,true,true);
  const [current]=await tx.query('SELECT id,customer_reference,status FROM customer_sample_sessions WHERE id=? AND deleted_at IS NULL FOR UPDATE',[sessionId]);
  if(selectionRows(current).length!==1)throw new SampleSessionManualError(404);
  const [write]=await tx.query("UPDATE customer_sample_sessions SET deleted_at=UTC_TIMESTAMP(),deleted_by_user_id=?,status='closed' WHERE id=? AND deleted_at IS NULL",[actor.userId,sessionId]);
  if((write as {affectedRows?:unknown})?.affectedRows!==1)throw new SampleSessionManualError(409);
  return {id:sessionId,deleted:true};
 });
}
export async function changeSampleSessionStatus(pool:SamplePool,actor:AppPrincipal,sessionId:string,input:unknown):Promise<SampleSessionSummary>{
 if(!validSelectionId(sessionId)||!input||typeof input!=='object'||Array.isArray(input))throw invalid();
 const body=input as Record<string,unknown>;
 if(Object.keys(body).length!==2||typeof body.status!=='string'||typeof body.expectedStatus!=='string'||!['open','closed'].includes(body.status)||!['open','closed'].includes(body.expectedStatus)||body.status===body.expectedStatus)throw invalid();
 return transaction(pool,async tx=>{
  await lockSelectionIdentity(tx,actor);
  const [sessions]=await tx.query('SELECT id,customer_reference,status FROM customer_sample_sessions WHERE id=? AND deleted_at IS NULL FOR UPDATE',[sessionId]);
  const session=selectionRows(sessions)[0];if(!session)throw new SampleSessionManualError(404);
  const [access]=await tx.query('SELECT can_manage FROM customer_sample_session_access WHERE session_id=? AND user_id=? AND can_manage=1 FOR UPDATE',[sessionId,actor.userId]);
  const grants=selectionRows(access);if(grants.length!==1||Number(grants[0].can_manage)!==1)throw new SampleSessionManualError(404);
  if(session.status!==body.expectedStatus)throw new SampleSessionManualError(409);
  const [result]=await tx.query('UPDATE customer_sample_sessions SET status=? WHERE id=? AND status=?',[body.status,sessionId,body.expectedStatus]);
  if((result as {affectedRows?:unknown})?.affectedRows!==1)throw new SampleSessionManualError(409);
  return summary({...session,status:body.status});
 });
}
export interface SampleSessionDirectory{items:SampleSessionSummary[];total:number;limit:number;offset:number}
export interface SampleShipmentProgress{sessionId:string;selectedProducts:number;shippedProducts:number;pendingProducts:number;shippedQuantity:number}
async function transaction<T>(pool:SamplePool,run:(tx:SampleTx)=>Promise<T>):Promise<T>{
 const tx=await pool.getConnection();let began=false;
 try{await tx.beginTransaction();began=true;const result=await run(tx);await tx.commit();began=false;return result;}
 catch(error){if(began)await tx.rollback();throw error;}finally{tx.release();}
}
const invalid=()=>new SampleSessionManualError(400);
function count(raw:unknown){const n=Number(raw);if((typeof raw!=='number'&&!(typeof raw==='string'&&/^\d+$/.test(raw)))||!Number.isSafeInteger(n)||n<0)throw new SampleSessionManualError(409);return n;}
function summary(raw:Record<string,unknown>):SampleSessionSummary{
 if(typeof raw.customer_reference!=='string'||!raw.customer_reference.trim()||raw.customer_reference.length>160||!['open','closed'].includes(String(raw.status)))throw new SampleSessionManualError(409);
 return {id:selectionDbId(raw.id),customerReference:raw.customer_reference,status:raw.status as 'open'|'closed'};
}
export async function createSampleSession(pool:SamplePool,actor:AppPrincipal,input:unknown):Promise<SampleSessionSummary>{
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||!('customerReference' in input)||typeof input.customerReference!=='string'||/[\p{Cc}\p{Cf}]/u.test(input.customerReference))throw invalid();
 const reference=input.customerReference.trim();if(!reference||reference.length>160)throw invalid();
 return transaction(pool,async tx=>{
  await lockSelectionIdentity(tx,actor);
  const [write]=await tx.query('INSERT INTO customer_sample_sessions (customer_reference,created_by_user_id) VALUES (?,?)',[reference,actor.userId]);
  const result=write as {affectedRows?:unknown;insertId?:unknown};if(result?.affectedRows!==1)throw new SampleSessionManualError(409);
  const id=selectionDbId(result.insertId);
  const [grant]=await tx.query('INSERT INTO customer_sample_session_access (session_id,user_id,can_manage) VALUES (?,?,1)',[id,actor.userId]);
  if((grant as {affectedRows?:unknown})?.affectedRows!==1)throw new SampleSessionManualError(409);
  return {id,customerReference:reference,status:'open'};
 });
}
export async function listSampleSessions(pool:SamplePool,actor:AppPrincipal,input:{query?:string;limit?:number;offset?:number}):Promise<SampleSessionDirectory>{
 const {query='',limit=20,offset=0}=input;
 if(Object.keys(input).some(k=>!['query','limit','offset'].includes(k))||typeof query!=='string'||query.length>160||/[\p{Cc}\p{Cf}]/u.test(query)||!Number.isSafeInteger(limit)||limit<1||limit>50||!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw invalid();
 return transaction(pool,async tx=>{
  await lockSelectionIdentity(tx,actor);
  const keyword=query.trim(),args:unknown[]=[actor.userId];
  let from=' FROM customer_sample_sessions s JOIN customer_sample_session_access a ON a.session_id=s.id WHERE a.user_id=? AND a.can_manage=1 AND s.deleted_at IS NULL';
  if(keyword){from+=" AND s.customer_reference LIKE ? ESCAPE '!'";args.push('%'+keyword.replace(/[!%_]/g,'!$&')+'%');}
  const [totals]=await tx.query('SELECT COUNT(*) AS total'+from,args);
  const found=selectionRows(totals);if(found.length!==1)throw new SampleSessionManualError(409);
  const total=count(found[0].total);
  const [data]=await tx.query('SELECT CAST(s.id AS CHAR) AS id,s.customer_reference,s.status'+from+' ORDER BY s.id DESC LIMIT ? OFFSET ?',[...args,limit,offset]);
  const items=selectionRows(data).map(summary);
  if(items.length!==Math.min(limit,Math.max(0,total-offset))||new Set(items.map(x=>x.id)).size!==items.length)throw new SampleSessionManualError(409);
  return {items,total,limit,offset};
 });
}
export async function readShipmentProgress(pool:SamplePool,actor:AppPrincipal,sessionId:string):Promise<SampleShipmentProgress>{
 if(!validSelectionId(sessionId))throw invalid();
 return transaction(pool,async tx=>{
  await lockSelectionAccess(tx,actor,sessionId,false);
  const [raw]=await tx.query(`SELECT
   (SELECT COUNT(*) FROM customer_sample_items WHERE session_id=? AND removed_at IS NULL) AS selected_products,
   (SELECT COUNT(DISTINCT si.product_id) FROM sample_shipment_items si JOIN customer_sample_items i ON i.session_id=si.session_id AND i.product_id=si.product_id WHERE si.session_id=? AND i.removed_at IS NULL) AS shipped_products,
   (SELECT COALESCE(SUM(si.quantity),0) FROM sample_shipment_items si WHERE si.session_id=?) AS shipped_quantity`,[sessionId,sessionId,sessionId]);
  const data=selectionRows(raw);if(data.length!==1)throw new SampleSessionManualError(409);
  const row=data[0],selectedProducts=count(row.selected_products),shippedProducts=count(row.shipped_products),shippedQuantity=count(row.shipped_quantity);
  if(shippedProducts>selectedProducts)throw new SampleSessionManualError(409);
  return {sessionId,selectedProducts,shippedProducts,pendingProducts:selectedProducts-shippedProducts,shippedQuantity};
 });
}
