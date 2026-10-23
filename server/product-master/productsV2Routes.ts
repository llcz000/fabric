import {catalogExportHandler} from './catalogExport';
import {Router,json,type RequestHandler,type Response,type ErrorRequestHandler} from 'express';
import type {Pool} from '../order-v2/lines';
import type {AppPrincipal} from '../access/types';
import {requireV2Principal,requireV2Action,type AccessDatabase} from '../access/middleware';
import {createV2Product,createV2ProductsBatch,previewV2ProductsBatch,getV2Product,updateV2Product,deleteV2Product,V2ProductError} from './productsV2';
import {parseProductSearchQuery,searchProductCatalog,ProductSearchError} from './productSearch';

/** Standalone V2 router; never mount over legacy /api/products before cutover. */
export function createV2ProductsRouter(db:AccessDatabase,pool:Pool):Router{
 const router=Router(),principal=requireV2Principal(db);
 const read=requireV2Action('products.read'),write=requireV2Action('products.manage');
 const parser=json({limit:'64kb'});
 const jsonRequired:RequestHandler=(req,res,next)=>{
  if(!req.is('application/json')){res.status(400).json({error:'JSON content type required'});return;}
  next();
 };
 const error=(res:Response,e:unknown)=>{
  if(e instanceof V2ProductError||e instanceof ProductSearchError){res.status(e.status).json({error:e.message});return;}
  res.status(503).json({error:'V2 product service temporarily unavailable'});
 };
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 router.get('/products/export.xlsx',principal,read,catalogExportHandler(db,'products'));
 router.get('/products',principal,read,async(req,res)=>{
  try{res.json(await searchProductCatalog(db,parseProductSearchQuery(req.query)));}
  catch(e){error(res,e);}
 });
 router.post('/products/batch/preview',principal,read,jsonRequired,parser,async(req,res)=>{
  try{res.json(await previewV2ProductsBatch(db,req.body));}catch(e){error(res,e);}
 });
 router.post('/products/batch',principal,write,jsonRequired,parser,async(req,res)=>{
  try{res.status(201).json(await createV2ProductsBatch(pool,res.locals.principal as AppPrincipal,req.body));}
  catch(e){error(res,e);}
 });
 router.get('/products/:id',principal,read,async(req,res)=>{
  try{res.json(await getV2Product(db,String(req.params.id)));}catch(e){error(res,e);}
 });
 router.post('/products',principal,write,jsonRequired,parser,async(req,res)=>{
  try{res.status(201).json(await createV2Product(pool,res.locals.principal as AppPrincipal,req.body));}
  catch(e){error(res,e);}
 });
 router.patch('/products/:id',principal,write,jsonRequired,parser,async(req,res)=>{
  try{res.json(await updateV2Product(pool,res.locals.principal as AppPrincipal,String(req.params.id),req.body));}
  catch(e){error(res,e);}
 });
 router.delete('/products/:id',principal,write,async(req,res)=>{
  try{res.json(await deleteV2Product(pool,res.locals.principal as AppPrincipal,String(req.params.id)));}
  catch(e){error(res,e);}
 });
 const parserError:ErrorRequestHandler=(e,_req,res,_next)=>{
  const n=e&&typeof e==='object'?(e as {status?:unknown}).status:undefined;
  if(n===400){res.status(400).json({error:'Invalid JSON request'});return;}
  if(n===413){res.status(413).json({error:'Request body too large'});return;}
  res.status(503).json({error:'V2 product service temporarily unavailable'});
 };
 router.use(parserError);
 return router;
}