import {Router,json} from 'express';
import rateLimit from 'express-rate-limit';
import {requireV2Principal,requireV2Action,type AccessDatabase} from './middleware';
import {createMember,changeMember,resetMemberPassword,MemberAccessError,type MemberTransactionPool} from './members';
import type {AppPrincipal} from './types';

/**
 * Admin-only optional router, mount beside V2 auth ONLY after safe cutover.
 * Never attaches to legacy server.ts, never accepts actor/role via headers.
 */
export function createV2MemberRouter(database:AccessDatabase,pool:MemberTransactionPool):Router{
 const router=Router();
 router.use(json({limit:'16kb'}));
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 router.use(requireV2Principal(database),requireV2Action('members.manage'));
 const respondError=(res:import('express').Response,error:unknown)=>{
  if(error instanceof MemberAccessError){
   res.status(error.status).json({error:error.message});return;
  }
  res.status(503).json({error:'Members temporarily unavailable'});
 };
 router.get('/members',async (_req,res)=>{
  try{
   const [rows]=await database.query(
    'SELECT id,username,display_name,role,is_active FROM v2_access_users ORDER BY username_normalized ASC'
   );
   if(!Array.isArray(rows))throw Error('Invalid members');
   res.json({members:rows.map(row=>({id:row.id,username:row.username,display_name:row.display_name,role:row.role,is_active:row.is_active}))});
  }catch(error){respondError(res,error);}
 });
 router.post('/members',async (req,res)=>{
  const actor=res.locals.principal as AppPrincipal;
  try{
   const member=await createMember(pool,actor,req.body);
   res.status(201).json(member);
  }catch(error){respondError(res,error);}
 });
 router.patch('/members/:id',async(req,res)=>{
  const actor=res.locals.principal as AppPrincipal;
  try{
   await changeMember(pool,actor,String(req.params.id),req.body);
   res.json({success:true});
  }catch(error){respondError(res,error);}
 });
 const limiter=rateLimit({
  windowMs:15*60*1000,limit:10,
  standardHeaders:'draft-8',legacyHeaders:false,
  message:{error:'Too many password reset attempts'},
 });
 router.post('/members/:id/reset-password',limiter,async(req,res)=>{
  const actor=res.locals.principal as AppPrincipal;
  try{
   if(!req.body||typeof req.body.password!=='string'||
    Object.keys(req.body).some(k=>k!=='password')){
    res.status(400).json({error:'Invalid password'});return;
   }
   await resetMemberPassword(pool,actor,String(req.params.id),req.body.password);
   res.json({success:true});
  }catch(error){respondError(res,error);}
 });
 return router;
}
