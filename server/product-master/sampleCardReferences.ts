interface Query {query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>}

/** Caller must first hold the corresponding parent row FOR UPDATE.
 * Locking reads see current cards, including inactive cards, rather than a
 * transaction snapshot. The parent -> card order matches create/scan.
 */
export async function hasSampleCardReference(
 db:Query,kind:'master'|'fabric',id:string,currentOnly=false
):Promise<boolean>{
 const column=kind==='master'?'master_id':'fabric_id';
 let raw:unknown;
 try{
  [raw]=await db.query('SELECT id FROM sample_cards WHERE '+column+'=?'+(currentOnly?' AND deleted_at IS NULL':'')+' LIMIT 1 FOR SHARE',[id]);
 }catch(error){
  // This one-table query is the only supported optional phase-two lookup.
  // Missing columns, permissions, and every other driver failure fail closed.
  if(error&&typeof error==='object'&&(error as {code?:unknown}).code==='ER_NO_SUCH_TABLE')return false;
  throw Error('Sample card references unavailable');
 }
 if(!Array.isArray(raw)||raw.some(row=>!row||typeof row!=='object'||!Object.hasOwn(row,'id')))
  throw Error('Sample card references unavailable');
 return raw.length>0;
}
