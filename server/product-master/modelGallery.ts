import {Router,json,type RequestHandler} from 'express';
import {z} from 'zod';
import type {Pool} from '../order-v2/lines';
import type {AppPrincipal} from '../access/types';
import {withCatalogTransaction} from '../access/catalogTransaction';
import {requireV2Action,requireV2Principal,type AccessDatabase} from '../access/middleware';

export class ModelGalleryError extends Error{
 constructor(message:string,readonly status:400|401|403|404|409=400){super(message);}
}
const uuid=z.string().uuid();
const numberId=z.string().regex(/^[1-9]\d{0,19}$/).refine(v=>/^[1-9]\d{0,19}$/.test(v)&&BigInt(v)<=18446744073709551615n);
const modelFields=z.object({
 assetId:uuid,category:z.enum(['dress','top','skirt','pants','set','other']),
 angle:z.enum(['front','side','back','other']),
 note:z.string().max(400),
 referenceCm:z.number().positive().max(300).nullable()
}).strict();
const input=modelFields.extend({
 angle:modelFields.shape.angle.default('front'),
 note:modelFields.shape.note.default(''),
 referenceCm:modelFields.shape.referenceCm.default(null)
});
const patch=modelFields.partial().extend({expectedAssetId:uuid.optional()})
 .refine(v=>Boolean(v.assetId)===Boolean(v.expectedAssetId));
export type ModelRecord={
 id:string;modelNo:string;assetId:string;category:string;angle:string;note:string;
 referenceCm:number|null;width:number;height:number;
};
type Db={query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>};
function rows(value:unknown):Record<string,unknown>[]{
 if(!Array.isArray(value))throw Error('Model records unavailable');
 return value as Record<string,unknown>[];
}
const select='SELECT m.id,m.asset_id,m.category,m.angle,m.note,m.reference_cm,a.width,a.height FROM v2_model_assets m JOIN image_assets a ON a.id=m.asset_id';
function record(r:Record<string,unknown>):ModelRecord{
 const id=String(r.id);
 if(!numberId.safeParse(id).success)throw Error('Invalid model identity');
 return {id,modelNo:'M'+id.padStart(5,'0'),assetId:String(r.asset_id),
  category:String(r.category),angle:String(r.angle),note:String(r.note??''),
  referenceCm:r.reference_cm===null?null:Number(r.reference_cm),
  width:Number(r.width),height:Number(r.height)};
}
export async function listModels(db:Db,options:{limit:number;offset:number;category?:string}):Promise<{items:ModelRecord[];total:number}>{
 const {limit,offset,category}=options;
 if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>1000000)
  throw new ModelGalleryError('Invalid model pagination');
 if(category!==undefined&&!input.shape.category.safeParse(category).success)throw new ModelGalleryError('Invalid category');
 const where=' WHERE m.deleted_at IS NULL'+(category?' AND m.category=?':'');
 const params=category?[category]:[];
 const [count]=await db.query('SELECT COUNT(*) AS total FROM v2_model_assets m'+where,params);
 const [data]=await db.query(select+where+' ORDER BY m.created_at DESC,m.id DESC LIMIT ? OFFSET ?',[...params,limit,offset]);
 const total=Number(rows(count)[0]?.total);
 if(!Number.isSafeInteger(total)||total<0)throw Error('Model count unavailable');
 return {items:rows(data).map(record),total};
}
async function selected(db:Db,id:string,lock=false):Promise<ModelRecord>{
 if(!numberId.safeParse(id).success)throw new ModelGalleryError('Invalid model id');
 const [data]=await db.query(select+' WHERE m.id=? AND m.deleted_at IS NULL'+(lock?' FOR UPDATE':''),[id]);
 const row=rows(data)[0];
 if(!row)throw new ModelGalleryError('Model not found',404);
 return record(row);
}
async function manager<T>(pool:Pool,actor:AppPrincipal,fn:(db:Db)=>Promise<T>):Promise<T>{
 return withCatalogTransaction(pool,actor,(message,status)=>new ModelGalleryError(message,status),'Insufficient model permissions',fn);
}
export async function createModel(pool:Pool,actor:AppPrincipal,raw:unknown){
 const value=input.safeParse(raw);
 if(!value.success)throw new ModelGalleryError('Invalid model fields');
 return manager(pool,actor,async db=>{
  const v=value.data;
  const [assets]=await db.query('SELECT id,status,purpose FROM image_assets WHERE id=? FOR UPDATE',[v.assetId]);
  const asset=rows(assets)[0];
  if(!asset||asset.status!=='ready'||asset.purpose!=='product_image')
   throw new ModelGalleryError('Model image is not ready',409);
  const [existing]=await db.query('SELECT id,deleted_at FROM v2_model_assets WHERE asset_id=? LIMIT 1 FOR UPDATE',[v.assetId]);
  const prior=rows(existing)[0];
  if(prior&&prior.deleted_at==null)
   throw new ModelGalleryError('该图片已在模特图库中（M'+String(prior.id).padStart(5,'0')+'），无需重复导入',409);
  let id:string;
  if(prior){
   id=String(prior.id);
   const [changed]=await db.query('UPDATE v2_model_assets SET category=?,angle=?,note=?,reference_cm=?,created_at=NOW(),deleted_at=NULL WHERE id=? AND deleted_at IS NOT NULL',
    [v.category,v.angle,v.note,v.referenceCm,id]);
   if(Number((changed as {affectedRows?:number}).affectedRows)!==1)throw new ModelGalleryError('模特资料已变化，请重试导入',409);
  }else{
   const [result]=await db.query('INSERT INTO v2_model_assets(asset_id,category,angle,note,reference_cm) VALUES (?,?,?,?,?)',
    [v.assetId,v.category,v.angle,v.note,v.referenceCm]);
   id=String((result as {insertId:unknown}).insertId);
  }
  const [referenced]=await db.query("UPDATE image_assets SET ref_count=ref_count+1 WHERE id=? AND status='ready'",[v.assetId]);
  if(Number((referenced as {affectedRows?:number}).affectedRows)!==1)throw new ModelGalleryError('Model reference ledger inconsistent',409);
  return selected(db,id);
 });
}
export async function editModel(pool:Pool,actor:AppPrincipal,id:string,raw:unknown){
 if(!numberId.safeParse(id).success)throw new ModelGalleryError('Invalid model id');
 const value=patch.safeParse(raw);
 if(!value.success||Object.keys(value.data).length===0)throw new ModelGalleryError('Invalid model changes');
 try{return await manager(pool,actor,async db=>{
  const prior=await selected(db,id,true);
  const {assetId,expectedAssetId}=value.data;
  if(expectedAssetId&&prior.assetId!==expectedAssetId)
   throw new ModelGalleryError('模特图片已被更新，请重新打开编辑后再试',409);
  const replace=assetId&&assetId!==prior.assetId;
  if(replace){
   const [assets]=await db.query('SELECT status,purpose FROM image_assets WHERE id=? FOR UPDATE',[assetId]);
   const asset=rows(assets)[0];
   if(!asset||asset.status!=='ready'||asset.purpose!=='product_image')
    throw new ModelGalleryError('替换图片未就绪，请重新选择图片',409);
   const [assigned]=await db.query('SELECT id FROM v2_model_assets WHERE asset_id=? LIMIT 1 FOR UPDATE',[assetId]);
   const owner=rows(assigned)[0];
   if(owner)throw new ModelGalleryError('该图片已关联模特 M'+String(owner.id).padStart(5,'0')+'，请选择其他图片',409);
   const [attached]=await db.query("UPDATE image_assets SET ref_count=ref_count+1 WHERE id=? AND status='ready'",[assetId]);
   if(Number((attached as {affectedRows?:number}).affectedRows)!==1)
    throw new ModelGalleryError('Model reference ledger inconsistent',409);
  }
  const next={...prior,...value.data};
  await db.query('UPDATE v2_model_assets SET asset_id=?,category=?,angle=?,note=?,reference_cm=? WHERE id=?',
   [next.assetId,next.category,next.angle,next.note,next.referenceCm,id]);
  if(replace)await releaseModelImage(db,prior.assetId);
  return selected(db,id);
 });}catch(error){
  const code=(error as {code?:string}|null)?.code;
  if(value.data.assetId&&(code==='ER_DUP_ENTRY'||code==='ER_LOCK_DEADLOCK'||code==='ER_LOCK_WAIT_TIMEOUT'))
   throw new ModelGalleryError('图片关联已变化，请重新打开编辑后再试',409);
  throw error;
 }
}
async function releaseModelImage(db:Db,assetId:string){
 const [decremented]=await db.query("UPDATE image_assets SET status=IF(ref_count=1,'recycled',status),recycled_at=IF(ref_count=1,NOW(),recycled_at),purge_after=IF(ref_count=1,DATE_ADD(NOW(),INTERVAL 30 DAY),purge_after),ref_count=ref_count-1 WHERE id=? AND ref_count>0",[assetId]);
 if(Number((decremented as {affectedRows?:number}).affectedRows)!==1)throw new ModelGalleryError('Model reference ledger inconsistent',409);
}
export async function deleteModel(pool:Pool,actor:AppPrincipal,id:string){
 if(!numberId.safeParse(id).success)throw new ModelGalleryError('Invalid model id');
 return manager(pool,actor,async db=>{
  const prior=await selected(db,id,true);
  const [assets]=await db.query('SELECT ref_count FROM image_assets WHERE id=? FOR UPDATE',[prior.assetId]);
  if(Number(rows(assets)[0]?.ref_count)<1)throw new ModelGalleryError('Model reference ledger inconsistent',409);
  const [changed]=await db.query('UPDATE v2_model_assets SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL',[id]);
  if(Number((changed as {affectedRows?:number}).affectedRows)!==1)throw new ModelGalleryError('Model not found',404);
  await releaseModelImage(db,prior.assetId);
  return {id,deleted:true};
 });
}
export function createModelGalleryRouter(db:AccessDatabase,pool:Pool):Router{
 const router=Router(),principal=requireV2Principal(db),
  read=requireV2Action('products.read'),write=requireV2Action('products.manage');
 const requireJson:RequestHandler=(req,res,next)=>{if(!req.is('application/json')){res.status(400).json({error:'JSON content type required'});return;}next();};
 const respond=(res:import('express').Response,error:unknown)=>{
  if(error instanceof ModelGalleryError){res.status(error.status).json({error:error.message});return;}
  res.status(503).json({error:'模特图库暂不可用，请检查数据库迁移'});
 };
 router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
 router.get('/models',principal,read,async(req,res)=>{
  try{
   const limit=req.query.limit===undefined?50:Number(req.query.limit),offset=req.query.offset===undefined?0:Number(req.query.offset);
   const category=req.query.category===undefined?undefined:String(req.query.category);
   res.json(await listModels(db,{limit,offset,category}));
  }catch(e){respond(res,e);}
 });
 router.post('/models',principal,write,requireJson,json({limit:'16kb'}),async(req,res)=>{
  try{res.status(201).json(await createModel(pool,res.locals.principal as AppPrincipal,req.body));}
  catch(e){respond(res,e);}
 });
 router.patch('/models/:id',principal,write,requireJson,json({limit:'16kb'}),async(req,res)=>{
  try{res.json(await editModel(pool,res.locals.principal as AppPrincipal,String(req.params.id),req.body));}
  catch(e){respond(res,e);}
 });
 router.delete('/models/:id',principal,write,async(req,res)=>{
  try{res.json(await deleteModel(pool,res.locals.principal as AppPrincipal,String(req.params.id)));}
  catch(e){respond(res,e);}
 });
 return router;
}
