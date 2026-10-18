import {Router,json,type RequestHandler,type ErrorRequestHandler} from 'express';
import type {AppPrincipal} from '../access/types';
import type {SamplePool} from './scanRepository';
import {createSampleSession,listSampleSessions,readShipmentProgress,changeSampleSessionStatus} from './sessionDirectory';
import {SampleSessionManualError} from './sessionManual';
export function createSampleSessionDirectoryRouter(authenticate:RequestHandler,pool:SamplePool):Router{
 const router=Router();router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 router.patch('/sessions/:sessionId/status',authenticate,json({strict:true,limit:'8kb'}),async(req,res)=>{
  if(Object.keys(req.query).length||!req.is('application/json')){res.status(400).json({error:'Invalid selection request'});return;}
  try{res.json(await changeSampleSessionStatus(pool,res.locals.principal as AppPrincipal,String(req.params.sessionId),req.body));}catch(error){failure(res,error);}
 });
 router.get('/sessions',authenticate,async(req,res)=>{
  const query=req.query;
  if(Object.keys(query).some(k=>!['query','limit','offset'].includes(k))||Object.values(query).some(x=>typeof x!=='string')||
    [query.limit,query.offset].some(x=>x!==undefined&&!/^(0|[1-9]\d*)$/.test(String(x)))){res.status(400).json({error:'Invalid selection query'});return;}
  try{res.json(await listSampleSessions(pool,res.locals.principal as AppPrincipal,{query:query.query as string|undefined,limit:query.limit===undefined?20:Number(query.limit),offset:query.offset===undefined?0:Number(query.offset)}));}catch(error){failure(res,error);}
 });
 router.post('/sessions',authenticate,json({strict:true,limit:'8kb'}),async(req,res)=>{
  if(Object.keys(req.query).length||!req.is('application/json')){res.status(400).json({error:'Invalid selection request'});return;}
  try{res.status(201).json(await createSampleSession(pool,res.locals.principal as AppPrincipal,req.body));}catch(error){failure(res,error);}
 });
 router.get('/sessions/:sessionId/progress',authenticate,async(req,res)=>{
  if(Object.keys(req.query).length){res.status(400).json({error:'Invalid selection query'});return;}
  try{res.json(await readShipmentProgress(pool,res.locals.principal as AppPrincipal,String(req.params.sessionId)));}catch(error){failure(res,error);}
 });
 const errors:ErrorRequestHandler=(error,_req,res,_next)=>{const status=(error as {status?:unknown})?.status;res.status(status===413?413:400).json({error:'Invalid selection request'});};
 router.use(errors);return router;
}
function failure(res:import('express').Response,error:unknown){
 const status=error instanceof SampleSessionManualError?error.status:503;
 res.status(status).json({error:status===400?'Invalid selection request':status===403?'Forbidden':status===404?'Selection unavailable':status===409?'Selection conflict':'Selection temporarily unavailable'});
}
