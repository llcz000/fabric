/** 2,000 genuine domain-service fixtures on a restored rehearsal DB, never production. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import {performance} from 'node:perf_hooks';
import {createPatternMaster} from '../server/product-master/patternMasters';
import {createColorway} from '../server/product-master/colorwayIdentity';
import {createFabric} from '../server/product-master/fabrics';
import {createV2Product} from '../server/product-master/productsV2';
import {resolvePrincipalFromToken} from '../server/access/sessions';
import {createPinnedV2Database} from '../server/product-master/v2ProductionTarget';
dotenv.config({quiet:true,override:true});
async function main(){
 assert.equal(process.env.FABRIC_V2_QA_ACK,'WRITE_RESTORED_REHEARSAL_ONLY');assert.match(process.env.DB_DATABASE??'',/^fabric_v2_test_release_[a-z0-9]+$/);assert.equal(process.env.DB_DATABASE,process.env.FABRIC_V2_EXPECTED_DATABASE);
 const pool=mysql.createPool({socketPath:'/var/run/mysqld/mysqld.sock',user:'root',database:process.env.DB_DATABASE,dateStrings:true,supportBigNumbers:true,bigNumberStrings:true,connectionLimit:4});
 const db=createPinnedV2Database(pool,{database:process.env.DB_DATABASE!,serverUuid:process.env.FABRIC_V2_EXPECTED_UUID!});
 const base='http://127.0.0.1:3001';
 try{
  const login=await fetch(base+'/api/v2/access/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:process.env.ADMIN_PASSWORD})});assert.equal(login.status,200);const {token}=await login.json() as {token:string},actor=await resolvePrincipalFromToken(db,token);assert(actor);
  const stamp=Date.now().toString(),master=await createPatternMaster(db,actor,{masterNo:'PERF'+stamp}),fabric=await createFabric(db,actor,{fabricNo:'PERFF'+stamp,fabricName:'性能演练',weightValue:120,weightUnit:'gsm',widthValue:150});
  const started=performance.now();
  for(let i=0;i<2000;i++){const color=await createColorway(db,actor,master.id,{remark:'restored performance fixture'});await createV2Product(db,actor,{patternColorwayId:color.id,fabricId:fabric.id});}
  const measurements:Record<string,number[]>={};
  for(const path of ['/api/v2/products?limit=20&offset=0','/api/v2/pattern-catalog?limit=20&offset=0','/api/v2/fabrics/catalog?limit=20&offset=0','/api/v2/documents?limit=20&offset=0','/api/v2/documents/stats']){
   const times:number[]=[];for(let n=0;n<25;n++){const t=performance.now(),res=await fetch(base+path,{headers:{Authorization:'Bearer '+token}});assert.equal(res.status,200,path);await res.json();times.push(performance.now()-t);}measurements[path]=times;
  }
  const metrics=Object.fromEntries(Object.entries(measurements).map(([path,times])=>{times.sort((a,b)=>a-b);return [path,{requests:times.length,p95Ms:Math.round(times[Math.ceil(times.length*.95)-1]*100)/100,maxMs:Math.round(times.at(-1)!*100)/100}];}));
  assert(Object.values(metrics).every(m=>m.p95Ms<=1000),'P95 exceeds one second');
  const result={recordsSeeded:2000,seedMilliseconds:Math.round(performance.now()-started),metrics,measurementBoundary:'real HTTP response plus complete JSON body on remote loopback, actual restored MySQL; excludes WAN/browser rendering',productionDatabaseChanged:false};await writeFile('candidate-performance-qa-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await pool.end();}
}
main().catch(error=>{console.error(JSON.stringify({error:error instanceof Error?error.message:'Performance QA failed'}));process.exitCode=1;});
