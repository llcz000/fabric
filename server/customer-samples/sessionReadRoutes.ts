import {Router} from 'express';
import {requireV2Principal,type AccessDatabase} from '../access/middleware';
import type {AppPrincipal} from '../access/types';
import type {SamplePool} from './scanRepository';
import {readSampleSession,SampleSessionReadError} from './sessionRead';
/** Private admin/sales history endpoint; current account, login and explicit session grant are rechecked in SQL. */
export function createSampleSessionReadRouter(authDb:AccessDatabase,pool:SamplePool):Router{
 const router=Router();
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 router.get('/sessions/:sessionId',requireV2Principal(authDb),async(req,res)=>{
  const actor=res.locals.principal as AppPrincipal;
  if(actor.role!=='sales'&&actor.role!=='admin'){res.status(403).json({error:'Forbidden'});return;}
  const page=(v:unknown,defaultValue:number):number|null=>{
   if(v===undefined)return defaultValue;
   if(typeof v!=='string'||!/^(0|[1-9]\d*)$/.test(v))return null;
   const number=Number(v);return Number.isSafeInteger(number)?number:null;
  };
  const limit=page(req.query.limit,50),offset=page(req.query.offset,0);
  if(Object.keys(req.query).some(k=>k!=='limit'&&k!=='offset')||limit===null||offset===null){
   res.status(400).json({error:'Invalid pagination'});return;
  }
  try{res.json(await readSampleSession(pool,actor,String(req.params.sessionId),{limit,offset}));}
  catch(error){
   if(error instanceof SampleSessionReadError){
    res.status(error.status).json({error:error.status===400?'Invalid selection query':error.status===403?'Forbidden':error.status===404?'Selection unavailable':'Selection data conflict'});return;
   }
   res.status(503).json({error:'Selection temporarily unavailable'});
  }
 });
 return router;
}
