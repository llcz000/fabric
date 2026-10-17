import type {AppPrincipal} from '../access/types';
import type {SamplePool} from './scanRepository';
import {lockSelectionAccess,SampleSessionManualError,validSelectionId} from './sessionManual';
import {SampleFulfillmentError} from './fulfillmentService';

type Row=Record<string,unknown>;
const rows=(raw:unknown):Row[]=>{
 if(!Array.isArray(raw)||raw.some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw new SampleFulfillmentError(409);
 return raw as Row[];
};
const id=(raw:unknown)=>{
 if(typeof raw==='number'&&!Number.isSafeInteger(raw))throw new SampleFulfillmentError(409);
 const value=String(raw);
 if(!validSelectionId(value))throw new SampleFulfillmentError(409);
 return value;
};
const count=(raw:unknown)=>{
 if(!(typeof raw==='number'||typeof raw==='string'&&/^\d+$/.test(raw)))throw new SampleFulfillmentError(409);
 const n=Number(raw);
 if(!Number.isSafeInteger(n)||n<0)throw new SampleFulfillmentError(409);
 return n;
};
const text=(raw:unknown,limit:number,required=false):string|null=>{
 if(raw===null&&!required)return null;
 if(typeof raw!=='string'||(required&&!raw)||raw.length>limit)throw new SampleFulfillmentError(409);
 return raw;
};
const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&
 Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const iso=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&
 Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
interface ShipmentHistoryRow{id:string;actorUserId:string;shippedAt:string;carrier:string|null;trackingNo:string|null;items:{productId:string;quantity:number}[]}
interface FollowupHistoryRow{id:string;actorUserId:string;contactedOn:string;customerConfirmed:boolean|null;feedback:string|null;outcome:string;nextAction:string|null;nextFollowupOn:string|null;productIds:string[]}
export type FulfillmentKind='shipments'|'followups';
export async function readSampleFulfillmentHistory(
 pool:SamplePool,actor:AppPrincipal,sessionId:string,kind:FulfillmentKind,
 page:{limit?:number;offset?:number}={}
){
 if(!validSelectionId(sessionId)||!['shipments','followups'].includes(kind)||
  !page||typeof page!=='object'||Array.isArray(page)||
  Object.keys(page).some(k=>k!=='limit'&&k!=='offset'))throw new SampleFulfillmentError(400);
 const {limit=20,offset=0}=page;
 if(!Number.isSafeInteger(limit)||limit<1||limit>50||
  !Number.isSafeInteger(offset)||offset<0||offset>1000000)throw new SampleFulfillmentError(400);
 if(!actor||(actor.role!=='admin'&&actor.role!=='sales')||
  !validSelectionId(actor.userId)||!validSelectionId(actor.sessionId))throw new SampleFulfillmentError(403);
 const tx=await pool.getConnection();let began=false;
 try{
  await tx.beginTransaction();began=true;
  await lockSelectionAccess(tx,actor,sessionId,false);
  // No owner passed from client. Session/grant SHARE lock protects the
  // entire read including totals and relation rows from concurrent mutation.
  const table=kind==='shipments'?'sample_shipments':'sample_followups';
  const [countRaw]=await tx.query('SELECT COUNT(*) AS total FROM '+table+' WHERE session_id=?',[sessionId]);
  const summaries=rows(countRaw);if(summaries.length!==1)throw new SampleFulfillmentError(409);
  const total=count(summaries[0].total);
  const [headRaw]=await tx.query(kind==='shipments'?
   "SELECT CAST(id AS CHAR) AS id,CAST(actor_user_id AS CHAR) AS actor_user_id,CONCAT(DATE_FORMAT(shipped_at,'%Y-%m-%dT%H:%i:%s.'),SUBSTRING(DATE_FORMAT(shipped_at,'%f'),1,3),'Z') AS shipped_at,carrier,tracking_no FROM sample_shipments WHERE session_id=? ORDER BY shipped_at DESC,id DESC LIMIT ? OFFSET ?":
   "SELECT CAST(id AS CHAR) AS id,CAST(actor_user_id AS CHAR) AS actor_user_id,DATE_FORMAT(contacted_on,'%Y-%m-%d') AS contacted_on,customer_confirmed,feedback,outcome,next_action,DATE_FORMAT(next_followup_on,'%Y-%m-%d') AS next_followup_on FROM sample_followups WHERE session_id=? ORDER BY contacted_on DESC,id DESC LIMIT ? OFFSET ?",
   [sessionId,limit,offset]);
  const headers=rows(headRaw);
  if(headers.length!==Math.min(limit,Math.max(0,total-offset)))throw new SampleFulfillmentError(409);
  const ids=headers.map(x=>id(x.id));
  if(new Set(ids).size!==ids.length)throw new SampleFulfillmentError(409);
  const items:(ShipmentHistoryRow|FollowupHistoryRow)[]=kind==='shipments'?headers.map(x=>{
   if(!iso(x.shipped_at))throw new SampleFulfillmentError(409);
   return {id:id(x.id),actorUserId:id(x.actor_user_id),shippedAt:x.shipped_at as string,
    carrier:text(x.carrier,160),trackingNo:text(x.tracking_no,160),items:[] as {productId:string;quantity:number}[]};
  }):headers.map(x=>{
   if(!date(x.contacted_on)||x.next_followup_on!==null&&!date(x.next_followup_on)||
    x.customer_confirmed!==null&&x.customer_confirmed!==0&&x.customer_confirmed!==1)throw new SampleFulfillmentError(409);
   return {id:id(x.id),actorUserId:id(x.actor_user_id),contactedOn:x.contacted_on as string,
    customerConfirmed:x.customer_confirmed===null?null:x.customer_confirmed===1,
    feedback:text(x.feedback,2000),outcome:text(x.outcome,400,true)!,
    nextAction:text(x.next_action,400),nextFollowupOn:x.next_followup_on as string|null,
    productIds:[] as string[]};
  });
  if(ids.length){
   const [lineRaw]=await tx.query(kind==='shipments'?
    'SELECT CAST(shipment_id AS CHAR) AS shipment_id,CAST(product_id AS CHAR) AS product_id,quantity FROM sample_shipment_items WHERE session_id=? AND shipment_id IN ('+ids.map(()=>'?').join(',')+') ORDER BY shipment_id,product_id':
    'SELECT CAST(followup_id AS CHAR) AS followup_id,CAST(product_id AS CHAR) AS product_id FROM sample_followup_products WHERE session_id=? AND followup_id IN ('+ids.map(()=>'?').join(',')+') ORDER BY followup_id,product_id',
    [sessionId,...ids]);
   const lookup=new Map<string,ShipmentHistoryRow|FollowupHistoryRow>(items.map(x=>[x.id,x] as const));
   const seen=new Set<string>();
   for(const line of rows(lineRaw)){
    const parentId=id(kind==='shipments'?line.shipment_id:line.followup_id),productId=id(line.product_id);
    const parent=lookup.get(parentId),key=parentId+':'+productId;
    if(!parent||seen.has(key))throw new SampleFulfillmentError(409);
    seen.add(key);
    if(kind==='shipments'){
     const quantity=count(line.quantity);if(!quantity||!('items' in parent))throw new SampleFulfillmentError(409);
     parent.items.push({productId,quantity});
    }else{
     if(!('productIds' in parent))throw new SampleFulfillmentError(409);
     parent.productIds.push(productId);
    }
   }
   if(kind==='shipments'&&items.some(x=>!('items' in x)||!x.items.length))throw new SampleFulfillmentError(409);
  }
  await tx.commit();began=false;
  return {sessionId,total,limit,offset,items};
 }catch(error){
  if(began)await tx.rollback();
  if(error instanceof SampleSessionManualError)throw new SampleFulfillmentError(error.status);
  throw error;
 }finally{tx.release();}
}
