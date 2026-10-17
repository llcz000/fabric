/** AC-81: the approved factual shipment-batch boundary (in memory only).
 * This is NOT a shipment writer/route/schema migration or an authorization
 * decision. Its selected item input must come from a server-verified session,
 * and persistence will be added only after the shipment workflow is approved.
 * Selection != shipment: no side effects and no status changes.
 */
export class ShipmentBatchError extends Error {
 constructor(){super('Invalid sample shipment');this.name='ShipmentBatchError';}
}
type Row=Record<string,unknown>;
const isRow=(v:unknown):v is Row=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const validId=(v:unknown):v is string=>
 typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v)&&BigInt(v)<=18446744073709551615n;
const validDate=(v:unknown):v is string=>{
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v))return false;
 const date=new Date(v);const canonical=v.includes('.')?v:v.slice(0,-1)+'.000Z';
 return Number.isFinite(date.valueOf())&&date.toISOString()===canonical;
};
const strictFields=(v:Row,allowed:readonly string[])=>{
 if(Object.keys(v).some(key=>!allowed.includes(key)))throw new ShipmentBatchError();
};
const cleanOptText=(v:unknown):string|null=>{
 if(v===undefined||v===null)return null;
 if(typeof v!=='string'||!v.trim()||v!==v.trim()||v.length>160||/[\x00-\x1f\x7f]/.test(v))
  throw new ShipmentBatchError();
 return v;
};
const positiveQuantity=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;

export interface SelectedShipmentItem{
 itemId:string;productId:string;removedAt:string|null
}
export interface ShipmentLine{
 itemId:string;productId:string;quantity:number
}
export interface PreparedShipmentBatch{
 sessionId:string;shippedAt:string;carrier:string|null;trackingNo:string|null;items:ShipmentLine[]
}
export interface ShipmentProgress{
 selectedProducts:number;shippedProducts:number;pendingProducts:number;shippedQuantity:number
}
function verifiedSelection(raw:unknown):Map<string,SelectedShipmentItem>{
 if(!Array.isArray(raw))throw new ShipmentBatchError();
 const lookup=new Map<string,SelectedShipmentItem>(),identities=new Set<string>();
 for(const value of raw){
  if(!isRow(value)||!validId(value.itemId)||!validId(value.productId)||
   !(value.removedAt===null||validDate(value.removedAt))||
   lookup.has(value.productId)||identities.has(value.itemId))throw new ShipmentBatchError();
  lookup.set(value.productId,{itemId:value.itemId,productId:value.productId,removedAt:value.removedAt as string|null});
  identities.add(value.itemId);
 }
 return lookup;
}

/** Pure safe draft. Caller MUST server-load authorized current selections and
 * persist batch/items transactionally with current session locks. */
export function prepareShipmentBatch(raw:unknown,selected:unknown,context:{sessionId:string}):PreparedShipmentBatch{
 if(!isRow(raw)||!context||!validId(context.sessionId))throw new ShipmentBatchError();
 strictFields(raw,['sessionId','shippedAt','carrier','trackingNo','items']);
 if(!validId(raw.sessionId)||raw.sessionId!==context.sessionId||!validDate(raw.shippedAt)||
    !Array.isArray(raw.items)||raw.items.length===0||raw.items.length>1000)
  throw new ShipmentBatchError();
 const lookup=verifiedSelection(selected),seen=new Set<string>(),items:ShipmentLine[]=[];
 for(const value of raw.items){
  if(!isRow(value))throw new ShipmentBatchError();
  strictFields(value,['productId','quantity']);
  if(!validId(value.productId)||!positiveQuantity(value.quantity)||seen.has(value.productId))
   throw new ShipmentBatchError();
  const match=lookup.get(value.productId);
  if(!match||match.removedAt!==null)throw new ShipmentBatchError();
  seen.add(value.productId);
  items.push({itemId:match.itemId,productId:match.productId,quantity:value.quantity});
 }
 return {sessionId:context.sessionId,shippedAt:raw.shippedAt,carrier:cleanOptText(raw.carrier),
  trackingNo:cleanOptText(raw.trackingNo),items};
}

/** Current selection progress plus factual historical shipped quantities.
 * Removed products are not current pending/shipped products; old shipment
 * quantities remain historical facts and are never undone by later removal.
 */
export function summarizeShipmentProgress(selected:unknown,history:unknown,context:{sessionId:string}):ShipmentProgress{
 if(!context||!validId(context.sessionId))throw new ShipmentBatchError();
 const lookup=verifiedSelection(selected);
 if(!Array.isArray(history))throw new ShipmentBatchError();
 const live=new Set([...lookup].filter(([,x])=>x.removedAt===null).map(([id])=>id));
 const shipped=new Set<string>();let shippedQuantity=0;let sessionId:string|undefined;
 for(const batch of history){
  if(!isRow(batch)||!validId(batch.sessionId)||!validDate(batch.shippedAt)||
     !Array.isArray(batch.items)||!batch.items.length)throw new ShipmentBatchError();
  if(batch.sessionId!==context.sessionId||sessionId!==undefined&&sessionId!==batch.sessionId)
   throw new ShipmentBatchError();
  sessionId=batch.sessionId;
  const seen=new Set<string>();
  for(const line of batch.items){
   if(!isRow(line)||!validId(line.productId)||!validId(line.itemId)||
      !positiveQuantity(line.quantity)||seen.has(line.productId))throw new ShipmentBatchError();
   const original=lookup.get(line.productId);
   if(!original||original.itemId!==line.itemId)throw new ShipmentBatchError();
   seen.add(line.productId);
   if(!Number.isSafeInteger(shippedQuantity+line.quantity))throw new ShipmentBatchError();
   shippedQuantity+=line.quantity;
   if(live.has(line.productId))shipped.add(line.productId);
  }
 }
 return {selectedProducts:live.size,shippedProducts:shipped.size,
  pendingProducts:live.size-shipped.size,shippedQuantity};
}
