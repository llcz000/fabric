import {createHash} from 'node:crypto';
import type {AppPrincipal} from '../access/types';
import type {SamplePool,SampleTx} from './scanRepository';
import {lockSelectionAccess,selectionRows,selectionDbId,validSelectionId,SampleSessionManualError} from './sessionManual';
import {parseSampleCardRecord,type SampleCard} from './cardLibrary';

export interface ReviewSource{cardId:string;cardNo:string;retired:boolean}
export interface ReviewEntry{itemId:string;productId:string;productNo:string;version:string;target:SampleCard|null;sources:ReviewSource[]}
export interface CardReviewIssue{itemId:string;productNo:string;oldCards:ReviewSource[];currentCard:{id:string;cardNo:string;description:string}|null;reason:string;canUpdate:boolean}
export interface SampleCardReview{sessionId:string;snapshot:string;canUpdate:boolean;totalProducts:number;cardCount:number;issues:CardReviewIssue[]}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function buildCardReview(sessionId:string,entries:ReviewEntry[],confirmed:Record<string,string>,canUpdate:boolean){
 const fingerprints=new Map<string,string>(),cards=new Map<string,SampleCard>(),issues:CardReviewIssue[]=[];
 for(const entry of entries){
  const sources=entry.sources.slice().sort((a,b)=>a.cardId.localeCompare(b.cardId));
  const fingerprint=hash({itemId:entry.itemId,productId:entry.productId,version:entry.version,target:entry.target,sources});fingerprints.set(entry.itemId,fingerprint);
  if(entry.target)cards.set(entry.target.id,entry.target);
  const outdated=!entry.target||!sources.length||sources.some(source=>source.cardId!==entry.target!.id||source.retired);
  if(!entry.target||outdated&&confirmed[entry.itemId]!==fingerprint)issues.push({itemId:entry.itemId,productNo:entry.productNo,oldCards:sources,
   currentCard:entry.target?{id:entry.target.id,cardNo:entry.target.cardNo,description:entry.target.description}:null,
   reason:!entry.target?'当前无有效色卡，请处理产品或色卡资料':!sources.length?'尚未记录当前色卡来源':sources.some(s=>s.cardId!==entry.target!.id&&s.cardNo===entry.target!.cardNo)?'同编号色卡已重新建立，二维码不同':'来源色卡与当前产品关联不一致',canUpdate:canUpdate&&!!entry.target});
 }
 const snapshot=hash({sessionId,entries:[...fingerprints],confirmed:Object.entries(confirmed).sort(([a],[b])=>a.localeCompare(b))});
 return {public:{sessionId,snapshot,canUpdate,totalProducts:entries.length,cardCount:cards.size,issues} satisfies SampleCardReview,fingerprints,cards:[...cards.values()],entries};
}
export class SampleCardReviewRequired extends SampleSessionManualError{
 constructor(readonly review:SampleCardReview){super(409);}
}
function confirmations(raw:unknown):Record<string,string>{
 const parsed=typeof raw==='string'?JSON.parse(raw):raw;
 if(parsed==null)return {};
 if(typeof parsed!=='object'||Array.isArray(parsed)||Object.entries(parsed).some(([key,value])=>!validSelectionId(key)||typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value)))throw Error('Invalid persisted card review');
 return {...parsed};
}
/** Session access is checked by the caller before any private selection or QR data is read. */
export async function loadCardReview(tx:SampleTx,sessionId:string,canUpdate:boolean){
 const [saved]=await tx.query('SELECT card_review FROM customer_sample_sessions WHERE id=?',[sessionId]);
 const persisted=selectionRows(saved);if(persisted.length!==1)throw new SampleSessionManualError(404);
 const confirmed=confirmations(persisted[0].card_review);
 const [raw]=await tx.query(`SELECT i.id AS review_item_id,i.product_id,p.product_no,p.row_version,
  c.id,c.master_id,m.master_no,c.fabric_id,f.fabric_no,c.card_no,f.fabric_name,f.composition,f.weight_value,f.weight_unit,f.width_value,
  c.qr_payload,c.is_active,c.reprint_revision,c.printed_revision,t.token_hash
  FROM customer_sample_items i LEFT JOIN v2_products p ON p.id=i.product_id
  LEFT JOIN pattern_colorways cw ON cw.id=p.pattern_colorway_id LEFT JOIN pattern_masters m ON m.id=cw.master_id
  LEFT JOIN v2_fabrics f ON f.id=p.fabric_id LEFT JOIN sample_cards c ON c.master_id=cw.master_id AND c.fabric_id=p.fabric_id AND c.deleted_at IS NULL AND c.is_active=1
  LEFT JOIN sample_card_tokens t ON t.card_id=c.id AND t.revoked_at IS NULL
  WHERE i.session_id=? AND i.removed_at IS NULL ORDER BY i.id`,[sessionId]);
 const entries:ReviewEntry[]=[],seen=new Set<string>();
 for(const row of selectionRows(raw)){
  const itemId=selectionDbId(row.review_item_id),productId=selectionDbId(row.product_id);if(seen.has(itemId))throw new SampleSessionManualError(409);seen.add(itemId);
  let target:SampleCard|null=null;
  if(row.id!=null)try{target=parseSampleCardRecord(row);}catch{ /* Keep a blocked issue instead of dropping an invalid card. */ }
  entries.push({itemId,productId,productNo:typeof row.product_no==='string'?row.product_no:'产品 '+productId,version:String(row.row_version??''),target,sources:[]});
 }
 const [sourceRaw]=await tx.query(`SELECT sources.product_id,sources.card_id,c.card_no,c.deleted_at,c.is_active
  FROM (SELECT product_id,card_id FROM customer_sample_item_sources WHERE session_id=? UNION SELECT product_id,card_id FROM customer_sample_manual_events WHERE session_id=? AND card_id IS NOT NULL) sources
  JOIN sample_cards c ON c.id=sources.card_id ORDER BY sources.product_id,sources.card_id`,[sessionId,sessionId]);
 const byProduct=new Map(entries.map(entry=>[entry.productId,entry]));
 for(const row of selectionRows(sourceRaw))byProduct.get(String(row.product_id))?.sources.push({cardId:selectionDbId(row.card_id),cardNo:String(row.card_no),retired:row.deleted_at!==null||Number(row.is_active)!==1});
 return {plan:buildCardReview(sessionId,entries,confirmed,canUpdate),confirmed};
}
export async function reviewSessionCards(pool:SamplePool,actor:AppPrincipal,sessionId:string){
 const tx=await pool.getConnection();let began=false;
 try{await tx.beginTransaction();began=true;const canUpdate=await lockSelectionAccess(tx,actor,sessionId,false);const {plan}=await loadCardReview(tx,sessionId,canUpdate);await tx.commit();began=false;return plan.public;}
 catch(error){if(began)await tx.rollback();throw error;}finally{tx.release();}
}
export async function confirmSessionCards(pool:SamplePool,actor:AppPrincipal,sessionId:string,input:unknown){
 const body=input as {snapshot?:unknown;itemIds?:unknown};
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['snapshot','itemIds'].includes(k))||typeof body.snapshot!=='string'||!/^[a-f0-9]{64}$/.test(body.snapshot)||!Array.isArray(body.itemIds)||!body.itemIds.length||body.itemIds.length>10000||!body.itemIds.every(validSelectionId)||new Set(body.itemIds).size!==body.itemIds.length)throw new SampleSessionManualError(400);
 const tx=await pool.getConnection();let began=false;
 try{
  await tx.beginTransaction();began=true;await lockSelectionAccess(tx,actor,sessionId,true);
  const {plan,confirmed}=await loadCardReview(tx,sessionId,true);
  if(plan.public.snapshot!==body.snapshot)throw new SampleCardReviewRequired(plan.public);
  const issues=new Map(plan.public.issues.map(issue=>[issue.itemId,issue]));
  if(body.itemIds.some(id=>!issues.get(id)?.canUpdate))throw new SampleCardReviewRequired(plan.public);
  const chosen=plan.entries.filter(entry=>(body.itemIds as string[]).includes(entry.itemId));
  for(const entry of chosen){
   const target=entry.target!;
   if(!entry.sources.some(s=>s.cardId===target.id&&!s.retired)){
    const [written]=await tx.query("INSERT INTO customer_sample_manual_events (session_id,product_id,actor_user_id,action,card_id) VALUES (?,?,?,'already_selected',?)",[sessionId,entry.productId,actor.userId,target.id]);
    if((written as {affectedRows?:number})?.affectedRows!==1)throw new SampleSessionManualError(409);
    await tx.query('INSERT INTO customer_sample_selected_cards(session_id,card_id) VALUES (?,?) ON DUPLICATE KEY UPDATE id=id',[sessionId,target.id]);
   }
  }
  const after=await loadCardReview(tx,sessionId,true);
  for(const entry of chosen)confirmed[entry.itemId]=after.plan.fingerprints.get(entry.itemId)!;
  // Bound the JSON to currently selected items; selection and provenance records are never rewritten.
  const live=Object.fromEntries(after.plan.entries.filter(e=>confirmed[e.itemId]).map(e=>[e.itemId,confirmed[e.itemId]]));
  const [updated]=await tx.query('UPDATE customer_sample_sessions SET card_review=? WHERE id=?',[JSON.stringify(live),sessionId]);
  if((updated as {affectedRows?:number})?.affectedRows!==1)throw new SampleSessionManualError(409);
  const result=buildCardReview(sessionId,after.plan.entries,live,true).public;await tx.commit();began=false;return result;
 }catch(error){if(began)await tx.rollback();throw error;}finally{tx.release();}
}

export function currentSampleCardCountSql(session:string){
 if(!/^[a-z][a-z0-9_]*\.id$/i.test(session))throw Error('Invalid internal session alias');
 return '(SELECT COUNT(DISTINCT live_card.id) FROM customer_sample_items selected JOIN v2_products product ON product.id=selected.product_id JOIN pattern_colorways colorway ON colorway.id=product.pattern_colorway_id JOIN sample_cards live_card ON live_card.master_id=colorway.master_id AND live_card.fabric_id=product.fabric_id AND live_card.deleted_at IS NULL AND live_card.is_active=1 WHERE selected.session_id='+session+' AND selected.removed_at IS NULL)';
}
