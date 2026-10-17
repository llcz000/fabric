import {Router,json,type RequestHandler,type ErrorRequestHandler} from 'express';
import {requireV2Principal,type AccessDatabase} from '../access/middleware';
import type {AppPrincipal} from '../access/types';
import {SampleScanError} from './scanRepository';

/**
 * B2/B3 independent, NOT mounted in server.ts until schema and transactional
 * repository are verified. Only a server-authorized salesperson may scan.
 * The service must recheck ownership in its own transaction before writes.
 */
export interface CardScanRequest {cardToken:string;sessionId:string}
export interface CardScanResponse {
 cardId:string;
 resolvedProductIds:string[];
 addedProductIds:string[];
 alreadySelectedProductIds:string[];
 selectedCardCount:number;
}
export interface CardScanDependencies {
 /** Server-side permission: deny by default; check session ownership/grants. */
 authorize:(principal:AppPrincipal,sessionId:string)=>Promise<boolean>;
 /** Persist transactionally; do not trust the actor's request body. */
 scan:(input:CardScanRequest,principal:AppPrincipal)=>Promise<CardScanResponse>;
}
const TOKEN=/^[A-Za-z0-9_-]{22,128}$/;
const SESSION=/^[1-9][0-9]{0,19}$/;
function readBody(body:unknown):CardScanRequest|null {
 if(!body||typeof body!=='object'||Array.isArray(body))return null;
 const value=body as Record<string,unknown>;
 if(Object.keys(value).length!==2||
  !Object.keys(value).every(k=>k==='cardToken'||k==='sessionId')||
  typeof value.cardToken!=='string'||!TOKEN.test(value.cardToken)||
  typeof value.sessionId!=='string'||!SESSION.test(value.sessionId)||
  BigInt(value.sessionId)>18446744073709551615n)return null;
 return {cardToken:value.cardToken,sessionId:value.sessionId};
}
export function createSampleCardScanRouter(
 authDb:AccessDatabase,
 deps:CardScanDependencies,
):Router {
 const router=Router();
 const privateCache:RequestHandler=(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();};
 router.use(privateCache);
 // No public GET fallback: an unauthenticated QR cannot expose an image page.
 const sales:RequestHandler=(_req,res,next)=>{
  if((res.locals.principal as AppPrincipal|undefined)?.role!=='sales'){
   res.status(403).json({error:'Forbidden'});return;
  }
  next();
 };
 const requireJson:RequestHandler=(req,res,next)=>{
  if(!req.is('application/json')){res.status(400).json({error:'JSON content type required'});return;}
  next();
 };
 router.post('/scan',requireV2Principal(authDb),sales,requireJson,json({limit:'8kb'}),async (req,res)=>{
  const actor=res.locals.principal as AppPrincipal|undefined;
  if(!actor){res.status(401).json({error:'Unauthorized'});return;}
  // Admin is NOT implicitly a salesperson; any future delegated access must
  // be explicitly approved in the Phase 2 permission matrix.
  if(actor.role!=='sales'){res.status(403).json({error:'Forbidden'});return;}
  const input=readBody(req.body);
  if(!input){res.status(400).json({error:'Invalid scan request'});return;}
  try{
   if(!await deps.authorize(actor,input.sessionId)){
    res.status(403).json({error:'Forbidden'});return;
   }
   const result=await deps.scan(input,actor);
   res.status(200).json(result);
  }catch(error){
   if(error instanceof SampleScanError){
    const publicError=error.status===403?'Forbidden':
      error.status===404?'Card or selection unavailable':
      error.code==='NO_AVAILABLE_PRODUCTS'?'当前没有可选产品':'Card selection conflict';
    res.status(error.status).json({error:publicError});return;
   }
   res.status(503).json({error:'Sample selection temporarily unavailable'});
  }
 });
 const errors:ErrorRequestHandler=(error,_req,res,_next)=>{
  const status=error&&typeof error==='object'?(error as {status?:unknown}).status:undefined;
  res.status(status===400?400:status===413?413:503).json({error:
   status===400?'Invalid JSON request':status===413?'Request body too large':'Sample selection temporarily unavailable'});
 };
 router.use(errors);
 return router;
}
