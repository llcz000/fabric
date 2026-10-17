import {Router} from 'express';
import {resolvePatternLink,type PatternLinkReadPool,type PatternLinkDecisionVerifier} from './patternLinkStore';
import {projectPublicPattern,type PatternCandidate} from './publicPatternProjection';

/** B1 isolated public JSON endpoint; deliberately NOT mounted by legacy server.
 * The caller must inject audited server-only adapters for the approved link
 * table, current publication decisions and current trusted catalog candidates.
 * Token possession never grants internal card/sample access. This route
 * cannot serve images: the eventual media gateway must recheck each preview.
 */
export interface PublicPatternDependencies{
 pool:PatternLinkReadPool;
 verifyServerDecision:PatternLinkDecisionVerifier;
 loadCandidate:(patternMasterId:string)=>Promise<PatternCandidate|null>;
}
export function createPublicPatternRouter(deps:PublicPatternDependencies):Router{
 if(!deps||!deps.pool||typeof deps.verifyServerDecision!=='function'||
  typeof deps.loadCandidate!=='function')throw Error('Public pattern adapters required');
 const router=Router();
 router.use((_req,res,next)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
  next();
 });
 router.get('/:token',async(req,res)=>{
  if(Object.keys(req.query).length){res.status(404).json({error:'Pattern unavailable'});return;}
  try{
   const reference=await resolvePatternLink(deps.pool,req.params.token,deps.verifyServerDecision);
   if(!reference){res.status(404).json({error:'Pattern unavailable'});return;}
   const candidate=await deps.loadCandidate(reference.patternMasterId);
   // Verify BOTH the live link and the publication decision again after
   // loading candidate data. A changed/inactive link must not use stale
   // content from the first lookup. A future real deployment still requires
   // an atomic DB publication/read strategy and separately guarded media.
   const stillValid=await resolvePatternLink(deps.pool,req.params.token,deps.verifyServerDecision);
   if(!stillValid||stillValid.patternMasterId!==reference.patternMasterId){
    res.status(404).json({error:'Pattern unavailable'});return;
   }
   const pattern=candidate?projectPublicPattern(candidate):null;
   if(!pattern||!pattern.colorways.length){
    res.json({available:false,message:'暂不可用'});return;
   }
   res.json({available:true,pattern});
  }catch{
   res.status(404).json({error:'Pattern unavailable'});
  }
 });
 return router;
}
