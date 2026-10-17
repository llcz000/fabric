import {Router} from 'express';
import {resolvePatternLinkPresentation,type PatternLinkReadPool,type PatternLinkDecisionVerifier} from './patternLinkStore';
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
   const first=await resolvePatternLinkPresentation(deps.pool,req.params.token,deps.verifyServerDecision);
   if(!first){res.status(404).json({error:'Pattern unavailable'});return;}
   // Never load an unpublished master. Inactive links must still be
   // rechecked after authorization before showing "temporarily unavailable".
   const candidate=first.available?await deps.loadCandidate(first.patternMasterId):null;
   // Suppress previously approved content if the master was disabled during
   // candidate loading. Repeated reads are not an atomic publication snapshot.
   const current=await resolvePatternLinkPresentation(deps.pool,req.params.token,deps.verifyServerDecision);
   if(!current||current.patternMasterId!==first.patternMasterId){
    res.status(404).json({error:'Pattern unavailable'});return;
   }
   if(!first.available||!current.available){
    res.json({available:false,message:'暂不可用'});return;
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
