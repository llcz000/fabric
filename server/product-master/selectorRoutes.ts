import {Router} from 'express';
import {requireV2Principal,requireV2Action,type AccessDatabase} from '../access/middleware';
import {parseSelectorQuery,searchSelectableProducts,type SelectorDb} from './selector';

/** Given explicitly authorized image IDs, return server-signed thumbnail URLs. */
export type SelectorThumbnailSigner=(ids:string[])=>Promise<Map<string,string>>;

/**
 * Isolated V2 API, NOT mounted on legacy server.ts. Consumer mount example:
 * app.use('/api/v2/document-products',createV2SelectorRouter(database,signer));
 * GET /selector?... requires a real currently active bearer principal plus
 * orders.create_own (admin or an appropriately granted salesperson).
 */
export function createV2SelectorRouter(
 db:AccessDatabase&SelectorDb,signThumbnails?:SelectorThumbnailSigner
):Router{
 const router=Router();
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 router.get('/selector',requireV2Principal(db),requireV2Action('orders.create_own'),async(req,res)=>{
  try{
   const query=parseSelectorQuery(req.query as Record<string,unknown>);
   const result=await searchSelectableProducts(db,query);
   const ids=[...new Set(result.items.map(item=>item.patternImageAssetId).filter((x):x is string=>!!x))];
   const signed=ids.length&&signThumbnails?await signThumbnails(ids):new Map<string,string>();
   res.json({...result,items:result.items.map(item=>({
    ...item,thumbnailUrl:item.patternImageAssetId?signed.get(item.patternImageAssetId)??null:null
   }))});
  }catch(error){
   if(error instanceof Error&&'status' in error&&(error as {status:unknown}).status===400){
    res.status(400).json({error:'Invalid search parameters'});return;
   }
   res.status(503).json({error:'Product selection temporarily unavailable'});
  }
 });
 return router;
}
