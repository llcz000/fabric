import type {AccessDatabase} from '../server/access/middleware';
import type {Pool,TxConn} from '../server/order-v2/lines';

/** P7-4f test-only adapter for a verified EMPTY remote MySQL 8 sandbox.
 * The remote connector is the P7-4d SSH mysql SELECT-only client.
 * No general SQL formatting, transaction implementation or user identity
 * injection: unknown SQL/identities fail closed.
 */
const TARGET='fabric_v2_test_20261012_p6documents';
const IDENTITY='SELECT DATABASE() AS database_name, @@server_uuid AS server_uuid';
const SESSION=`SELECT u.id AS user_id,u.username,u.display_name,u.role,
 u.can_manage_own_orders,u.can_manage_products,s.id AS session_id
 FROM v2_access_sessions s
 JOIN v2_access_users u ON u.id=s.user_id
 WHERE s.token_hash=? AND s.revoked_at IS NULL
 AND s.expires_at > UTC_TIMESTAMP() AND u.is_active=1 LIMIT 1`;
const LOGIN='SELECT id,password_hash,is_active FROM v2_access_users WHERE username_normalized=? LIMIT 1';
const normalize=(sql:string)=>sql.replace(/\s+/g,' ').trim();
const SESSION_SQL=normalize(SESSION);
const errors=()=>new Error('P7 readonly connection allows only approved SELECT');
function oneIdentity(raw:unknown):{database_name:string;server_uuid:string}{
 if(!Array.isArray(raw)||raw.length!==1||typeof raw[0]!=='string')
  throw Error('P7 database identity unavailable');
 const values=raw[0].split('\t');
 if(values.length!==2||values[0]!==TARGET||!values[1]||values[1].length<8)
  throw Error('P7 database target or identity mismatch');
 return {database_name:values[0],server_uuid:values[1]};
}
export function createP7ReadonlyHttpPool(execute:(sql:string)=>Promise<string[]>):{
 database:AccessDatabase;pool:Pool;stats:()=>{writes:number;released:number;selects:number}
}{
 let selects=0,released=0;
 const query:AccessDatabase['query']=async(sql,params=[])=>{
  if(typeof sql!=='string'||!Array.isArray(params))throw errors();
  if(sql===IDENTITY&&params.length===0){
   selects++;
   return [[oneIdentity(await execute('SELECT DATABASE(), @@server_uuid'))],[]];
  }
  const clean=normalize(sql);
  let parameter:string;
  if(clean===SESSION_SQL&&params.length===1&&
     typeof params[0]==='string'&&/^[0-9a-f]{64}$/.test(params[0])){
   parameter=params[0];
  }else if(clean===LOGIN&&params.length===1&&params[0]==='p7readonlyabsent'){
   parameter='p7readonlyabsent';
  }else throw errors();

  // Only the fixed SQL templates above and restrictive ASCII parameter sets
  // can reach the SSH shell. No arbitrary query fragments or user-supplied
  // shell metacharacters, semicolons, dollar signs, backticks or newlines.
  const remoteSql=clean.replace('?',String.fromCharCode(39)+parameter+String.fromCharCode(39));
  if(!remoteSql.startsWith('SELECT ')||/[;$\x60\r\n]/.test(remoteSql)||remoteSql.includes('--'))
   throw errors();
  selects++;
  const result=await execute(remoteSql);
  if(!Array.isArray(result)||result.length!==0)
   throw Error('P7 readonly empty-sandbox credentials changed');
  return [[],[]];
 };
 const rejectWrite=async():Promise<void>=>{throw Error('P7 readonly transaction forbidden');};
 const pool:Pool={async getConnection():Promise<TxConn>{
  return {query,beginTransaction:rejectWrite,commit:rejectWrite,rollback:rejectWrite,release(){released++;}};
 }};
 return {database:{query},pool,stats:()=>({writes:0,released,selects})};
}
