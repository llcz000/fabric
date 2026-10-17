import {Router,json} from 'express';
import type {AppPrincipal} from '../access/types';
import {requireV2Principal,requireV2Action,type AccessDatabase} from '../access/middleware';
import {createV2Document,readV2Document,updateV2Document,DocumentWriteError,type DocumentRecord} from './documents';
import {OrderLineError,type Pool} from './lines';
import {DocumentCalculationError} from './calculations';
import {copyV2Document,deleteV2Document} from './documentLifecycle';
import {buildV2DocumentPrintModel} from './print';
import {buildDocumentWorkbookFromModel} from '../documentExcel';
import sharp from 'sharp';
import {readCompanyImageForExport,describeCompanyImages,type CompanyImageRuntime} from '../image-assets/companyImages';
import type {CompanyImageRole} from '../image-assets/types';
import {listScopedOrders,listMatchingOrderItems,summarizeMatchingOrderItems,statsScopedOrders,parseScopedOrderFilters,OrderSearchError} from './orderQueries';

type Database=Pool&AccessDatabase;
function sendError(res:import('express').Response,error:unknown):void{
 const status=(error instanceof DocumentWriteError||error instanceof OrderLineError||error instanceof DocumentCalculationError||error instanceof OrderSearchError)
  ?error.status:503;
 const safe=[400,401,403,404,409,422].includes(status)?status:503;
 res.status(safe).json({error:safe===404?'Order not found':
  safe===503?'Document service temporarily unavailable':
  error instanceof Error?error.message:'Invalid document'});
}
/**
 * Strictly separate, opt-in V2 API. NOT mounted on legacy server.ts; a real
 * V2 schema migration and route-wide authorization is a release precondition.
 */
export function createV2DocumentRouter(db:Database,options:{companyImages?:CompanyImageRuntime;companyPrintLabels?:boolean}={}):Router{
 const router=Router();
 router.use(json({limit:'64kb',strict:true}));
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 /** V2 list and stats have mandatory server-side owner SQL predicates;
  * no legacy JSON fallback and no client-supplied owner override. */
 router.get('/documents',requireV2Principal(db),async(req,res)=>{
  try{
   const filters=parseScopedOrderFilters(req.query as Record<string,unknown>);
   res.json(await listScopedOrders(db,res.locals.principal as AppPrincipal,filters));
  }catch(error){sendError(res,error);}
 });
 /** QUERY-03: totals across ONLY matching detail lines; no deposit or prepayment sum. */
 router.get('/documents/matching-totals',requireV2Principal(db),async(req,res)=>{
  try{
   const filters=parseScopedOrderFilters(req.query as Record<string,unknown>);
   res.json(await summarizeMatchingOrderItems(db,res.locals.principal as AppPrincipal,filters));
  }catch(error){sendError(res,error);}
 });
 router.get('/documents/stats',requireV2Principal(db),async(req,res)=>{
  try{
   const raw=req.query as Record<string,unknown>;
   if(Object.keys(raw).some(key=>!['from','to'].includes(key)))
    throw new OrderSearchError('Invalid statistics filters');
   const {from,to}=parseScopedOrderFilters(raw);
   res.json(await statsScopedOrders(db,res.locals.principal as AppPrincipal,{from,to}));
  }catch(error){sendError(res,error);}
 });
 router.get('/documents/:id/matching-items',requireV2Principal(db),async(req,res)=>{
  try{
   const filters=parseScopedOrderFilters(req.query as Record<string,unknown>);
   res.json(await listMatchingOrderItems(db,res.locals.principal as AppPrincipal,String(req.params.id),filters));
  }catch(error){sendError(res,error);}
 });
 router.post('/documents',requireV2Principal(db),requireV2Action('orders.create_own'),async(req,res)=>{
  try{
   const actor=res.locals.principal as AppPrincipal;
   const created=await createV2Document(db,actor,req.body) satisfies DocumentRecord;
   res.status(201).json(created);
  }catch(e){sendError(res,e);}
 });
 /** DOC-01 explicit independent new-id copy. */
 router.post('/documents/:id/copy',requireV2Principal(db),requireV2Action('orders.create_own'),async(req,res)=>{
  try{
   const result=await copyV2Document(db,res.locals.principal as AppPrincipal,String(req.params.id),req.body);
   res.status(201).json(result);
  }catch(e){sendError(res,e);}
 });
 /** DOC-01 only explicitly confirmed owner-checked atomic deletion. */
 router.delete('/documents/:id',requireV2Principal(db),async(req,res)=>{
  try{
   await deleteV2Document(db,res.locals.principal as AppPrincipal,String(req.params.id),req.body);
   res.status(204).end();
  }catch(e){sendError(res,e);}
 });
 /** Every display/print/export must load the latest unified company settings,
  * even for saved documents with a non-null historical display snapshot. */
 const loadCurrentCompany=async():Promise<Record<string,unknown>>=>{
  const [raw]=await db.query('SELECT * FROM company_config WHERE id=1 LIMIT 1');
  if(!Array.isArray(raw)||raw.length!==1||!raw[0]||typeof raw[0]!=='object')
   throw new Error('Current company settings unavailable');
  const settings=raw[0] as Record<string,unknown>;
  if(options.companyPrintLabels){
   const [labels]=await db.query('SELECT issuer_label,receiver_label FROM v2_company_print_labels WHERE company_id=1 LIMIT 1');
   if(!Array.isArray(labels))throw Error('Current signature labels unavailable');
   Object.assign(settings,labels.length===1?labels[0]:{
    issuer_label:'开单人签字',receiver_label:'收货人签字'});
  }
  return settings;
 };
 /** Print and Excel use the same authorized persisted PRODUCT/trade record.
  * Never use legacy /api/export_template/:id (no V2 owner scoping). */
 const readPrintable=async(id:string,actor:AppPrincipal)=>{
  const saved=await readV2Document(db,actor,id);
  const company=await loadCurrentCompany();
  const model=buildV2DocumentPrintModel(saved,company);
  if(options.companyImages?.enabled){
   const present=await describeCompanyImages(company,options.companyImages);
   model.companyImages=Object.fromEntries(Object.keys(present).map(role=>[
    role,'/api/v2/documents/'+encodeURIComponent(saved.id)+'/company-image/'+role
   ]));
  }
  return {saved,company,model};
 };
 const imageRoles=['brand_logo','wechat_qr','alipay_qr'] as const;
 const imageBytes=async(company:Record<string,unknown>,role:CompanyImageRole)=>{
  const runtime=options.companyImages;
  if(!runtime?.enabled)return null;
  const raw=await readCompanyImageForExport(company,runtime,role);
  if(!raw)return null;
  return sharp(raw.body,{limitInputPixels:16000000}).png().toBuffer();
 };
 router.get('/documents/:id/company-image/:role',requireV2Principal(db),async(req,res)=>{
  try{
   const role=String(req.params.role);
   if(!imageRoles.includes(role as CompanyImageRole)){res.status(404).end();return;}
   await readV2Document(db,res.locals.principal as AppPrincipal,String(req.params.id));
   const company=await loadCurrentCompany();
   const bytes=await imageBytes(company,role as CompanyImageRole);
   if(!bytes){res.status(404).end();return;}
   res.setHeader('Content-Type','image/png');
   res.setHeader('X-Content-Type-Options','nosniff');
   res.status(200).send(bytes);
  }catch(e){sendError(res,e);}
 });
 router.get('/documents/:id/print-model',requireV2Principal(db),async(req,res)=>{
  try{
   const {model}=await readPrintable(String(req.params.id),res.locals.principal as AppPrincipal);
   res.json(model);
  }catch(e){sendError(res,e);}
 });
 router.get('/documents/:id/export.xlsx',requireV2Principal(db),async(req,res)=>{
  try{
   const {saved,company,model}=await readPrintable(String(req.params.id),res.locals.principal as AppPrincipal);
   const entries=await Promise.all(imageRoles.map(async role=>{
    const body=await imageBytes(company,role);
    return body?[role,{body,mime:'image/png' as const}] as const:null;
   }));
   const images=Object.fromEntries(entries.filter(x=>x!==null));
   const workbook=buildDocumentWorkbookFromModel(model,images);
   const bytes=await workbook.xlsx.writeBuffer();
   const name=saved.orderNo.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g,'_').slice(0,100)||'V2单据';
   res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
   res.setHeader('Content-Disposition',`attachment; filename="fabric-v2-${saved.id}.xlsx"; filename*=UTF-8''${encodeURIComponent(name+'.xlsx')}`);
   res.status(200).send(Buffer.from(bytes));
  }catch(e){sendError(res,e);}
 });
 router.get('/documents/:id',requireV2Principal(db),async(req,res)=>{
  try{
   const result=await readV2Document(db,res.locals.principal as AppPrincipal,String(req.params.id));
   res.json(result);
  }catch(e){sendError(res,e);}
 });
 router.patch('/documents/:id',requireV2Principal(db),async(req,res)=>{
  try{
   const result=await updateV2Document(db,res.locals.principal as AppPrincipal,String(req.params.id),req.body);
   res.json(result);
  }catch(e){sendError(res,e);}
 });
 return router;
}
