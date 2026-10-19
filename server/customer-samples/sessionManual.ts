import type {AppPrincipal} from '../access/types';
import type {SamplePool,SampleTx} from './scanRepository';

export class SampleSessionManualError extends Error{
 constructor(readonly status:400|403|404|409){super('Sample selection unavailable');this.name='SampleSessionManualError';}
}
export interface ManualSelectionInput{sessionId:string;cardId:string;productIds?:string[]}
export interface ManualSelectionResult{
 sessionId:string;cardId:string;
 items:{productId:string;itemId:string;action:'added'|'restored'|'already_selected'}[];
}
export type SelectionRow=Record<string,unknown>;
export const validSelectionId=(x:unknown):x is string=>typeof x==='string'&&/^[1-9]\d{0,19}$/.test(x)&&BigInt(x)<=18446744073709551615n;
export const selectionRows=(raw:unknown):SelectionRow[]=>{
 if(!Array.isArray(raw)||raw.some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw new SampleSessionManualError(409);
 return raw as SelectionRow[];
};
export const selectionDbId=(raw:unknown):string=>{
 if(typeof raw==='number'&&!Number.isSafeInteger(raw))throw new SampleSessionManualError(409);
 const value=String(raw);if(!validSelectionId(value))throw new SampleSessionManualError(409);return value;
};
const oneWrite=(value:unknown)=>{
 if(!value||typeof value!=='object'||(value as {affectedRows?:unknown}).affectedRows!==1)throw new SampleSessionManualError(409);
};
/** Same lock order as scanning: account -> login -> sample session -> explicit grant. */
export async function lockSelectionIdentity(tx:SampleTx,actor:AppPrincipal){
 if(!actor||(actor.role!=='sales'&&actor.role!=='admin')||!validSelectionId(actor.userId)||!validSelectionId(actor.sessionId))throw new SampleSessionManualError(403);
 const [users]=await tx.query('SELECT id,role,is_active FROM v2_access_users WHERE id=? FOR SHARE',[actor.userId]);
 const user=selectionRows(users)[0];
 if(!user||user.role!==actor.role||Number(user.is_active)!==1)throw new SampleSessionManualError(403);
 const [login]=await tx.query('SELECT id FROM v2_access_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR SHARE',[actor.sessionId,actor.userId]);
 if(selectionRows(login).length!==1)throw new SampleSessionManualError(403);
}
export async function lockSelectionAccess(tx:SampleTx,actor:AppPrincipal,sessionId:string,write:boolean,allowClosed=false){
 if(!validSelectionId(sessionId))throw new SampleSessionManualError(400);
 await lockSelectionIdentity(tx,actor);
 const lock=write?'FOR UPDATE':'FOR SHARE';
 const [sessions]=await tx.query('SELECT id,status FROM customer_sample_sessions WHERE id=? AND deleted_at IS NULL '+lock,[sessionId]);
 const session=selectionRows(sessions)[0];if(!session)throw new SampleSessionManualError(404);
 const [access]=await tx.query('SELECT can_manage FROM customer_sample_session_access WHERE session_id=? AND user_id=? AND can_manage=1 '+lock,[sessionId,actor.userId]);
 const grants=selectionRows(access);if(grants.length!==1||Number(grants[0].can_manage)!==1)throw new SampleSessionManualError(404);
 if(write&&!allowClosed&&session.status!=='open')throw new SampleSessionManualError(409);
 if(session.status!=='open'&&session.status!=='closed')throw new SampleSessionManualError(409);
}
/** Only card-based selections. Omitted productIds means whole current card;
 * an explicit subset must still be wholly eligible, or the entire request rolls back.
 * Manual provenance never invents a physical scan event. Legacy no-card audits remain intact.
 */
export async function addManualSampleItem(pool:SamplePool,actor:AppPrincipal,input:ManualSelectionInput):Promise<ManualSelectionResult>{
 if(!actor||(actor.role!=='sales'&&actor.role!=='admin')||!validSelectionId(actor.userId)||!validSelectionId(actor.sessionId))throw new SampleSessionManualError(403);
 if(!input||!validSelectionId(input.sessionId)||!validSelectionId(input.cardId)||
  Object.keys(input).some(k=>!['sessionId','cardId','productIds'].includes(k))||
  (input.productIds!==undefined&&(!Array.isArray(input.productIds)||input.productIds.length<1||input.productIds.length>10000||
   !input.productIds.every(validSelectionId)||new Set(input.productIds).size!==input.productIds.length)))throw new SampleSessionManualError(400);
 const tx=await pool.getConnection();let began=false;
 try{
  await tx.beginTransaction();began=true;
  await lockSelectionAccess(tx,actor,input.sessionId,true);
  // Discover without locks, then master -> fabric -> card -> token, matching create/retire.
  const [locatedRaw]=await tx.query('SELECT master_id,fabric_id FROM sample_cards WHERE id=?',[input.cardId]);
  const located=selectionRows(locatedRaw)[0];if(!located)throw new SampleSessionManualError(404);
  const masterId=selectionDbId(located.master_id),fabricId=selectionDbId(located.fabric_id);
  for(const [table,id] of [['pattern_masters',masterId],['v2_fabrics',fabricId]]){
   const [data]=await tx.query('SELECT id,is_active FROM '+table+' WHERE id=? FOR SHARE',[id]);
   const row=selectionRows(data)[0];if(!row||selectionDbId(row.id)!==id||Number(row.is_active)!==1)throw new SampleSessionManualError(409);
  }
  const [cards]=await tx.query('SELECT id,master_id,fabric_id,is_active,deleted_at FROM sample_cards WHERE id=? FOR UPDATE',[input.cardId]);
  const card=selectionRows(cards)[0];
  if(!card||card.deleted_at!==null||Number(card.is_active)!==1)throw new SampleSessionManualError(404);
  if(selectionDbId(card.id)!==input.cardId||selectionDbId(card.master_id)!==masterId||selectionDbId(card.fabric_id)!==fabricId)throw new SampleSessionManualError(409);
  const [tokens]=await tx.query('SELECT card_id,revoked_at FROM sample_card_tokens WHERE card_id=? FOR SHARE',[input.cardId]);
  const token=selectionRows(tokens)[0];if(!token||token.revoked_at!==null||selectionDbId(token.card_id)!==input.cardId)throw new SampleSessionManualError(404);
  const [products]=await tx.query(`SELECT p.id,p.fabric_id,c.master_id,p.is_active AS product_active,
   c.is_active AS colorway_active,p.is_available_for_sampling AS sampling_available
   FROM v2_products p JOIN pattern_colorways c ON c.id=p.pattern_colorway_id
   WHERE p.fabric_id=? AND c.master_id=? ORDER BY p.id FOR SHARE`,[fabricId,masterId]);
  const eligible=selectionRows(products).filter(x=>Number(x.product_active)===1&&Number(x.colorway_active)===1&&Number(x.sampling_available)===1);
  if(eligible.some(x=>selectionDbId(x.fabric_id)!==fabricId||selectionDbId(x.master_id)!==masterId))throw new SampleSessionManualError(409);
  const eligibleIds=eligible.map(x=>selectionDbId(x.id));
  if(new Set(eligibleIds).size!==eligibleIds.length)throw new SampleSessionManualError(409);
  const selected=input.productIds??eligibleIds;
  if(!selected.length||selected.some(id=>!eligibleIds.includes(id)))throw new SampleSessionManualError(409);
  const ids=eligibleIds.filter(id=>selected.includes(id));
  const items:ManualSelectionResult['items']=[];
  for(const productId of ids){
   const [existingRaw]=await tx.query('SELECT id,product_id,removed_at,removed_by_user_id FROM customer_sample_items WHERE session_id=? AND product_id=? FOR UPDATE',[input.sessionId,productId]);
   const existing=selectionRows(existingRaw);if(existing.length>1)throw new SampleSessionManualError(409);
   let itemId:string,action:ManualSelectionResult['items'][number]['action'];
   if(!existing.length){
    const [insert]=await tx.query('INSERT INTO customer_sample_items (session_id,product_id,selected_by_user_id) VALUES (?,?,?)',[input.sessionId,productId,actor.userId]);
    oneWrite(insert);itemId=selectionDbId((insert as {insertId:unknown}).insertId);action='added';
   }else{
    const item=existing[0];itemId=selectionDbId(item.id);
    if(selectionDbId(item.product_id)!==productId||!Object.hasOwn(item,'removed_at')||!Object.hasOwn(item,'removed_by_user_id')||
      (item.removed_at===null)!==(item.removed_by_user_id===null))throw new SampleSessionManualError(409);
    if(item.removed_at!==null){
     selectionDbId(item.removed_by_user_id);
     const [restored]=await tx.query('UPDATE customer_sample_items SET removed_at=NULL,removed_by_user_id=NULL WHERE session_id=? AND product_id=? AND removed_at IS NOT NULL',[input.sessionId,productId]);
     oneWrite(restored);action='restored';
    }else action='already_selected';
   }
   const [audit]=await tx.query('INSERT INTO customer_sample_manual_events (session_id,product_id,actor_user_id,action,card_id) VALUES (?,?,?,?,?)',[input.sessionId,productId,actor.userId,action,input.cardId]);
   oneWrite(audit);items.push({productId,itemId,action});
  }
  await tx.query('INSERT INTO customer_sample_selected_cards(session_id,card_id) VALUES (?,?) ON DUPLICATE KEY UPDATE id=id',[input.sessionId,input.cardId]);
  await tx.commit();began=false;return {sessionId:input.sessionId,cardId:input.cardId,items};
 }catch(error){if(began)await tx.rollback();throw error;}finally{tx.release();}
}
