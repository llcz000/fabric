import type {AppPrincipal} from '../access/types';
import {scopeOrdersQuery} from '../access/sessions';

type Database={query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>};
type Row=Record<string,unknown>;
export class OrderSearchError extends Error {
 constructor(message:string,readonly status=400){super(message);}
}
export interface ScopedOrderFilters{
 limit:number;offset:number;orderNo?:string;type?:'sample'|'deposit'|'bulk';
 from?:string;to?:string;customer?:string;productNo?:string;colorNo?:string;
 productName?:string;settled?:boolean;
}
const only=['limit','offset','orderNo','type','from','to','customer','productNo','colorNo','productName','settled'];
const escapeLike=(value:string)=>'%'+value.replace(/[\\%_]/g,c=>'\\'+c)+'%';
const itemFields={productNo:'product_no',colorNo:'color_no',productName:'product_name'} as const;
const linePieces="CASE WHEN o.template_type='sample' THEN 1 WHEN o.template_type='bulk' THEN COALESCE(JSON_LENGTH(i.piece_meters),0) ELSE 0 END";
const int=(raw:unknown,key:string,def:number,min:number,max:number):number=>{
 if(raw===undefined)return def;
 if(typeof raw!=='string'||!/^(0|[1-9][0-9]*)$/.test(raw)||raw.length>10||
  Number(raw)<min||Number(raw)>max)throw new OrderSearchError('Invalid '+key);
 return Number(raw);
};
const date=(v:unknown,label:string):string|undefined=>{
 if(v===undefined)return;
 if(typeof v!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)||
  Number.isNaN(new Date(v+'T00:00:00Z').getTime())||
  new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)
   throw new OrderSearchError('Invalid '+label);
 return v;
};
export function parseScopedOrderFilters(input:Record<string,unknown>):ScopedOrderFilters {
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!only.includes(k)))
  throw new OrderSearchError('Invalid order search');
 const limit=int(input.limit,'limit',20,1,50),offset=int(input.offset,'offset',0,0,1000000);
 const filters:ScopedOrderFilters={limit,offset};
 if(input.orderNo!==undefined){
  if(typeof input.orderNo!=='string'||input.orderNo.length>100)
   throw new OrderSearchError('Invalid orderNo');
  if(input.orderNo.trim())filters.orderNo=input.orderNo.trim();
 }
 if(input.type!==undefined){
  if(!['sample','deposit','bulk','sales'].includes(String(input.type)))throw new OrderSearchError('Invalid type');
  // Public/UI sales label maps to the existing persisted MySQL `bulk` value.
  filters.type=input.type==='sales'?'bulk':input.type as ScopedOrderFilters['type'];
 }
 const from=date(input.from,'from'),to=date(input.to,'to');
 if(from&&to&&from>to)throw new OrderSearchError('Invalid range');
 if(from)filters.from=from;
 if(to)filters.to=to;
 for(const field of ['customer','productNo','colorNo','productName'] as const){
  const value=input[field];
  if(value===undefined)continue;
  if(typeof value!=='string'||[...value].length>100||/[\p{Cc}\p{Cf}]/u.test(value))
   throw new OrderSearchError('Invalid '+field);
  if(value.trim())filters[field]=value.trim();
 }
 if(input.settled!==undefined){
  if(input.settled!=='true'&&input.settled!=='false')throw new OrderSearchError('Invalid settled');
  filters.settled=input.settled==='true';
 }
 return filters;
}
function array(value:unknown):Row[]{
 if(!Array.isArray(value))throw Error('Order search row set unavailable');
 return value as Row[];
}
function where(actor:AppPrincipal|null|undefined,filters:Partial<ScopedOrderFilters>,itemAlias?:'i'){
 const scoped=scopeOrdersQuery(actor);
 const parts=[scoped.predicate],args:unknown[]=[...scoped.parameters];
 if(filters.orderNo){parts.push("o.order_no LIKE ? ESCAPE '\\\\'");args.push(escapeLike(filters.orderNo));}
 if(filters.customer){parts.push("o.receiving_unit LIKE ? ESCAPE '\\\\'");args.push(escapeLike(filters.customer));}
 if(filters.type){parts.push('o.template_type=?');args.push(filters.type);}
 if(filters.from){parts.push('o.order_date>=?');args.push(filters.from);}
 if(filters.to){parts.push('o.order_date<=?');args.push(filters.to);}
 if(filters.settled!==undefined){
  parts.push("o.template_type IN ('sample','bulk')",'o.settled=?');args.push(filters.settled?1:0);
 }
 const fields=(Object.keys(itemFields) as (keyof typeof itemFields)[])
  .filter(field=>Boolean(filters[field]));
 if(fields.length){
  const conditions=fields.map(field=>{
   args.push(escapeLike(filters[field]!));
   return "i."+itemFields[field]+" LIKE ? ESCAPE '\\\\'";
  });
  if(itemAlias==='i')parts.push(...conditions);
  else parts.push('EXISTS (SELECT 1 FROM order_items i WHERE i.order_id=o.id AND '+conditions.join(' AND ')+')');
 }
 return {sql:'WHERE '+parts.join(' AND '),args};
}
export async function listScopedOrders(db:Database,actor:AppPrincipal|null|undefined,filters:ScopedOrderFilters){
 const query=where(actor,filters);
 const [c]=await db.query('SELECT COUNT(*) AS total FROM orders o '+query.sql,query.args);
 const total=Number(array(c)[0]?.total);
 if(!Number.isSafeInteger(total)||total<0)throw Error('Invalid order count');
 if(total===0)return {total,limit:filters.limit,offset:filters.offset,items:[]};
 const [raw]=await db.query(
  'SELECT o.id,o.order_no,o.order_date,o.receiving_unit,o.template_type,o.deposit,o.total_meters,o.total_pieces,o.total_amount,o.deduction_meters,o.created_by_user_id,o.settled FROM orders o '+
  query.sql+' ORDER BY o.order_date DESC,o.id DESC LIMIT ? OFFSET ?',
  [...query.args,filters.limit,filters.offset]
 );
 return {total,limit:filters.limit,offset:filters.offset,items:array(raw).map(r=>({
  id:String(r.id),orderNo:String(r.order_no),date:r.order_date instanceof Date?
   r.order_date.toISOString().slice(0,10):String(r.order_date).slice(0,10),
  receivingUnit:String(r.receiving_unit??''),type:String(r.template_type),
  ownerId:r.created_by_user_id==null?null:String(r.created_by_user_id),
  deposit:Number(r.deposit??0),totalMeters:Number(r.total_meters??0),
  totalPieces:Number(r.total_pieces??0),totalAmount:Number(r.total_amount??0),deductionMeters:Number(r.deduction_meters??0),settled:Number(r.settled)===1
 }))};
}
/** QUERY-02: return only matched saved lines, after checking the same scoped
 * header match. Recheck ownership in both count and page; no N+1 catalog reads. */
export async function listMatchingOrderItems(
 db:Database,actor:AppPrincipal|null|undefined,orderId:string,filters:ScopedOrderFilters
){
 if(!/^[1-9][0-9]{0,19}$/.test(orderId))throw new OrderSearchError('Invalid order id');
 const header=where(actor,filters);
 const [visible]=await db.query('SELECT o.id FROM orders o '+header.sql+' AND o.id=? LIMIT 1',[...header.args,orderId]);
 if(array(visible).length!==1)throw new OrderSearchError('Order not found',404);
 const query=where(actor,filters,'i');
 const sql='FROM orders o JOIN order_items i ON i.order_id=o.id '+query.sql+' AND o.id=?';
 const args=[...query.args,orderId];
 const [count]=await db.query('SELECT COUNT(*) AS total '+sql,args);
 const total=Number(array(count)[0]?.total);
 if(!Number.isSafeInteger(total)||total<0)throw Error('Invalid matching line count');
 const [raw]=total===0?[[],[]]:await db.query(
  'SELECT i.id,i.product_no,i.color_no,i.product_name,i.meters,i.amount,'+linePieces+' AS pieces '+
  sql+' ORDER BY i.id LIMIT ? OFFSET ?',[...args,filters.limit,filters.offset]);
 const finite=(v:unknown)=>{const n=Number(v??0);if(!Number.isFinite(n)||n<0)throw Error('Invalid matching line');return n;};
 return {orderId,total,limit:filters.limit,offset:filters.offset,items:array(raw).map(row=>({
  id:String(row.id),productNo:String(row.product_no??''),colorNo:String(row.color_no??''),
  productName:String(row.product_name??''),meters:finite(row.meters),amount:finite(row.amount),pieces:finite(row.pieces)
 }))};
}
/** QUERY-03: aggregate ONLY matched line rows under the same server-side owner
 * predicate. Combined totals exclude deposit contracts and advance-payment
 * amounts; they are not revenue and must be shown separately by type.
 */
export async function summarizeMatchingOrderItems(
 db:Database,actor:AppPrincipal|null|undefined,filters:ScopedOrderFilters
){
 const query=where(actor,filters,'i');
 const [raw]=await db.query(
  'SELECT COUNT(*) AS matching_line_count,'+
  'COALESCE(SUM(i.meters),0) AS meters_total,'+
  'COALESCE(SUM(i.amount),0) AS amount_total,'+
  'COALESCE(SUM('+linePieces+'),0) AS pieces_total '+
  'FROM orders o JOIN order_items i ON i.order_id=o.id '+
  query.sql+" AND o.template_type<>'deposit'",query.args);
 const r=array(raw)[0]??{};
 const finite=(v:unknown)=>{const n=Number(v??0);if(!Number.isFinite(n)||n<0)throw Error('Invalid matched totals');return n;};
 return {matchingLineCount:finite(r.matching_line_count),metersTotal:finite(r.meters_total),
  amountTotal:finite(r.amount_total),piecesTotal:finite(r.pieces_total)};
}

export async function statsScopedOrders(
 db:Database,actor:AppPrincipal|null|undefined,filters:Pick<ScopedOrderFilters,'from'|'to'>={}
){
 const query=where(actor,filters);
 const [raw]=await db.query(
  'SELECT COUNT(*) AS order_count,'+
  "COALESCE(SUM(CASE WHEN o.template_type IN ('sample','bulk') THEN o.total_amount ELSE 0 END),0) AS amount_total,"+
  "COALESCE(SUM(CASE WHEN o.template_type IN ('sample','bulk') THEN o.total_meters ELSE 0 END),0) AS meters_total,"+
  (['sample','bulk','deposit'] as const).flatMap(type=>[
   "COALESCE(SUM(CASE WHEN o.template_type='"+type+"' THEN 1 ELSE 0 END),0) AS "+type+"_count",
   "COALESCE(SUM(CASE WHEN o.template_type='"+type+"' THEN o.total_meters ELSE 0 END),0) AS "+type+"_meters",
   "COALESCE(SUM(CASE WHEN o.template_type='"+type+"' THEN o.total_amount ELSE 0 END),0) AS "+type+(type==='deposit'?'_contract_amount':'_amount')
  ]).join(',')+
  ' FROM orders o '+query.sql,query.args);
 const r=array(raw)[0]??{};
 const number=(v:unknown)=>{const n=Number(v??0);if(!Number.isFinite(n)||n<0)throw Error('Invalid statistics');return n;};
 const value=(key:string)=>number(r[key]);
 // Rank saved line names, including historical/manual entries. Catalog edits
 // must not change an already-saved document's product identity or grouping.
 const productName="COALESCE(NULLIF(TRIM(i.product_name),''),'未命名的面料')";
 const [ranked]=await db.query(
  'SELECT '+productName+' AS product_name,'+
  'COALESCE(SUM(i.meters),0) AS meters_total '+
  'FROM orders o JOIN order_items i ON i.order_id=o.id '+query.sql+
  ' GROUP BY '+productName+' ORDER BY meters_total DESC,product_name ASC LIMIT 5',query.args);
 const [recent]=await db.query(
  'SELECT o.id,o.order_no,o.order_date,o.receiving_unit,o.template_type,o.total_meters,o.total_amount '+
  'FROM orders o '+query.sql+' ORDER BY o.order_date DESC,o.id DESC LIMIT 4',query.args);
 return {orderCount:value('order_count'),amountTotal:value('amount_total'),
  metersTotal:value('meters_total'),byType:{
   sample:{count:value('sample_count'),meters:value('sample_meters'),amount:value('sample_amount')},
   bulk:{count:value('bulk_count'),meters:value('bulk_meters'),amount:value('bulk_amount')},
   deposit:{count:value('deposit_count'),meters:value('deposit_meters'),contractAmount:value('deposit_contract_amount')}
  },topProducts:array(ranked).map(row=>({
   productName:String(row.product_name),meters:number(row.meters_total)
  })),recentOrders:array(recent).map(row=>({
   id:String(row.id),orderNo:String(row.order_no),date:row.order_date instanceof Date?
    row.order_date.toISOString().slice(0,10):String(row.order_date).slice(0,10),
   receivingUnit:String(row.receiving_unit??''),type:String(row.template_type),
   totalMeters:number(row.total_meters),totalAmount:number(row.total_amount)
  }))};
}
