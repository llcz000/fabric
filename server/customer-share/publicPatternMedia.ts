import {Router} from 'express';
import {resolvePatternLink,type PatternLinkReadPool,type PatternLinkDecisionVerifier} from './patternLinkStore';
import type {AssetContent} from '../image-assets/service';
export function createPublicPatternMediaRouter(deps:{pool:PatternLinkReadPool;verifyServerDecision:PatternLinkDecisionVerifier;loadPreviews:(masterId:string)=>Promise<Map<string,string>>;readDisplay:(assetId:string)=>Promise<AssetContent>}){
 const router=Router();router.use((_req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});next();});
 router.get('/:token/images/:ref',async(req,res)=>{
  try{
   if(Object.keys(req.query).length||!(/^[A-Za-z0-9_-]{43}$/).test(String(req.params.ref)))throw Error('Unavailable');
   const token=req.params.token,ref='display:'+req.params.ref,link=await resolvePatternLink(deps.pool,token,deps.verifyServerDecision);if(!link)throw Error('Unavailable');
   const asset=(await deps.loadPreviews(link.patternMasterId)).get(ref);if(!asset)throw Error('Unavailable');
   const content=await deps.readDisplay(asset);
   if(!Buffer.isBuffer(content.body)||!content.body.length||content.body.length>5*1024*1024||content.body.length!==content.byteSize||!['image/webp','image/png','image/jpeg'].includes(content.mime))throw Error('Unavailable');
   const current=await resolvePatternLink(deps.pool,token,deps.verifyServerDecision);
   if(!current||current.patternMasterId!==link.patternMasterId||(await deps.loadPreviews(current.patternMasterId)).get(ref)!==asset)throw Error('Unavailable');
   res.type(content.mime).send(content.body);
  }catch{res.status(404).json({error:'Pattern unavailable'});}
 });return router;
}
