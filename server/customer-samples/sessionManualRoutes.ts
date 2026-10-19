import {Router,json,type RequestHandler,type ErrorRequestHandler} from 'express';
import type {AppPrincipal} from '../access/types';
import type {SamplePool} from './scanRepository';
import {addManualSampleItem,SampleSessionManualError} from './sessionManual';
import {parseSelectionCardFilters,searchSelectionCards} from './sessionCardSearch';

/** Private, test-assembly-only manual selection; no public QR or customer endpoint.
 * Both registered roles; SQL rechecks login and explicit session grant.
 */
export function createSampleSessionManualRouter(authenticate:RequestHandler,pool:SamplePool):Router{
 const router=Router();
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 router.get('/sessions/:sessionId/cards',authenticate,async(req,res)=>{
  const actor=res.locals.principal as AppPrincipal|undefined;
  if(!actor){res.status(401).json({error:'Unauthorized'});return;}
  try{res.json(await searchSelectionCards(pool,actor,String(req.params.sessionId),parseSelectionCardFilters(req.query)));}
  catch(error){res.status(error instanceof SampleSessionManualError?error.status:503).json({error:'Card selection unavailable'});}
 });
 router.post('/sessions/:sessionId/items/manual',authenticate,json({strict:true,limit:'256kb'}),async(req,res)=>{
  const actor=res.locals.principal as AppPrincipal|undefined;
  if(!actor){res.status(401).json({error:'Unauthorized'});return;}
  if(actor.role!=='sales'&&actor.role!=='admin'){res.status(403).json({error:'Forbidden'});return;}
  const body=req.body;
  if(Object.keys(req.query).length||!body||typeof body!=='object'||Array.isArray(body)||
   Object.keys(body).some(k=>!['cardId','productIds'].includes(k))||typeof body.cardId!=='string'){
   res.status(400).json({error:'Invalid manual selection'});return;
  }
  try{res.json(await addManualSampleItem(pool,actor,{sessionId:String(req.params.sessionId),cardId:body.cardId,
   ...(Object.hasOwn(body,'productIds')?{productIds:body.productIds}:{})}));}
  catch(error){
   if(error instanceof SampleSessionManualError){
    res.status(error.status).json({error:error.status===400?'Invalid manual selection':
     error.status===403?'Forbidden':error.status===404?'Selection unavailable':'Selection is read-only or unavailable'});
    return;
   }
   res.status(503).json({error:'Selection temporarily unavailable'});
  }
 });
 const safeJsonError:ErrorRequestHandler=(error,_req,res,next)=>{
  if(error&&typeof error==='object'&&('status' in error||'statusCode' in error)){
   res.status(400).json({error:'Invalid manual selection'});return;
  }
  next(error);
 };
 router.use(safeJsonError);
 return router;
}
