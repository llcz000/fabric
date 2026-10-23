import {createHmac} from 'node:crypto';
import {Router,json,type ErrorRequestHandler} from 'express';
import {requireV2Principal,type AccessDatabase} from '../access/middleware';
import type {AppPrincipal} from '../access/types';
import {formatPatternShareUrl,type PatternShareLinkPool} from './patternLinkIssuer';
import {hashPatternLinkToken,isPatternLinkToken} from './patternLinkToken';

/** Operator-only additive DDL. Runtime checks metadata and never executes this. */
export const CARD_SHARE_SQL=`CREATE TABLE card_share_links (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 card_id BIGINT UNSIGNED NOT NULL,
 token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 status ENUM('active','inactive','revoked') NOT NULL DEFAULT 'active',
 revoked_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_card_share_token (token_hash),
 UNIQUE KEY uq_card_share_card (card_id),
 CONSTRAINT fk_card_share_card FOREIGN KEY (card_id) REFERENCES sample_cards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
export interface CardShareDb{query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>}
const id=(v:unknown):v is string=>typeof v==='string'&&/^[1-9]\d{0,19}$/.test(v)&&BigInt(v)<=18446744073709551615n;
const rows=(v:unknown):Record<string,unknown>[]=>{if(!Array.isArray(v)||v.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw Error('Card share unavailable');return v;};
export function deriveCardShareToken(cardId:unknown,secret:unknown){
 if(!id(cardId)||!(secret instanceof Uint8Array)||secret.byteLength!==32||!secret.some(Boolean))throw Error('Card share configuration invalid');
 return createHmac('sha256',secret).update('fabric:card-share:stable-token:v1\0'+cardId,'ascii').digest('base64url');
}
export interface CardShare{cardId:string;masterId:string;fabricId:string;cardNo:string;available:boolean}
export async function resolveCardShare(db:CardShareDb,token:unknown):Promise<CardShare|null>{
 try{
  if(!isPatternLinkToken(token))return null;const digest=hashPatternLinkToken(token);
  const [raw]=await db.query(`SELECT l.token_hash,l.status AS link_status,l.revoked_at,
   CAST(c.id AS CHAR) AS card_id,CAST(c.master_id AS CHAR) AS master_id,CAST(c.fabric_id AS CHAR) AS fabric_id,c.card_no,c.deleted_at,
   c.is_active AS card_active,m.is_active AS master_active,f.is_active AS fabric_active
   FROM card_share_links l LEFT JOIN sample_cards c ON c.id=l.card_id
   LEFT JOIN pattern_masters m ON m.id=c.master_id LEFT JOIN v2_fabrics f ON f.id=c.fabric_id
   WHERE l.token_hash=? LIMIT 2`,[digest]);
  const found=rows(raw);if(found.length!==1)return null;const r=found[0];
  if(r.token_hash!==digest||r.link_status!=='active'||r.revoked_at!==null||r.deleted_at!==null||!id(r.card_id)||!id(r.master_id)||!id(r.fabric_id)||typeof r.card_no!=='string'||!r.card_no.trim()||r.card_no.length>129)return null;
  const flags=[r.card_active,r.master_active,r.fabric_active];if(flags.some(v=>v!==0&&v!==1))return null;
  return {cardId:r.card_id,masterId:r.master_id,fabricId:r.fabric_id,cardNo:r.card_no,available:flags.every(v=>v===1)};
 }catch{return null;}
}
async function issueCardShare(pool:PatternShareLinkPool,actor:AppPrincipal,cardId:string,secret:Uint8Array,base:string){
 const token=deriveCardShareToken(cardId,secret),digest=hashPatternLinkToken(token),url=formatPatternShareUrl(base,token).replace('/p/','/c/');
 const tx=await pool.getConnection();let begun=false;
 try{
  await tx.beginTransaction();begun=true;
  const [users]=await tx.query('SELECT id,role,is_active FROM v2_access_users WHERE id=? FOR SHARE',[actor.userId]);
  const account=rows(users);if(account.length!==1||String(account[0].id)!==actor.userId||account[0].is_active!==1||!['admin','sales'].includes(String(account[0].role)))throw Error('Unavailable');
  const [sessions]=await tx.query('SELECT id,user_id FROM v2_access_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR SHARE',[actor.sessionId,actor.userId]);
  const current=rows(sessions);if(current.length!==1||String(current[0].id)!==actor.sessionId||String(current[0].user_id)!==actor.userId)throw Error('Unavailable');
  const [located]=await tx.query('SELECT master_id,fabric_id FROM sample_cards WHERE id=?',[cardId]);
  const targets=rows(located);if(targets.length!==1)throw Error('Unavailable');const masterId=String(targets[0].master_id),fabricId=String(targets[0].fabric_id);
  if(!id(masterId)||!id(fabricId))throw Error('Unavailable');
  const [masters]=await tx.query('SELECT id,is_active FROM pattern_masters WHERE id=? FOR SHARE',[masterId]);
  const [fabrics]=await tx.query('SELECT id,is_active FROM v2_fabrics WHERE id=? FOR SHARE',[fabricId]);
  for(const [raw,target] of [[masters,masterId],[fabrics,fabricId]] as const){const parent=rows(raw);if(parent.length!==1||String(parent[0].id)!==target||parent[0].is_active!==1)throw Error('Unavailable');}
  const [cards]=await tx.query('SELECT id,master_id,fabric_id,is_active,deleted_at FROM sample_cards WHERE id=? FOR UPDATE',[cardId]);
  const found=rows(cards);if(found.length!==1||String(found[0].id)!==cardId||String(found[0].master_id)!==masterId||String(found[0].fabric_id)!==fabricId||found[0].is_active!==1||found[0].deleted_at!==null)throw Error('Unavailable');
  const [existing]=await tx.query('SELECT CAST(card_id AS CHAR) AS card_id,token_hash,status,revoked_at FROM card_share_links WHERE card_id=? LIMIT 2 FOR UPDATE',[cardId]);
  const links=rows(existing);if(links.length>1||links.length===1&&(links[0].card_id!==cardId||links[0].token_hash!==digest||links[0].status!=='active'||links[0].revoked_at!==null))throw Error('Unavailable');
  const created=links.length===0;
  if(created){const [insert]=await tx.query("INSERT INTO card_share_links (token_hash,card_id,status,revoked_at) VALUES (?,?,'active',NULL)",[digest,cardId]);if(!insert||typeof insert!=='object'||(insert as {affectedRows?:unknown}).affectedRows!==1)throw Error('Unavailable');}
  await tx.commit();begun=false;return {url,created};
 }catch{if(begun)try{await tx.rollback();}catch{}throw Error('Card share unavailable');}finally{tx.release();}
}
export const cardShareHeaders={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
export function createCardShareIssueRouter(deps:{authDb:AccessDatabase;pool:PatternShareLinkPool;secret:Uint8Array;publicBase:string}){
 formatPatternShareUrl(deps.publicBase,deriveCardShareToken('1',deps.secret));
 const router=Router();router.use((_req,res,next)=>{res.set(cardShareHeaders);next();});
 router.post('/sample-cards/:cardId/share',requireV2Principal(deps.authDb),(req,res,next)=>{
  if(!id(req.params.cardId)||Object.keys(req.query).length||!req.is('application/json')){res.status(400).json({error:'Invalid card share request'});return;}next();
 },json({limit:'1kb',strict:true}),async(req,res)=>{
  if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length){res.status(400).json({error:'Invalid card share request'});return;}
  try{const result=await issueCardShare(deps.pool,res.locals.principal as AppPrincipal,req.params.cardId,deps.secret,deps.publicBase);res.status(result.created?201:200).json(result);}
  catch{res.status(503).json({error:'Card share temporarily unavailable'});}
 });
 const errors:ErrorRequestHandler=(_error,_req,res,_next)=>{res.status(400).json({error:'Invalid card share request'});};router.use(errors);return router;
}
