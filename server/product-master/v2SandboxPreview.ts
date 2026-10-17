/** P7: isolated V2 HTTP SANDBOX PREVIEW, never production or legacy App.
 * No old server.ts, legacy MySQL auto-DDL, JSON fallback, legacy tokens, upload
 * route or service account. Does NOT declare phase-one release readiness.
 * Starting it with real sandbox credentials can WRITE to that sandbox through
 * authenticated V2 APIs: do not launch without explicit sandbox authorization.
 */
import express,{type Express} from 'express';
import type {AccessDatabase} from '../access/middleware';
import type {Pool} from '../order-v2/lines';
import {createV2CatalogAssembly} from './v2CatalogAssembly';

const ACK='I_ACKNOWLEDGE_SANDBOX';
const IDENTITY='SELECT DATABASE() AS database_name, @@server_uuid AS server_uuid';
const configs=new WeakSet<object>();
export interface V2SandboxPreviewConfig{
 readonly database:string;
 readonly serverUuid:string;
 readonly listenHost:'127.0.0.1';
 readonly listenPort:number;
 readonly dbHost:'127.0.0.1';
 readonly dbPort:number;
 readonly dbUser:string;
}
type Vars=Record<string,string|undefined>;
const invalid=()=>new Error('V2 sandbox preview configuration or identity invalid');
function port(v:string|undefined,minimum:number):number{
 if(typeof v!=='string'||!/^[1-9][0-9]{0,4}$/.test(v))throw invalid();
 const n=Number(v);
 if(!Number.isSafeInteger(n)||n<minimum||n>65535)return (()=>{throw invalid()})();
 return n;
}
/** Config comes only from explicit environment, never inferred from live DB. */
export function resolveV2SandboxPreviewConfig(env:Vars):V2SandboxPreviewConfig{
 try{
  if(!env||env.FABRIC_V2_SANDBOX_PREVIEW!==ACK||
    env.NODE_ENV!=='development'||env.HOST!=='127.0.0.1'||
    env.DB_HOST!=='127.0.0.1')throw invalid();
  const name=env.FABRIC_V2_SANDBOX_DATABASE;
  if(typeof name!=='string'||name.length>64||
    !/^fabric_v2_test_[a-z0-9]+(?:_[a-z0-9]+)*$/.test(name)||
    /prod/i.test(name)||env.DB_DATABASE!==name)throw invalid();
  const uuid=env.FABRIC_V2_SANDBOX_EXPECTED_UUID;
  if(typeof uuid!=='string'||!/^([0-9a-f]{8}-){1}[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)||
    uuid==='00000000-0000-0000-0000-000000000000')throw invalid();
  if(typeof env.DB_USER!=='string'||!/^[A-Za-z0-9_.-]{3,60}$/.test(env.DB_USER)||
    typeof env.DB_PASSWORD!=='string'||!env.DB_PASSWORD)throw invalid();
  const cfg=Object.freeze({
   database:name,serverUuid:uuid,listenHost:'127.0.0.1' as const,
   listenPort:port(env.PORT,1024),dbHost:'127.0.0.1' as const,
   dbPort:port(env.DB_PORT,1),dbUser:env.DB_USER,
  });
  configs.add(cfg);
  return cfg;
 }catch{throw invalid();}
}
function parseIdentity(rows:unknown){
 if(!Array.isArray(rows)||rows.length!==1||!rows[0]||typeof rows[0]!=='object'||Array.isArray(rows[0]))
  throw invalid();
 const record=rows[0] as Record<string,unknown>;
 if(typeof record.database_name!=='string'||typeof record.server_uuid!=='string')throw invalid();
 return {database:record.database_name,uuid:record.server_uuid};
}
/** Re-probe the ACTUAL read adapter and a physical transaction connection
 * against the independently pinned sandbox UUID before opening HTTP. V2's
 * internal assembly separately verifies both adapters and checks each leased
 * connection again before business SQL. These claims do not prove DB ownership.
 */
export async function createV2SandboxPreviewApp(config:V2SandboxPreviewConfig,
 database:AccessDatabase,pool:Pool):Promise<Express>{
 if(!config||!configs.has(config))throw invalid();
 try{
  const [auth]=await database.query(IDENTITY);
  const identity=parseIdentity(auth);
  if(identity.database!==config.database||identity.uuid!==config.serverUuid)throw invalid();
  const conn=await pool.getConnection();
  try{
   const [rows]=await conn.query(IDENTITY);
   const actual=parseIdentity(rows);
   if(actual.database!==config.database||actual.uuid!==config.serverUuid)throw invalid();
  }finally{conn.release();}
  // Pin EVERY following adapter/connection to the independently supplied
  // UUID. The internal assembly only compares its two adapters to one another;
  // without this wrapper both might silently drift to a different instance.
  const check=(rows:unknown)=>{
   const value=parseIdentity(rows);
   if(value.database!==config.database||value.uuid!==config.serverUuid)throw invalid();
  };
  const pinnedDatabase:AccessDatabase={async query(sql,params=[]){
   const result=await database.query(sql,params);
   if(sql===IDENTITY)check(result[0]);
   return result;
  }};
  const pinnedPool:Pool={async getConnection(){
   const connection=await pool.getConnection();
   try{
    const [rows]=await connection.query(IDENTITY);
    check(rows);
    return connection;
   }catch{
    try{connection.release();}catch{/* Do not leak original database errors */ }
    throw invalid();
   }
  }};
  const routes=await createV2CatalogAssembly(pinnedDatabase,pinnedPool,{
   database:config.database,confirmation:ACK,
  });
  const app=express();
  app.disable('x-powered-by');
  app.get('/health',(_req,res)=>{res.set('Cache-Control','no-store');
   res.json({status:'sandbox-preview',releaseAuthorized:false});});
  app.use('/api/v2',routes);
  app.use((_req,res)=>{res.set('Cache-Control','no-store');
   res.status(404).json({error:'Not found in isolated V2 sandbox preview'});});
  return app;
 }catch{throw invalid();}
}
