import type {Pool} from '../order-v2/lines';
export interface V2ProductionTarget{readonly database:string;readonly serverUuid:string}
/** Explicit independently pinned deployment settings; no auto-discovery or JSON fallback. */
export function resolveV2ProductionTarget(env:Record<string,string|undefined>):V2ProductionTarget|null{
 if(env.FABRIC_V2_RUNTIME===undefined||env.FABRIC_V2_RUNTIME==='legacy')return null;
 if(env.FABRIC_V2_RUNTIME!=='production'||env.FABRIC_V2_LEGACY_ROUTE_MODE!=='deny_legacy'||
  !env.FABRIC_V2_EXPECTED_DATABASE||!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(env.FABRIC_V2_EXPECTED_DATABASE)||
  env.DB_DATABASE!==env.FABRIC_V2_EXPECTED_DATABASE||
  !env.FABRIC_V2_EXPECTED_UUID||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(env.FABRIC_V2_EXPECTED_UUID)||
  env.FABRIC_V2_EXPECTED_UUID==='00000000-0000-0000-0000-000000000000')throw Error('V2 production configuration invalid');
 return Object.freeze({database:env.FABRIC_V2_EXPECTED_DATABASE,serverUuid:env.FABRIC_V2_EXPECTED_UUID});
}
export function createPinnedV2Database(pool:Pool,target:V2ProductionTarget){
 const checked:Pool={async getConnection(){
  let connection:Awaited<ReturnType<Pool['getConnection']>>|undefined;
  try{
   connection=await pool.getConnection();
   const [rows]=await connection.query('SELECT DATABASE() AS database_name, @@server_uuid AS server_uuid');
   if(!Array.isArray(rows)||rows.length!==1||rows[0]?.database_name!==target.database||rows[0]?.server_uuid!==target.serverUuid)
    throw Error('Target mismatch');
   return connection;
  }catch{try{connection?.release();}catch{}throw Error('V2 storage unavailable');}
 }};
 return {...checked,async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  const connection=await checked.getConnection();
  try{return await connection.query(sql,params);}finally{connection.release();}
 }};
}
