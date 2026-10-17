import type {AppPrincipal} from '../access/types';
import {canManageOrder} from '../access/policy';
import {normalizePieceMeters} from './calculations';

/**
 * P1-D-2 independent future V2 line writer; NOT mounted on legacy server.ts.
 * Exact retained line IDs and explicit removal are mandatory. No client
 * provenance, product code/name, or legacy flags are accepted.
 */
export interface TxConn {
 beginTransaction():Promise<void>;commit():Promise<void>;rollback():Promise<void>;release():void;
 query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>;
}
export interface Pool{getConnection():Promise<TxConn>}
type Business={meters?:number;unitPrice?:number;remark?:string;deductionMeters?:number;pieceMeters?:number[]|null};
type Manual={productNo:string;productName:string;composition?:string;weight?:number;width?:number;colorNo?:string};
type Line={id?:string;fields:Business;selection?:{productId:string};manual?:Manual};
export type Update={items:Line[];removeIds:string[]};
type DBRow=Record<string,unknown>;
export class OrderLineError extends Error{
 readonly status:number;
 constructor(message:string,status=400){super(message);this.status=status;}
}
const intId=(s:unknown):s is string=>typeof s==='string'&&/^[1-9]\d{0,9}$/.test(s)&&Number(s)<=2147483647;
// Product keys are BIGINT UNSIGNED, unlike legacy INT order/line IDs.
const productIdOk=(s:unknown):s is string=>typeof s==='string'&&/^[1-9]\d{0,19}$/.test(s)&&BigInt(s)<=18446744073709551615n;
const ownKeys=(object:Record<string,unknown>,allowed:string[])=>Object.keys(object).every(k=>allowed.includes(k));
function fieldsValid(fields:unknown):fields is Business{
 if(!fields||typeof fields!=='object'||Array.isArray(fields))return false;
 const f=fields as Record<string,unknown>;
 if(!ownKeys(f,['meters','unitPrice','remark','deductionMeters','pieceMeters']))return false;
 for(const k of ['meters','unitPrice','deductionMeters']){
  const v=f[k];
  if(v!==undefined && (typeof v!=='number'||!Number.isFinite(v)||v<0||v>99999999||Math.abs(v*100-Math.round(v*100))>1e-5))
   return false;
 }
 if(f.pieceMeters!==undefined){try{normalizePieceMeters(f.pieceMeters);}catch{return false;}}
 return f.remark===undefined || (typeof f.remark==='string'&&f.remark.length<=500);
}
function limited(s:unknown,n:number):s is string{
 return typeof s==='string'&&Array.from(s).length<=n;
}
function validManual(v:unknown):v is Manual{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;
 const m=v as Record<string,unknown>;
 if(!ownKeys(m,['productNo','productName','composition','weight','width','colorNo']))return false;
 if(!limited(m.productNo,50)||m.productNo.trim()===''||!limited(m.productName,100)||m.productName.trim()==='')return false;
 if(m.composition!==undefined&&!limited(m.composition,50))return false;
 if(m.colorNo!==undefined&&!limited(m.colorNo,100))return false;
 for(const k of ['weight','width']){
  const v=m[k];
  if(v!==undefined&&(typeof v!=='number'||!Number.isFinite(v)||v<0||Math.abs(v*100-Math.round(v*100))>1e-5))return false;
 }
 return true;
}
function values(fields:Business):{sql:string;args:unknown[]} {
 const columns:string[]=[],args:unknown[]=[];
 if(fields.meters!==undefined){columns.push('meters=?');args.push(fields.meters);}
 if(fields.unitPrice!==undefined){columns.push('unit_price=?');args.push(fields.unitPrice);}
 if(fields.remark!==undefined){columns.push('remark=?');args.push(fields.remark);}
 if(fields.deductionMeters!==undefined){columns.push('deduction_meters=?');args.push(fields.deductionMeters);}
 if(fields.pieceMeters!==undefined){columns.push('piece_meters=?');args.push(fields.pieceMeters===null?null:JSON.stringify(fields.pieceMeters));}
 return {sql:columns.join(','),args};
}
interface ProductRef {
 id:string;productNo:string;productName:string;colorNo:string;
 composition:string;weight:number|null;width:number|null;
 snapshot:string;
}
async function product(db:TxConn,id:string):Promise<ProductRef>{
 const [raw]=await db.query(
  `SELECT p.id,p.product_no,p.is_active AS product_active,
   f.fabric_no,f.fabric_name,f.composition,f.weight_value,f.weight_unit,f.width_value,
   f.is_active AS fabric_active,c.colorway_no,c.is_active AS colorway_active,
   m.master_no,m.is_active AS master_active
   FROM v2_products p
   JOIN v2_fabrics f ON f.id=p.fabric_id
   JOIN pattern_colorways c ON c.id=p.pattern_colorway_id
   JOIN pattern_masters m ON m.id=c.master_id
   WHERE p.id=? FOR SHARE`,
  [id]
 );
 const r=Array.isArray(raw)?(raw as DBRow[])[0]:undefined;
 if(!r||Number(r.product_active)!==1||Number(r.fabric_active)!==1||
    Number(r.colorway_active)!==1||Number(r.master_active)!==1)
  throw new OrderLineError('Selected product is unavailable',422);
 const productNo=String(r.product_no??''),name=String(r.fabric_name??''),
  composition=String(r.composition??''),colorNo=String(r.colorway_no??'');
 const weight=r.weight_value==null?null:Number(r.weight_value);
 const width=r.width_value==null?null:Number(r.width_value);
 // Real legacy production order_items columns are shorter than V2 master.
 // Reject rather than truncating a newly selected product.
 if(!limited(productNo,50)||!limited(name,100)||!limited(composition,50)||
    !limited(colorNo,100)||weight!==null&&(!Number.isFinite(weight)||Math.round(weight*100)!==weight*100)||
    width!==null&&(!Number.isFinite(width)||Math.round(width*100)!==width*100)){
  throw new OrderLineError('Selected product exceeds legacy order snapshot precision/length',422);
 }
 const snapshot=JSON.stringify({version:1,source:'catalog',productId:id,
  productNo,productName:name,masterNo:String(r.master_no??''),fabricNo:String(r.fabric_no??''),
  colorwayNo:colorNo,composition,weightValue:r.weight_value==null?null:String(r.weight_value),
  weightUnit:r.weight_unit??null,widthCm:r.width_value==null?null:String(r.width_value)});
 return {id,productNo,productName:name,colorNo,composition,weight,width,snapshot};
}
function sourceSql(selected:ProductRef|Manual,kind:'catalog'|'manual'):{
 sql:string;params:unknown[]
} {
 const manual=kind==='manual';
 const m=selected as Manual,p=selected as ProductRef;
 const productNo=manual?m.productNo:p.productNo;
 const name=manual?m.productName:p.productName;
 const composition=manual?m.composition??'':p.composition;
 const weight=manual?m.weight??null:p.weight;
 const width=manual?m.width??null:p.width;
 const colorNo=manual?m.colorNo??'':p.colorNo;
 const snapshot=manual?JSON.stringify({version:1,source:'manual',productNo,productName:name,
  composition,weightValue:weight,widthCm:width,colorNo}):p.snapshot;
 return {sql:'v2_product_id=?,v2_source_kind=?,v2_product_snapshot=?,product_no=?,product_name=?,color_no=?,composition=?,weight=?,width=?',
  params:[manual?null:p.id,kind,snapshot,productNo,name,colorNo,composition,weight,width]};
}

export async function reconcileOrderLinesInTransaction(db:TxConn,actor:AppPrincipal,orderId:string,change:Update,
 finalize?: (db:TxConn,id:string,touchedIds:readonly string[])=>Promise<void>
):Promise<{insertedIds:string[]}>{
 if(!intId(orderId)||!change||!Array.isArray(change.items)||!Array.isArray(change.removeIds)||
    change.items.length>200||change.removeIds.length>200)throw new OrderLineError('Invalid order line input');
 const retained=new Set<string>(),removed=new Set<string>();
 for(const rid of change.removeIds){
  if(!intId(rid)||removed.has(rid))throw new OrderLineError('Invalid removed line ids');
  removed.add(rid);
 }
 for(const line of change.items){
  if(!line||typeof line!=='object'||Array.isArray(line)||
   !ownKeys(line as unknown as Record<string,unknown>,['id','fields','selection','manual'])||
   !fieldsValid(line.fields))throw new OrderLineError('Invalid order line fields');
  if(line.id!==undefined &&(!intId(line.id)||retained.has(line.id)||removed.has(line.id)))
   throw new OrderLineError('Duplicate or invalid line identity');
  if(line.id)retained.add(line.id);
  if(!!line.selection&&!!line.manual)throw new OrderLineError('Ambiguous source');
  if(line.selection && (!ownKeys(line.selection as unknown as Record<string,unknown>,['productId'])||
    !productIdOk(line.selection.productId)))throw new OrderLineError('Invalid selected product');
  if(line.manual&&!validManual(line.manual))throw new OrderLineError('Invalid manual details');
  if(line.manual&&actor?.role!=='admin')throw new OrderLineError('Manual mode requires administrator',403);
  if(!line.id&&!line.selection&&!line.manual)throw new OrderLineError('New line requires explicit source');
 }
 const [owners]=await db.query('SELECT id,created_by_user_id FROM orders WHERE id=? FOR UPDATE',[orderId]);
  const order=Array.isArray(owners)?(owners as DBRow[])[0]:undefined;
  if(!order||!canManageOrder(actor,{createdByUserId:order.created_by_user_id==null?null:String(order.created_by_user_id)}))
   throw new OrderLineError('Order not found',404);
  const [rows]=await db.query('SELECT id,order_id,v2_product_id,v2_source_kind,product_no,product_name FROM order_items WHERE order_id=? ORDER BY id FOR UPDATE',[orderId]);
  if(!Array.isArray(rows))throw new OrderLineError('Cannot read locked order lines',503);
  const known=new Set((rows as DBRow[]).map(row=>String(row.id)));
  for(const id of [...retained,...removed])if(!known.has(id))throw new OrderLineError('Line not found in order',404);
  if([...known].some(id=>!retained.has(id)&&!removed.has(id)))
   throw new OrderLineError('Implicitly omitted order lines cannot be deleted');
  const insertedIds:string[]=[],touchedIds:string[]=[];
  for(const line of change.items){
   const business=values(line.fields);
   let provenance:{sql:string;params:unknown[]}|undefined;
   if(line.selection)provenance=sourceSql(await product(db,line.selection.productId),'catalog');
   else if(line.manual)provenance=sourceSql(line.manual,'manual');
   if(line.id){
    const updates=[business.sql,provenance?.sql].filter(Boolean).join(',');
    if(updates){
     const [result]=await db.query('UPDATE order_items SET '+updates+' WHERE id=? AND order_id=?',
      [...business.args,...provenance?.params??[],line.id,orderId]);
     // A locked idempotent edit may report zero changed rows in MySQL.
     if(Number((result as {affectedRows?:number}).affectedRows)>1)
      throw new OrderLineError('Unexpected multi-row item update',409);
    }
    if(line.fields.meters!==undefined||line.fields.unitPrice!==undefined||line.fields.deductionMeters!==undefined||line.fields.pieceMeters!==undefined) touchedIds.push(line.id);
   }else{
    if(!provenance)throw new OrderLineError('Missing provenance');
    const [result]=await db.query(
      'INSERT INTO order_items (order_id,meters,unit_price,remark,piece_meters,deduction_meters,v2_product_id,v2_source_kind,v2_product_snapshot,product_no,product_name,color_no,composition,weight,width) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [orderId,line.fields.meters??0,line.fields.unitPrice??0,line.fields.remark??'',
       line.fields.pieceMeters==null?null:JSON.stringify(line.fields.pieceMeters),line.fields.deductionMeters??0,
       ...provenance.params]);
    const newId=(result as {insertId?:number|bigint|string}).insertId;
    if(newId===undefined)throw new OrderLineError('New line ID unavailable',503);
    insertedIds.push(String(newId));
    touchedIds.push(String(newId));
   }
  }
  for(const id of removed){
   const [result]=await db.query('DELETE FROM order_items WHERE id=? AND order_id=?',[id,orderId]);
   if(Number((result as {affectedRows?:number}).affectedRows)!==1)
    throw new OrderLineError('Removed line changed concurrently',409);
  }
  if(finalize)await finalize(db,orderId,touchedIds);
  return {insertedIds};
}

/** Compatibility wrapper for old P1-D/P6 calculation tests and callers. */
export async function reconcileOrderLines(pool:Pool,actor:AppPrincipal,orderId:string,change:Update,
 finalize?: (db:TxConn,id:string,touchedIds:readonly string[])=>Promise<void>
):Promise<{insertedIds:string[]}>{
 const db=await pool.getConnection();let active=false;
 try{
  await db.beginTransaction();active=true;
  const result=await reconcileOrderLinesInTransaction(db,actor,orderId,change,finalize);
  await db.commit();active=false;
  return result;
 }catch(error){if(active)await db.rollback();throw error;}finally{db.release();}
}
