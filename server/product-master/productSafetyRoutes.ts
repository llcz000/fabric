import {Router} from 'express';
import type {AccessDatabase} from '../access/middleware';
import {requireV2Principal,requireV2Action} from '../access/middleware';
import type {AppPrincipal} from '../access/types';
import type {Pool} from '../order-v2/lines';
import {deactivateV2Product,deleteUnusedV2Product,ProductMutationError} from './productProtection';

/** Independent V2-only product safety router. Never mounted onto production
 * legacy server.ts before controlled V2 schema/authorization cutover. */
export function createV2ProductSafetyRouter(db:AccessDatabase&Pool):Router;
export function createV2ProductSafetyRouter(db:AccessDatabase,pool:Pool):Router;
export function createV2ProductSafetyRouter(db:AccessDatabase,pool?:Pool):Router{
 // Original callers have one combined database/pool; assembly may inject separately.
 const mutations=pool??(db as AccessDatabase&Pool);
 const router=Router();
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 router.post('/:id/deactivate',requireV2Principal(db),requireV2Action('products.manage'),async(req,res)=>{
  try{
   res.json(await deactivateV2Product(mutations,res.locals.principal as AppPrincipal,String(req.params.id)));
  }catch(error){sendError(res,error);}
 });
 router.delete('/:id',requireV2Principal(db),requireV2Action('products.manage'),async(req,res)=>{
  try{
   res.json(await deleteUnusedV2Product(mutations,res.locals.principal as AppPrincipal,String(req.params.id)));
  }catch(error){sendError(res,error);}
 });
 return router;
}
function sendError(res:import('express').Response,error:unknown):void{
 const status=error instanceof ProductMutationError?error.status:503;
 res.status(status).json({error:status===409?'Product is still referenced':
  status===404?'Product not found':
  status===403?'Insufficient product permissions':
  status===401?'Unauthorized':
  status===400?'Invalid product identifier':'Product operation temporarily unavailable'});
}
