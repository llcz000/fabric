import express from 'express';import mysql from 'mysql2/promise';
import {createV2ProductionRouter} from '../server/product-master/v2ProductionRuntime';
import {createImageAssetRuntime} from '../server/image-assets/runtime';
import {createPatternShareRuntime} from '../server/customer-share/patternShareRuntime';
import {requireV2Principal} from '../server/access/middleware';
import {createFrontendStaticRouter} from '../server/frontendStatic';
import path from 'node:path';
async function main(){
 const database=process.env.DB_DATABASE!;if(!/^fabric_v2_test_productshare_[a-z0-9]+$/.test(database)||process.env.FABRIC_V2_EXPECTED_UUID!=='a937ff09-72b6-11f1-b04e-52540034488b')throw Error('Only the explicit restored sandbox may run this harness');
 const target={database,serverUuid:process.env.FABRIC_V2_EXPECTED_UUID};
 const pool=mysql.createPool({host:'127.0.0.1',user:process.env.DB_USER,password:process.env.DB_PASSWORD,database,supportBigNumbers:true,bigNumberStrings:true,dateStrings:true,connectionLimit:4});
 const {routes,db}=await createV2ProductionRouter(pool,target);
 const assets=createImageAssetRuntime({env:process.env,mysqlPool:db});if(!assets.service)throw Error('Real media service required');
 // Deliberately do not start image workers in a restored production database.
 const sharing=await createPatternShareRuntime(db,db,target,assets.service,process.env);if(!sharing?.productsEnabled||!sharing.productPublicRouter)throw Error('Migrated product share required');
 const app=express();app.get('/api/health',async(_req,res)=>{await db.query('SELECT 1');res.json({status:'ok',storage:'mysql',mode:'v2',testOnly:true});});app.get('/api/runtime',(_req,res)=>res.json({mode:'v2'}));
 routes.get('/pattern-sharing',requireV2Principal(db),(_req,res)=>res.json({enabled:true,productsEnabled:true}));routes.use(sharing.privateRouter);
 app.use('/api/v2',routes);app.use('/api/public/patterns',sharing.publicRouter);app.use('/api/public/products',sharing.productPublicRouter);
 app.use(createFrontendStaticRouter(path.join(process.cwd(),'dist'),{allowPatternShare:true,allowProductShare:true}));
 app.listen(3010,'127.0.0.1',()=>console.log('Restored DB product sharing QA ready; no image worker started'));
}
main().catch(error=>{console.error('Restored DB QA startup refused: '+(error instanceof Error?error.message.slice(0,200):'unknown'));process.exit(1);});
