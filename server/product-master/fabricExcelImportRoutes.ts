/** XLSX-only P5 import HTTP router. Not mounted to the production server.ts. */
import {Router,json,type RequestHandler,type ErrorRequestHandler,type Response} from 'express';
import type {Pool} from '../order-v2/lines';
import type {AppPrincipal} from '../access/types';
import {requireV2Principal,requireV2Action,type AccessDatabase} from '../access/middleware';
import {FabricExcelError,type FabricExcelOptions} from './fabricExcelPreview';
import {createFabricImportService,FabricImportError} from './fabricExcelImport';

export function createFabricExcelImportRouter(database:AccessDatabase,pool:Pool):Router{
 const router=Router(),service=createFabricImportService(database,pool);
 const principal=requireV2Principal(database),manage=requireV2Action('products.manage');
 const parser=json({limit:'12mb',strict:true});
 const requireJson:RequestHandler=(req,res,next)=>{
  if(!req.is('application/json')){res.status(400).json({error:'JSON required'});return;}next();
 };
 const handle=(res:Response,e:unknown)=>{
  if(e instanceof FabricImportError){res.status(e.status).json({error:e.message});return;}
  if(e instanceof FabricExcelError){res.status(400).json({error:e.message});return;}
  res.status(503).json({error:'面料导入暂时不可用'});
 };
 router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
 router.post('/fabrics/import/preview',principal,manage,requireJson,parser,async(req,res)=>{
  try{
   const data=req.body as Record<string,unknown>;
   if(!data||typeof data!=='object'||Array.isArray(data)||
    Object.keys(data).some(x=>!['fileBase64','options'].includes(x))||
    typeof data.fileBase64!=='string'||data.fileBase64.length>11_200_000||
    !/^(?:[a-zA-Z0-9+/]{4})*(?:[a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=)?$/.test(data.fileBase64))
    throw new FabricImportError('文件数据格式错误');
   const buffer=Buffer.from(data.fileBase64,'base64');
   res.json(await service.preview(res.locals.principal as AppPrincipal,buffer,data.options as FabricExcelOptions));
  }catch(e){handle(res,e);}
 });
 router.post('/fabrics/import/commit',principal,manage,requireJson,json({limit:'32kb',strict:true}),
  async(req,res)=>{
   try{res.json(await service.commit(res.locals.principal as AppPrincipal,req.body));}
   catch(e){handle(res,e);}
  });
 const errors:ErrorRequestHandler=(err,_req,res,_next)=>{
  if(err?.status===400){res.status(400).json({error:'请求格式错误'});return;}
  if(err?.status===413){res.status(413).json({error:'Excel文件或确认数据过大'});return;}
  res.status(503).json({error:'面料导入暂时不可用'});
 };
 router.use(errors);
 return router;
}
