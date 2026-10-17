import type {RequestHandler} from 'express';

/**
 * Opt-in fail-closed API namespace cutover. Legacy is the default while the
 * old app and its order schema must continue running. In deny_legacy mode,
 * requests cannot reach ANY old /api, static upload, import/export, image,
 * company, inventory, or order handler (including old /api/login).
 *
 * No permission can be inferred from a legacy global admin token. Future
 * V2 routers must verify independent per-user sessions for every request.
 */
export type LegacyCutoverMode='legacy'|'deny_legacy';
export function resolveLegacyCutoverMode(value:string|undefined):LegacyCutoverMode{
 if(value===undefined||value==='legacy')return 'legacy';
 if(value==='deny_legacy')return 'deny_legacy';
 throw new Error('Invalid legacy cutover mode; expected legacy or deny_legacy');
}
function isAllowedInCutover(rawUrl:string,method:string):boolean {
 if(!rawUrl.startsWith('/'))return false;
 const path=rawUrl.split('?',1)[0];
 // Do not normalize untrusted encoded/traversal paths. Allow only plain,
 // explicitly selected V2/health paths and immutable frontend assets.
 if(path.includes('\\')||path.includes('%')||path.includes('//')||
  path.split('/').some(segment=>segment==='.'||segment==='..'))return false;
 if(path==='/api/health')return method==='GET'||method==='HEAD';
 if(/^\/api\/v2(?:\/[A-Za-z0-9_.-]+)*\/?$/.test(path))return true;
 if(method!=='GET'&&method!=='HEAD')return false;
 return path==='/'||path==='/index.html'||path==='/favicon.ico'||
  /^\/assets\/[A-Za-z0-9_.-]+$/.test(path);
}
export function createLegacyCutoverGuard(mode:LegacyCutoverMode):RequestHandler{
 if(mode==='legacy')return (_req,_res,next)=>next();
 if(mode!=='deny_legacy')throw Error('Invalid legacy cutover mode');
 return (req,res,next)=>{
  if(isAllowedInCutover(req.originalUrl,req.method)){next();return;}
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.status(410).json({error:'Legacy endpoint disabled during V2 cutover'});
 };
}
