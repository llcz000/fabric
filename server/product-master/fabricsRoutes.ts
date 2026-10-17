import {catalogExportHandler} from './catalogExport';
import {Router,json,type ErrorRequestHandler,type RequestHandler,type Response} from 'express';
import type {Pool} from '../order-v2/lines';
import {requireV2Principal,requireV2Action,type AccessDatabase} from '../access/middleware';
import type {AppPrincipal} from '../access/types';
import {createFabric,listFabrics,getFabric,updateFabric,deleteFabric,FabricError} from './fabrics';
import {searchFabricCatalog,parseFabricCatalogQuery,FabricCatalogError} from './fabricCatalog';
import {createFabricExcelImportRouter} from './fabricExcelImportRoutes';

/** Standalone P3-3, never attached to legacy server.ts until V2 cutover review. */
export function createFabricRouter(database:AccessDatabase,pool:Pool):Router{
 const router=Router();
 const principal=requireV2Principal(database);
 const read=requireV2Action('products.read'),write=requireV2Action('products.manage');
 const parser=json({limit:'16kb'});
 const requireJson:RequestHandler=(req,res,next)=>{
  if(!req.is('application/json')){res.status(400).json({error:'JSON content type required'});return;}
  next();
 };
 const handle=(res:Response,e:unknown)=>{
  if(e instanceof FabricError||e instanceof FabricCatalogError){res.status(e.status).json({error:e.message});return;}
  res.status(503).json({error:'Fabric service temporarily unavailable'});
 };
 function param(raw:unknown,defaultValue:number):number{
  if(raw===undefined)return defaultValue;
  if(typeof raw!=='string'||!/^([1-9]\d*|0)$/.test(raw))throw new FabricError('Invalid pagination');
  const value=Number(raw);
  if(!Number.isSafeInteger(value))throw new FabricError('Invalid pagination');
  return value;
 }
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 router.use(createFabricExcelImportRouter(database,pool));
 router.get('/fabrics/catalog/export.xlsx',principal,read,catalogExportHandler(database,'fabrics'));
 router.get('/fabrics/catalog',principal,read,async(req,res)=>{
  try{res.json(await searchFabricCatalog(database,parseFabricCatalogQuery(req.query)));}
  catch(e){handle(res,e);}
 });
 router.get('/fabrics',principal,read,async(req,res)=>{
  try{
   const {includeInactive,query,limit,offset}=req.query;
   if((includeInactive!==undefined&&includeInactive!=='true')||
    (query!==undefined&&typeof query!=='string'))
    throw new FabricError('Invalid fabric query');
   res.json({items:await listFabrics(database,{
    includeInactive:includeInactive==='true',query:query as string|undefined,
    limit:param(limit,50),offset:param(offset,0)
   })});
  }catch(e){handle(res,e);}
 });
 router.get('/fabrics/:id',principal,read,async(req,res)=>{
  try{res.json(await getFabric(database,String(req.params.id)));}
  catch(e){handle(res,e);}
 });
 router.post('/fabrics',principal,write,requireJson,parser,async(req,res)=>{
  try{res.status(201).json(await createFabric(pool,res.locals.principal as AppPrincipal,req.body));}
  catch(e){handle(res,e);}
 });
 router.patch('/fabrics/:id',principal,write,requireJson,parser,async(req,res)=>{
  try{res.json(await updateFabric(pool,res.locals.principal as AppPrincipal,String(req.params.id),req.body));}
  catch(e){handle(res,e);}
 });
 router.delete('/fabrics/:id',principal,write,async(req,res)=>{
  try{res.json(await deleteFabric(pool,res.locals.principal as AppPrincipal,String(req.params.id)));}
  catch(e){handle(res,e);}
 });
 const parserError:ErrorRequestHandler=(e,_req,res,_next)=>{
  const status=e&&typeof e==='object'?(e as {status?:unknown}).status:undefined;
  if(status===400){res.status(400).json({error:'Invalid JSON request'});return;}
  if(status===413){res.status(413).json({error:'Request body too large'});return;}
  res.status(503).json({error:'Fabric service temporarily unavailable'});
 };
 router.use(parserError);
 return router;
}