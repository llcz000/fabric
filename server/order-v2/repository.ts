import type {AppPrincipal} from '../access/types';
import {canManageOrder} from '../access/policy';

/** Separate prospective V2 writer; the legacy server.ts still uses old CRUD. */
interface TxConn {
 beginTransaction():Promise<void>;
 commit():Promise<void>;
 rollback():Promise<void>;
 release():void;
 query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>;
}
interface Pool {getConnection():Promise<TxConn>}
type EditableField='meters'|'unitPrice'|'remark';
type Fields=Partial<Record<EditableField,number|string>>;

export class P1DOrderAccessError extends Error {
 readonly status=404;
 constructor(){super('Order item not found');}
}

function validate(id:string, itemId:string,patch:Fields):void {
 if(!/^[1-9]\d{0,9}$/.test(id)||!/^[1-9]\d{0,9}$/.test(itemId)||
  Number(id)>2147483647||Number(itemId)>2147483647||
  !patch||typeof patch!=='object'||Array.isArray(patch)||
  Object.keys(patch).length===0||Object.keys(patch).some(x=>!['meters','unitPrice','remark'].includes(x))) {
   throw Error('Invalid order item fields');
 }
 for(const key of ['meters','unitPrice'] as const) {
  const v=patch[key];
  if(v!==undefined && (typeof v!=='number'||!Number.isFinite(v)||v<0||v>9999999999.99||
    Math.round(v*100)/100!==v)) throw Error('Invalid order item fields');
 }
 if(patch.remark!==undefined && (typeof patch.remark!=='string'||patch.remark.length>500)) {
  throw Error('Invalid order item fields');
 }
}
/**
 * No delete/reinsert, no product fields mutated, no client-submitted owner.
 * Order and existing item are locked in the same MySQL transaction. The SQL
 * order_id is checked again at UPDATE time: do not rely on a route guard alone.
 */
export async function updateExistingOrderItemBusinessFields(
 pool:Pool,actor:AppPrincipal,orderId:string,itemId:string,patch:Fields
):Promise<void>{
 validate(orderId,itemId,patch);
 if(!actor)throw new P1DOrderAccessError();
 const db=await pool.getConnection();
 let begun=false;
 try {
  await db.beginTransaction();begun=true;
  const [orders]=await db.query('SELECT id,created_by_user_id FROM orders WHERE id=? FOR UPDATE',[orderId]);
  const order=Array.isArray(orders)?(orders as Record<string,unknown>[])[0]:null;
  if(!order||!canManageOrder(actor,{
   createdByUserId:order.created_by_user_id==null?null:String(order.created_by_user_id)
  }))throw new P1DOrderAccessError();
  const [items]=await db.query('SELECT id FROM order_items WHERE id=? AND order_id=? FOR UPDATE',[itemId,orderId]);
  if(!Array.isArray(items)||items.length===0)throw new P1DOrderAccessError();
  const changed: string[]=[];
  const params:unknown[]=[];
  if(patch.meters!==undefined){changed.push('meters=?');params.push(patch.meters);}
  if(patch.unitPrice!==undefined){changed.push('unit_price=?');params.push(patch.unitPrice);}
  if(patch.remark!==undefined){changed.push('remark=?');params.push(patch.remark);}
  await db.query('UPDATE order_items SET '+changed.join(',')+' WHERE id=? AND order_id=?',
   [...params,itemId,orderId]);
  await db.commit();begun=false;
 }catch(error){
  if(begun)await db.rollback();
  throw error;
 }finally{db.release();}
}
