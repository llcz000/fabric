import {catalogExportHandler} from './catalogExport';
import {Router,json,type ErrorRequestHandler,type RequestHandler,type Response} from 'express';
import type {Pool} from '../order-v2/lines';
import {requireV2Principal,requireV2Action,type AccessDatabase} from '../access/middleware';
import type {AppPrincipal} from '../access/types';
import {createPatternMaster,listPatternMasters,updatePatternMaster,deletePatternMaster,PatternMasterError} from './patternMasters';
import {searchPatternCatalog,parsePatternCatalogQuery,loadPatternEditor,PatternCatalogError} from './patternCatalog';

/** Isolated P3-1a HTTP router; no server.ts/production mounting. */
export function createPatternMasterRouter(database:AccessDatabase,pool:Pool):Router{
 const router=Router();
 const parser=json({limit:'16kb'});
 const principal=requireV2Principal(database);
 const read=requireV2Action('products.read');
 const write=requireV2Action('products.manage');
 const requireJson:RequestHandler=(req,res,next)=>{
  if(!req.is('application/json')){res.status(400).json({error:'JSON content type required'});return;}
  next();
 };
 const errorResponse=(res:Response,error:unknown)=>{
  if(error instanceof PatternMasterError||error instanceof PatternCatalogError){res.status(error.status).json({error:error.message});return;}
  res.status(503).json({error:'Pattern master service temporarily unavailable'});
 };
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 router.get('/pattern-catalog/export.xlsx',principal,read,catalogExportHandler(database,'patterns'));
 router.get('/pattern-catalog',principal,read,async(req,res)=>{
  try{res.json(await searchPatternCatalog(database,parsePatternCatalogQuery(req.query)));}
  catch(e){errorResponse(res,e);}
 });
 router.get('/pattern-masters/:id/colorway-details',principal,read,async(req,res)=>{
  try{res.json(await loadPatternEditor(database,String(req.params.id)));}
  catch(e){errorResponse(res,e);}
 });
 router.get('/pattern-masters',principal,read,async(req,res)=>{
  try{
   const includeInactive=req.query.includeInactive;
   if(includeInactive!==undefined&&includeInactive!=='true'){
    res.status(400).json({error:'Invalid includeInactive filter'});return;
   }
   res.json({items:await listPatternMasters(database,{includeInactive:includeInactive==='true'})});
  }catch(e){errorResponse(res,e);}
 });
 router.post('/pattern-masters',principal,write,requireJson,parser,async(req,res)=>{
  try{res.status(201).json(await createPatternMaster(pool,res.locals.principal as AppPrincipal,req.body));}
  catch(e){errorResponse(res,e);}
 });
 router.patch('/pattern-masters/:id',principal,write,requireJson,parser,async(req,res)=>{
  try{res.json(await updatePatternMaster(pool,res.locals.principal as AppPrincipal,String(req.params.id),req.body));}
  catch(e){errorResponse(res,e);}
 });
 router.delete('/pattern-masters/:id',principal,write,async(req,res)=>{
  try{res.json(await deletePatternMaster(pool,res.locals.principal as AppPrincipal,String(req.params.id)));}
  catch(e){errorResponse(res,e);}
 });
 const parserError:ErrorRequestHandler=(error,_req,res,_next)=>{
  const status=error&&typeof error==='object'?(error as {status?:unknown}).status:undefined;
  if(status===400){res.status(400).json({error:'Invalid JSON request'});return;}
  if(status===413){res.status(413).json({error:'Request body too large'});return;}
  res.status(503).json({error:'Pattern master service temporarily unavailable'});
 };
 router.use(parserError);
 return router;
}