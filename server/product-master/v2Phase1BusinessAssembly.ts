/** P4 third-batch phase-one-only V2 writable business API assembly.
 * A reusable route group for localhost/in-memory/isolated DB integration
 * without touching legacy app or the deployed server.ts.
 *
 * Mount only at /api/v2 behind an independently pinned local sandbox.
 * Do not enable it in production until auth, orders, image assets, database
 * migration, rollback plan and approved UI have passed release gates.
 */
import {Router,type ErrorRequestHandler} from 'express';
import type {Pool} from '../order-v2/lines';
import {requireV2Principal,requireV2Action,type AccessDatabase} from '../access/middleware';
import {createV2AccessRouter} from '../access/routes';
import {createPatternMasterRouter} from './patternMastersRoutes';
import {createColorwayIdentityRouter} from './colorwayIdentityRoutes';
import {createSharedTagsRouter} from './sharedTagsRoutes';
import {createFabricRouter} from './fabricsRoutes';
import {createV2ProductsRouter} from './productsV2Routes';
import {createV2ProductSafetyRouter} from './productSafetyRoutes';
import {createV2SelectorRouter} from './selectorRoutes';
import {createV2DocumentRouter} from '../order-v2/documentRoutes';
import {createV2CompanyPrintSettingsRouter} from '../order-v2/companyPrintSettings';
import {createImageAssetRouter,type ImageAssetRouteRuntime} from '../image-assets/routes';
import {createCompanyImageRouter,type CompanyImageRuntime} from '../image-assets/companyImages';

/** Test-only preflight. Confirm the authorization query adapter and transaction
 * pool share one specific MySQL 8 sandbox before the HTTP router is reachable.
 * A single start-up probe is NOT a substitute for pool-wide production
 * attestation, schema verification or migration approval.
 */
const IDENTITY_SQL='SELECT DATABASE() AS database_name, @@server_uuid AS server_uuid';
interface IsolatedAssemblyTarget{database:string;confirmation:string}
type DatabaseIdentity={database_name:string;server_uuid:string};
function parseIdentity(rows:unknown):DatabaseIdentity{
 if(!Array.isArray(rows)||rows.length!==1||!rows[0]||typeof rows[0]!=='object')
  throw new Error('V2 database identity unavailable');
 const row=rows[0] as Record<string,unknown>;
 if(typeof row.database_name!=='string'||!row.database_name ||
    typeof row.server_uuid!=='string'||!row.server_uuid.trim())
  throw new Error('V2 database identity unavailable');
 return {database_name:row.database_name,server_uuid:row.server_uuid};
}
async function inspectIdentity(db:AccessDatabase):Promise<DatabaseIdentity>{
 try{
  const [rows]=await db.query(IDENTITY_SQL);
  return parseIdentity(rows);
 }catch{throw new Error('V2 database identity unavailable');}
}
function requireSandboxOption(options:IsolatedAssemblyTarget|undefined):string{
 if(!options||options.confirmation!=='I_ACKNOWLEDGE_SANDBOX'||
    typeof options.database!=='string'||
    !/^fabric_v2_test_[a-zA-Z0-9_]{1,44}$/.test(options.database))
  throw new Error('V2 isolated sandbox target and confirmation required');
 return options.database;
}
async function requireSameIsolatedStorage(db:AccessDatabase,pool:Pool,options:IsolatedAssemblyTarget):Promise<DatabaseIdentity>{
 const expected=requireSandboxOption(options);
 const auth=await inspectIdentity(db);
 if(auth.database_name!==expected)throw new Error('V2 database target mismatch');
 let connection:Awaited<ReturnType<Pool['getConnection']>>|undefined;
 let matches=false;
 try{
  connection=await pool.getConnection();
  const tx=await inspectIdentity(connection);
  matches=tx.database_name===expected&&tx.server_uuid===auth.server_uuid;
 }catch{
  // Never surface untrusted MySQL connection or adapter diagnostics.
  throw new Error('V2 database identity unavailable');
 }finally{
  connection?.release();
 }
 if(!matches)throw new Error('V2 database instance or target mismatch');
 return auth;
}

/** Every checked-out transaction uses the SAME physical connection for its
 * identity SELECT and later BEGIN/queries. Startup probes alone cannot protect
 * a rebuilt pool connection. Deliberately limited to this isolated V2 router.
 */
function verifiedTransactionPool(pool:Pool,expected:DatabaseIdentity):Pool{
 return {async getConnection(){
  let connection:Awaited<ReturnType<Pool['getConnection']>>|undefined;
  try{
   connection=await pool.getConnection();
   const actual=await inspectIdentity(connection);
   if(actual.database_name!==expected.database_name||actual.server_uuid!==expected.server_uuid)
    throw new Error('V2 transaction connection mismatch');
   return connection;
  }catch{
   try{connection?.release();}catch{/* Never replace the safe error with driver diagnostics. */}
   throw new Error('V2 transaction storage unavailable');
  }
 }};
}

/** Do not leave login, permissions or catalog reads on an independently
 * reconnecting adapter after startup. Each operation is executed through a
 * guarded pool connection, with its identity proven on that same connection.
 * The separate bootstrap adapter is used only for the initial comparison.
 */
function verifiedQueryDatabase(pool:Pool):AccessDatabase{
 return {async query(sql,params){
  const connection=await pool.getConnection();
  try{return await connection.query(sql,params);}finally{connection.release();}
 }};
}

/** V2 user identity is owned exclusively by the access routes.
 * All data routes apply their own fresh Bearer and products.read/manage guards.
 */
export async function createV2Phase1BusinessAssembly(database:AccessDatabase,pool:Pool,options:IsolatedAssemblyTarget&{imageAssets?:ImageAssetRouteRuntime;companyImages?:CompanyImageRuntime}):Promise<Router>{
 const identity=await requireSameIsolatedStorage(database,pool,options);
 const checkedPool=verifiedTransactionPool(pool,identity);
 const checkedDatabase=verifiedQueryDatabase(checkedPool);
 const routes=Router();
 routes.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 routes.use('/access',createV2AccessRouter(checkedDatabase));
 // Media is OPTIONAL until independently approved isolated image runtime.
 routes.get('/media-capabilities',requireV2Principal(checkedDatabase),(_req,res)=>
  res.json({available:Boolean(options.imageAssets?.enabled&&options.imageAssets.service),
   companyImagesAvailable:Boolean(options.companyImages?.enabled&&options.companyImages.service)}));
 if(options.imageAssets?.enabled&&options.imageAssets.service){
  const guard=requireV2Principal(checkedDatabase);
  const write=requireV2Action('products.manage');
  routes.use('/image-assets',guard,(req,res,next)=>{
   if(req.method==='GET'||req.method==='HEAD')return next();
   return write(req,res,next);
  },createImageAssetRouter(options.imageAssets));
 }
 if(options.companyImages?.enabled&&options.companyImages.service){
  const guard=requireV2Principal(checkedDatabase);
  const admin=requireV2Action('members.manage');
  routes.use('/company/images',guard,(req,res,next)=>{
   if(req.method==='GET'||req.method==='HEAD')return next();
   return admin(req,res,next);
  },createCompanyImageRouter(options.companyImages));
 }
 routes.use(createV2CompanyPrintSettingsRouter(checkedDatabase,checkedPool));
 routes.use(createPatternMasterRouter(checkedDatabase,checkedPool));
 routes.use(createColorwayIdentityRouter(checkedDatabase,checkedPool));
 routes.use(createSharedTagsRouter(checkedDatabase,checkedPool));
 routes.use(createFabricRouter(checkedDatabase,checkedPool));
 routes.use(createV2ProductsRouter(checkedDatabase,checkedPool));
 // Explicitly expose safe deactivation without changing the existing DELETE behavior.
 routes.use('/products',createV2ProductSafetyRouter(checkedDatabase,checkedPool));
 // Use the same auth query adapter and transaction pool as the catalog;
 // production target identity must be checked before any future deployment.
 routes.use('/document-products',createV2SelectorRouter(checkedDatabase));
 routes.use(createV2DocumentRouter({query:checkedDatabase.query.bind(checkedDatabase),getConnection:checkedPool.getConnection.bind(checkedPool)},
  {companyImages:options.companyImages,companyPrintLabels:true}));
 /** Catch body-parser errors from auth routes too. Never forward Express's
  * development HTML traces into user-visible API responses. */
 const errors:ErrorRequestHandler=(error,_req,res,_next)=>{
  if(res.headersSent){res.end();return;}
  const status=error&&typeof error==='object'?(error as {status?:unknown}).status:undefined;
  if(status===400){res.status(400).json({error:'Invalid JSON request'});return;}
  if(status===413){res.status(413).json({error:'Request body too large'});return;}
  res.status(503).json({error:'V2 API temporarily unavailable'});
 };
 routes.use(errors);
 return routes;
}
