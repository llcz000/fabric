import type {AppPrincipal} from '../access/types';
import {canCreateOwnOrder,canReadOrder,canManageOrder} from '../access/policy';
import type {TxConn,Pool,Update} from './lines';
import {reconcileOrderLinesInTransaction} from './lines';
import {calculateAndPersistOrderTotals} from './calculatedSave';
import {normalizeStoredPieceMeters} from './calculations';
import {recordAdminDocumentAction} from './documentAudit';
import {readHeaderFields,HEADER_COLUMNS,headerSqlValue,type HeaderCreate,type HeaderEdit,type DisplaySnapshot} from './headerFields';

type Row=Record<string,unknown>;
type ReadDB={query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>};
export class DocumentWriteError extends Error{
 readonly status:number;
 constructor(message:string,status=400){super(message);this.status=status;}
}
export interface CreateDocument{
 orderNo:string;date:string;receivingUnit:string;type:'sample'|'deposit'|'bulk';
 deposit:number;items:Update['items'];
}
export type CompleteCreateDocument=CreateDocument&HeaderCreate;
export type EditDocument=HeaderEdit&{items:Update['items'];removeIds:string[];deposit?:number;orderNo?:string;date?:string;receivingUnit?:string};
export interface DocumentLine{
 id:string;productId:string|null;source:'catalog'|'manual'|null;snapshot:Row|null;
 productNo:string;productName:string;colorNo:string;composition:string;
 weight:number|null;widthCm:number|null;meters:number;unitPrice:number;
 amount:number;remark:string;pieceMeters:number[]|null;deductionMeters:number;
}
export interface DocumentRecord{
 id:string;ownerId:string|null;orderNo:string;date:string;receivingUnit:string;
 type:'sample'|'deposit'|'bulk';deposit:number;
 styleNo:string;issuer:string;receiver:string;receiverPhone:string;receiverAddress:string;
 settled:boolean;displaySnapshot:DisplaySnapshot|null;
 totalMeters:number;totalPieces:number;totalAmount:number;deductionMeters:number;
 items:DocumentLine[];
}
function dict(v:unknown):Row{
 if(!v||typeof v!=='object'||Array.isArray(v))throw new DocumentWriteError('Invalid document payload');
 return v as Row;
}
function keys(v:Row,allowed:string[]):void{
 if(Object.keys(v).some(key=>!allowed.includes(key)))throw new DocumentWriteError('Unexpected document payload fields');
}
function money(value:unknown,max:number):value is number{
 return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=max&&
  Math.abs(value*100-Math.round(value*100))<1e-5;
}
function date(value:unknown):value is string{
 if(typeof value!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value))return false;
 const timestamp=new Date(value+'T00:00:00Z');
 return !Number.isNaN(timestamp.getTime())&&timestamp.toISOString().slice(0,10)===value;
}
function positiveInt(id:unknown):id is string{
 return typeof id==='string'&&/^[1-9][0-9]{0,9}$/.test(id)&&Number(id)<=2147483647;
}
function validatedLines(value:unknown,allowExisting:boolean):Update['items']{
 if(!Array.isArray(value)||value.length>200)throw new DocumentWriteError('Invalid document lines');
 for(const line of value){
  const v=dict(line);
  keys(v,['id','fields','selection','manual']);
  if(allowExisting?v.id!==undefined&&!positiveInt(v.id):v.id!==undefined)
   throw new DocumentWriteError('Invalid existing line identifier');
  if(!v.fields||typeof v.fields!=='object'||Array.isArray(v.fields))
   throw new DocumentWriteError('Invalid line business fields');
  keys(v.fields as Row,['meters','unitPrice','remark','deductionMeters','pieceMeters']);
  const fields=v.fields as Row;
  if(!allowExisting&&(typeof fields.meters!=='number'||typeof fields.unitPrice!=='number'))
   throw new DocumentWriteError('New lines require meters and unit price');
  if(!allowExisting&&!v.selection&&!v.manual)
   throw new DocumentWriteError('New lines require explicit product source');
  if(v.selection!==undefined){const s=dict(v.selection);keys(s,['productId']);}
  if(v.manual!==undefined){const m=dict(v.manual);keys(m,['productNo','productName','composition','weight','width','colorNo']);}
  if(!!v.selection&&!!v.manual)throw new DocumentWriteError('Ambiguous line product source');
 }
 return value as Update['items'];
}
export function validateV2DocumentCreate(value:unknown):CompleteCreateDocument{
 const v=dict(value);keys(v,['orderNo','date','receivingUnit','type','deposit','items',...Object.keys(HEADER_COLUMNS)]);
 if(typeof v.orderNo!=='string'||!v.orderNo.trim()||v.orderNo.length>100||
    !date(v.date)||typeof v.receivingUnit!=='string'||!v.receivingUnit.trim()||
    v.receivingUnit.length>100||!['sample','deposit','bulk','sales'].includes(String(v.type))||
    !money(v.deposit,v.type==='deposit'?100:999999999.99))
  throw new DocumentWriteError('Invalid order header');
 const items=validatedLines(v.items,false);
 if(items.length===0)throw new DocumentWriteError('At least one product line required');
 let header:HeaderCreate;
 try{header=readHeaderFields(v,true) as HeaderCreate;}catch{throw new DocumentWriteError('Invalid order display header');}
 if(v.type==='sample'&&v.deposit!==0)throw new DocumentWriteError('Sample documents do not accept a deposit');
 if(v.type==='deposit'&&header.settled)throw new DocumentWriteError('Deposit documents do not have a settlement status');
 return {orderNo:v.orderNo.trim(),date:v.date,receivingUnit:v.receivingUnit.trim(),
  type:v.type==='sales'?'bulk':v.type as CreateDocument['type'],deposit:v.deposit,items,...header};
}
export function validateV2DocumentEdit(value:unknown):EditDocument {
 const v=dict(value);keys(v,['items','removeIds','deposit','orderNo','date','receivingUnit',...Object.keys(HEADER_COLUMNS)]);
 const items=validatedLines(v.items,true);
 if(!Array.isArray(v.removeIds)||v.removeIds.length>200||v.removeIds.some(id=>!positiveInt(id)))
  throw new DocumentWriteError('Explicit removed line ids required');
 if(v.deposit!==undefined&&!money(v.deposit,999999999.99))throw new DocumentWriteError('Invalid deposit');
 let header:HeaderEdit;
 try{header=readHeaderFields(v,false) as HeaderEdit;}catch{throw new DocumentWriteError('Invalid order display header');}
 const editable:Partial<Pick<EditDocument,'orderNo'|'date'|'receivingUnit'>>={};
 for(const key of ['orderNo','receivingUnit'] as const){if(key in v){if(typeof v[key]!=='string'||!v[key].trim()||v[key].length>100)throw new DocumentWriteError('Invalid order header');editable[key]=v[key].trim();}}
 if('date' in v){if(!date(v.date))throw new DocumentWriteError('Invalid order date');editable.date=v.date;}
 return {items,removeIds:v.removeIds as string[],...(v.deposit!==undefined?{deposit:v.deposit as number}: {}),...header,...editable};
}
function array(value:unknown):Row[]{if(!Array.isArray(value))throw Error('Database rows unavailable');return value as Row[];}
export async function freshWriter(db:TxConn,actor:AppPrincipal):Promise<AppPrincipal>{
 // Locks serialize role changes, session revocation and this write. The
 // bearer was also verified by HTTP middleware before reaching this service.
 if(!actor||!/^[1-9][0-9]*$/.test(actor.userId)||!/^[1-9][0-9]*$/.test(actor.sessionId))
  throw new DocumentWriteError('Invalid session',401);
 const [raw]=await db.query(
  'SELECT id,role,is_active,can_manage_own_orders,can_manage_products FROM v2_access_users WHERE id=? FOR SHARE',
  [actor.userId]);
 const user=array(raw)[0];
 if(!user||Number(user.is_active)!==1||user.role!==actor.role)
  throw new DocumentWriteError('Session no longer valid',401);
 const [session]=await db.query(
  'SELECT id FROM v2_access_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR SHARE',
  [actor.sessionId,actor.userId]
 );
 if(!array(session)[0])throw new DocumentWriteError('Session revoked',401);
 const current:AppPrincipal={...actor,canManageOwnOrders:user.role==='admin'||Number(user.can_manage_own_orders)===1,
  canManageProducts:user.role==='admin'||Number(user.can_manage_products)===1};
 if(!canCreateOwnOrder(current))throw new DocumentWriteError('Cannot manage own documents',403);
 return current;
}
export const lockV2DocumentWriter=freshWriter;
async function transact<T>(pool:Pool,worker:(db:TxConn)=>Promise<T>):Promise<T>{
 const db=await pool.getConnection();let active=false;
 try{
  await db.beginTransaction();active=true;
  const result=await worker(db);
  await db.commit();active=false;return result;
 }catch(error){if(active)await db.rollback();throw error;}finally{db.release();}
}
export async function createV2Document(pool:Pool,actor:AppPrincipal,body:unknown):Promise<DocumentRecord>{
 const input=validateV2DocumentCreate(body);
 return transact(pool,async(db)=>{
  const current=await lockV2DocumentWriter(db,actor);
  const [result]=await db.query(
   'INSERT INTO orders (order_no,order_date,receiving_unit,template_type,deposit,created_by_user_id,style_no,sign_person,receiver,receiver_phone,receiver_address,settled,v2_display_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
   [input.orderNo,input.date,input.receivingUnit,input.type,input.deposit,current.userId,
    input.styleNo,input.issuer,input.receiver,input.receiverPhone,input.receiverAddress,
    headerSqlValue('settled',input.settled),headerSqlValue('displaySnapshot',input.displaySnapshot)]
  );
  const id=String((result as {insertId?:number|bigint|string}).insertId??'');
  if(!positiveInt(id))throw new DocumentWriteError('Unable to allocate order id',503);
  await reconcileOrderLinesInTransaction(db,current,id,{items:input.items,removeIds:[]},
   async(locked,orderId,touched)=>{await calculateAndPersistOrderTotals(locked,orderId,touched);});
  return readV2Document(db,current,id);
 });
}

export async function updateV2Document(pool:Pool,actor:AppPrincipal,orderId:string,body:unknown):Promise<DocumentRecord>{
 if(!positiveInt(orderId))throw new DocumentWriteError('Order not found',404);
 const input=validateV2DocumentEdit(body);
 return transact(pool,async(db)=>{
  const current=await lockV2DocumentWriter(db,actor);
  await reconcileOrderLinesInTransaction(db,current,orderId,{items:input.items,removeIds:input.removeIds},
   async(locked,id,touched,owner)=>{
    if(input.deposit!==undefined||input.settled===true){
     const [read]=await locked.query('SELECT template_type FROM orders WHERE id=? FOR UPDATE',[id]);
     const type=array(read)[0]?.template_type;
     if(type==='sample'&&input.deposit!==undefined&&input.deposit!==0)throw new DocumentWriteError('Sample documents do not accept a deposit');
     if(type==='deposit'&&(input.settled===true||(input.deposit!==undefined&&input.deposit>100)))throw new DocumentWriteError('Invalid deposit percentage or settlement status');
     if(input.deposit!==undefined)await locked.query('UPDATE orders SET deposit=? WHERE id=?',[input.deposit,id]);
    }
    await calculateAndPersistOrderTotals(locked,id,touched);
    const updates=Object.entries(HEADER_COLUMNS).filter(([key])=>key in input).map(([key,column])=>({
     key:key as keyof HeaderCreate,column
    }));
    if(updates.length){
     await locked.query('UPDATE orders SET '+updates.map(x=>x.column+'=?').join(',')+' WHERE id=?',
      [...updates.map(x=>headerSqlValue(x.key,input[x.key] as HeaderCreate[keyof HeaderCreate])),id]);
    }
    const businessHeader={orderNo:'order_no',date:'order_date',receivingUnit:'receiving_unit'} as const;
    const changed=(Object.keys(businessHeader) as (keyof typeof businessHeader)[]).filter(key=>key in input);
    if(changed.length)await locked.query('UPDATE orders SET '+changed.map(key=>businessHeader[key]+'=?').join(',')+' WHERE id=?',[...changed.map(key=>input[key]),id]);
    await recordAdminDocumentAction(locked,current,id,owner,'edit');
   });
  return readV2Document(db,current,orderId);
 });
}
function asNumber(value:unknown):number{return value==null?0:Number(value);}
function snapshot(value:unknown):Row|null{
 if(value==null)return null;
 const decoded=typeof value==='string'?JSON.parse(value):value;
 if(!decoded||typeof decoded!=='object'||Array.isArray(decoded))throw Error('Invalid frozen snapshot');
 return decoded as Row;
}
function storedPieceMeters(row:Row):number[]|null{
 // The old form persisted fixed-length JSON arrays with empty slots as null.
 // Only unlinked legacy rows get this read projection; SQL and V2 validation stay unchanged.
 return normalizeStoredPieceMeters(row.piece_meters,row.v2_source_kind==null&&row.v2_product_snapshot==null);
}
export async function readV2Document(db:ReadDB,actor:AppPrincipal,orderId:string):Promise<DocumentRecord>{
 if(!positiveInt(orderId))throw new DocumentWriteError('Order not found',404);
 if(!actor)throw new DocumentWriteError('Authentication required',401);
 const [oRaw]=await db.query(
  'SELECT o.id,o.order_no,o.order_date,o.receiving_unit,o.template_type,o.deposit,o.total_meters,o.total_pieces,o.total_amount,o.deduction_meters,o.created_by_user_id,o.style_no,o.sign_person,o.receiver,o.receiver_phone,o.receiver_address,o.settled,o.v2_display_snapshot FROM orders o WHERE o.id=? LIMIT 1',
  [orderId]);
 const o=array(oRaw)[0];
 if(!o||!canReadOrder(actor,{createdByUserId:o.created_by_user_id==null?null:String(o.created_by_user_id)}))
  throw new DocumentWriteError('Order not found',404);
 if(o.template_type!=='sample'&&o.template_type!=='deposit'&&o.template_type!=='bulk')
  throw new DocumentWriteError('Unknown document type',503);
 const [iRaw]=await db.query(
  'SELECT i.id,i.order_id,i.product_no,i.product_name,i.color_no,i.composition,i.weight,i.width,i.meters,i.unit_price,i.amount,i.remark,i.piece_meters,i.deduction_meters,i.v2_product_id,i.v2_source_kind,i.v2_product_snapshot FROM order_items i WHERE i.order_id=? ORDER BY i.id',
  [orderId]);
 return {
  id:String(o.id),ownerId:o.created_by_user_id==null?null:String(o.created_by_user_id),
  orderNo:String(o.order_no),date:o.order_date instanceof Date?o.order_date.toISOString().slice(0,10):String(o.order_date).slice(0,10),
  receivingUnit:String(o.receiving_unit),type:o.template_type,deposit:o.template_type==='sample'?0:asNumber(o.deposit),
  styleNo:String(o.style_no??''),issuer:String(o.sign_person??''),receiver:String(o.receiver??''),
  receiverPhone:String(o.receiver_phone??''),receiverAddress:String(o.receiver_address??''),
  settled:o.template_type!=='deposit'&&Number(o.settled)===1,displaySnapshot:snapshot(o.v2_display_snapshot) as unknown as DisplaySnapshot|null,
  totalMeters:asNumber(o.total_meters),totalPieces:o.template_type==='deposit'?0:o.template_type==='sample'?array(iRaw).length:asNumber(o.total_pieces),totalAmount:asNumber(o.total_amount),
  deductionMeters:asNumber(o.deduction_meters),
  items:array(iRaw).map(r=>({
   id:String(r.id),productId:r.v2_product_id==null?null:String(r.v2_product_id),
   source:r.v2_source_kind==='catalog'||r.v2_source_kind==='manual'?r.v2_source_kind:null,
   snapshot:snapshot(r.v2_product_snapshot),productNo:String(r.product_no??''),
   productName:String(r.product_name??''),colorNo:String(r.color_no??''),
   composition:String(r.composition??''),weight:r.weight==null?null:asNumber(r.weight),
   widthCm:r.width==null?null:asNumber(r.width),meters:asNumber(r.meters),
   unitPrice:asNumber(r.unit_price),amount:asNumber(r.amount),remark:String(r.remark??''),
   pieceMeters:storedPieceMeters(r),deductionMeters:asNumber(r.deduction_meters)
  }))
 };
}
