import type {PublicPattern} from '../../../server/customer-share/publicPatternProjection';
import type {PublicCard} from '../../../server/customer-share/cardShareCatalog';
const row=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,max:number)=>typeof v==='string'&&v.length>0&&v.length<=max;
const ref=(v:unknown)=>typeof v==='string'&&/^display:[A-Za-z0-9_-]{43}$/.test(v);
const images=(v:unknown)=>Array.isArray(v)&&v.length<=10&&v.every(x=>row(x)&&Object.keys(x).length===1&&ref(x.previewRef));
const number=(v:unknown)=>v===null||typeof v==='number'&&Number.isFinite(v)&&v>0;
const bad=()=>new Error('花型资料暂不可用');
export function parsePublicPatternResponse(raw:unknown):PublicPattern|null{
 if(!row(raw)||typeof raw.available!=='boolean')throw bad();if(!raw.available)return null;
 const p=raw.pattern;if(!row(p)||!text(p.patternNo,64)||!Array.isArray(p.colorways))throw bad();const seen=new Set<number>();
 for(const c of p.colorways){
  if(!row(c)||!Number.isSafeInteger(c.colorwayNumber)||c.colorwayNumber<1||seen.has(c.colorwayNumber)||!images(c.designImages)||!Array.isArray(c.fabrics))throw bad();seen.add(c.colorwayNumber);
  for(const f of c.fabrics){if(!row(f)||!text(f.fabricNo,64)||!text(f.fabricName,255)||!(f.composition===null||typeof f.composition==='string'&&f.composition.length<=500)||!number(f.weightValue)||!number(f.widthCm)||![null,'gsm','mm'].includes(f.weightUnit)||(f.weightValue===null)!==(f.weightUnit===null)||!images(f.displayImages)||!images(f.detailImages)||!images(f.effectImages))throw bad();}
 }
 return p as PublicPattern;
}
export function publicPatternImagePath(token:string,previewRef:string,productOnly=false){if(!/^[A-Za-z0-9_-]{43}$/.test(token)||!ref(previewRef))throw bad();return '/api/public/'+(productOnly?'products':'patterns')+'/'+token+'/images/'+previewRef.slice(8);}
export function parsePublicProductResponse(raw:unknown):{pattern:PublicPattern|null;productNo:string}{
 const pattern=parsePublicPatternResponse(raw);
 if(pattern===null)return {pattern:null,productNo:''};
 if(!row(raw)||!text(raw.productNo,200)||pattern.colorways.length!==1||pattern.colorways[0].fabrics.length!==1||pattern.colorways[0].designImages.length)throw bad();
 return {pattern,productNo:raw.productNo};
}
export function parsePatternShareLink(raw:unknown,productOnly=false){
 if(typeof raw!=='string')throw bad();const url=new URL(raw);
 if(url.protocol!=='https:'||url.href!==raw||url.username||url.password||url.search||url.hash||!(productOnly?/^\/s\/[A-Za-z0-9_-]{43}$/:/^\/p\/[A-Za-z0-9_-]{43}$/).test(url.pathname))throw bad();
 return {url:raw,path:url.pathname};
}
const only=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function parsePublicCardResponse(raw:unknown):PublicCard|null{
 if(!row(raw)||typeof raw.available!=='boolean')throw bad();
 if(!raw.available){if(Object.keys(raw).some(k=>k!=='available'&&k!=='message'))throw bad();return null;}
 if(!only(raw,['available','card']))throw bad();const c=raw.card;
 if(!row(c)||!only(c,['cardNo','fabricNo','fabricName','composition','weightValue','weightUnit','widthCm','colorways'])||!text(c.cardNo,129)||!text(c.fabricNo,64)||!text(c.fabricName,255)||!(c.composition===null||typeof c.composition==='string'&&c.composition.length<=500)||!number(c.weightValue)||!number(c.widthCm)||![null,'gsm','mm'].includes(c.weightUnit)||(c.weightValue===null)!==(c.weightUnit===null)||!Array.isArray(c.colorways)||!c.colorways.length)throw bad();
 const seen=new Set<number>(),products=new Set<string>();
 for(const color of c.colorways){
  if(!row(color)||!only(color,['colorwayNo','productNo','displayImages','detailImages','effectImages'])||!Number.isSafeInteger(color.colorwayNo)||color.colorwayNo<1||color.colorwayNo>4294967295||seen.has(color.colorwayNo)||!text(color.productNo,200)||products.has(color.productNo)||!images(color.displayImages)||!images(color.detailImages)||!images(color.effectImages))throw bad();
  seen.add(color.colorwayNo);products.add(color.productNo);
 }
 return c as PublicCard;
}
export function parseCardShareLink(raw:unknown,expectedOrigin?:string){
 if(typeof raw!=='string')throw bad();const url=new URL(raw);
 if(url.protocol!=='https:'||url.href!==raw||url.username||url.password||url.search||url.hash||!/^\/c\/[A-Za-z0-9_-]{43}$/.test(url.pathname)||expectedOrigin!==undefined&&url.origin!==expectedOrigin)throw bad();
 return {url:raw,path:url.pathname};
}
export function publicCardImagePath(token:string,previewRef:string){
 if(!/^[A-Za-z0-9_-]{43}$/.test(token)||!ref(previewRef))throw bad();
 return '/api/public/cards/'+token+'/images/'+previewRef.slice(8);
}
