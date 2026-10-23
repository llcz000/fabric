import {Router,json,type ErrorRequestHandler,type RequestHandler,type Response} from 'express';
import {requireV2Principal,type AccessDatabase} from '../access/middleware';
import type {AppPrincipal} from '../access/types';
import type {SampleCard} from './cardLibrary';
import {SampleCardError,createSampleCard,retireSampleCard,confirmSampleCardReprinted,listSampleCards,getSelectedSampleCards,resolveSampleCardToken} from './cardLibrary';
import {formatSampleCardScanUrl} from '../../src/lib/sampleCardScanLink';
import type {SamplePool} from './scanRepository';
import {buildSampleCardsWorkbook} from './cardExcel';

/** Approved 2026-10-14: sample-card management/export belongs to both roles.
 * Does not grant scanning or any customer sample-session access. */
export function canManageSampleCards(actor:AppPrincipal):boolean{
 return actor.role==='admin'||actor.role==='sales';
}
export interface SampleCardListInput{query?:string;limit?:number;offset?:number;needsReprint?:boolean}
export interface SampleCardLibraryDependencies{
 resolve?(token:string):Promise<SampleCard>;
 list(input:SampleCardListInput):Promise<{items:SampleCard[];total:number;limit:number;offset:number}>;
 create(input:{masterId:string;fabricId:string},actor:AppPrincipal):Promise<{card:SampleCard;created:boolean}>;
 retire(identity:string,actor:AppPrincipal):Promise<{id:string;retired:true}>;
 confirmReprinted(identity:string,revision:string,actor:AppPrincipal):Promise<{id:string;reprintRevision:string;needsReprint:false}>;
 selected(ids:string[]):Promise<SampleCard[]>;
}
/** Caller supplies the same verified database source for auth, reads and writes. */
export function createMySQLSampleCardLibraryDependencies(database:AccessDatabase,pool:SamplePool):SampleCardLibraryDependencies{
 return {
  resolve:token=>resolveSampleCardToken(database,token),
  list:input=>listSampleCards(database,input),
  create:(input,actor)=>createSampleCard(pool,actor,input,canManageSampleCards),
  retire:(identity,actor)=>retireSampleCard(pool,actor,identity,canManageSampleCards),
  confirmReprinted:(identity,revision,actor)=>confirmSampleCardReprinted(pool,actor,identity,revision,canManageSampleCards),
  selected:ids=>getSelectedSampleCards(database,ids),
 };
}
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[1-9]\d{0,19}$/.test(v)&&BigInt(v)<=18446744073709551615n;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function createInput(v:unknown):{masterId:string;fabricId:string}|null{
 if(!record(v)||Object.keys(v).length!==2||!validId(v.masterId)||!validId(v.fabricId))return null;
 return {masterId:v.masterId,fabricId:v.fabricId};
}
function selection(v:unknown):string[]|null{
 if(!record(v)||Object.keys(v).length!==1||!Array.isArray(v.cardIds)||v.cardIds.length<1||v.cardIds.length>1000||
 !v.cardIds.every(validId)||new Set(v.cardIds).size!==v.cardIds.length)return null;
 return v.cardIds;
}
function listInput(q:Record<string,unknown>):SampleCardListInput|null{
 if(Object.keys(q).some(k=>!['query','limit','offset','needsReprint'].includes(k)))return null;
 if(q.query!==undefined&&(typeof q.query!=='string'||[...q.query].length>100||/[\p{Cc}\p{Cf}]/u.test(q.query)))return null;
 const number=(v:unknown,defaultValue:number):number|null=>{
  if(v===undefined)return defaultValue;
  if(typeof v!=='string'||!/^(0|[1-9]\d*)$/.test(v))return null;
  const n=Number(v);return Number.isSafeInteger(n)?n:null;
 };
 const limit=number(q.limit,50),offset=number(q.offset,0);
 if(limit===null||limit<1||limit>100||offset===null||offset<0||offset>1000000)return null;
 if(q.needsReprint!==undefined&&q.needsReprint!=='true'&&q.needsReprint!=='false')return null;
 return {query:q.query as string|undefined,limit,offset,needsReprint:q.needsReprint==='true'};
}
export function createSampleCardLibraryRouter(authDb:AccessDatabase,deps:SampleCardLibraryDependencies,scanOrigin=process.env.FABRIC_V2_PUBLIC_ORIGIN):Router{
 const withScanUrl=(card:SampleCard):SampleCard=>scanOrigin?{...card,scanUrl:formatSampleCardScanUrl(scanOrigin,card.qrPayload)}:card;
 const router=Router();
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 const principal=requireV2Principal(authDb);
 const manage:RequestHandler=(_req,res,next)=>{
  const actor=res.locals.principal as AppPrincipal|undefined;
  if(!actor){res.status(401).json({error:'Unauthorized'});return;}
  if(!canManageSampleCards(actor)){res.status(403).json({error:'Forbidden'});return;}
  next();
 };
 const requireJson:RequestHandler=(req,res,next)=>{
  if(!req.is('application/json')){res.status(400).json({error:'JSON content type required'});return;}
  next();
 };
 const parser=json({limit:'64kb'});
 const handle=(res:Response,e:unknown)=>{
  if(e instanceof SampleCardError){
   const status=e.status;
   const message=status===400?'Invalid card request':status===401?'Unauthorized':status===403?'Forbidden':status===404?'Card unavailable':'Card conflict';
   res.status(status).json({error:message});return;
  }
  res.status(503).json({error:'Card library temporarily unavailable'});
 };
 router.get('/',principal,manage,async(req,res)=>{
  const input=listInput(req.query);if(!input){res.status(400).json({error:'Invalid card query'});return;}
   try{const page=await deps.list(input);res.json({...page,items:page.items.map(withScanUrl)});}catch(e){handle(res,e);}
 });
 router.post('/resolve',principal,manage,requireJson,parser,async(req,res)=>{
  if(!record(req.body)||Object.keys(req.body).length!==1||typeof req.body.cardToken!=='string'||!/^[A-Za-z0-9_-]{22,128}$/.test(req.body.cardToken)){
   res.status(400).json({error:'Invalid card request'});return;
  }
  try{if(!deps.resolve)throw Error('Card resolver unavailable');res.json(withScanUrl(await deps.resolve(req.body.cardToken)));}catch(e){handle(res,e);}
 });
 router.post('/',principal,manage,requireJson,parser,async(req,res)=>{
  const input=createInput(req.body);if(!input){res.status(400).json({error:'Invalid card request'});return;}
  try{
   const result=await deps.create(input,res.locals.principal as AppPrincipal);
    res.status(result.created?201:200).json({...result,card:withScanUrl(result.card)});
  }catch(e){handle(res,e);}
 });
 /** Business delete: permanent token revoke and archival; no historical FK deletion. */
 router.delete('/:id',principal,manage,async(req,res)=>{
  const identity=req.params.id;
  if(typeof identity!=='string'||!validId(identity)){res.status(400).json({error:'Invalid card ID'});return;}
  try{res.status(200).json(await deps.retire(identity,res.locals.principal as AppPrincipal));}
  catch(e){handle(res,e);}
 });
 router.post('/:id/confirm-reprinted',principal,manage,requireJson,parser,async(req,res)=>{
  const identity=req.params.id,body=req.body as unknown;
  const revision=body&&typeof body==='object'&&!Array.isArray(body)?
   (body as Record<string,unknown>).expectedRevision:undefined;
  if(typeof identity!=='string'||!validId(identity)||!body||typeof body!=='object'||Array.isArray(body)||
   Object.keys(body).length!==1||typeof revision!=='string'||
   !/^(0|[1-9][0-9]{0,19})$/.test(revision)||BigInt(revision)>18446744073709551615n){
   res.status(400).json({error:'Invalid reprint confirmation'});return;
  }
  try{res.json(await deps.confirmReprinted(identity,revision,res.locals.principal as AppPrincipal));}
  catch(e){handle(res,e);}
 });
 router.post('/export',principal,manage,requireJson,parser,async(req,res)=>{
  const ids=selection(req.body);if(!ids){res.status(400).json({error:'Select valid cards'});return;}
  try{
   const cards=await deps.selected(ids);
   // Defend against an adapter silently enlarging selection or shuffling identity.
   if(cards.length!==ids.length||cards.some((c,i)=>c.id!==ids[i]))
    throw Error('Selection adapter mismatch');
    const bytes=await buildSampleCardsWorkbook(cards,scanOrigin);
   res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
   res.setHeader('Content-Disposition','attachment; filename="sample-cards.xlsx"');
   res.send(bytes);
  }catch(e){handle(res,e);}
 });
 const errors:ErrorRequestHandler=(e,_req,res,_next)=>{
  const status=e&&typeof e==='object'?(e as {status?:unknown}).status:undefined;
  res.status(status===400?400:status===413?413:503).json({
   error:status===400?'Invalid JSON request':status===413?'Request body too large':'Card library temporarily unavailable'
  });
 };
 router.use(errors);
 return router;
}
