import express,{Router} from 'express';
import path from 'node:path';
import mysql from 'mysql2/promise';
import {z} from 'zod';
import {createV2BusinessRoutes} from './v2CatalogAssembly';
import {createPinnedV2Database,resolveV2ProductionTarget,type V2ProductionTarget} from './v2ProductionTarget';
import {verifyV2ProductionSchema} from './v2ProductionMigration';
import {verifyV2DocumentSupportSchema} from '../order-v2/documentSupportSchema';
import {createV2ProductionHttpApp} from './v2ProductionHttp';
import {requireV2Principal} from '../access/middleware';
import type {AppPrincipal} from '../access/types';
import type {Pool} from '../order-v2/lines';
import {createImageAssetRuntime} from '../image-assets/runtime';
import {startV2ImageProcessor} from './v2ImageProcessor';
import {createImageAssetRouter} from '../image-assets/routes';
import {createCompanyImageRouter,describeCompanyImages,readCompanyImageForExport,omitCompanyLegacyImageValues,type CompanyImageRuntime} from '../image-assets/companyImages';
import type {V2DocumentOutputDependencies} from '../order-v2/documentRoutes';
import {readLegacyImage} from '../image-assets/legacySource';
import {getAssetPolicy} from '../image-assets/policy';
import COS from 'cos-nodejs-sdk-v5';
import {CosStorageAdapter,type CosSdkBoundary} from '../image-assets/cosStorage';
import {createSampleFulfillmentRouter} from '../customer-samples/fulfillmentRoutes';
import {createV2InventoryRouter} from './v2Inventory';
import {createFrontendStaticRouter} from '../frontendStatic';
import {companyExportImage} from '../order-v2/companyExportImage';

export async function createV2ProductionRouter(pool:Pool,target:V2ProductionTarget,output?:V2DocumentOutputDependencies){
 const db=createPinnedV2Database(pool,target);
 // This is SELECT only. No bootstrap, automatic ALTER, guessed owner or JSON fallback.
 await verifyV2ProductionSchema(db,target.database);
 await verifyV2DocumentSupportSchema(db);
 const routes=createV2BusinessRoutes(db,db,output);
 routes.use('/customer-samples',createSampleFulfillmentRouter(requireV2Principal(db),db));
 return {routes,db};
}

export async function startV2ProductionServer(){
 const target=resolveV2ProductionTarget(process.env);if(!target)throw Error('V2 production target required');
 if(process.env.ASSET_STORAGE_PROVIDER!=='cos'||process.env.IMAGE_ASSETS_ENABLED!=='true')throw Error('V2 production requires configured private COS');
 const pool=mysql.createPool({host:process.env.DB_HOST??'localhost',port:Number(process.env.DB_PORT??3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:target.database,connectionLimit:10,
  dateStrings:true,supportBigNumbers:true,bigNumberStrings:true});
 try{
  const {routes,db}=await createV2ProductionRouter(pool,target,{
   loadCurrentCompany:()=>loadCompany(),
   async loadImages(current){
    const descriptions=await describeCompanyImages(current,companyRuntime),images:NonNullable<import('../documentExcel').DocumentWorkbookInput['images']>={};
    for(const role of ['brand_logo','wechat_qr','alipay_qr'] as const){
     if(!descriptions[role])continue;const image=await readCompanyImageForExport(current,companyRuntime,role);
     if(!image)throw Error('Current company image unavailable');images[role]=await companyExportImage(image);
    }
    return images;
   }
  });
  const assets=createImageAssetRuntime({env:{...process.env,COMPANY_IMAGE_ASSETS_ENABLED:'true',PRODUCT_IMAGE_ASSETS_ENABLED:'true'},mysqlPool:db});
  if(!assets.service||!assets.worker)throw Error('V2 media unavailable');
  const extras=Router(),authenticate=requireV2Principal(db);
  extras.use('/api/image-assets',authenticate,createImageAssetRouter(assets,(_req,res)=>'v2:'+(res.locals.principal as AppPrincipal).userId));
  const loadCompany=async()=>{
   const [data]=await db.query('SELECT * FROM company_config WHERE id=1 LIMIT 1');
   if(!Array.isArray(data)||data.length!==1)throw Error('Current company settings unavailable');
   return data[0] as Record<string,unknown>;
  };
  const companyRuntime:CompanyImageRuntime={enabled:true,service:assets.service,
   async findAssociation(role){const [data]=await db.query('SELECT asset_id FROM company_image_assets WHERE company_id=1 AND role=?',[role]);return Array.isArray(data)&&data[0]?String(data[0].asset_id):null;},
   getCompany:loadCompany,
   readLegacy:source=>readLegacyImage(source,{maxBytes:getAssetPolicy('company_logo').maxBytes,localRoot:path.join(process.cwd(),'uploads'),
    cos:{config:{bucket:process.env.COS_BUCKET!,region:process.env.COS_REGION!},storage:new CosStorageAdapter({bucket:process.env.COS_BUCKET!,region:process.env.COS_REGION!},new COS({SecretId:process.env.COS_SECRET_ID!,SecretKey:process.env.COS_SECRET_KEY!}) as unknown as CosSdkBoundary)}})
  };
  const company=Router();company.use(authenticate);
  company.use('/images',createCompanyImageRouter(companyRuntime));
  company.get('/',async(_req,res)=>{
   try{const values=await loadCompany();res.set('Cache-Control','no-store').json({...values,images:await describeCompanyImages(values,companyRuntime)});}
   catch{res.status(503).json({error:'Current company settings unavailable'});}
  });
  const companyFields=z.object({company_name:z.string().min(1).max(100),brand_name:z.string().max(50),address:z.string().max(200),phone:z.string().max(20),default_terms:z.string().max(16000),deposit_terms:z.string().max(16000),issuer_label:z.string().min(1).max(100),receiver_label:z.string().min(1).max(100)}).strict();
  company.post('/',express.json({limit:'64kb'}),async(req,res)=>{
   const parsed=companyFields.safeParse(omitCompanyLegacyImageValues(req.body,true));
   if(!parsed.success){res.status(400).json({error:'Invalid company configuration'});return;}
   try{const v=parsed.data;await db.query('UPDATE company_config SET company_name=?,brand_name=?,address=?,phone=?,default_terms=?,deposit_terms=?,issuer_label=?,receiver_label=? WHERE id=1',[v.company_name,v.brand_name,v.address,v.phone,v.default_terms,v.deposit_terms,v.issuer_label,v.receiver_label]);res.json({success:true});}
   catch{res.status(503).json({error:'Company settings unavailable'});}
  });
  extras.use('/api/company',company);
  extras.use('/api/inventory',createV2InventoryRouter(db));
  const app=createV2ProductionHttpApp(routes,async()=>{await db.query('SELECT 1');return true;},extras);
  app.use(createFrontendStaticRouter(path.join(process.cwd(),'dist')));
  app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
   if(res.headersSent){res.end();return;}
   const status=error&&typeof error==='object'?(error as {status?:unknown}).status:undefined;
   res.status(status===400?400:status===413?413:503).json({error:'V2 request unavailable'});
  });
  const server=app.listen(Number(process.env.PORT??3000),process.env.HOST??'127.0.0.1');
  await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const stopWorker=startV2ImageProcessor(assets.worker);
  let closing=false;const stop=()=>{if(closing)return;closing=true;stopWorker();server.close(()=>void pool.end());};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  console.log('[V2] Production runtime ready; MySQL identity/schema verified; legacy APIs disabled');
 }catch{await pool.end();throw Error('V2 production startup refused; verify configuration and schema');}
}
