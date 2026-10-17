import type {AppPrincipal} from '../access/types';
import type {SamplePool} from './scanRepository';
export class SampleSessionReadError extends Error{
 constructor(readonly status:400|403|404|409){super('Sample selection unavailable');this.name='SampleSessionReadError';}
}
export interface SampleSessionPage{
 session:{id:string;customerReference:string;status:'open'|'closed'};
 total:number;selectedCardCount:number;limit:number;offset:number;
 items:{id:string;productId:string;current:{productNo:string;patternNo:string;colorwayNo:number;fabricNo:string;fabricName:string;composition:string|null;weightValue:string|null;weightUnit:'gsm'|'mm'|null;widthCm:string|null};sources:{cardId:string;cardNo:string;retired:boolean;firstScanEventId:string|null;firstManualEventId?:string}[]}[];
}
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[1-9]\d{0,19}$/.test(value)&&BigInt(value)<=18446744073709551615n;
type Row=Record<string,unknown>;
const rows=(raw:unknown):Row[]=>{
 if(!Array.isArray(raw)||raw.some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw new SampleSessionReadError(409);
 return raw as Row[];
};
function dbId(raw:unknown):string{
 if(typeof raw==='number'&&!Number.isSafeInteger(raw))throw new SampleSessionReadError(409);
 const value=String(raw);if(!validId(value))throw new SampleSessionReadError(409);return value;
}
function count(raw:unknown):number{
 if(!(typeof raw==='number'||typeof raw==='string'&&/^\d+$/.test(raw)))throw new SampleSessionReadError(409);
 const value=Number(raw);if(!Number.isSafeInteger(value)||value<0)throw new SampleSessionReadError(409);return value;
}
function liveDetails(row:Row):SampleSessionPage['items'][number]['current']{
 const required=(value:unknown):string=>{
  if(typeof value!=='string'||!value.trim())throw new SampleSessionReadError(409);
  return value;
 };
 const decimal=(value:unknown):string|null=>{
  if(value===null)return null;
  if((typeof value!=='string'&&typeof value!=='number')||!Number.isFinite(Number(value))||Number(value)<=0)
   throw new SampleSessionReadError(409);
  return String(value);
 };
 const colorwayNo=count(row.colorway_no);
 if(colorwayNo<1||colorwayNo>4294967295)throw new SampleSessionReadError(409);
 const weightValue=decimal(row.weight_value),rawUnit=row.weight_unit;
 if(rawUnit!==null&&rawUnit!=='gsm'&&rawUnit!=='mm')throw new SampleSessionReadError(409);
 const weightUnit=rawUnit as 'gsm'|'mm'|null;
 if((weightValue===null)!==(weightUnit===null))throw new SampleSessionReadError(409);
 if(row.composition!==null&&typeof row.composition!=='string')throw new SampleSessionReadError(409);
 return {
  productNo:required(row.product_no),patternNo:required(row.master_no),colorwayNo,
  fabricNo:required(row.fabric_no),fabricName:required(row.fabric_name),
  composition:row.composition as string|null,weightValue,weightUnit,
  widthCm:decimal(row.width_value)
 };
}
/** Internal selection read; live master attributes, no grant creation or implicit admin access.
 * User -> login -> sample session -> grant locks match the scan transaction.
 * Holding the session SHARE lock keeps totals/items/sources coherent against scans.
 */
export async function readSampleSession(
 pool:SamplePool,actor:AppPrincipal,sessionId:string,input:{limit?:number;offset?:number}={}
):Promise<SampleSessionPage>{
 if(!actor||(actor.role!=='sales'&&actor.role!=='admin')||!validId(actor.userId)||!validId(actor.sessionId))throw new SampleSessionReadError(403);
 if(!validId(sessionId)||!input||typeof input!=='object'||Array.isArray(input)||
  Object.keys(input).some(k=>k!=='limit'&&k!=='offset'))throw new SampleSessionReadError(400);
 const {limit=50,offset=0}=input;
 if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>1000000)
  throw new SampleSessionReadError(400);
 const tx=await pool.getConnection();let began=false;
 try{
  await tx.beginTransaction();began=true;
  const [userRaw]=await tx.query('SELECT id,role,is_active FROM v2_access_users WHERE id=? FOR SHARE',[actor.userId]);
  const user=rows(userRaw)[0];
  if(!user||user.role!==actor.role||Number(user.is_active)!==1)throw new SampleSessionReadError(403);
  const [loginRaw]=await tx.query('SELECT id FROM v2_access_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR SHARE',[actor.sessionId,actor.userId]);
  if(rows(loginRaw).length!==1)throw new SampleSessionReadError(403);
  // Do not fetch customer details until the explicit session grant is checked.
  const [sessionRaw]=await tx.query('SELECT id,status FROM customer_sample_sessions WHERE id=? FOR SHARE',[sessionId]);
  const session=rows(sessionRaw)[0];if(!session)throw new SampleSessionReadError(404);
  if(session.status!=='open'&&session.status!=='closed')throw new SampleSessionReadError(409);
  const [grantRaw]=await tx.query('SELECT can_manage FROM customer_sample_session_access WHERE session_id=? AND user_id=? AND can_manage=1 FOR SHARE',[sessionId,actor.userId]);
  const grant=rows(grantRaw);if(grant.length!==1||Number(grant[0].can_manage)!==1)throw new SampleSessionReadError(404);
  const [summaryRaw]=await tx.query('SELECT s.customer_reference, '+
   '(SELECT COUNT(*) FROM customer_sample_items i WHERE i.session_id=s.id AND i.removed_at IS NULL) AS total, '+
   '(SELECT COUNT(*) FROM customer_sample_selected_cards c WHERE c.session_id=s.id) AS selected_card_count '+
   'FROM customer_sample_sessions s WHERE s.id=?',[sessionId]);
  const summary=rows(summaryRaw)[0];
  if(!summary||typeof summary.customer_reference!=='string'||summary.customer_reference.length>160)throw new SampleSessionReadError(409);
  const total=count(summary.total),selectedCardCount=count(summary.selected_card_count);
  const [itemRaw]=await tx.query('SELECT i.id,i.product_id,p.product_no,m.master_no,c.colorway_no, '+
   'f.fabric_no,f.fabric_name,f.composition,f.weight_value,f.weight_unit,f.width_value '+
   'FROM customer_sample_items i LEFT JOIN v2_products p ON p.id=i.product_id '+
   'LEFT JOIN pattern_colorways c ON c.id=p.pattern_colorway_id '+
   'LEFT JOIN pattern_masters m ON m.id=c.master_id '+
   'LEFT JOIN v2_fabrics f ON f.id=p.fabric_id '+
   'WHERE i.session_id=? AND i.removed_at IS NULL ORDER BY i.id ASC LIMIT ? OFFSET ?',[sessionId,limit,offset]);
  const selected=rows(itemRaw);
  if(selected.length!==Math.min(limit,Math.max(0,total-offset)))throw new SampleSessionReadError(409);
  const items:SampleSessionPage['items']=selected.map(row=>({id:dbId(row.id),productId:dbId(row.product_id),current:liveDetails(row),sources:[]}));
  const byProduct=new Map(items.map(item=>[item.productId,item]));
  if(byProduct.size!==items.length||new Set(items.map(item=>item.id)).size!==items.length)throw new SampleSessionReadError(409);
  if(items.length){
   const [sourceRaw]=await tx.query('SELECT src.product_id,src.card_id,c.card_no,c.deleted_at,src.first_scan_event_id '+
    'FROM customer_sample_item_sources src JOIN sample_cards c ON c.id=src.card_id '+
    'WHERE src.session_id=? AND src.product_id IN ('+items.map(()=>'?').join(',')+') '+
    'ORDER BY src.product_id ASC,src.card_id ASC',[sessionId,...items.map(item=>item.productId)]);
   const seen=new Set<string>();
   for(const row of rows(sourceRaw)){
    const productId=dbId(row.product_id),cardId=dbId(row.card_id),item=byProduct.get(productId);
    if(!item||typeof row.card_no!=='string'||!row.card_no||!Object.hasOwn(row,'deleted_at')||seen.has(productId+':'+cardId))
     throw new SampleSessionReadError(409);
    seen.add(productId+':'+cardId);
    item.sources.push({cardId,cardNo:row.card_no,retired:row.deleted_at!==null,firstScanEventId:dbId(row.first_scan_event_id)});
   }
   const [manualRaw]=await tx.query('SELECT e.product_id,e.card_id,c.card_no,c.deleted_at,MIN(e.id) AS first_manual_event_id '+
    'FROM customer_sample_manual_events e JOIN sample_cards c ON c.id=e.card_id '+
    'WHERE e.session_id=? AND e.product_id IN ('+items.map(()=>'?').join(',')+') '+
    'GROUP BY e.product_id,e.card_id,c.card_no,c.deleted_at ORDER BY e.product_id,e.card_id',[sessionId,...items.map(item=>item.productId)]);
   for(const row of rows(manualRaw)){
    const productId=dbId(row.product_id),cardId=dbId(row.card_id),item=byProduct.get(productId);
    if(!item||typeof row.card_no!=='string'||!row.card_no||!Object.hasOwn(row,'deleted_at'))throw new SampleSessionReadError(409);
    const firstManualEventId=dbId(row.first_manual_event_id);
    const source=item.sources.find(x=>x.cardId===cardId);
    if(source)source.firstManualEventId=firstManualEventId;
    else item.sources.push({cardId,cardNo:row.card_no,retired:row.deleted_at!==null,firstScanEventId:null,firstManualEventId});
   }
  }
  await tx.commit();began=false;
  return {session:{id:sessionId,customerReference:summary.customer_reference,status:session.status},total,selectedCardCount,limit,offset,items};
 }catch(error){if(began)await tx.rollback();throw error;}finally{tx.release();}
}
