import {calculateDocumentTotals,calculateLineAmounts,normalizeStoredPieceMeters,DocumentCalculationError,type DocumentTotals} from './calculations';
import {reconcileOrderLines,type TxConn,type Pool,type Update} from './lines';
import type {AppPrincipal} from '../access/types';
type DBRow=Record<string,unknown>;
/**
 * Invoked only AFTER the owner + all existing lines are locked by the V2
 * reconciliation transaction, and BEFORE COMMIT. No separate DB connection.
 *
 * Never modify unedited historical item snapshots or amount fields. If legacy
 * stored amounts don't satisfy today's calculation contract, fail closed for
 * manual review rather than silently rewriting the original history.
 */
export async function calculateAndPersistOrderTotals(
 db:Pick<TxConn,'query'>,orderId:string,changedIds:readonly string[]
):Promise<DocumentTotals>{
 if(!/^[1-9]\d{0,9}$/.test(orderId)||!Array.isArray(changedIds)||
  new Set(changedIds).size!==changedIds.length||changedIds.some(x=>!/^[1-9]\d{0,9}$/.test(x)))
  throw new DocumentCalculationError('Invalid order or touched line IDs');
 const [orderRaw]=await db.query('SELECT template_type,deposit FROM orders WHERE id=? FOR UPDATE',[orderId]);
 const order=Array.isArray(orderRaw)?(orderRaw as DBRow[])[0]:undefined;
 if(!order)throw new DocumentCalculationError('Order is no longer available');
 const rawType=order.template_type;
 if(rawType!=='bulk'&&rawType!=='sample'&&rawType!=='deposit')
  throw new DocumentCalculationError('Unexpected saved document type');
 const [lineRaw]=await db.query(
  'SELECT id,meters,unit_price,amount,piece_meters,deduction_meters,v2_source_kind,v2_product_snapshot FROM order_items WHERE order_id=? ORDER BY id FOR UPDATE',
  [orderId]
 );
 if(!Array.isArray(lineRaw))throw new DocumentCalculationError('Stored order lines unavailable');
 if(lineRaw.length===0)throw new DocumentCalculationError('At least one product line required');
 const lines=(lineRaw as DBRow[]).map(r=>{
  const m=Number(r.meters),p=Number(r.unit_price),amt=Number(r.amount),deduction=Number(r.deduction_meters??0);
  return {id:String(r.id),meters:m,unitPrice:p,amount:amt,deductionMeters:deduction,
   pieceMeters:normalizeStoredPieceMeters(r.piece_meters,r.v2_source_kind==null&&r.v2_product_snapshot==null)};
 });
 const known=new Set(lines.map(r=>r.id));
 if(changedIds.some(id=>!known.has(id)))throw new DocumentCalculationError('Touched order line is missing');
 const touched=new Set(changedIds);
 const revised=lines.map(line=>{
  if(!touched.has(line.id))return line;
  const calc=calculateLineAmounts(rawType,line);
  return {...line,amount:calc.amount};
 });
 const totals=calculateDocumentTotals(rawType,revised,Number(order.deposit??0));
 // No SQL mutations occur until every row, roll and total passes validation.
 for(const line of revised){
  if(!touched.has(line.id))continue;
  const [write]=await db.query(
   'UPDATE order_items SET amount=? WHERE id=? AND order_id=?',
   [line.amount,line.id,orderId]
  );
  if(Number((write as {affectedRows?:number}).affectedRows)>1)
   throw new DocumentCalculationError('Unexpected multi-row line calculation');
 }
 const [updated]=await db.query(
  'UPDATE orders SET total_meters=?,total_pieces=?,total_amount=?,deduction_meters=? WHERE id=?',
  [totals.totalMeters,totals.totalPieces,totals.totalAmount,totals.totalDeductionMeters,orderId]
 );
 if(Number((updated as {affectedRows?:number}).affectedRows)>1)
  throw new DocumentCalculationError('Unexpected multi-row total update');
 return totals;
}
/** Full P6-1 billing path: same transaction for stable line IDs and totals. */
export async function reconcileOrderLinesAndTotals(
 pool:Pool,actor:AppPrincipal,orderId:string,change:Update
):Promise<{insertedIds:string[]}>{
 return reconcileOrderLines(pool,actor,orderId,change,async(db,id,changedIds)=>{
  await calculateAndPersistOrderTotals(db,id,changedIds);
 });
}
