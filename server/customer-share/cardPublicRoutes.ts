import {Router} from 'express';
import type {AssetContent} from '../image-assets/service';
import {resolveCardShare,cardShareHeaders,type CardShare,type CardShareDb} from './cardSharing';
import type {PublicCard} from './cardShareCatalog';
interface Loaded{card:PublicCard;previews:Map<string,string>}
export function createPublicCardRouter(deps:{db:CardShareDb;load:(share:CardShare)=>Promise<Loaded|null>;readDisplay:(assetId:string)=>Promise<AssetContent>;resolve?:(token:string)=>Promise<CardShare|null>}){
 const resolve=(token:string)=>deps.resolve?deps.resolve(token):resolveCardShare(deps.db,token);
 const router=Router();router.use((_req,res,next)=>{res.set(cardShareHeaders);next();});
 const same=(a:CardShare|null,b:CardShare)=>a&&a.cardId===b.cardId&&a.masterId===b.masterId&&a.fabricId===b.fabricId&&a.cardNo===b.cardNo;
 router.get('/:token',async(req,res)=>{
  try{
   if(Object.keys(req.query).length)throw Error('Unavailable');
   const first=await resolve(req.params.token);if(!first)throw Error('Unavailable');
   const loaded=first.available?await deps.load(first):null;
   const current=await resolve(req.params.token);if(!same(current,first))throw Error('Unavailable');
   if(!current!.available||!first.available||!loaded?.card.colorways.length){res.json({available:false,message:'暂不可用'});return;}
   res.json({available:true,card:loaded.card});
  }catch{res.status(404).json({error:'Card unavailable'});}
 });
 router.get('/:token/images/:ref',async(req,res)=>{
  try{
   if(Object.keys(req.query).length||!/^[-\w]{43}$/.test(String(req.params.ref)))throw Error('Unavailable');
   const first=await resolve(req.params.token);if(!first?.available)throw Error('Unavailable');
   const ref='display:'+req.params.ref,asset=(await deps.load(first))?.previews.get(ref);if(!asset)throw Error('Unavailable');
   const content=await deps.readDisplay(asset);
   if(!Buffer.isBuffer(content.body)||!content.body.length||content.body.length>5*1024*1024||content.body.length!==content.byteSize||!['image/webp','image/png','image/jpeg'].includes(content.mime))throw Error('Unavailable');
   const current=await resolve(req.params.token);
   if(!same(current,first)||!current!.available||(await deps.load(current!))?.previews.get(ref)!==asset)throw Error('Unavailable');
   const final=await resolve(req.params.token);if(!same(final,first)||!final!.available)throw Error('Unavailable');
   res.type(content.mime).send(content.body);
  }catch{res.status(404).json({error:'Card unavailable'});}
 });return router;
}
