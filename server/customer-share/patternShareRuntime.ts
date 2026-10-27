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
import {verifyProductLinkRuntimeSchema} from './productLinkSchemaContract';
import {createProductShareIssueRouter,createPublicProductRouter} from './productSharing';
import {verifyCardLinkRuntimeSchema} from './cardLinkSchemaContract';
import {createCardShareIssueRouter} from './cardSharing';
import {loadCardShareCatalog} from './cardShareCatalog';
import {createPublicCardRouter} from './cardPublicRoutes';
import {resolveSampleCardToken} from '../customer-samples/cardLibrary';
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
 const privateRouter=createPatternShareIssueRouter({authDb:database,pool,secret,publicBase:config.publicOrigin});
 // Additive rollout: a missing/unverified product mapping disables only the new
 // feature. Existing issued pattern links continue to work. No runtime DDL.
 let productsEnabled=false;
 try{await verifyProductLinkRuntimeSchema(pool,target);productsEnabled=true;}catch{/* fail closed until operator migration and metadata acceptance */}
 if(productsEnabled)privateRouter.use(createProductShareIssueRouter({authDb:database,pool,secret,publicBase:config.publicOrigin}));
 const productPublicRouter=productsEnabled?createPublicProductRouter({db:database,load:(masterId,productId)=>loadPatternShareCatalog(database,masterId,secret,productId),readDisplay:id=>service.readContent(id,'display','public-product-display')}):null;
 let cardsEnabled=false;
 try{await verifyCardLinkRuntimeSchema(pool,target);cardsEnabled=true;}catch{/* only new card sharing is unavailable until its additive table is verified */}
 if(cardsEnabled)privateRouter.use(createCardShareIssueRouter({authDb:database,pool,secret,publicBase:config.publicOrigin}));
 const cardPublicDeps={db:database,load:(share:import('./cardSharing').CardShare)=>loadCardShareCatalog(database,share,secret),readDisplay:(id:string)=>service.readContent(id,'display','public-card-display')};
 const cardPublicRouter=cardsEnabled?createPublicCardRouter(cardPublicDeps):null;
 // Physical QR possession permits only the whitelisted public card projection, not any internal operation.
 const cardScanPublicRouter=cardsEnabled?createPublicCardRouter({...cardPublicDeps,resolve:async token=>{
  try{const c=await resolveSampleCardToken(database,token);return {cardId:c.id,masterId:c.masterId,fabricId:c.fabricId,cardNo:c.cardNo,available:c.isActive};}
  catch{return null;}
 }}):null;
 return {publicRouter,privateRouter,productPublicRouter,productsEnabled,cardPublicRouter,cardScanPublicRouter,cardsEnabled};
}
