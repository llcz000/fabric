/** Explicit opt-in standalone sandbox-only V2 HTTP server.
 * COMMAND IS NOT RUN AS PART OF TESTS OR DEFAULT DEV SERVER.
 * Start only after operator authorizes sandbox DB test writes:
 * npx tsx scripts/run-v2-phase1-business-preview.ts
 * Env: NODE_ENV=development HOST=127.0.0.1 PORT=3456,
 * FABRIC_V2_SANDBOX_PREVIEW=I_ACKNOWLEDGE_SANDBOX,
 * FABRIC_V2_SANDBOX_DATABASE, FABRIC_V2_SANDBOX_EXPECTED_UUID,
 * DB_HOST=127.0.0.1 DB_PORT DB_DATABASE(=sandbox) DB_USER DB_PASSWORD.
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import type {AccessDatabase} from '../server/access/middleware';
import type {Pool} from '../server/order-v2/lines';
import {createV2Phase1BusinessPreviewApp,resolveV2Phase1BusinessPreviewConfig} from '../server/product-master/v2Phase1BusinessPreview';

dotenv.config();
async function start(){
 // Strict validation happens BEFORE creating a database pool or network socket.
 const config=resolveV2Phase1BusinessPreviewConfig(process.env);
 const mysqlPool=mysql.createPool({
  host:config.dbHost,port:config.dbPort,user:config.dbUser,
  password:process.env.DB_PASSWORD!,database:config.database,
  dateStrings:true,connectionLimit:5,
  // No legacy schema initialization and no on-error JSON fallback.
 });
 const database:AccessDatabase={
  async query(sql,params=[]){return await mysqlPool.query(sql,params) as [unknown,unknown];}
 };
 const txPool:Pool={
  async getConnection(){
   const connection=await mysqlPool.getConnection();
   return {
    query:async(sql,params=[])=>await connection.query(sql,params) as [unknown,unknown],
    beginTransaction:()=>connection.beginTransaction(),
    commit:()=>connection.commit(),
    rollback:()=>connection.rollback(),
    release:()=>connection.release(),
   };
  }
 };
 try{
  const app=await createV2Phase1BusinessPreviewApp(config,database,txPool);
  const server=app.listen(config.listenPort,config.listenHost,()=>{
   console.log('[P4 phase-one-only V2 business sandbox] local-only HTTP ready; NOT production and NOT release-authorized');
  });
  let closing=false;
  const close=()=>{
   if(closing)return;closing=true;
   server.close(async()=>{await mysqlPool.end();});
  };
  process.once('SIGINT',close);
  process.once('SIGTERM',close);
 }catch{
  await mysqlPool.end();
  throw Error('V2 isolated sandbox preview refused; no HTTP listener started');
 }
}
start().catch(error=>{console.error(error.message);process.exitCode=1;});
