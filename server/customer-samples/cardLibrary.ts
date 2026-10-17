import {createHash,randomBytes} from 'node:crypto';
import type {AppPrincipal} from '../access/types';
import type {SamplePool} from './scanRepository';

/** Internal service DTO. Raw payload is card identity, never permission. */
export interface SampleCard {
 id:string;masterId:string;masterNo:string;fabricId:string;fabricNo:string;
 cardNo:string;description:string;composition:string|null;
 weightValue:number|null;weightUnit:'gsm'|'mm'|null;widthValue:number|null;
 qrPayload:string;isActive:boolean;reprintRevision?:string;needsReprint?:boolean;
}
export interface SampleCardDb {query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>}
export type SampleCardAuthorization=(actor:AppPrincipal,action:'read'|'create'|'export'|'retire'|'reprint')=>boolean|Promise<boolean>;
export interface SampleCardListQuery {query?:string;limit?:number;offset?:number;needsReprint?:boolean}
export class SampleCardError extends Error {
 constructor(message:string,readonly status:400|401|403|404|409=400){super(message);this.name='SampleCardError';}
}
type Row=Record<string,unknown>;
const validId=(x:unknown):x is string=>typeof x==='string'&&/^[1-9][0-9]{0,19}$/.test(x)&&BigInt(x)<=18446744073709551615n;
const rows=(x:unknown):Row[]=>{if(!Array.isArray(x))throw Error('Unexpected sample card rowset');return x as Row[];};
function dbId(x:unknown):string {
 if(typeof x==='number'&&!Number.isSafeInteger(x))throw new SampleCardError('Card identity inconsistent',409);
 const result=String(x);if(!validId(result))throw new SampleCardError('Card identity inconsistent',409);return result;
}
const hash=(payload:string)=>createHash('sha256').update(payload,'utf8').digest('hex');
function numberOrNull(x:unknown):number|null{
 if(x==null)return null;
 const result=Number(x);if(!Number.isFinite(result)||result<=0)throw new SampleCardError('Card specification inconsistent',409);
 return result;
}
function printedRevision(value:unknown):string{
 if(typeof value==='number'&&!Number.isSafeInteger(value))
  throw new SampleCardError('Unsafe card print revision',409);
 const parsed=String(value??'0');
 if(!/^(0|[1-9][0-9]{0,19})$/.test(parsed)||BigInt(parsed)>18446744073709551615n)
  throw new SampleCardError('Invalid card print revision',409);
 return parsed;
}
function card(row:Row):SampleCard{
 const payload=row.qr_payload;
 if(typeof payload!=='string'||!/^[A-Za-z0-9_-]{22,128}$/.test(payload)||hash(payload)!==row.token_hash)
  throw new SampleCardError('Card QR identity inconsistent',409);
 const unit=row.weight_unit??null,weight=numberOrNull(row.weight_value);
 if(unit!==null&&unit!=='gsm'&&unit!=='mm'||(unit===null)!==(weight===null))
  throw new SampleCardError('Card specification inconsistent',409);
 if(typeof row.master_no!=='string'||typeof row.fabric_no!=='string'||typeof row.card_no!=='string'||
  typeof row.fabric_name!=='string'||![0,1].includes(Number(row.is_active)))
  throw new SampleCardError('Card data inconsistent',409);
 const reprintRevision=printedRevision(row.reprint_revision),printed=printedRevision(row.printed_revision);
 if(BigInt(printed)>BigInt(reprintRevision))throw new SampleCardError('Card print revision inconsistent',409);
 // Identity updates must eventually include card references in their lock checks.
 // Reject drift explicitly while that cross-module integration gate remains open.
 if(row.card_no!==row.master_no+'-'+row.fabric_no)
  throw new SampleCardError('Card number inconsistent with current master data',409);
 return {id:dbId(row.id),masterId:dbId(row.master_id),masterNo:row.master_no,
  fabricId:dbId(row.fabric_id),fabricNo:row.fabric_no,cardNo:row.card_no,
  description:row.fabric_name,composition:row.composition==null?null:String(row.composition),
  weightValue:weight,weightUnit:unit as SampleCard['weightUnit'],widthValue:numberOrNull(row.width_value),qrPayload:payload,
  isActive:Number(row.is_active)===1,reprintRevision,needsReprint:BigInt(reprintRevision)>BigInt(printed)};
}
const from=` FROM sample_cards c
 JOIN pattern_masters m ON m.id=c.master_id
 JOIN v2_fabrics f ON f.id=c.fabric_id
 LEFT JOIN sample_card_tokens t ON t.card_id=c.id AND t.revoked_at IS NULL`;
const select=`SELECT c.id,c.master_id,m.master_no,c.fabric_id,f.fabric_no,c.card_no,
 f.fabric_name,f.composition,f.weight_value,f.weight_unit,f.width_value,c.qr_payload,c.is_active,c.reprint_revision,c.printed_revision,t.token_hash`+from;
function inputIds(input:unknown):{masterId:string;fabricId:string}{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new SampleCardError('Invalid card fields');
 const values=input as Record<string,unknown>;
 if(Object.keys(values).length!==2||!Object.hasOwn(values,'masterId')||!Object.hasOwn(values,'fabricId')||
  !validId(values.masterId)||!validId(values.fabricId))throw new SampleCardError('Select one existing master and fabric');
 return {masterId:values.masterId,fabricId:values.fabricId};
}
async function currentActor(db:SampleCardDb,actor:AppPrincipal):Promise<AppPrincipal>{
 const [users]=await db.query('SELECT id,role,is_active,can_manage_products,can_manage_own_orders FROM v2_access_users WHERE id=? FOR SHARE',[actor.userId]);
 const user=rows(users)[0];
 if(!user||Number(user.is_active)!==1||(user.role!=='admin'&&user.role!=='sales'))
  throw new SampleCardError('Authentication required',401);
 const [sessions]=await db.query('SELECT id FROM v2_access_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR SHARE',[actor.sessionId,actor.userId]);
 if(!rows(sessions).length)throw new SampleCardError('Authentication required',401);
 // Do not trust role or flags copied into a previously authenticated principal.
 return {...actor,role:user.role,canManageProducts:Number(user.can_manage_products)===1,
  canManageOwnOrders:Number(user.can_manage_own_orders)===1};
}
/** Explicit management policy, default deny. Current user/login locks precede business locks. */
export async function createSampleCard(
 pool:SamplePool,actor:AppPrincipal,input:unknown,authorize:SampleCardAuthorization=()=>false
):Promise<{card:SampleCard;created:boolean}>{
 const {masterId,fabricId}=inputIds(input);
 if(!actor||!validId(actor.userId)||!validId(actor.sessionId))
  throw new SampleCardError('Authentication required',401);
 const tx=await pool.getConnection();let began=false;
 try{
  await tx.beginTransaction();began=true;
  const fresh=await currentActor(tx,actor);
  if(await authorize(fresh,'create')!==true)throw new SampleCardError('Card management forbidden',403);
  const [masterRows]=await tx.query('SELECT id,master_no,is_active FROM pattern_masters WHERE id=? FOR UPDATE',[masterId]);
  const master=rows(masterRows)[0];
  if(!master||Number(master.is_active)!==1)throw new SampleCardError('Master unavailable',409);
  const [fabricRows]=await tx.query('SELECT id,fabric_no,is_active FROM v2_fabrics WHERE id=? FOR UPDATE',[fabricId]);
  const fabric=rows(fabricRows)[0];
  if(!fabric||Number(fabric.is_active)!==1)throw new SampleCardError('Fabric unavailable',409);
  const find=async()=>{const [data]=await tx.query(select+' WHERE c.master_id=? AND c.fabric_id=? AND c.deleted_at IS NULL FOR UPDATE',[masterId,fabricId]);return rows(data);};
  const prior=await find();
  let created=false;
  if(!prior.length){
   if(typeof master.master_no!=='string'||typeof fabric.fabric_no!=='string')
    throw new SampleCardError('Card identity inconsistent',409);
   const payload=randomBytes(32).toString('base64url');
   const cardNo=master.master_no+'-'+fabric.fabric_no;
   // Two max-64 character source identifiers and the separator.
   if(cardNo.length>129)throw new SampleCardError('Card number inconsistent',409);
   let inserted:unknown;
   try {
    const [result]=await tx.query('INSERT INTO sample_cards(master_id,fabric_id,card_no,qr_payload) VALUES (?,?,?,?)',[masterId,fabricId,cardNo,payload]);
    inserted=(result as {insertId:unknown}).insertId;created=true;
   }catch(error){
    if(!error||typeof error!=='object'||!('code' in error)||error.code!=='ER_DUP_ENTRY')throw error;
    // Current locking read observes a competing unique-combination winner.
    // Other unique collisions are conflicts; do not regenerate or retry a code.
    const winner=await find();
    if(winner.length!==1)throw new SampleCardError('Card combination conflict',409);
   }
   if(created)await tx.query('INSERT INTO sample_card_tokens(card_id,token_hash) VALUES (?,?)',[dbId(inserted),hash(payload)]);
  }
  const saved=await find();
  if(saved.length!==1)throw new SampleCardError('Card identity inconsistent',409);
  const result=card(saved[0]);
  await tx.commit();began=false;return {card:result,created};
 }catch(error){if(began)await tx.rollback();throw error;}finally{tx.release();}
}
/** B2-5 / AC-96: retire a printed card without deleting any historical FK rows.
 * Only this service may revoke a physical QR. Lock order: account/session,
 * master, fabric, card, token. Only active cards can be retired. */
export async function retireSampleCard(
 pool:SamplePool,actor:AppPrincipal,identity:string,authorize:SampleCardAuthorization=()=>false
):Promise<{id:string;retired:true}>{
 if(!validId(identity))throw new SampleCardError('Invalid card identity');
 if(!actor||!validId(actor.userId)||!validId(actor.sessionId))
  throw new SampleCardError('Authentication required',401);
 const tx=await pool.getConnection();let began=false;
 try{
  await tx.beginTransaction();began=true;
  const fresh=await currentActor(tx,actor);
  if(await authorize(fresh,'retire')!==true)throw new SampleCardError('Card management forbidden',403);
  // Parent discovery is non-locking. Recheck the card after taking parent locks.
  const [locatedRaw]=await tx.query('SELECT master_id,fabric_id FROM sample_cards WHERE id=?',[identity]);
  const located=rows(locatedRaw)[0];
  if(!located)throw new SampleCardError('Card not found',404);
  const masterId=dbId(located.master_id),fabricId=dbId(located.fabric_id);
  const [masters]=await tx.query('SELECT id FROM pattern_masters WHERE id=? FOR UPDATE',[masterId]);
  if(rows(masters).length!==1)throw new SampleCardError('Master reference unavailable',409);
  const [fabrics]=await tx.query('SELECT id FROM v2_fabrics WHERE id=? FOR UPDATE',[fabricId]);
  if(rows(fabrics).length!==1)throw new SampleCardError('Fabric reference unavailable',409);
  const [currentRaw]=await tx.query('SELECT c.id,c.master_id,c.fabric_id,c.deleted_at FROM sample_cards c WHERE c.id=? FOR UPDATE',[identity]);
  const current=rows(currentRaw)[0];
  if(!current||current.deleted_at!=null)throw new SampleCardError('Card already retired',404);
  if(dbId(current.master_id)!==masterId||dbId(current.fabric_id)!==fabricId)
   throw new SampleCardError('Card identity changed',409);
  const [tokenRaw]=await tx.query('SELECT token_hash,revoked_at FROM sample_card_tokens WHERE card_id=? FOR UPDATE',[identity]);
  const token=rows(tokenRaw)[0];
  if(!token||typeof token.token_hash!=='string'||token.revoked_at!=null)
   throw new SampleCardError('Card QR unavailable',409);
  // Once revoked, token hash is retained by a unique index forever.
  const [revokeRaw]=await tx.query('UPDATE sample_card_tokens SET revoked_at=UTC_TIMESTAMP() WHERE card_id=? AND revoked_at IS NULL',[identity]);
  if(Number((revokeRaw as {affectedRows?:unknown}).affectedRows)!==1)
   throw new SampleCardError('Card QR revoke conflict',409);
  const [retireRaw]=await tx.query('UPDATE sample_cards SET deleted_at=UTC_TIMESTAMP(),is_active=0 WHERE id=? AND deleted_at IS NULL',[identity]);
  if(Number((retireRaw as {affectedRows?:unknown}).affectedRows)!==1)
   throw new SampleCardError('Card retire conflict',409);
  await tx.commit();began=false;return {id:identity,retired:true};
 }catch(error){if(began)await tx.rollback();throw error;}finally{tx.release();}
}
/** B2-5 AC-99: an operator confirms printing the exact revision visible
 * when the paper card was prepared. Later fabric changes cannot be acked by
 * an old browser request; this is an atomic, row-locked CAS.
 */
export async function confirmSampleCardReprinted(
 pool:SamplePool,actor:AppPrincipal,identity:string,expectedRevision:string,
 authorize:SampleCardAuthorization=()=>false
):Promise<{id:string;reprintRevision:string;needsReprint:false}>{
 const validRevision=(value:unknown):value is string=>typeof value==='string'&&
  /^(0|[1-9][0-9]{0,19})$/.test(value)&&BigInt(value)<=18446744073709551615n;
 if(!validId(identity)||!validRevision(expectedRevision))
  throw new SampleCardError('Invalid card or reprint revision');
 if(!actor||!validId(actor.userId)||!validId(actor.sessionId))
  throw new SampleCardError('Authentication required',401);
 const tx=await pool.getConnection();let began=false;
 try{
  await tx.beginTransaction();began=true;
  const fresh=await currentActor(tx,actor);
  if(await authorize(fresh,'reprint')!==true)throw new SampleCardError('Card management forbidden',403);
  const [locatedRaw]=await tx.query('SELECT master_id,fabric_id FROM sample_cards WHERE id=?',[identity]);
  const located=rows(locatedRaw)[0];if(!located)throw new SampleCardError('Card not found',404);
  const masterId=dbId(located.master_id),fabricId=dbId(located.fabric_id);
  const [masters]=await tx.query('SELECT id FROM pattern_masters WHERE id=? FOR UPDATE',[masterId]);
  if(rows(masters).length!==1)throw new SampleCardError('Card master unavailable',409);
  const [fabrics]=await tx.query('SELECT id FROM v2_fabrics WHERE id=? FOR UPDATE',[fabricId]);
  if(rows(fabrics).length!==1)throw new SampleCardError('Card fabric unavailable',409);
  const [currentRaw]=await tx.query(
   'SELECT c.reprint_revision,c.printed_revision,c.deleted_at,c.master_id,c.fabric_id FROM sample_cards c WHERE c.id=? FOR UPDATE',[identity]);
  const current=rows(currentRaw)[0];
  if(!current||current.deleted_at!=null)throw new SampleCardError('Card retired',404);
  if(dbId(current.master_id)!==masterId||dbId(current.fabric_id)!==fabricId)
   throw new SampleCardError('Card identity changed',409);
  const revision=String(current.reprint_revision),printed=String(current.printed_revision);
  if(!validRevision(revision)||!validRevision(printed)||BigInt(printed)>BigInt(revision))
   throw new SampleCardError('Card reprint revision inconsistent',409);
  if(revision!==expectedRevision)
   throw new SampleCardError('Fabric changed after print preparation',409);
  if(printed!==revision){
   const [updated]=await tx.query(
    'UPDATE sample_cards SET printed_revision=reprint_revision WHERE id=? AND deleted_at IS NULL AND reprint_revision=? AND printed_revision<reprint_revision',
    [identity,expectedRevision]);
   if(Number((updated as {affectedRows?:unknown}).affectedRows)!==1)
    throw new SampleCardError('Card print confirmation conflict',409);
  }
  await tx.commit();began=false;return {id:identity,reprintRevision:revision,needsReprint:false};
 }catch(error){if(began)await tx.rollback();throw error;}finally{tx.release();}
}
function options(input:SampleCardListQuery):Required<SampleCardListQuery>{
 if(!input||typeof input!=='object'||Array.isArray(input)||
  Object.keys(input).some(k=>!['query','limit','offset','needsReprint'].includes(k)))throw new SampleCardError('Invalid card query');
 const {query='',limit=50,offset=0,needsReprint=false}=input;
 if(typeof query!=='string'||[...query].length>100||/[\p{Cc}\p{Cf}]/u.test(query)||
  !Number.isSafeInteger(limit)||limit<1||limit>100||
  !Number.isSafeInteger(offset)||offset<0||offset>1000000||typeof needsReprint!=='boolean')throw new SampleCardError('Invalid card query');
 return {query:query.trim(),limit,offset,needsReprint};
}
/** Internal reads: caller MUST authenticate and authorize read before invocation. Never log DTOs. */
export async function listSampleCards(db:SampleCardDb,input:SampleCardListQuery={}):Promise<{
 items:SampleCard[];total:number;limit:number;offset:number
}>{
 const {query,limit,offset,needsReprint}=options(input);let filter=' WHERE c.deleted_at IS NULL';const args:unknown[]=[];
 if(needsReprint)filter+=' AND c.reprint_revision>c.printed_revision';
 if(query){
  const pattern='%'+query.replace(/[!%_]/g,x=>'!'+x)+'%';
  filter+=" AND (c.card_no LIKE ? ESCAPE '!' OR m.master_no LIKE ? ESCAPE '!' OR f.fabric_no LIKE ? ESCAPE '!' OR f.fabric_name LIKE ? ESCAPE '!')";
  args.push(pattern,pattern,pattern,pattern);
 }
 const [countRows]=await db.query('SELECT COUNT(*) AS total'+from+filter,args);
 const total=Number(rows(countRows)[0]?.total);
 if(!Number.isSafeInteger(total)||total<0)throw Error('Invalid sample card count');
 const [items]=await db.query(select+filter+' ORDER BY c.card_no ASC,c.id ASC LIMIT ? OFFSET ?',[...args,limit,offset]);
 return {items:rows(items).map(card),total,limit,offset};
}
/** Explicit selection only; no partial export and preserve caller selection order. */
export async function getSelectedSampleCards(db:SampleCardDb,ids:unknown):Promise<SampleCard[]>{
 if(!Array.isArray(ids)||ids.length<1||ids.length>1000||!ids.every(validId)||new Set(ids).size!==ids.length)
  throw new SampleCardError('Select distinct existing cards');
 const [data]=await db.query(select+' WHERE c.deleted_at IS NULL AND c.id IN ('+ids.map(()=>'?').join(',')+')',ids);
 const found=rows(data).map(card),byId=new Map(found.map(c=>[c.id,c]));
 if(found.length!==byId.size)throw new SampleCardError('Card identity inconsistent',409);
 if(ids.some(id=>!byId.has(id)))throw new SampleCardError('Selected card unavailable',404);
 return ids.map(id=>byId.get(id)!);
}
