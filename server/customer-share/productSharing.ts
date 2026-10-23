import {createHmac} from 'node:crypto';
import {Router,json,type ErrorRequestHandler} from 'express';
import {requireV2Principal,type AccessDatabase} from '../access/middleware';
import type {AppPrincipal} from '../access/types';
import type {AssetContent} from '../image-assets/service';
import {formatPatternShareUrl,type PatternShareLinkPool} from './patternLinkIssuer';
import {hashPatternLinkToken,isPatternLinkToken} from './patternLinkToken';
import {projectPublicPattern,type PatternCandidate} from './publicPatternProjection';

/** Reviewed operator SQL only. Runtime never creates or repairs tables. */
export const PRODUCT_SHARE_SQL=`CREATE TABLE product_share_links (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 product_id BIGINT UNSIGNED NOT NULL,
 token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 status ENUM('active','inactive','revoked') NOT NULL DEFAULT 'active',
 revoked_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_product_share_token (token_hash),
 UNIQUE KEY uq_product_share_product (product_id),
 CONSTRAINT fk_product_share_product FOREIGN KEY (product_id) REFERENCES v2_products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
interface Db{query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>}
const id=(v:unknown):v is string=>typeof v==='string'&&/^[1-9]\d{0,19}$/.test(v)&&BigInt(v)<=18446744073709551615n;
const records=(v:unknown):Record<string,unknown>[]=>{if(!Array.isArray(v)||v.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw Error('Product share unavailable');return v;};
export function deriveProductShareToken(productId:unknown,secret:unknown){
 if(!id(productId)||!(secret instanceof Uint8Array)||secret.byteLength!==32||!secret.some(Boolean))throw Error('Product share configuration invalid');
 return createHmac('sha256',secret).update('fabric:product-share:stable-token:v1\0'+productId,'ascii').digest('base64url');
}
interface ProductShare{productId:string;masterId:string;productNo:string;available:boolean}
export async function resolveProductShare(db:Db,token:unknown):Promise<ProductShare|null>{
 try{
  if(!isPatternLinkToken(token))return null;const digest=hashPatternLinkToken(token);
  const [raw]=await db.query(`SELECT l.token_hash,l.status AS link_status,l.revoked_at,
   CAST(p.id AS CHAR) AS product_id,CAST(m.id AS CHAR) AS master_id,p.product_no,
   p.is_active AS product_active,c.is_active AS colorway_active,m.is_active AS master_active,f.is_active AS fabric_active
   FROM product_share_links l
   LEFT JOIN v2_products p ON p.id=l.product_id
   LEFT JOIN pattern_colorways c ON c.id=p.pattern_colorway_id
   LEFT JOIN pattern_masters m ON m.id=c.master_id
   LEFT JOIN v2_fabrics f ON f.id=p.fabric_id
   WHERE l.token_hash=? LIMIT 2`,[digest]);
  const rows=records(raw);if(rows.length!==1)return null;const r=rows[0];
  if(r.token_hash!==digest||r.link_status!=='active'||r.revoked_at!==null||!id(r.product_id)||!id(r.master_id)||typeof r.product_no!=='string'||!r.product_no.trim()||r.product_no.length>200)return null;
  const flags=[r.product_active,r.colorway_active,r.master_active,r.fabric_active];if(flags.some(v=>v!==0&&v!==1))return null;
  // An issued mapping is the explicit server publication record. Activity never
  // grants publication by itself; inactive current parents only reveal unavailability.
  return {productId:r.product_id,masterId:r.master_id,productNo:r.product_no,available:flags.every(v=>v===1)};
 }catch{return null;}
}
async function issueProductShare(pool:PatternShareLinkPool,actor:AppPrincipal,productId:string,secret:Uint8Array,base:string){
 const token=deriveProductShareToken(productId,secret),digest=hashPatternLinkToken(token);
 const url=formatPatternShareUrl(base,token).replace('/p/','/s/');
 const tx=await pool.getConnection();let begun=false;
 try{
  await tx.beginTransaction();begun=true;
  const [users]=await tx.query('SELECT id,role,is_active FROM v2_access_users WHERE id=? FOR SHARE',[actor.userId]);
  const accounts=records(users);if(accounts.length!==1||String(accounts[0].id)!==actor.userId||accounts[0].is_active!==1||!['admin','sales'].includes(String(accounts[0].role)))throw Error('Unavailable');
  const [sessions]=await tx.query('SELECT id,user_id FROM v2_access_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR SHARE',[actor.sessionId,actor.userId]);
  const current=records(sessions);if(current.length!==1||String(current[0].id)!==actor.sessionId||String(current[0].user_id)!==actor.userId)throw Error('Unavailable');
  const [products]=await tx.query('SELECT id FROM v2_products WHERE id=? FOR UPDATE',[productId]);
  const found=records(products);if(found.length!==1||String(found[0].id)!==productId)throw Error('Unavailable');
  const [existing]=await tx.query('SELECT CAST(product_id AS CHAR) AS product_id,token_hash,status,revoked_at FROM product_share_links WHERE product_id=? LIMIT 2 FOR UPDATE',[productId]);
  const links=records(existing);if(links.length>1||links.length===1&&(links[0].product_id!==productId||links[0].token_hash!==digest||links[0].status!=='active'||links[0].revoked_at!==null))throw Error('Unavailable');
  const created=links.length===0;
  if(created){const [insert]=await tx.query("INSERT INTO product_share_links (token_hash,product_id,status,revoked_at) VALUES (?,?,'active',NULL)",[digest,productId]);if(!insert||typeof insert!=='object'||(insert as {affectedRows?:unknown}).affectedRows!==1)throw Error('Unavailable');}
  await tx.commit();begun=false;return {url,created};
 }catch{if(begun)try{await tx.rollback();}catch{}throw Error('Product share unavailable');}
 finally{tx.release();}
}
const headers={ 'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
export function createProductShareIssueRouter(deps:{authDb:AccessDatabase;pool:PatternShareLinkPool;secret:Uint8Array;publicBase:string}){
 formatPatternShareUrl(deps.publicBase,deriveProductShareToken('1',deps.secret));
 const router=Router();router.use((_req,res,next)=>{res.set(headers);next();});
 router.post('/products/:productId/share',requireV2Principal(deps.authDb),(req,res,next)=>{
  if(!id(req.params.productId)||Object.keys(req.query).length||!req.is('application/json')){res.status(400).json({error:'Invalid product share request'});return;}next();
 },json({limit:'1kb',strict:true}),async(req,res)=>{
  if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length){res.status(400).json({error:'Invalid product share request'});return;}
  try{const result=await issueProductShare(deps.pool,res.locals.principal as AppPrincipal,req.params.productId,deps.secret,deps.publicBase);res.status(result.created?201:200).json(result);}
  catch{res.status(503).json({error:'Product share temporarily unavailable'});}
 });
 const errors:ErrorRequestHandler=(_error,_req,res,_next)=>{res.status(400).json({error:'Invalid product share request'});};router.use(errors);return router;
}
export function createPublicProductRouter(deps:{db:Db;load:(masterId:string,productId:string)=>Promise<{candidate:PatternCandidate;previews:Map<string,string>}|null>;readDisplay:(id:string)=>Promise<AssetContent>}){
 const router=Router();router.use((_req,res,next)=>{res.set(headers);next();});
 const same=(a:ProductShare|null,b:ProductShare)=>a&&a.productId===b.productId&&a.masterId===b.masterId&&a.productNo===b.productNo;
 router.get('/:token',async(req,res)=>{
  try{
   if(Object.keys(req.query).length)throw Error('Unavailable');
   const first=await resolveProductShare(deps.db,req.params.token);if(!first)throw Error('Unavailable');
   const loaded=first.available?await deps.load(first.masterId,first.productId):null;
   const current=await resolveProductShare(deps.db,req.params.token);if(!same(current,first))throw Error('Unavailable');
   const pattern=first.available&&current!.available&&loaded?projectPublicPattern(loaded.candidate):null;
   if(!pattern||pattern.colorways.length!==1||pattern.colorways[0].fabrics.length!==1){res.json({available:false,message:'暂不可用'});return;}
   res.json({available:true,productNo:first.productNo,pattern});
  }catch{res.status(404).json({error:'Product unavailable'});}
 });
 router.get('/:token/images/:ref',async(req,res)=>{
  try{
   if(Object.keys(req.query).length||!/^[-\w]{43}$/.test(String(req.params.ref)))throw Error('Unavailable');
   const first=await resolveProductShare(deps.db,req.params.token);if(!first?.available)throw Error('Unavailable');
   const ref='display:'+req.params.ref,asset=(await deps.load(first.masterId,first.productId))?.previews.get(ref);if(!asset)throw Error('Unavailable');
   const content=await deps.readDisplay(asset);
   if(!Buffer.isBuffer(content.body)||!content.body.length||content.body.length>5*1024*1024||content.body.length!==content.byteSize||!['image/webp','image/png','image/jpeg'].includes(content.mime))throw Error('Unavailable');
   const current=await resolveProductShare(deps.db,req.params.token);
   if(!same(current,first)||!current!.available||(await deps.load(current!.masterId,current!.productId))?.previews.get(ref)!==asset)throw Error('Unavailable');
   res.type(content.mime).send(content.body);
  }catch{res.status(404).json({error:'Product unavailable'});}
 });return router;
}
