import {Router,json,type ErrorRequestHandler} from 'express';
import {hashPassword,verifyPassword,hashSessionToken} from './password';
import {createAuthenticatedSession} from './sessions';
import {requireV2Principal,bearerToken,type AccessDatabase} from './middleware';
import type {AppPrincipal} from './types';

/** Optional isolated router; NOT mounted on legacy server.ts. */
export function createV2AccessRouter(database:AccessDatabase):Router {
  const router=Router();
  router.use(json({limit:'16kb'}));
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  // 2026-10-22: user requested unrestricted login retries, with credential checks retained.
  // Fixed dummy record prevents username existence timing feedback.
  const dummyHash=hashPassword('v2-no-user-timing-placeholder');
  router.post('/login',async (req,res)=>{
    const username=req.body?.username,password=req.body?.password;
    if(typeof username!=='string'||typeof password!=='string'
      ||!/^[A-Za-z0-9._]{3,64}$/.test(username)
      ||password.length<8||Buffer.byteLength(password,'utf8')>1024){
      res.status(400).json({error:'Invalid credentials'});return;
    }
    try {
      const normalized=username.toLowerCase();
      const [rawRows]=await database.query(
        'SELECT id,password_hash,is_active FROM v2_access_users WHERE username_normalized=? LIMIT 1',
        [normalized]
      );
      const rows=Array.isArray(rawRows)?rawRows as Record<string,unknown>[]:[];
      const row=rows[0];
      const matches=await verifyPassword(password,row?.password_hash??await dummyHash);
      if(!row||Number(row.is_active)!==1||!matches){
        res.status(401).json({error:'Invalid credentials'});return;
      }
      const issued=await createAuthenticatedSession(database,String(row.id),12*3600);
      res.json(issued);
    }catch{
      res.status(503).json({error:'Login temporarily unavailable'});
    }
  });
  router.get('/me',requireV2Principal(database),(_req,res)=>{
    const actor=res.locals.principal as AppPrincipal;
    res.json({id:actor.userId,username:actor.username,displayName:actor.displayName,
      role:actor.role});
  });
  router.post('/logout',requireV2Principal(database),async (req,res)=>{
    const token=bearerToken(req);
    if(!token){res.status(401).json({error:'Unauthorized'});return;}
    try{
      await database.query(
        'UPDATE v2_access_sessions SET revoked_at=UTC_TIMESTAMP() WHERE token_hash=? AND revoked_at IS NULL',
        [hashSessionToken(token)]
      );
      res.json({success:true});
    }catch {res.status(503).json({error:'Logout temporarily unavailable'});}
  });
  /** Standalone route security: parser failures must never fall through to
   * Express's default development HTML error page or expose raw input. */
  const parseError:ErrorRequestHandler=(error,_req,res,_next)=>{
    const status=error&&typeof error==='object'?(error as {status?:unknown}).status:undefined;
    if(status===400){res.status(400).json({error:'Invalid JSON request'});return;}
    if(status===413){res.status(413).json({error:'Request body too large'});return;}
    res.status(503).json({error:'Authentication temporarily unavailable'});
  };
  router.use(parseError);
  return router;
}
