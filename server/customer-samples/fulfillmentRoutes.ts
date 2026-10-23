import {Router,json,type RequestHandler,type ErrorRequestHandler} from 'express';
import type {AppPrincipal} from '../access/types';
import type {SamplePool} from './scanRepository';
import {saveShipmentBatch,saveSampleFollowup,SampleFulfillmentError} from './fulfillmentService';
import {readSampleFulfillmentHistory} from './fulfillmentRead';

/** Private, opt-in V2 B3 routes. No legacy/server.ts/public wiring.
 * Authenticate with requireV2Principal before entry; transaction rechecks
 * current role/login/session grant and fresh item state on every write.
 */
export function createSampleFulfillmentRouter(authenticate:RequestHandler,pool:SamplePool):Router{
 const router=Router();
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 const body=json({strict:true,limit:'32kb'});
 for(const [suffix,save] of [
  ['shipments',saveShipmentBatch],
  ['followups',saveSampleFollowup]
 ] as const){
  router.post('/sessions/:sessionId/'+suffix,authenticate,body,async(req,res)=>{
   const actor=res.locals.principal as AppPrincipal|undefined;
   if(!actor){res.status(401).json({error:'Unauthorized'});return;}
   if(actor.role!=='admin'&&actor.role!=='sales'){res.status(403).json({error:'Forbidden'});return;}
   const input=req.body;
   const fields=suffix==='shipments'?['sessionId','shippedAt','carrier','trackingNo','items']:
    ['sessionId','contactedOn','customerConfirmed','feedback','outcome','nextAction','nextFollowupOn','productIds'];
   if(Object.keys(req.query).length||!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(key=>!fields.includes(key))||
    input.sessionId!==String(req.params.sessionId)){
    res.status(400).json({error:'Invalid fulfillment request'});return;
   }
   try{res.status(201).json(await save(pool,actor,input));}
   catch(error){
    if(error instanceof SampleFulfillmentError){
     res.status(error.status).json({error:error.status===400?'Invalid fulfillment request':
      error.status===403?'Forbidden':error.status===404?'Selection unavailable':'Fulfillment conflict'});
    }else res.status(503).json({error:'Fulfillment temporarily unavailable'});
   }
  });
 }
 for(const kind of ['shipments','followups'] as const){
  router.get('/sessions/:sessionId/'+kind,authenticate,async(req,res)=>{
   const actor=res.locals.principal as AppPrincipal|undefined;
   if(!actor){res.status(401).json({error:'Unauthorized'});return;}
   const page=(raw:unknown,otherwise:number)=>{
    if(raw===undefined)return otherwise;
    if(typeof raw!=='string'||!(/^(0|[1-9][0-9]*)$/).test(raw))return null;
    const n=Number(raw);return Number.isSafeInteger(n)?n:null;
   };
   const limit=page(req.query.limit,20),offset=page(req.query.offset,0);
   if(Object.keys(req.query).some(k=>k!=='limit'&&k!=='offset')||limit===null||offset===null){
    res.status(400).json({error:'Invalid fulfillment query'});return;
   }
   try{res.json(await readSampleFulfillmentHistory(pool,actor,String(req.params.sessionId),kind,{limit,offset}));}
   catch(error){
    if(error instanceof SampleFulfillmentError)res.status(error.status).json({error:error.status===400?'Invalid fulfillment query':error.status===403?'Forbidden':error.status===404?'Selection unavailable':'Fulfillment data conflict'});
    else res.status(503).json({error:'Fulfillment temporarily unavailable'});
   }
  });
 }
 const safeJsonError:ErrorRequestHandler=(err,_req,res,next)=>{
  if(err&&typeof err==='object'&&('status' in err||'statusCode' in err)){
   res.status(400).json({error:'Invalid fulfillment request'});return;
  }
  next(err);
 };
 router.use(safeJsonError);
 return router;
}
