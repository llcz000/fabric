import {lockCustomerSessionAccess,sampleSessionScope} from '../customers/sessionBridge';
import {CustomerError} from '../customers/model';
import {createHash} from 'node:crypto';
import type {AppPrincipal} from '../access/types';
import {planCardScan,type LiveCardProduct,type SavedSampleProduct} from './cardScan';
import type {CardScanRequest,CardScanResponse} from './cardScanRoutes';

/** Independent V2 domain transaction. Never mounted on legacy server.ts. */
export interface SampleTx {
 customerProfilesEnabled?:boolean;
 beginTransaction():Promise<void>;
 commit():Promise<void>;
 rollback():Promise<void>;
 release():void;
 query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>;
}
export interface SamplePool {customerProfilesEnabled?:boolean;getConnection():Promise<SampleTx>}
type Row=Record<string,unknown>;
const readRows=(data:unknown):Row[]=>{
 if(!Array.isArray(data))throw new Error('Unexpected SQL response');
 return data as Row[];
};
const id=(x:unknown)=>String(x);
const validId=(x:string)=>/^[1-9][0-9]{0,19}$/.test(x)&&BigInt(x)<=18446744073709551615n;
export class SampleScanError extends Error {
 readonly status:403|404|409;
 constructor(status:403|404|409,message:string,readonly code?:'NO_AVAILABLE_PRODUCTS'){
  super(message);this.status=status;this.name='SampleScanError';
 }
}
const tokenPattern=/^[A-Za-z0-9_-]{22,128}$/;
const pick=(row:Row):LiveCardProduct=>({
 id:id(row.id),fabricId:id(row.fabric_id),masterId:id(row.master_id),
 productNo:String(row.product_no),colorwayNo:Number(row.colorway_no)
});
/**
 * Active registered admins and sales require explicit Phase-2 authorization
 * per customer sample session. Neither
 * orders.manage_own nor products.manage grants sample operations. The
 * transaction locks and rechecks current account/login before acquiring the
 * sample session FOR UPDATE, then rechecks its grant. HTTP authorization
 * alone cannot protect against account changes or login revocation.
 *
 * Card contents derive exclusively from the SQL JOIN; the client supplies
 * only a token and session ID. Inactive colorways/products are omitted; a
 * temporary sampling availability is also verified from current locked product rows.
 */
export async function persistSampleCardScan(
 db:SamplePool,actor:AppPrincipal,input:CardScanRequest
):Promise<CardScanResponse>{
 if((actor.role!=='admin'&&actor.role!=='sales')||!validId(actor.userId)||!validId(actor.sessionId))
  throw new SampleScanError(403,'Sample scan forbidden');
 if(!validId(input.sessionId)||!tokenPattern.test(input.cardToken))
  throw new SampleScanError(404,'Sample scan target invalid');
 const tx=await db.getConnection();
 let began=false;
 try{
  await tx.beginTransaction();began=true;
  // Match the V2 document write lock order: user, login, then business rows.
  // These current reads serialize role/active changes and login revocation.
  const [userRaw]=await tx.query(
   'SELECT id,role,is_active FROM v2_access_users WHERE id=? FOR SHARE',
   [actor.userId]);
  const user=readRows(userRaw)[0];
  if(!user||Number(user.is_active)!==1||user.role!==actor.role)
   throw new SampleScanError(403,'Sample scan forbidden');
  const [loginRaw]=await tx.query(
   'SELECT id FROM v2_access_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR SHARE',
   [actor.sessionId,actor.userId]);
  if(!readRows(loginRaw)[0])throw new SampleScanError(403,'Sample scan forbidden');
  const customer=await lockCustomerSessionAccess(tx,actor,input.sessionId,true);
  // Serialize all scan/item mutations for the same sample session.
  const [sessionRaw]=await tx.query(
   'SELECT id,created_by_user_id FROM customer_sample_sessions WHERE id=? AND deleted_at IS NULL FOR UPDATE',
   [input.sessionId]);
  const session=readRows(sessionRaw)[0];
  if(!session)throw new SampleScanError(404,'Sample session not found');
  if(!customer){const [accessRaw]=await tx.query(
   'SELECT can_manage FROM customer_sample_session_access WHERE session_id=? AND user_id=? AND can_manage=1 FOR UPDATE',
   [input.sessionId,actor.userId]);
  if(Number(readRows(accessRaw)[0]?.can_manage)!==1)
   throw new SampleScanError(403,'Sample scan forbidden');}
  // Hash scan input before query. Raw payload is persisted by the authorized
  // card library for stable QR/Excel reads; never log either form.
  const tokenHash=createHash('sha256').update(input.cardToken,'utf8').digest('hex');
  const lookup=`SELECT t.card_id,c.master_id,c.fabric_id,c.is_active,t.token_hash
   FROM sample_card_tokens t JOIN sample_cards c ON c.id=t.card_id
   WHERE t.token_hash=? AND t.revoked_at IS NULL AND c.deleted_at IS NULL LIMIT 1`;
  // Locate parents without retaining a card/token lock. A locking lookup here
  // would reverse create's master -> fabric -> card order and permit deadlock.
  const [locatedRaw]=await tx.query(lookup,[tokenHash]);
  const located=readRows(locatedRaw)[0];
  if(!located||Number(located.is_active)!==1)throw new SampleScanError(404,'Card unavailable');
  const cardId=id(located.card_id),fabricId=id(located.fabric_id),masterId=id(located.master_id);
  if(!validId(cardId)||!validId(masterId)||!validId(fabricId)||located.token_hash!==tokenHash)
   throw new SampleScanError(409,'Card single-master identity inconsistent');
  // Acquire identity locks in the same order as createSampleCard. These
  // current reads also reject parent deletion/disable while the locator waits.
  const [masterRaw]=await tx.query(
   'SELECT id,is_active FROM pattern_masters WHERE id=? FOR SHARE',[masterId]);
  const master=readRows(masterRaw)[0];
  if(!master||id(master.id)!==masterId||Number(master.is_active)!==1)
   throw new SampleScanError(409,'Card master unavailable');
  const [fabricRaw]=await tx.query(
   'SELECT id,is_active FROM v2_fabrics WHERE id=? FOR SHARE',[fabricId]);
  const fabric=readRows(fabricRaw)[0];
  if(!fabric||id(fabric.id)!==fabricId||Number(fabric.is_active)!==1)
   throw new SampleScanError(409,'Card fabric unavailable');
  // The locator was a snapshot read; it cannot authorize products. Lock
  // the card by PRIMARY KEY *before* its token, matching retire/create order.
  // A JOIN ... FOR UPDATE may lock token before card depending on the SQL
  // optimizer, reversing retire's card -> token lock order and deadlocking.
  const [cardRaw]=await tx.query(
   'SELECT c.id,c.master_id,c.fabric_id,c.is_active,c.deleted_at FROM sample_cards c WHERE c.id=? FOR UPDATE',
   [cardId]);
  const cardRow=readRows(cardRaw)[0];
  if(!cardRow||cardRow.deleted_at!=null||Number(cardRow.is_active)!==1)
   throw new SampleScanError(404,'Card unavailable');
  if(id(cardRow.id)!==cardId||id(cardRow.master_id)!==masterId||
    id(cardRow.fabric_id)!==fabricId)
   throw new SampleScanError(409,'Card identity changed during scan');
  // This is a current locking read, so even under REPEATABLE READ a revoked
  // token cannot be used and retirement cannot commit until the scan ends.
  const [tokenRaw]=await tx.query(
   'SELECT t.card_id,t.token_hash,t.revoked_at FROM sample_card_tokens t WHERE t.card_id=? FOR SHARE',
   [cardId]);
  const currentToken=readRows(tokenRaw)[0];
  if(!currentToken||currentToken.revoked_at!=null)
   throw new SampleScanError(404,'Card unavailable');
  if(id(currentToken.card_id)!==cardId||currentToken.token_hash!==tokenHash)
   throw new SampleScanError(409,'Card QR identity changed during scan');
  const masterIds=[masterId];
  // Current locking read: retain all four identity/availability rows through
  // sample commit. Product FK checks alone do not prevent concurrent disable.
  const [productRaw]=await tx.query(`SELECT p.id,p.fabric_id,c.master_id,p.product_no,
    c.colorway_no,m.master_no,f.fabric_name,f.composition,f.weight_value,
    f.weight_unit,f.width_value,p.is_active AS product_active,
    p.is_available_for_sampling AS sampling_available,
    c.is_active AS colorway_active,m.is_active AS master_active,f.is_active AS fabric_active
   FROM v2_products p
   JOIN pattern_colorways c ON c.id=p.pattern_colorway_id
   JOIN pattern_masters m ON m.id=c.master_id
   JOIN v2_fabrics f ON f.id=p.fabric_id
   WHERE p.fabric_id=? AND c.master_id=? ORDER BY p.id FOR SHARE`,[fabricId,masterId]);
  const candidates=readRows(productRaw);
  if(candidates.some(x=>Number(x.master_active)!==1||Number(x.fabric_active)!==1))
   throw new SampleScanError(409,'Card parent availability inconsistent');
  // Selection includes only currently usable active products + versions.
  // Keep selected product identities stable when current availability changes.
  const available=candidates.filter(x=>Number(x.product_active)===1&&Number(x.colorway_active)===1&&Number(x.sampling_available)===1);
  if(available.length===0)throw new SampleScanError(409,'Card has no eligible products','NO_AVAILABLE_PRODUCTS');
  const [oldRaw]=await tx.query(
   'SELECT product_id,removed_at FROM customer_sample_items WHERE session_id=? FOR UPDATE',
   [input.sessionId]);
  const saved=readRows(oldRaw);
  const removedIds=new Set(saved.filter(row=>row.removed_at!=null).map(row=>id(row.product_id)));
  // An unchecked colorway is a deliberate choice. Rescans may append new products,
  // but only an explicit manual selection may restore a removed row.
  const selected:SavedSampleProduct[]=saved.map(row=>({productId:id(row.product_id)}));
  let plan;
  try {plan=planCardScan({id:cardId,fabricId,masterIds},available.map(pick),selected);}
  catch {throw new SampleScanError(409,'Card/product scope inconsistent');}
  await tx.query(`INSERT INTO customer_sample_selected_cards(session_id,card_id)
    VALUES (?,?) ON DUPLICATE KEY UPDATE id=id`,[input.sessionId,cardId]);
  const [scanInsert]=await tx.query(`INSERT INTO customer_sample_scan_events
    (session_id,card_id,actor_user_id,resolved_products_json,added_products_json)
    VALUES (?,?,?,?,?)`,
    [input.sessionId,cardId,actor.userId,JSON.stringify(plan.resolvedProductIds),
     JSON.stringify(plan.newlyAdded.map(x=>x.productId))]);
  const eventId=id((scanInsert as {insertId:unknown}).insertId);
  for(const item of plan.newlyAdded){
   await tx.query(`INSERT INTO customer_sample_items
    (session_id,product_id,selected_by_user_id)
    VALUES (?,?,?)`,[input.sessionId,item.productId,actor.userId]);
  }
  // Both newly inserted and previously selected products record this card as
  // a source, even if originally selected through another card.
  for(const productId of plan.resolvedProductIds){
   await tx.query(`INSERT INTO customer_sample_item_sources
    (session_id,product_id,card_id,first_scan_event_id)
    VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE id=id`,
    [input.sessionId,productId,cardId,eventId]);
  }
  const [countRaw]=await tx.query(
   'SELECT COUNT(*) AS total FROM customer_sample_selected_cards WHERE session_id=?',
   [input.sessionId]);
  const count=Number(readRows(countRaw)[0]?.total);
  if(!Number.isSafeInteger(count)||count<1)throw new Error('Invalid card count');
  await tx.commit();began=false;
  return {cardId,resolvedProductIds:plan.resolvedProductIds,
   addedProductIds:plan.newlyAdded.map(x=>x.productId),
   alreadySelectedProductIds:plan.unchangedProductIds.filter(productId=>!removedIds.has(productId)),selectedCardCount:count};
 }catch(error){
  if(began)await tx.rollback();
  if(error instanceof CustomerError)throw new SampleScanError(error.status===403?403:error.status===404?404:409,'Sample selection unavailable');
  throw error;
 }finally {tx.release();}
}
