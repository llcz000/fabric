/**
 * B2/B3 domain boundary for a single card scan. This is an independently
 * testable delta calculator, NOT a database writer or printed-edition freeze.
 *
 * Inputs must come from trusted database reads inside the eventual scan
 * transaction. Never take these lists or the selected IDs from an HTTP body.
 * Persistence must use unique(session_id, product_id), scan-event audit,
 * and row-level locking to avoid racing rescan/selection mutations.
 */
export interface SampleCardScope {
 id:string;
 fabricId:string;
 masterIds:readonly string[];
}
export interface LiveCardProduct {
 id:string;
 fabricId:string;
 masterId:string;
 productNo:string;
 colorwayNo:number;
}
export interface SavedSampleProduct {
 productId:string;
}
export interface NewSampleProduct {
 productId:string;
}
export interface CardScanPlan {
 resolvedProductIds:string[];
 newlyAdded:NewSampleProduct[];
 unchangedProductIds:string[];
}
export class CardScanInputError extends Error {
 readonly status=409;
 constructor(message:string){super(message);this.name='CardScanInputError';}
}
const ID=/^[1-9][0-9]{0,19}$/;
const MAX_ID=18446744073709551615n;
function validId(value:unknown):value is string {
 return typeof value==='string' && ID.test(value) && BigInt(value)<=MAX_ID;
}
const cmpIds=(a:string,b:string):number=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0;
export function planCardScan(
 card:SampleCardScope,
 currentProducts:readonly LiveCardProduct[],
 selectedProducts:readonly SavedSampleProduct[]
):CardScanPlan {
 if(!validId(card.id)||!validId(card.fabricId)||
  !Array.isArray(card.masterIds)||card.masterIds.length===0||
  !card.masterIds.every(validId))
  throw new CardScanInputError('Card fabric and pattern scope are required');
 const allowed=new Set(card.masterIds);
 const known=new Set<string>();
 for(const existing of selectedProducts) {
  if(!validId(existing.productId)) throw new CardScanInputError('Invalid saved product');
  known.add(existing.productId);
 }
 const seen=new Map<string,LiveCardProduct>();
 for(const product of currentProducts) {
  if(!validId(product.id)||!validId(product.fabricId)||!validId(product.masterId)||
   typeof product.productNo!=='string'||!product.productNo||
   !Number.isSafeInteger(product.colorwayNo)||product.colorwayNo<=0)
   throw new CardScanInputError('Invalid live card product');
  if(product.fabricId!==card.fabricId||!allowed.has(product.masterId))
   throw new CardScanInputError('Product outside card fabric/pattern scope');
  const earlier=seen.get(product.id);
  if(earlier&&
   (earlier.fabricId!==product.fabricId||earlier.masterId!==product.masterId||
    earlier.productNo!==product.productNo||earlier.colorwayNo!==product.colorwayNo))
   throw new CardScanInputError('Conflicting duplicate product');
  seen.set(product.id,product);
 }
 const ids=[...seen.keys()].sort(cmpIds);
 return {
  resolvedProductIds:ids,
  newlyAdded:ids.filter(id=>!known.has(id)).map(productId=>({productId})),
  unchangedProductIds:ids.filter(id=>known.has(id)),
 };
}
