import {CustomerError} from '../customers/model';
import {Router,json} from 'express';
import type {AppPrincipal} from '../access/types';
import {requireV2Principal,requireV2Action,type AccessDatabase} from '../access/middleware';
import {createV2Document,readV2Document,updateV2Document,DocumentWriteError,type DocumentRecord} from './documents';
import {copyV2Document,deleteV2Document} from './documentLifecycle';
import {describeCompanyImages,readCompanyImageForExport,type CompanyImageRuntime} from '../image-assets/companyImages';
import {companyExportImage} from './companyExportImage';
import {OrderLineError,type Pool} from './lines';
import {reserveV2DocumentNumber} from './documentNumbers';
import {scopeOrdersQuery} from '../access/sessions';
import {exportV2DocumentSnapshot} from './documentExport';
import {once} from 'node:events';
import {DocumentCalculationError} from './calculations';
import {buildV2DocumentPrintModel} from './print';
import {buildDocumentWorkbookFromModel} from '../documentExcel';
import {listScopedOrders,listMatchingOrderItems,summarizeMatchingOrderItems,statsScopedOrders,parseScopedOrderFilters,OrderSearchError} from './orderQueries';

type Database=Pool&AccessDatabase;
export interface V2DocumentOutputDependencies{
 companyImages?:CompanyImageRuntime;companyPrintLabels?:boolean;
 loadCurrentCompany?():Promise<Record<string,unknown>>;
 loadImages?(company:Record<string,unknown>):Promise<import('../documentExcel').DocumentWorkbookInput['images']>;
}
function sendError(res:import('express').Response,error:unknown):void{
 const status=(error instanceof CustomerError||error instanceof DocumentWriteError||error instanceof OrderLineError||error instanceof DocumentCalculationError||error instanceof OrderSearchError)
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
export function createV2DocumentRouter(db:Database,output:V2DocumentOutputDependencies={}):Router{
 const router=Router();
 router.use(json({limit:'64kb',strict:true}));
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 router.post('/documents/reserve-number',requireV2Principal(db),async(req,res)=>{
  try{res.json({orderNo:await reserveV2DocumentNumber(db,res.locals.principal as AppPrincipal,req.body)});}
  catch(error){sendError(res,error);}
 });
 router.get('/documents/customers',requireV2Principal(db),async(req,res)=>{
  try{
   if(Object.keys(req.query).some(k=>k!=='q')||req.query.q!==undefined&&(typeof req.query.q!=='string'||req.query.q.length>100))throw new DocumentWriteError('Invalid customer query');
   const scope=scopeOrdersQuery(res.locals.principal as AppPrincipal),value=String(req.query.q??'').replace(/[\\%_]/g,c=>'\\'+c);
   const [data]=await db.query("SELECT DISTINCT o.receiving_unit FROM orders o WHERE "+scope.predicate+" AND o.receiving_unit LIKE ? ESCAPE '\\\\' ORDER BY o.receiving_unit LIMIT 20",[...scope.parameters,'%'+value+'%']);
   if(!Array.isArray(data))throw Error('Customer query unavailable');res.json({items:data.map(r=>String(r.receiving_unit))});
  }catch(error){sendError(res,error);}
 });
 router.get('/documents/export.json',requireV2Principal(db),async(req,res)=>{
  const cancel=new AbortController();res.once('close',()=>cancel.abort());
  const records=exportV2DocumentSnapshot(db,res.locals.principal as AppPrincipal);
  try{
   if(Object.keys(req.query).length)throw new DocumentWriteError('Invalid document export query');
   let current=await records.next();res.type('application/json').attachment('fabric-v2-documents.json');
   res.write('{"format":"fabric-v2-documents-export-v1","exportedAt":'+JSON.stringify(new Date().toISOString())+',"documents":[');
   let first=true;
   while(!current.done){
    if(cancel.signal.aborted)throw Error('Export cancelled');
    if(!res.write((first?'':',')+JSON.stringify(current.value)))await once(res,'drain',{signal:cancel.signal});
    first=false;current=await records.next();
   }
   res.end(']}');
  }catch(error){if(!res.headersSent)sendError(res,error);else res.destroy();}
  finally{await records.return();}
 });
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
   if(Object.keys(raw).some(key=>!['from','to','compareFrom','compareTo'].includes(key)))
    throw new OrderSearchError('Invalid statistics filters');
   const {from,to}=parseScopedOrderFilters({from:raw.from,to:raw.to});
   // 环比基期由前端推导后显式传入，服务端不做区间推算，只按同口径再聚合一次。
   const hasCompare=raw.compareFrom!==undefined||raw.compareTo!==undefined;
   const compareRaw=hasCompare
    ?parseScopedOrderFilters({from:raw.compareFrom,to:raw.compareTo}):null;
   res.json(await statsScopedOrders(db,res.locals.principal as AppPrincipal,{from,to},compareRaw));
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
 /** Every display/print/export must load the latest unified company settings,
  * even for saved documents with a non-null historical display snapshot. */
 const loadCurrentCompany=async():Promise<Record<string,unknown>>=>{
  if(output.loadCurrentCompany)return output.loadCurrentCompany();
  const [raw]=await db.query('SELECT * FROM company_config WHERE id=1 LIMIT 1');
  if(!Array.isArray(raw)||raw.length!==1||!raw[0]||typeof raw[0]!=='object')
   throw new Error('Current company settings unavailable');
  const company=raw[0] as Record<string,unknown>;
  if(output.companyPrintLabels){const [labels]=await db.query('SELECT issuer_label,receiver_label FROM v2_company_print_labels WHERE company_id=1 LIMIT 1');if(!Array.isArray(labels))throw Error('Current signature labels unavailable');Object.assign(company,labels[0]??{issuer_label:'开单人签字',receiver_label:'收货人签字'});}
  return company;
 };
 const imageRoles=['brand_logo','wechat_qr','alipay_qr'] as const;
 const imageBytes=async(company:Record<string,unknown>,role:typeof imageRoles[number])=>{
  if(!output.companyImages?.enabled)return null;
  const raw=await readCompanyImageForExport(company,output.companyImages,role);
  return raw?companyExportImage(raw):null;
 };
 /** Print and Excel use the same authorized persisted PRODUCT/trade record.
  * Never use legacy /api/export_template/:id (no V2 owner scoping). */
 const readPrintable=async(id:string,actor:AppPrincipal)=>{
  const saved=await readV2Document(db,actor,id);
  const company=await loadCurrentCompany(),model=buildV2DocumentPrintModel(saved,company);
  const images=output.loadImages?await output.loadImages(company):output.companyImages?.enabled?Object.fromEntries((await Promise.all(imageRoles.map(async role=>{const image=await imageBytes(company,role);return image?[role,image]:null;}))).filter(x=>x!==null)):undefined;
  if(images){model.companyImages={};for(const role of ['brand_logo','wechat_qr','alipay_qr'] as const){const value=images[role];if(value)model.companyImages[role]='data:'+value.mime+';base64,'+value.body.toString('base64');}}
  return {saved,model};
 };
 router.post('/documents/:id/copy',requireV2Principal(db),requireV2Action('orders.create_own'),async(req,res)=>{
  try{res.status(201).json(await copyV2Document(db,res.locals.principal as AppPrincipal,String(req.params.id),req.body));}catch(e){sendError(res,e);}
 });
 router.get('/documents/:id/company-image/:role',requireV2Principal(db),async(req,res)=>{
  try{const role=String(req.params.role);if(!imageRoles.includes(role as typeof imageRoles[number])){res.status(404).end();return;}
   await readV2Document(db,res.locals.principal as AppPrincipal,String(req.params.id));
   const image=await imageBytes(await loadCurrentCompany(),role as typeof imageRoles[number]);if(!image){res.status(404).end();return;}res.type(image.mime).send(image.body);
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
   const {saved,model}=await readPrintable(String(req.params.id),res.locals.principal as AppPrincipal);
   const workbook=buildDocumentWorkbookFromModel(model);
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
 router.delete('/documents/:id',requireV2Principal(db),async(req,res)=>{
  try{
   if(Object.keys(req.query).length)throw new DocumentWriteError('Invalid delete request');
   await deleteV2Document(db,res.locals.principal as AppPrincipal,String(req.params.id),req.body);res.status(204).end();
  }catch(e){sendError(res,e);}
 });
 return router;
}
