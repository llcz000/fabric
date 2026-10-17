import type {PublicPattern} from '../../../server/customer-share/publicPatternProjection';
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
export function publicPatternImagePath(token:string,previewRef:string){if(!/^[A-Za-z0-9_-]{43}$/.test(token)||!ref(previewRef))throw bad();return '/api/public/patterns/'+token+'/images/'+previewRef.slice(8);}
export function parsePatternShareLink(raw:unknown){
 if(typeof raw!=='string')throw bad();const url=new URL(raw);
 if(url.protocol!=='https:'||url.href!==raw||url.username||url.password||url.search||url.hash||!/^\/p\/[A-Za-z0-9_-]{43}$/.test(url.pathname))throw bad();
 return {url:raw,path:url.pathname};
}
