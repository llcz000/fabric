import {Router,json,type ErrorRequestHandler,type RequestHandler,type Response} from 'express';
import type {Pool} from '../order-v2/lines';
import type {AppPrincipal} from '../access/types';
import {requireV2Principal,requireV2Action,type AccessDatabase} from '../access/middleware';
import {TagError,createSharedTag,listSharedTags,readEntityTags,replaceEntityTags,
 previewTagImpact,renameSharedTag,archiveSharedTag,mergeSharedTags,type TagDimension,type TagEntity} from './sharedTags';

/** Isolated P3-1b router; the legacy service is unchanged. */
export function createSharedTagsRouter(db:AccessDatabase,pool:Pool):Router{
 const router=Router();
 const principal=requireV2Principal(db),read=requireV2Action('products.read');
 const write=requireV2Action('products.manage');
 // Role simplification: both active roles can rename/archive/merge after
 // server-side impact and reference checks. Account management stays admin-only.
 const admin:RequestHandler=write;
 const jsonRequired:RequestHandler=(req,res,next)=>{
  if(!req.is('application/json')){res.status(400).json({error:'JSON content type required'});return;}
  next();
 };
 const parser=json({limit:'16kb'});
 const response=(res:Response,error:unknown)=>{
  if(error instanceof TagError){res.status(error.status).json({error:error.message});return;}
  res.status(503).json({error:'Shared tag service temporarily unavailable'});
 };
 const bodyFields=(body:unknown,keys:string[]):body is Record<string,unknown>=>{
  return !!body&&typeof body==='object'&&!Array.isArray(body)&&
   Object.keys(body).every(k=>keys.includes(k));
 };
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 router.get('/tags',principal,read,async(req,res)=>{
  try{
   const dimension=req.query.dimension;
   const includeArchived=req.query.includeArchived,search=req.query.search;
   if((dimension!=='topic'&&dimension!=='color')||
     (includeArchived!==undefined&&includeArchived!=='true')||
     (search!==undefined&&typeof search!=='string')){
    res.status(400).json({error:'Invalid tags query'});return;
   }
   res.json({items:await listSharedTags(db,dimension,{includeArchived:includeArchived==='true',search:search as string|undefined})});
  }catch(e){response(res,e);}
 });
 router.post('/tags',principal,write,jsonRequired,parser,async(req,res)=>{
  try{
   if(!bodyFields(req.body,['dimension','name']))throw new TagError('Invalid tag fields');
   res.status(201).json(await createSharedTag(pool,res.locals.principal as AppPrincipal,req.body.dimension as TagDimension,req.body.name));
  }catch(e){response(res,e);}
 });
 router.get('/tags/:id/impact',principal,read,async(req,res)=>{
  try{res.json(await previewTagImpact(db,String(req.params.id)));}catch(e){response(res,e);}
 });
 router.patch('/tags/:id',principal,admin,jsonRequired,parser,async(req,res)=>{
  try{
   if(!bodyFields(req.body,['name','confirmAffectedCount']))throw new TagError('Invalid tag update');
   res.json(await renameSharedTag(pool,res.locals.principal as AppPrincipal,String(req.params.id),
    req.body.name,req.body.confirmAffectedCount as number));
  }catch(e){response(res,e);}
 });
 router.post('/tags/:id/archive',principal,admin,jsonRequired,parser,async(req,res)=>{
  try{
   if(!bodyFields(req.body,[])||Object.keys(req.body).length!==0)throw new TagError('Unexpected tag fields');
   res.json(await archiveSharedTag(pool,res.locals.principal as AppPrincipal,String(req.params.id)));
  }catch(e){response(res,e);}
 });
 router.post('/tags/:id/merge',principal,admin,jsonRequired,parser,async(req,res)=>{
  try{
   if(!bodyFields(req.body,['targetId','confirmAffectedCount'])||
     !Object.hasOwn(req.body,'targetId')||!Object.hasOwn(req.body,'confirmAffectedCount'))
    throw new TagError('Invalid tag merge request');
   res.json(await mergeSharedTags(pool,res.locals.principal as AppPrincipal,String(req.params.id),
    req.body.targetId as string,req.body.confirmAffectedCount as number));
  }catch(e){response(res,e);}
 });
 const targets:{prefix:string;kind:TagEntity}[]=[
  {prefix:'/pattern-masters/:id/tags',kind:'master'},
  {prefix:'/pattern-masters/:id/color-tags',kind:'masterColor'},
  {prefix:'/pattern-colorways/:id/tags',kind:'colorway'}];
 for(const target of targets){
  router.get(target.prefix,principal,read,async(req,res)=>{
   try{res.json({items:await readEntityTags(db,target.kind,String(req.params.id))});}
   catch(e){response(res,e);}
  });
  router.put(target.prefix,principal,write,jsonRequired,parser,async(req,res)=>{
   try{
    if(!bodyFields(req.body,target.kind==='masterColor'?['tagIds','newColorTags']:['tagIds'])||!Object.hasOwn(req.body,'tagIds'))throw new TagError('Invalid tag relation');
    res.json({tagIds:await replaceEntityTags(pool,res.locals.principal as AppPrincipal,target.kind,
     String(req.params.id),req.body.tagIds,req.body.newColorTags??[])});
   }catch(e){response(res,e);}
  });
 }
 const parseError:ErrorRequestHandler=(error,_req,res,_next)=>{
  const code=error&&typeof error==='object'?(error as {status?:unknown}).status:undefined;
  if(code===400){res.status(400).json({error:'Invalid JSON request'});return;}
  if(code===413){res.status(413).json({error:'Request body too large'});return;}
  res.status(503).json({error:'Shared tag service temporarily unavailable'});
 };
 router.use(parseError);
 return router;
}
