import {createHmac} from 'node:crypto';
import {isIP} from 'node:net';
import type {AppPrincipal} from '../access/types';
import {hashPatternLinkToken,isPatternLinkToken,type PatternLinkToken} from './patternLinkToken';

/**
 * B1 code-only, opt-in share-link issuance contract. No production mounting,
 * migration, environment reads or server routes. NEVER persist raw tokens.
 * Production MUST configure/back up an independent 32-byte CSPRNG secret and
 * preserve it across deployments. Key rotation needs a separate migration.
 */
export interface PatternShareLinkTransaction{
 query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>;
 beginTransaction():Promise<void>;
 commit():Promise<void>;
 rollback():Promise<void>;
 release():void;
}
export interface PatternShareLinkPool{
 getConnection():Promise<PatternShareLinkTransaction>;
}
const ID=/^[1-9][0-9]{0,19}$/;
const MAX_ID=18446744073709551615n;
const DOMAIN='fabric:pattern-share:stable-token:v1\0';
function publicIPv4(host:string){
 if(isIP(host)!==4)return false;
 const [a,b,c]=host.split('.').map(Number);
 return a!==0&&a!==10&&a!==127&&a<224&&!(a===100&&b>=64&&b<=127)&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&(b===168||b===0||b===2))&&!(a===198&&(b===18||b===19||b===51&&c===100))&&!(a===203&&b===0&&c===113);
}
const denied=()=>new Error('Pattern link unavailable');
function id(value:unknown):value is string{
 return typeof value==='string'&&ID.test(value)&&BigInt(value)<=MAX_ID;
}
function validSecret(raw:unknown):raw is Uint8Array{
 return raw instanceof Uint8Array&&raw.BYTES_PER_ELEMENT===1&&
  raw.byteLength===32&&raw.some(n=>n!==0);
}
function rows(result:unknown):Record<string,unknown>[]{
 if(!Array.isArray(result)||result.length!==2||!Array.isArray(result[0])||
  result[0].some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw denied();
 return result[0] as Record<string,unknown>[];
}
/** Deterministic 256-bit keyed digest; public value is unguessable without the
 * long-lived server secret, yet survives disabled/re-enabled master status.
 * Exact master canonicalization and versioned domain prevent identity aliases.
 */
export function deriveStablePatternLinkToken(patternMasterId:unknown,secret:unknown):PatternLinkToken{
 try{
  if(!id(patternMasterId)||!validSecret(secret))throw denied();
  const mac=createHmac('sha256',Buffer.from(secret))
   .update(DOMAIN,'ascii').update(patternMasterId,'ascii').digest('base64url');
  if(!isPatternLinkToken(mac))throw denied();
  return mac;
 }catch{throw denied();}
}
export function formatPatternShareUrl(base:unknown,token:unknown):string{
 try{
  if(typeof base!=='string'||!isPatternLinkToken(token))throw denied();
  const url=new URL(base);
  // Exact canonical HTTPS with a DNS host or routable IPv4 and origin-only path. The
  // public origin must come from audited SERVER config, never client headers.
  if(url.protocol!=='https:'||url.origin!==base||url.username||url.password||
   url.pathname!=='/'||url.search||url.hash||!url.hostname.includes('.')||
   (isIP(url.hostname)!==0&&!publicIPv4(url.hostname))||url.hostname==='localhost')throw denied();
  return base+'/p/'+token;
 }catch{throw denied();}
}

/** Only a server-issued principal and a trusted verified pool may invoke this.
 * Recheck account/session and lock master BEFORE touching issuance table; no
 * manually-revoked link regeneration, no row repair, and no secret replacement.
 * The proposed pattern_share_links table must be approved with UNIQUE
 * token_hash (exact 64-lowercase-hex ASCII with binary collation), UNIQUE
 * master_id, enforced FK, and verified target DB identity.
 */
export async function issuePatternShareLink(
 pool:PatternShareLinkPool,actor:AppPrincipal,
 patternMasterId:unknown,secret:unknown,publicBase:unknown
):Promise<{token:PatternLinkToken;url:string;created:boolean}>{
 if(!pool||typeof pool.getConnection!=='function'||!actor||
  !id(actor.userId)||!id(actor.sessionId)||
  (actor.role!=='admin'&&actor.role!=='sales')||!id(patternMasterId))
  throw denied();
 const token=deriveStablePatternLinkToken(patternMasterId,secret);
 const url=formatPatternShareUrl(publicBase,token);
 const digest=hashPatternLinkToken(token);
 let tx:PatternShareLinkTransaction;
 try{tx=await pool.getConnection();}catch{throw denied();}
 let begun=false;
 try{
  await tx.beginTransaction();begun=true;
  const people=rows(await tx.query(
   'SELECT id,role,is_active FROM v2_access_users WHERE id=? FOR SHARE',[actor.userId]));
  const account=people[0];
  if(people.length!==1||!account||String(account.id)!==actor.userId||
   account.is_active!==1||(account.role!=='admin'&&account.role!=='sales'))throw denied();
  const sessions=rows(await tx.query(
   'SELECT id,user_id FROM v2_access_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR SHARE',
   [actor.sessionId,actor.userId]));
  if(sessions.length!==1||String(sessions[0].id)!==actor.sessionId||
   String(sessions[0].user_id)!==actor.userId)throw denied();
  const masters=rows(await tx.query(
   'SELECT id,is_active FROM pattern_masters WHERE id=? FOR UPDATE',[patternMasterId]));
  if(masters.length!==1||String(masters[0].id)!==patternMasterId||
   masters[0].is_active!==0&&masters[0].is_active!==1)throw denied();
  // Locking the master serializes this issuer even when no share row exists.
  // A UNIQUE(master_id) key is still mandatory on the approved table.
  const existing=rows(await tx.query(
   'SELECT CAST(master_id AS CHAR) AS master_id, token_hash, status, revoked_at FROM pattern_share_links WHERE master_id=? LIMIT 2 FOR UPDATE',
   [patternMasterId]));
  if(existing.length>1)throw denied();
  let created=false;
  if(existing.length){
   const row=existing[0];
   if(row.master_id!==patternMasterId||row.token_hash!==digest||
    row.status!=='active'||row.revoked_at!==null)throw denied();
  }else{
   const inserted=await tx.query(
    "INSERT INTO pattern_share_links (token_hash,master_id,status,revoked_at) VALUES (?,?,'active',NULL)",
    [digest,patternMasterId]);
   if(!Array.isArray(inserted)||inserted.length!==2||!inserted[0]||
    typeof inserted[0]!=='object'||
    (inserted[0] as {affectedRows?:unknown}).affectedRows!==1)throw denied();
   created=true;
  }
  await tx.commit();begun=false;
  return {token,url,created};
 }catch{
  if(begun)try{await tx.rollback();}catch{/* no confidential SQL in errors */}
  throw denied();
 }finally{
  try{tx.release();}catch{/* never leak driver errors */}
 }
}
