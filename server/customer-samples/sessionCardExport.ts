import type {AppPrincipal} from '../access/types';
import type {SamplePool,SampleTx} from './scanRepository';
import {lockCustomer} from '../customers/access';
import {CustomerError,shanghaiToday} from '../customers/model';
import {lockSelectionAccess,lockSelectionIdentity,validSelectionId,selectionRows,SampleSessionManualError} from './sessionManual';
import {SampleCardError,type SampleCard} from './cardLibrary';
import {loadCardReview,SampleCardReviewRequired} from './sessionCardReview';
import {buildSelectionCardsWorkbook,type SampleCardExportGroup} from './cardExcel';

async function readExportGroup(tx:SampleTx,sessionId:string,cards:SampleCard[]):Promise<SampleCardExportGroup>{
 const customerColumns=tx.customerProfilesEnabled?'COALESCE(c.display_name,s.customer_reference) AS customer_name,CASE WHEN l.customer_id IS NOT NULL THEN s.contact_name END AS contact_name':'s.customer_reference AS customer_name,NULL AS contact_name';
 const customerJoin=tx.customerProfilesEnabled?" LEFT JOIN customer_session_links l ON l.session_id=s.id LEFT JOIN customers c ON c.id=l.customer_id AND c.archived_at IS NULL AND JSON_EXTRACT(c.profile_json,'$.deletedAt') IS NULL":'';
 const [raw]=await tx.query('SELECT '+customerColumns+',UNIX_TIMESTAMP(s.created_at)*1000 AS created_at_ms FROM customer_sample_sessions s'+customerJoin+' WHERE s.id=?',[sessionId]);
 const row=selectionRows(raw)[0],timestamp=Number(row?.created_at_ms),createdAt=new Date(timestamp);
 if(typeof row?.customer_name!=='string'||!Number.isSafeInteger(timestamp)||timestamp<=0||!Number.isFinite(createdAt.getTime()))throw new SampleSessionManualError(409);
 return {sessionId,customerName:row.customer_name,contactName:typeof row.contact_name==='string'?row.contact_name:null,createdOn:shanghaiToday(createdAt),cards};
}
/** One authorized read transaction pins selection; no client-provided card IDs. */
export async function exportSessionCards(pool:SamplePool,actor:AppPrincipal,sessionId:string,scanOrigin?:string):Promise<Buffer>{
 const tx=await pool.getConnection();let began=false;
 try{
  await tx.beginTransaction();began=true;await lockSelectionAccess(tx,actor,sessionId,false);
  const {plan}=await loadCardReview(tx,sessionId,false);
  if(!plan.public.totalProducts||plan.public.issues.length)throw new SampleCardReviewRequired(plan.public);
  const group=await readExportGroup(tx,sessionId,plan.cards);
  const bytes=await buildSelectionCardsWorkbook([group],scanOrigin);
  await tx.commit();began=false;return bytes;
 }catch(error){if(began)await tx.rollback();if(error instanceof SampleCardError)throw new SampleSessionManualError(409);throw error;}finally{tx.release();}
}

export const sampleBatchExportLimit=50;
export class SampleBatchExportBlocked extends Error{
 constructor(readonly sessionId:string,readonly reason:'empty'|'review'){super('Selection blocks batch export');}
}
const byId=(a:string,b:string)=>a.length-b.length||a.localeCompare(b);
export async function exportBatchSessionCards(pool:SamplePool,actor:AppPrincipal,input:unknown,scanOrigin?:string):Promise<Buffer>{
 const body=input as {sessionIds?:unknown};
 if(!body||typeof body!=='object'||Object.keys(body).length!==1||!Array.isArray(body.sessionIds)||
  !body.sessionIds.length||body.sessionIds.length>sampleBatchExportLimit||!body.sessionIds.every(validSelectionId)||
  new Set(body.sessionIds).size!==body.sessionIds.length)throw new SampleSessionManualError(400);
 const sessionIds=body.sessionIds as string[],sorted=[...sessionIds].sort(byId);
 const tx=await pool.getConnection();let began=false;
 try{
  await tx.beginTransaction();began=true;await lockSelectionIdentity(tx,actor);
  if(tx.customerProfilesEnabled){
   const [raw]=await tx.query('SELECT DISTINCT customer_id FROM customer_session_links WHERE session_id IN ('+sorted.map(()=>'?').join(',')+') AND customer_id IS NOT NULL',sorted);
   const customerIds=selectionRows(raw).map(row=>String(row.customer_id)).sort(byId);
   for(const id of customerIds)await lockCustomer(tx,actor,id);
  }
  // Authorize the entire request before reading any card or returning a blocking order ID.
  for(const sessionId of sorted)await lockSelectionAccess(tx,actor,sessionId,false);
  const groups:SampleCardExportGroup[]=[];
  for(const sessionId of sessionIds){
   const {plan}=await loadCardReview(tx,sessionId,false);
   if(!plan.public.totalProducts)throw new SampleBatchExportBlocked(sessionId,'empty');
   if(plan.public.issues.length)throw new SampleBatchExportBlocked(sessionId,'review');
   groups.push(await readExportGroup(tx,sessionId,plan.cards));
  }
  await tx.commit();began=false;
  return await buildSelectionCardsWorkbook(groups,scanOrigin);
 }catch(error){
  if(began)await tx.rollback();
  if(error instanceof CustomerError)throw new SampleSessionManualError(error.status===503?409:error.status);
  if(error instanceof SampleCardError)throw new SampleSessionManualError(409);
  throw error;
 }finally{tx.release();}
}
