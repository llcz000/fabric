import {recordDeletion} from '../audit/deletionAudit';
import {lockCustomer} from '../customers/access';
import {lockCustomerSessionAccess,sampleSessionScope} from '../customers/sessionBridge';
import {CustomerError} from '../customers/model';
import type {AppPrincipal} from '../access/types';
import type {SamplePool,SampleTx} from './scanRepository';
import {lockSelectionIdentity,lockSelectionAccess,selectionRows,selectionDbId,validSelectionId,SampleSessionManualError} from './sessionManual';
export interface SampleSessionSummary{id:string;customerReference:string;createdOn?:string;createdAt?:string;selectedCardCount?:number;selectedProductCount?:number;customerId?:string|null;linkVersion?:string;canManage?:boolean}
export async function updateSampleSession(pool:SamplePool,actor:AppPrincipal,sessionId:string,input:unknown):Promise<SampleSessionSummary>{
 if(!validSelectionId(sessionId)||!input||typeof input!=='object'||Array.isArray(input))throw invalid();
 const body=input as Record<string,unknown>;
 if(Object.keys(body).length!==2||typeof body.customerReference!=='string'||typeof body.expectedCustomerReference!=='string'||!body.customerReference.trim()||body.customerReference.trim().length>160||/[\p{Cc}\p{Cf}]/u.test(body.customerReference))throw invalid();
 return transaction(pool,async tx=>{
  await lockSelectionAccess(tx,actor,sessionId,true);
  const [raw]=await tx.query('SELECT id,customer_reference FROM customer_sample_sessions WHERE id=? AND deleted_at IS NULL FOR UPDATE',[sessionId]);
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
  await lockSelectionAccess(tx,actor,sessionId,true);
  const [current]=await tx.query('SELECT id,customer_reference FROM customer_sample_sessions WHERE id=? AND deleted_at IS NULL FOR UPDATE',[sessionId]);
  if(selectionRows(current).length!==1)throw new SampleSessionManualError(404);
  await recordDeletion(tx,actor,{type:'selection',id:sessionId,label:String(selectionRows(current)[0].customer_reference)});
  const [write]=await tx.query("UPDATE customer_sample_sessions SET deleted_at=UTC_TIMESTAMP(),deleted_by_user_id=? WHERE id=? AND deleted_at IS NULL",[actor.userId,sessionId]);
  if((write as {affectedRows?:unknown})?.affectedRows!==1)throw new SampleSessionManualError(409);
  return {id:sessionId,deleted:true};
 });
}
export interface SampleSessionDirectory{items:SampleSessionSummary[];total:number;limit:number;offset:number}
export interface SampleShipmentProgress{sessionId:string;selectedProducts:number;shippedProducts:number;pendingProducts:number;shippedQuantity:number}
async function transaction<T>(pool:SamplePool,run:(tx:SampleTx)=>Promise<T>):Promise<T>{
 const tx=await pool.getConnection();let began=false;
 try{await tx.beginTransaction();began=true;const result=await run(tx);await tx.commit();began=false;return result;}
 catch(error){if(began)await tx.rollback();if(error instanceof CustomerError)throw new SampleSessionManualError(error.status===503?409:error.status);throw error;}finally{tx.release();}
}
const invalid=()=>new SampleSessionManualError(400);
function count(raw:unknown){const n=Number(raw);if((typeof raw!=='number'&&!(typeof raw==='string'&&/^\d+$/.test(raw)))||!Number.isSafeInteger(n)||n<0)throw new SampleSessionManualError(409);return n;}
function summary(raw:Record<string,unknown>):SampleSessionSummary{
 if(typeof raw.customer_reference!=='string'||!raw.customer_reference.trim()||raw.customer_reference.length>160)throw new SampleSessionManualError(409);
 const createdAt=raw.created_at_ms===undefined?undefined:new Date(Number(raw.created_at_ms)).toISOString();
 const selectedCardCount=raw.selected_card_count===undefined?undefined:count(raw.selected_card_count);
 const selectedProductCount=raw.selected_product_count===undefined?undefined:count(raw.selected_product_count);
 const createdOn=raw.created_on;
 if(createdOn!==undefined&&(typeof createdOn!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(createdOn)||!Number.isFinite(Date.parse(createdOn))||new Date(createdOn).toISOString().slice(0,10)!==createdOn))throw new SampleSessionManualError(409);
 return {id:selectionDbId(raw.id),customerReference:raw.customer_reference,...(createdOn===undefined?{}:{createdOn:createdOn as string}),...(createdAt===undefined?{}:{createdAt}),...(selectedCardCount===undefined?{}:{selectedCardCount}),...(selectedProductCount===undefined?{}:{selectedProductCount})};
}
export async function createSampleSession(pool:SamplePool,actor:AppPrincipal,input:unknown):Promise<SampleSessionSummary>{
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||!('customerReference' in input)||typeof input.customerReference!=='string'||/[\p{Cc}\p{Cf}]/u.test(input.customerReference))throw invalid();
 if(pool.customerProfilesEnabled)throw invalid();
 const reference=input.customerReference.trim();if(!reference||reference.length>160)throw invalid();
 return transaction(pool,async tx=>{
  await lockSelectionIdentity(tx,actor);
  const [write]=await tx.query('INSERT INTO customer_sample_sessions (customer_reference,created_by_user_id) VALUES (?,?)',[reference,actor.userId]);
  const result=write as {affectedRows?:unknown;insertId?:unknown};if(result?.affectedRows!==1)throw new SampleSessionManualError(409);
  const id=selectionDbId(result.insertId);
  const [grant]=await tx.query('INSERT INTO customer_sample_session_access (session_id,user_id,can_manage) VALUES (?,?,1)',[id,actor.userId]);
  if((grant as {affectedRows?:unknown})?.affectedRows!==1)throw new SampleSessionManualError(409);
  return {id,customerReference:reference};
 });
}
export async function listSampleSessions(pool:SamplePool,actor:AppPrincipal,input:{query?:string;limit?:number;offset?:number}):Promise<SampleSessionDirectory>{
 const {query='',limit=20,offset=0}=input;
 if(Object.keys(input).some(k=>!['query','limit','offset'].includes(k))||typeof query!=='string'||query.length>160||/[\p{Cc}\p{Cf}]/u.test(query)||!Number.isSafeInteger(limit)||limit<1||limit>50||!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw invalid();
 return transaction(pool,async tx=>{
  await lockSelectionIdentity(tx,actor);
  const keyword=query.trim(),args:unknown[]=[actor.userId];
  let from=' FROM customer_sample_sessions s JOIN customer_sample_session_access a ON a.session_id=s.id WHERE a.user_id=? AND a.can_manage=1 AND s.deleted_at IS NULL';
  if(tx.customerProfilesEnabled){const scoped=sampleSessionScope(actor);from=' FROM customer_sample_sessions s WHERE s.deleted_at IS NULL AND '+scoped.sql;args.splice(0,args.length,...scoped.args);}
  if(keyword){from+=" AND s.customer_reference LIKE ? ESCAPE '!'";args.push('%'+keyword.replace(/[!%_]/g,'!$&')+'%');}
  const [totals]=await tx.query('SELECT COUNT(*) AS total'+from,args);
  const found=selectionRows(totals);if(found.length!==1)throw new SampleSessionManualError(409);
  const total=count(found[0].total);
  const [data]=await tx.query("SELECT CAST(s.id AS CHAR) AS id,s.customer_reference,DATE_FORMAT(s.created_at,'%Y-%m-%d') AS created_on,UNIX_TIMESTAMP(s.created_at)*1000 AS created_at_ms,"+
   " (SELECT COUNT(*) FROM customer_sample_items selected_product WHERE selected_product.session_id=s.id AND selected_product.removed_at IS NULL) AS selected_product_count,"+
    "(SELECT COUNT(*) FROM customer_sample_selected_cards selected_card WHERE selected_card.session_id=s.id AND EXISTS ("+
   "SELECT 1 FROM customer_sample_items selected WHERE selected.session_id=s.id AND selected.removed_at IS NULL AND ("+
   "EXISTS (SELECT 1 FROM customer_sample_item_sources src WHERE src.session_id=s.id AND src.product_id=selected.product_id AND src.card_id=selected_card.card_id) OR "+
   "EXISTS (SELECT 1 FROM customer_sample_manual_events e WHERE e.session_id=s.id AND e.product_id=selected.product_id AND e.card_id=selected_card.card_id)))) AS selected_card_count"+
   ' FROM (SELECT s.id,s.customer_reference,s.created_at'+from+' ORDER BY s.created_at DESC,s.id DESC LIMIT ? OFFSET ?) s ORDER BY s.created_at DESC,s.id DESC',[...args,limit,offset]);
  const items=selectionRows(data).map(summary);
  if(tx.customerProfilesEnabled&&items.length){const [all]=await tx.query('SELECT DISTINCT customer_id FROM customer_session_links WHERE session_id IN ('+items.map(()=>'?').join(',')+') AND customer_id IS NOT NULL',[...items.map(x=>x.id)]);for(const cid of selectionRows(all).map(x=>String(x.customer_id)).sort((a,b)=>BigInt(a)<BigInt(b)?-1:1))await lockCustomer(tx,actor,cid);}
  if(tx.customerProfilesEnabled)for(const item of items){const linked=await lockCustomerSessionAccess(tx,actor,item.id,false);const [lr]=await tx.query('SELECT customer_id,row_version FROM customer_session_links WHERE session_id=? FOR SHARE',[item.id]);const row=selectionRows(lr)[0];item.customerId=row?.customer_id==null?null:String(row.customer_id);item.linkVersion=String(row?.row_version??0);item.canManage=linked?linked.canEdit:true;}
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
