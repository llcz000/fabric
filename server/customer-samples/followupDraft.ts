/** FOLLOW-01: pure draft contract for a server-authorized sample session.
 * This does not create records, send notifications or make orders. Before writing
 * a follow-up the caller must recheck account, login, session and explicit grant
 * and load selection identities from trusted transactional rows.
 */
export class SampleFollowupError extends Error {
 constructor(){super('Invalid sample follow-up');this.name='SampleFollowupError';}
}
export interface PreparedSampleFollowup {
 sessionId:string;contactedOn:string;customerConfirmed:boolean|null;feedback:string|null;
 outcome:string;nextAction:string|null;nextFollowupOn:string|null;productIds:string[];
}
type Row=Record<string,unknown>;
const row=(v:unknown):v is Row=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==='string'&&/^[1-9]\d{0,19}$/.test(v)&&BigInt(v)<=18446744073709551615n;
const date=(v:unknown):v is string=>{
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
 const t=Date.parse(v);return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===v;
};
const note=(v:unknown,max:number,required=false):string|null=>{
 if(v===undefined||v===null){if(required)throw new SampleFollowupError();return null;}
 if(typeof v!=='string'||v!==v.trim()||(required&&!v.length)||v.length>max||
  /[\p{Cc}\p{Cf}]/u.test(v))throw new SampleFollowupError();
 return v||null;
};
function verifiedProductIds(raw:unknown):Set<string>{
 if(!Array.isArray(raw)||raw.length>10000)throw new SampleFollowupError();
 const productIds=new Set<string>(),itemIds=new Set<string>();
 const live=new Set<string>();
 for(const item of raw){
  if(!row(item)||!id(item.itemId)||!id(item.productId)||
   !(item.removedAt===null||typeof item.removedAt==='string'&&
     /^\d{4}-\d{2}-\d{2}T/.test(item.removedAt)&&Number.isFinite(Date.parse(item.removedAt)))||
   productIds.has(item.productId)||itemIds.has(item.itemId))throw new SampleFollowupError();
  productIds.add(item.productId);itemIds.add(item.itemId);
  if(item.removedAt===null)live.add(item.productId);
 }
 return live;
}
/** Preserve user-entered facts and product references without auto-sending,
 * auto-shipping, updating catalog snapshots or creating an order. */
export function prepareSampleFollowup(raw:unknown,selected:unknown,context:{sessionId:string}):PreparedSampleFollowup{
 if(!row(raw)||!context||!id(context.sessionId)||Object.keys(raw).some(k=>![
  'sessionId','contactedOn','customerConfirmed','feedback','outcome','nextAction','nextFollowupOn','productIds'
 ].includes(k)))throw new SampleFollowupError();
 if(!id(raw.sessionId)||raw.sessionId!==context.sessionId||!date(raw.contactedOn)||
   !Array.isArray(raw.productIds)||raw.productIds.length>100)throw new SampleFollowupError();
 if(Object.hasOwn(raw,'customerConfirmed')&&raw.customerConfirmed!==null&&
    typeof raw.customerConfirmed!=='boolean')throw new SampleFollowupError();
 const confirmation=raw.customerConfirmed===undefined?null:raw.customerConfirmed as boolean|null;
 const outcome=note(raw.outcome,400,true)!;
 const feedback=note(raw.feedback,2000);
 const nextAction=note(raw.nextAction,400);
 const nextDate=raw.nextFollowupOn===undefined||raw.nextFollowupOn===null?null:raw.nextFollowupOn;
 if(nextDate!==null&&(!date(nextDate)||nextDate<raw.contactedOn))throw new SampleFollowupError();
 const live=verifiedProductIds(selected),seen=new Set<string>(),productIds:string[]=[];
 for(const value of raw.productIds){
  if(!id(value)||seen.has(value)||!live.has(value))throw new SampleFollowupError();
  seen.add(value);productIds.push(value);
 }
 return {sessionId:context.sessionId,contactedOn:raw.contactedOn,customerConfirmed:confirmation,
  feedback,outcome,nextAction,nextFollowupOn:nextDate as string|null,productIds};
}
