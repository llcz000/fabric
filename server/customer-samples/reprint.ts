/** B2-5 AC-98: mark ALL current sample cards after a real printed fabric change.
 * Called INSIDE the same authenticated fabric update/Excel-import transaction,
 * after the fabric row is locked. Never expose this helper as a public route.
 */
export interface PrintableFabric {
 fabricName:string;
 composition:string|null;
 weightValue:number|null;
 weightUnit:'gsm'|'mm'|null;
 widthValue:number|null;
 remark?:string|null;
}
export interface CardReprintDb {
 query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>;
}
const keys=['fabricName','composition','weightValue','weightUnit','widthValue'] as const;
export async function markCardsForReprintOnFabricChange(
 db:CardReprintDb,fabricId:string,before:PrintableFabric,after:PrintableFabric
):Promise<boolean>{
 const changed=keys.some(key=>before[key]!==after[key]);
 if(!changed)return false;
 // Deleted cards remain historical and never receive new operational work.
 // The increments and the fabric edit commit or roll back atomically.
 try{
  await db.query('UPDATE sample_cards SET reprint_revision=reprint_revision+1 WHERE fabric_id=? AND deleted_at IS NULL',[fabricId]);
  return true;
 }catch(error){
  // V2 phase-one may legitimately run before the independent B2 sample domain
  // is installed. Any *other* schema/permission/deadlock error must roll back
  // the fabric edit, never silently lose an existing card's reprint marker.
  if(error&&typeof error==='object'&&(error as {code?:unknown}).code==='ER_NO_SUCH_TABLE')return false;
  throw error;
 }
}
