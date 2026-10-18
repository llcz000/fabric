import {Router,json,type RequestHandler,type ErrorRequestHandler} from 'express';
import type {AppPrincipal} from '../access/types';
import type {SamplePool} from './scanRepository';
import {removeSampleSessionItem,removeSampleSessionCards,removeSampleSessionItems,SampleSessionRemoveError} from './sessionRemove';

/** Independent, unmounted route. The integration owner must supply
 * requireV2Principal(authDb); the transaction rechecks account/login/grant.
 * Accepts DELETE /sessions/:sessionId/items/:itemId with no mutation payload.
 */
export function createSampleSessionRemoveRouter(authenticate:RequestHandler,pool:SamplePool):Router{
 const router=Router();
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 router.post('/sessions/:sessionId/items/remove',authenticate,json({strict:true,limit:'32kb'}),async(req,res)=>{
  if(!req.is('application/json')||Object.keys(req.query).length||!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length!==1||!('itemIds' in req.body)){res.status(400).json({error:'Invalid item removal'});return;}
  try{res.json(await removeSampleSessionItems(pool,res.locals.principal as AppPrincipal,String(req.params.sessionId),req.body.itemIds));}
  catch(error){res.status(error instanceof SampleSessionRemoveError?error.status:503).json({error:'Selection removal unavailable'});}
 });
 router.post('/sessions/:sessionId/cards/remove',authenticate,json({strict:true,limit:'32kb'}),async(req,res)=>{
  if(!req.is('application/json')||Object.keys(req.query).length||!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length!==1||!('cardIds' in req.body)){res.status(400).json({error:'Invalid card removal'});return;}
  try{res.json(await removeSampleSessionCards(pool,res.locals.principal as AppPrincipal,String(req.params.sessionId),req.body.cardIds));}
  catch(error){res.status(error instanceof SampleSessionRemoveError?error.status:503).json({error:'Selection removal unavailable'});}
 });
 router.delete('/sessions/:sessionId/items/:itemId',authenticate,async(req,res)=>{
  const actor=res.locals.principal as AppPrincipal|undefined;
  if(!actor){res.status(401).json({error:'Unauthorized'});return;}
  if(actor.role!=='sales'&&actor.role!=='admin'){res.status(403).json({error:'Forbidden'});return;}
  // Reject DELETE payloads even without an Express body parser in the assembly.
  const length=req.headers['content-length'];
  const hasBody=(typeof length==='string'&&(!/^\\d+$/.test(length)||Number(length)>0))||
   req.headers['transfer-encoding']!==undefined;
  if(Object.keys(req.query).length||hasBody||req.body!==undefined&&(
   !req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length)){
   res.status(400).json({error:'Invalid selection removal'});return;
  }
  try{res.json(await removeSampleSessionItem(pool,actor,String(req.params.sessionId),String(req.params.itemId)));}
  catch(error){
   if(error instanceof SampleSessionRemoveError){
    res.status(error.status).json({error:error.status===400?'Invalid selection removal':error.status===403?'Forbidden':error.status===404?'Selection unavailable':'Selection is read-only or data conflict'});return;
   }
   res.status(503).json({error:'Selection temporarily unavailable'});
  }
 });
 const errors:ErrorRequestHandler=(error,_req,res,_next)=>{res.status((error as {status?:number})?.status===413?413:400).json({error:'Invalid selection request'});};router.use(errors);return router;
}
