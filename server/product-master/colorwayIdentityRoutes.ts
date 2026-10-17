import {Router,json,type Response,type ErrorRequestHandler,type RequestHandler} from 'express';
import type {Pool} from '../order-v2/lines';
import {requireV2Principal,requireV2Action,type AccessDatabase} from '../access/middleware';
import type {AppPrincipal} from '../access/types';
import {createColorway,listColorways,updateColorway,deleteColorway,ColorwayIdentityError} from './colorwayIdentity';

/** Independent P3-2a router. NOT attached to server.ts. Mount at /api/v2 only
 * after integration review. POST has no automatic retry or idempotency key.
 */
export function createColorwayIdentityRouter(database:AccessDatabase,pool:Pool):Router{
 const router=Router();
 const parser=json({limit:'16kb'});
 const requireJson:RequestHandler=(req,res,next)=>{
  if(!req.is('application/json')){res.status(400).json({error:'JSON content type required'});return;}
  next();
 };
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 const principal=requireV2Principal(database),manage=requireV2Action('products.manage');
 const errorResponse=(res:Response,error:unknown)=>{
  if(error instanceof ColorwayIdentityError){res.status(error.status).json({error:error.message});return;}
  res.status(503).json({error:'Colorway service temporarily unavailable'});
 };
 router.get('/pattern-masters/:masterId/colorways',principal,requireV2Action('products.read'),async(req,res)=>{
  try{res.json(await listColorways(database,String(req.params.masterId)));}catch(error){errorResponse(res,error);}
 });
 router.post('/pattern-masters/:masterId/colorways',principal,manage,requireJson,parser,async(req,res)=>{
  try{res.status(201).json(await createColorway(pool,res.locals.principal as AppPrincipal,String(req.params.masterId),req.body));}
  catch(error){errorResponse(res,error);}
 });
 router.patch('/pattern-colorways/:id',principal,manage,requireJson,parser,async(req,res)=>{
  try{res.json(await updateColorway(pool,res.locals.principal as AppPrincipal,String(req.params.id),req.body));}
  catch(error){errorResponse(res,error);}
 });
 router.delete('/pattern-colorways/:id',principal,manage,async(req,res)=>{
  try{res.json(await deleteColorway(pool,res.locals.principal as AppPrincipal,String(req.params.id)));}
  catch(error){errorResponse(res,error);}
 });
 // Parser exceptions occur before route handlers; keep error bodies JSON and
 // never expose Express's development HTML stack or raw submitted data.
 const parserError:ErrorRequestHandler=(error,_req,res,_next)=>{
  const status=error&&typeof error==='object'?(error as {status?:unknown}).status:undefined;
  if(status===400){res.status(400).json({error:'Invalid JSON request'});return;}
  if(status===413){res.status(413).json({error:'Request body too large'});return;}
  res.status(503).json({error:'Colorway service temporarily unavailable'});
 };
 router.use(parserError);
 return router;
}
