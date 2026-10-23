import {createV2BusinessRoutes} from '../../server/product-master/v2CatalogAssembly';
import {createV2ProductionHttpApp} from '../../server/product-master/v2ProductionHttp';
import {hashSessionToken} from '../../server/access/password';
import {validateHttpContract} from './core.mjs';
import contract from './http-contract.json';
/** Actual production HTTP composition; fixture authentication only, no real database or business writes. */
export async function checkReleaseHttpContract(input:unknown){
 const c=validateHttpContract(input) as typeof contract,token='e'.repeat(64);
 const database={async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
  if(!sql.trim().startsWith('SELECT')||!sql.includes('s.token_hash'))throw Error('Release contract check attempted a business database operation');
  return [args[0]===hashSessionToken(token)?[{user_id:'1',username:'release-fixture',display_name:'release-fixture',role:'admin',session_id:'1'}]:[],[]];
 }};
 const pool={customerProfilesEnabled:true,async getConnection():Promise<never>{throw Error('Release contract check must not open a real database');}};
 const app=createV2ProductionHttpApp(createV2BusinessRoutes(database,pool),async()=>true),server=app.listen(0,'127.0.0.1');
 try{
  await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const address=server.address();if(!address||typeof address==='string')throw Error('Release loopback listener unavailable');
  const checks:{path:string;status:number}[]=[];
  for(const check of [...c.retiredRoutes.map(r=>({...r,authenticated:true})),...c.anonymousDenied.map(path=>({path,status:401,authenticated:false}))]){
   const res=await fetch('http://127.0.0.1:'+address.port+'/api/v2'+check.path,{headers:check.authenticated?{Authorization:'Bearer '+token}:{},signal:AbortSignal.timeout(5000)});
   await res.text();
   if(res.status!==check.status)throw Error('HTTP contract '+check.path+': actual '+res.status+', expected '+check.status);
   checks.push({path:check.path,status:res.status});
  }
  return {checks,productionModified:false,fixtureIdentityOnly:true};
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
if(process.argv[2]==='--run-release-http-contract')void checkReleaseHttpContract(contract).then(result=>console.log(JSON.stringify(result))).catch(e=>{console.error(e.message);process.exitCode=1;});
