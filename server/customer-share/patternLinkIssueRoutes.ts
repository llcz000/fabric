import {Router,json,type ErrorRequestHandler} from 'express';
import {requireV2Principal,type AccessDatabase} from '../access/middleware';
import type {AppPrincipal} from '../access/types';
import {deriveStablePatternLinkToken,formatPatternShareUrl,issuePatternShareLink,
 type PatternShareLinkPool} from './patternLinkIssuer';

/**
 * B1 isolated private issuance endpoint. Intentionally never mounted by
 * legacy server.ts or the sandbox without reviewed schema, secret, publication
 * and target-DB gates. The caller injects ONLY trusted server configuration.
 *
 * POST /patterns/:masterId/share with an EMPTY JSON object; no client-supplied
 * link base, role, account, token, override, revoke flag, or signing secret.
 */
export interface PatternShareIssueDependencies{
 authDb:AccessDatabase;
 pool:PatternShareLinkPool;
 secret:Uint8Array;
 publicBase:string;
}
const validId=(value:unknown)=>typeof value==='string'&&
 /^[1-9][0-9]{0,19}$/.test(value)&&BigInt(value)<=18446744073709551615n;
export function createPatternShareIssueRouter(deps:PatternShareIssueDependencies):Router{
 if(!deps||!deps.authDb||typeof deps.authDb.query!=='function'||
  !deps.pool||typeof deps.pool.getConnection!=='function')throw Error('Pattern link dependencies invalid');
 // Fail before mounting a network route if the key or origin is malformed.
 const probe=deriveStablePatternLinkToken('1',deps.secret);
 formatPatternShareUrl(deps.publicBase,probe);
 const router=Router();
 router.use((_req,res,next)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Pragma','no-cache');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
  next();
 });
 const principal=requireV2Principal(deps.authDb);
 router.post('/patterns/:masterId/share',principal,(req,res,next)=>{
  if(!validId(req.params.masterId)||Object.keys(req.query).length||
    !req.is('application/json')){
   res.status(400).json({error:'Invalid pattern share request'});return;
  }
  next();
 },json({limit:'1kb',strict:true}),async(req,res)=>{
  const body:unknown=req.body;
  if(!body||typeof body!=='object'||Array.isArray(body)||
   Object.keys(body).length!==0){
   res.status(400).json({error:'Invalid pattern share request'});return;
  }
  try{
   const {url,created}=await issuePatternShareLink(deps.pool,
    res.locals.principal as AppPrincipal,req.params.masterId,deps.secret,deps.publicBase);
   res.status(created?201:200).json({url,created});
  }catch{
   // Never echo the raw HMAC key, SQL error, internal identity or token.
   res.status(503).json({error:'Pattern share temporarily unavailable'});
  }
 });
 const errors:ErrorRequestHandler=(_err,_req,res,_next)=>{
  res.status(400).json({error:'Invalid pattern share request'});
 };
 router.use(errors);
 return router;
}
