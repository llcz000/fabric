import type {Request,Response,NextFunction,RequestHandler} from 'express';
import {resolvePrincipalFromToken} from './sessions';
import {canReadOrder,canManageOrder,canManageProducts,canCreateOwnOrder,
 canImportFabricOverwrite,canExportProducts,canAdminManualOrder,canManageMembers} from './policy';
import type {AppPrincipal} from './types';

export interface AccessDatabase {
  query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>;
}

/** Only an exact bearer token is accepted. Never use client-supplied user ids. */
export function bearerToken(req:Request):string|null {
  const header=req.headers.authorization;
  const match=typeof header==='string'? /^Bearer ([a-f0-9]{64})$/.exec(header):null;
  return match?.[1]??null;
}

export const requireV2Principal=(database:AccessDatabase):RequestHandler=>{
  return async (req:Request,res:Response,next:NextFunction)=>{
    const token=bearerToken(req);
    if(!token) {res.status(401).json({error:'Unauthorized'});return;}
    try{
      const actor=await resolvePrincipalFromToken(database,token);
      if(!actor){res.status(401).json({error:'Unauthorized'});return;}
      res.locals.principal=actor;
      next();
    }catch{
      res.status(503).json({error:'Authentication temporarily unavailable'});
    }
  };
};
export type V2Action='products.read'|'products.manage'|'orders.create_own'|
  'fabrics.import_overwrite'|'products.export'|'orders.manual'|'members.manage';

function permitted(actor:AppPrincipal,action:V2Action):boolean {
  switch(action) {
    case 'products.read':return true;
    case 'products.manage':return canManageProducts(actor);
    case 'orders.create_own':return canCreateOwnOrder(actor);
    case 'fabrics.import_overwrite':return canImportFabricOverwrite(actor);
    case 'products.export':return canExportProducts(actor);
    case 'orders.manual':return canAdminManualOrder(actor);
    case 'members.manage':return canManageMembers(actor);
  }
}

/** Apply only AFTER requireV2Principal, never to legacy routes without it. */
export const requireV2Action=(action:V2Action):RequestHandler=>(_req,res,next)=>{
  const principal=res.locals.principal as AppPrincipal|undefined;
  if(!principal){res.status(401).json({error:'Unauthorized'});return;}
  if(!permitted(principal,action)){res.status(403).json({error:'Forbidden'});return;}
  next();
};

/**
 * For prospective orders with created_by_user_id. Legacy orders currently do
 * not have this column: not mounted on server.ts until safe migration and all
 * order routes are switched together.
 */
export const requireV2OrderAccess=(database:AccessDatabase,operation:'read'|'manage'):RequestHandler=>{
  return async (req,res,next)=>{
    const actor=res.locals.principal as AppPrincipal|undefined;
    if(!actor){res.status(401).json({error:'Unauthorized'});return;}
    const id=String(req.params.id??'');
    if(!/^[1-9][0-9]{0,9}$/.test(id)||Number(id)>2147483647){res.status(404).json({error:'Order not found'});return;}
    try {
      const [rawRows]=await database.query(
        'SELECT id,created_by_user_id FROM orders WHERE id=? LIMIT 1',
        [id]
      );
      const rows=Array.isArray(rawRows)?rawRows as Record<string,unknown>[]:[];
      const record=rows[0];
      if(!record){res.status(404).json({error:'Order not found'});return;}
      const owner=record.created_by_user_id==null?null:String(record.created_by_user_id);
      const order={createdByUserId:owner};
      if(!canReadOrder(actor,order)){res.status(404).json({error:'Order not found'});return;}
      if(operation==='manage'&&!canManageOrder(actor,order)){res.status(403).json({error:'Forbidden'});return;}
      res.locals.orderOwner=owner;
      next();
    }catch {
      // NEVER fall back to all orders / JSON on failed ownership queries.
      res.status(503).json({error:'Order access temporarily unavailable'});
    }
  };
};
