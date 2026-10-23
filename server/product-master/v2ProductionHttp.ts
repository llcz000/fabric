import express,{type Router} from 'express';
import rateLimit from 'express-rate-limit';
/** HTTP composition; the startup owner must attest storage before supplying routes. */
export function createV2ProductionHttpApp(routes:Router,probe:()=>Promise<boolean>,extras?:Router){
 const app=express();app.disable('x-powered-by');app.set('trust proxy','loopback');
 app.use((_req,res,next)=>{res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','same-origin');next();});
 app.get('/api/health',async(_req,res)=>{
  let ok=false;try{ok=await probe();}catch{}
  res.set('Cache-Control','no-store');res.status(ok?200:503).json({status:ok?'ok':'unavailable',storage:ok?'mysql':'unavailable',mode:'v2',uptimeSeconds:Math.floor(process.uptime())});
 });
 app.get('/api/runtime',(_req,res)=>{res.set('Cache-Control','no-store').json({mode:'v2'});});
 // Public traffic has its own quota; authenticated business uploads/polling must never lock login or catalogs.
 app.use('/api/public',rateLimit({windowMs:15*60*1000,limit:1000,standardHeaders:'draft-8',legacyHeaders:false}));
 app.use('/api/v2',routes);
 if(extras)app.use(extras);
 app.use('/api',(_req,res)=>{res.set('Cache-Control','no-store');res.status(410).json({error:'Legacy endpoint disabled during V2 cutover'});});
 return app;
}
