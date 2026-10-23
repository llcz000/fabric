import type {PublicPreview} from './publicPatternProjection';
import {projectPublicPattern} from './publicPatternProjection';
import {loadPatternShareCatalog} from './patternShareCatalog';
import type {CardShare,CardShareDb} from './cardSharing';

export interface PublicCardColorway{
 colorwayNo:number;productNo:string;displayImages:PublicPreview[];detailImages:PublicPreview[];effectImages:PublicPreview[];
}
export interface PublicCard{
 cardNo:string;fabricNo:string;fabricName:string;composition:string|null;
 weightValue:number|null;weightUnit:'gsm'|'mm'|null;widthCm:number|null;colorways:PublicCardColorway[];
}
/** Trusted card publication resolved by the route, never a client scope. */
export async function loadCardShareCatalog(db:CardShareDb,share:CardShare,secret:Uint8Array):Promise<{card:PublicCard;previews:Map<string,string>}|null>{
 if(!share.available)return null;
 const loaded=await loadPatternShareCatalog(db,share.masterId,secret,undefined,share.fabricId);
 if(!loaded)return null;const projected=projectPublicPattern(loaded.candidate);
 if(!projected?.colorways.length)return null;
 const first=projected.colorways[0].fabrics[0];if(!first)return null;
 const colorways:PublicCardColorway[]=[];
 for(const color of projected.colorways){
  const source=loaded.candidate.colorways.find(c=>c.colorwayNumber===color.colorwayNumber);
  if(color.fabrics.length!==1||source?.products.length!==1)throw Error('Card product scope inconsistent');
  const productNo=source.products[0].productNo;
  if(typeof productNo!=='string'||!productNo.trim()||productNo.length>200)throw Error('Card product unavailable');
  const fabric=color.fabrics[0];
  colorways.push({colorwayNo:color.colorwayNumber,productNo,displayImages:fabric.displayImages,detailImages:fabric.detailImages,effectImages:fabric.effectImages});
 }
 colorways.sort((a,b)=>a.colorwayNo-b.colorwayNo);
 const card:PublicCard={cardNo:share.cardNo,fabricNo:first.fabricNo,fabricName:first.fabricName,composition:first.composition,weightValue:first.weightValue,weightUnit:first.weightUnit,widthCm:first.widthCm,colorways};
 const allowed=new Set(colorways.flatMap(c=>[...c.displayImages,...c.detailImages,...c.effectImages].map(i=>i.previewRef)));
 return {card,previews:new Map([...loaded.previews].filter(([ref])=>allowed.has(ref)))};
}
