import type {AppPrincipal} from '../access/types';
import {canManageOrder} from '../access/policy';
import type {Pool,TxConn} from './lines';
import {assertActiveDocumentProduct} from './lines';
import {freshWriter,DocumentWriteError} from './documents';
import {recordAdminDocumentAction} from './documentAudit';

/** DOC-01: real V2 copy/delete. Operates only on explicitly authorized,
 * locked V2 orders; source line snapshots are copied in SQL, not resampled
 * from the mutable current product library. Never mounted on legacy server.
 */
type Row=Record<string,unknown>;
const idOk=(v:unknown):v is string=>typeof v==='string'&&/^[1-9][0-9]{0,9}$/.test(v)&&Number(v)<=2147483647;
function rows(r:unknown):Row[]{
 if(!Array.isArray(r))throw new DocumentWriteError('Database rows unavailable',503);
 return r as Row[];
}
function createInput(value:unknown):{orderNo:string;date:string}{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new DocumentWriteError('Invalid copy request');
 const v=value as Record<string,unknown>;
 if(Object.keys(v).some(k=>!['orderNo','date'].includes(k))||
  typeof v.orderNo!=='string'||!v.orderNo.trim()||v.orderNo.length>100||
  typeof v.date!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v.date)||
  Number.isNaN(Date.parse(v.date+'T00:00:00Z'))||
  new Date(v.date+'T00:00:00Z').toISOString().slice(0,10)!==v.date)
  throw new DocumentWriteError('Invalid copy request');
 return {orderNo:v.orderNo.trim(),date:v.date};
}
async function transact<T>(pool:Pool,work:(db:TxConn)=>Promise<T>):Promise<T>{
 const db=await pool.getConnection();let active=false;
 try{
  await db.beginTransaction();active=true;
  const result=await work(db);
  await db.commit();active=false;return result;
 }catch(error){if(active)await db.rollback();throw error;}finally{db.release();}
}
async function lockedSource(db:TxConn,actor:AppPrincipal,id:string):Promise<Row>{
 const [raw]=await db.query('SELECT id,created_by_user_id,order_no FROM orders WHERE id=? FOR UPDATE',[id]);
 const entry=rows(raw);
 if(entry.length!==1)throw new DocumentWriteError('Order not found',404);
 const owner=entry[0].created_by_user_id==null?null:String(entry[0].created_by_user_id);
 if(!canManageOrder(actor,{createdByUserId:owner}))throw new DocumentWriteError('Order not found',404);
 return entry[0];
}
/** Requires a distinct user-entered new number. One SQL snapshot copy,
 * including all frozen V2 product/trade fields; no stale input totals.
 */
export async function copyV2Document(pool:Pool,actor:AppPrincipal,sourceId:string,body:unknown):
 Promise<{id:string;orderNo:string}>{
 if(!idOk(sourceId))throw new DocumentWriteError('Order not found',404);
 const input=createInput(body);
 return transact(pool,async db=>{
  const writer=await freshWriter(db,actor);
  const source=await lockedSource(db,writer,sourceId);
  if(source.order_no===input.orderNo)throw new DocumentWriteError('New document number must differ',409);
  // Best-effort friendly duplicate check; physical UNIQUE(order_no) and
  // transaction write-conflict remain mandatory release/schema prerequisites.
  const [existing]=await db.query('SELECT id FROM orders WHERE order_no=? LIMIT 1 FOR UPDATE',[input.orderNo]);
  if(rows(existing).length)throw new DocumentWriteError('Document number already exists',409);
  const [lockedItems]=await db.query('SELECT id,v2_product_id,v2_source_kind FROM order_items WHERE order_id=? ORDER BY id FOR UPDATE',[sourceId]);
  const expected=rows(lockedItems).length;
  if(!Number.isSafeInteger(expected)||expected<1||expected>200)
   throw new DocumentWriteError('Source order items unavailable',409);
  for(const line of rows(lockedItems)){
   if(line.v2_source_kind!=='catalog'||line.v2_product_id==null)throw new DocumentWriteError('复制需选择有效库内产品；原单含未关联或手工明细，请普通新建后重新选品',422);
   await assertActiveDocumentProduct(db,String(line.v2_product_id));
  }
  const [newHeader]=await db.query(
   'INSERT INTO orders (order_no,order_date,receiving_unit,template_type,deposit,created_by_user_id,style_no,sign_person,receiver,receiver_phone,receiver_address,settled,v2_display_snapshot,total_meters,total_pieces,total_amount,deduction_meters) SELECT ?,?,receiving_unit,template_type,deposit,?,style_no,sign_person,receiver,receiver_phone,receiver_address,settled,v2_display_snapshot,total_meters,total_pieces,total_amount,deduction_meters FROM orders WHERE id=?',
   [input.orderNo,input.date,writer.userId,sourceId]);
  const newId=String((newHeader as {insertId?:string|number|bigint}).insertId??'');
  if(!idOk(newId)||Number((newHeader as {affectedRows?:number}).affectedRows)!==1)
   throw new DocumentWriteError('Unable to copy document',503);
  const [details]=await db.query(
   'INSERT INTO order_items (order_id,meters,unit_price,remark,piece_meters,deduction_meters,v2_product_id,v2_source_kind,v2_product_snapshot,product_no,product_name,color_no,composition,weight,width,amount) SELECT ?,meters,unit_price,remark,piece_meters,deduction_meters,v2_product_id,v2_source_kind,v2_product_snapshot,product_no,product_name,color_no,composition,weight,width,amount FROM order_items WHERE order_id=? ORDER BY id',
   [newId,sourceId]);
  if(Number((details as {affectedRows?:number}).affectedRows)!==expected)
   throw new DocumentWriteError('Source order changed during copy',409);
  return {id:newId,orderNo:input.orderNo};
 });
}
/** Explicit confirmation required; delete children and parent atomically.
 * All DB constraints (e.g. referenced shipments) remain enforceable and
 * cause rollback. No cascade or owner override from client fields.
 */
export async function deleteV2Document(pool:Pool,actor:AppPrincipal,orderId:string,body:unknown):
 Promise<{deleted:true}>{
 if(!idOk(orderId))throw new DocumentWriteError('Order not found',404);
 if(!body||typeof body!=='object'||Array.isArray(body)||
  Object.keys(body).length!==1||(body as {confirm?:unknown}).confirm!==true)
  throw new DocumentWriteError('Explicit deletion confirmation required');
 return transact(pool,async db=>{
  const writer=await freshWriter(db,actor);
  const original=await lockedSource(db,writer,orderId);
  await recordAdminDocumentAction(db,writer,orderId,original.created_by_user_id==null?null:String(original.created_by_user_id),'delete');
  await db.query('DELETE FROM order_items WHERE order_id=?',[orderId]);
  const [outcome]=await db.query('DELETE FROM orders WHERE id=?',[orderId]);
  if(Number((outcome as {affectedRows?:number}).affectedRows)!==1)
   throw new DocumentWriteError('Order changed or not found',409);
  return {deleted:true};
 });
}
