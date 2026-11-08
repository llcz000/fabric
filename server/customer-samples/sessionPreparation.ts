import type {AppPrincipal} from '../access/types';
import type {SamplePool,SampleTx} from './scanRepository';
import {lockCustomer} from '../customers/access';
import {CustomerError} from '../customers/model';
import {lockSelectionAccess,lockSelectionIdentity,validSelectionId,selectionRows,selectionDbId,SampleSessionManualError} from './sessionManual';
import {loadCardReview} from './sessionCardReview';
import {sampleBatchExportLimit,SampleBatchExportBlocked} from './sessionCardExport';

export interface PreparationRecipient{customerName:string;contactName:string|null}
export interface PreparationRow{
 productId:string;cardId:string;cardNo:string;patternNo:string;patternImageAssetId:string|null;
 quantity:number;recipients:PreparationRecipient[];
}
export interface PreparationSummary{rows:PreparationRow[]}
const byId=(a:string,b:string)=>a.length-b.length||a.localeCompare(b);

async function recipient(tx:SampleTx,sessionId:string,legacyContacts:Map<string,Map<string,string|null>>){
 const columns=tx.customerProfilesEnabled?"l.customer_id,COALESCE(c.display_name,s.customer_reference) AS customer_name,s.contact_id,CASE WHEN l.customer_id IS NOT NULL THEN s.contact_name END AS contact_name":"NULL AS customer_id,s.customer_reference AS customer_name,NULL AS contact_id,NULL AS contact_name";
 const join=tx.customerProfilesEnabled?" LEFT JOIN customer_session_links l ON l.session_id=s.id LEFT JOIN customers c ON c.id=l.customer_id AND c.archived_at IS NULL AND JSON_EXTRACT(c.profile_json,'$.deletedAt') IS NULL":'';
 const [raw]=await tx.query('SELECT '+columns+' FROM customer_sample_sessions s'+join+' WHERE s.id=?',[sessionId]);
 const row=selectionRows(raw)[0];
 if(!row||typeof row.customer_name!=='string'||!row.customer_name.trim())throw new SampleSessionManualError(409);
 const contactName=typeof row.contact_name==='string'&&row.contact_name.trim()?row.contact_name:null;
 const customerKey=row.customer_id==null?'session:'+sessionId:'customer:'+selectionDbId(row.customer_id);
 if(row.contact_id!=null&&(typeof row.contact_id!=='string'||!/^[a-f0-9]{32}$/.test(row.contact_id)))throw new SampleSessionManualError(409);
 // Legacy names are only linked for this read when the authorized current profile proves a unique identity.
 const contactId=row.contact_id??(row.customer_id!=null&&contactName?legacyContacts.get(selectionDbId(row.customer_id))?.get(contactName):null);
 const contactKey=contactId==null?contactName===null?'unspecified':'name:'+contactName:'id:'+contactId;
 return {key:JSON.stringify([customerKey,contactKey]),value:{customerName:row.customer_name,contactName} satisfies PreparationRecipient};
}

/** One read transaction: authorize every order before projecting any private selection data. */
export async function readPreparationSummary(pool:SamplePool,actor:AppPrincipal,input:unknown):Promise<PreparationSummary>{
 const body=input as {sessionIds?:unknown};
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!Array.isArray(body.sessionIds)||!body.sessionIds.length||body.sessionIds.length>sampleBatchExportLimit||!body.sessionIds.every(validSelectionId)||new Set(body.sessionIds).size!==body.sessionIds.length)throw new SampleSessionManualError(400);
 const ids=body.sessionIds as string[],sorted=[...ids].sort(byId),tx=await pool.getConnection();let began=false;
 try{
  await tx.beginTransaction();began=true;await lockSelectionIdentity(tx,actor);
  const legacyContacts=new Map<string,Map<string,string|null>>();
  if(tx.customerProfilesEnabled){
   const [raw]=await tx.query('SELECT DISTINCT customer_id FROM customer_session_links WHERE session_id IN ('+sorted.map(()=>'?').join(',')+') AND customer_id IS NOT NULL',sorted);
   for(const id of selectionRows(raw).map(row=>selectionDbId(row.customer_id)).sort(byId)){
    const {dto}=await lockCustomer(tx,actor,id),names=new Map<string,string|null>();
    for(const contact of dto.profile.contacts)if(contact.name&&contact.id)names.set(contact.name,names.has(contact.name)?null:contact.id);
    legacyContacts.set(id,names);
   }
  }
  for(const id of sorted)await lockSelectionAccess(tx,actor,id,false);
  const groups=new Map<string,{row:PreparationRow;recipients:Set<string>}>();
  for(const id of ids){
   const {plan}=await loadCardReview(tx,id,false);
   if(!plan.public.totalProducts)throw new SampleBatchExportBlocked(id,'empty');
   if(plan.public.issues.length)throw new SampleBatchExportBlocked(id,'review');
   const person=await recipient(tx,id,legacyContacts);
   const [raw]=await tx.query(`SELECT i.product_id,cw.colorway_no,cw.pattern_image_asset_id,m.master_no
    FROM customer_sample_items i JOIN v2_products p ON p.id=i.product_id
    JOIN pattern_colorways cw ON cw.id=p.pattern_colorway_id JOIN pattern_masters m ON m.id=cw.master_id
    WHERE i.session_id=? AND i.removed_at IS NULL ORDER BY i.id`,[id]);
   const details=new Map(selectionRows(raw).map(row=>[selectionDbId(row.product_id),row]));
   if(details.size!==plan.entries.length)throw new SampleSessionManualError(409);
   for(const entry of plan.entries){
    const current=details.get(entry.productId),card=entry.target;
    if(!current||!card||typeof current.master_no!=='string'||!current.master_no.trim()||!Number.isInteger(Number(current.colorway_no))||Number(current.colorway_no)<1)throw new SampleSessionManualError(409);
    const asset=current.pattern_image_asset_id;
    if(asset!=null&&(typeof asset!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(asset)))throw new SampleSessionManualError(409);
    const key=card.id+':'+entry.productId;
    let group=groups.get(key);
    if(!group){group={row:{productId:entry.productId,cardId:card.id,cardNo:card.cardNo,patternNo:current.master_no+'-'+current.colorway_no,patternImageAssetId:asset as string??null,quantity:0,recipients:[]},recipients:new Set()};groups.set(key,group);}
    if(!group.recipients.has(person.key)){group.recipients.add(person.key);group.row.recipients.push(person.value);group.row.quantity++;}
   }
  }
  const rows=[...groups.values()].map(group=>group.row).sort((a,b)=>a.cardNo.localeCompare(b.cardNo,'zh-CN',{numeric:true})||a.patternNo.localeCompare(b.patternNo,'zh-CN',{numeric:true})||byId(a.productId,b.productId));
  await tx.commit();began=false;return {rows};
 }catch(error){if(began)await tx.rollback();if(error instanceof CustomerError)throw new SampleSessionManualError(error.status===503?409:error.status);throw error;}finally{tx.release();}
}
