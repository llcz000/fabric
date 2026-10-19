import {Router} from 'express';
import type {AccessDatabase} from '../access/middleware';
import type {Pool} from '../order-v2/lines';
import type {ImageAssetService} from '../image-assets/service';
import type {V2ProductionTarget} from '../product-master/v2ProductionTarget';
import {resolvePatternShareRuntimeConfig,readPatternShareKey} from './patternShareRuntimeConfig';
import {verifyPatternLinkRuntimeSchema} from './patternLinkSchemaContract';
import {createPatternShareIssueRouter} from './patternLinkIssueRoutes';
import {createPublicPatternRouter} from './publicPatternRoutes';
import {createPublicPatternMediaRouter} from './publicPatternMedia';
import {loadPatternShareCatalog} from './patternShareCatalog';
import type {PatternLinkDecisionVerifier} from './patternLinkStore';
/** Caller supplies ONLY the already pinned database and private asset service. */
export async function createPatternShareRuntime(database:AccessDatabase,pool:Pool,target:V2ProductionTarget,service:ImageAssetService,env:NodeJS.ProcessEnv){
 const config=resolvePatternShareRuntimeConfig(env);if(!config)return null;
 const secret=await readPatternShareKey(config);await verifyPatternLinkRuntimeSchema(pool,target);
 const verifyServerDecision:PatternLinkDecisionVerifier=async({patternMasterId})=>{
  const [raw]=await database.query("SELECT m.is_active FROM pattern_share_links l JOIN pattern_masters m ON m.id=l.master_id WHERE l.master_id=? AND l.status='active' AND l.revoked_at IS NULL LIMIT 2",[patternMasterId]);
  if(!Array.isArray(raw)||raw.length!==1||raw[0].is_active!==0&&raw[0].is_active!==1)return null;
  return raw[0].is_active===1?{authorizationVerified:true,publicationVerified:true}:{authorizationVerified:true,publicationVerified:false,unavailableVerified:true};
 };
 const load=(masterId:string)=>loadPatternShareCatalog(database,masterId,secret);
 const publicRouter=Router();
 publicRouter.use(createPublicPatternMediaRouter({pool:database,verifyServerDecision,loadPreviews:async id=>(await load(id))?.previews??new Map(),readDisplay:id=>service.readContent(id,'display','public-pattern-display')}));
 publicRouter.use(createPublicPatternRouter({pool:database,verifyServerDecision,loadCandidate:async id=>(await load(id))?.candidate??null}));
 return {publicRouter,privateRouter:createPatternShareIssueRouter({authDb:database,pool,secret,publicBase:config.publicOrigin})};
}
