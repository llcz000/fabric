/** V2 document header fields share existing orders columns, except nullable JSON
 * presentation snapshot. Never treat browser computed totals or owner as input.
 */
export interface DisplaySnapshot{
 companyName:string;companyAddress:string;companyPhone:string;terms:string;
}
export interface HeaderCreate{
 styleNo:string;issuer:string;receiver:string;receiverPhone:string;receiverAddress:string;
 settled:boolean;displaySnapshot:DisplaySnapshot|null;
}
export type HeaderEdit=Partial<HeaderCreate>;
type Rec=Record<string,unknown>;
const LIMITS:Record<Exclude<keyof HeaderCreate,'settled'|'displaySnapshot'>,number>={
 styleNo:100,issuer:100,receiver:100,receiverPhone:100,receiverAddress:500
};
const DISPLAY_LIMITS:Record<keyof DisplaySnapshot,number>={
 companyName:255,companyAddress:500,companyPhone:100,terms:12000
};
function rec(v:unknown):Rec{
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid display header');
 return v as Rec;
}
function text(v:unknown,max:number):string {
 if(typeof v!=='string'||v.length>max)throw Error('Invalid header text');
 return v;
}
export function readHeaderFields(v:Rec,create:boolean):HeaderCreate|HeaderEdit {
 const out:Rec={};
 for(const [key,max] of Object.entries(LIMITS)){
  if(key in v)out[key]=text(v[key],max);
  else if(create)out[key]='';
 }
 if('settled' in v){
  if(typeof v.settled!=='boolean')throw Error('Invalid settled');
  out.settled=v.settled;
 }else if(create)out.settled=false;
 if('displaySnapshot' in v){
  if(v.displaySnapshot===null)out.displaySnapshot=null;
  else{
   const raw=rec(v.displaySnapshot);
   if(Object.keys(raw).some(key=>!(key in DISPLAY_LIMITS)))
    throw Error('Invalid display snapshot keys');
   const snapshot:Rec={};
   for(const [key,max] of Object.entries(DISPLAY_LIMITS))
    snapshot[key]=key in raw?text(raw[key],max):'';
   out.displaySnapshot=snapshot;
  }
 }else if(create)out.displaySnapshot=null;
 return out as HeaderCreate|HeaderEdit;
}
export const HEADER_KEYS=[
 'styleNo','issuer','receiver','receiverPhone','receiverAddress','settled','displaySnapshot'
] as const;
export const HEADER_COLUMNS={
 styleNo:'style_no',issuer:'sign_person',receiver:'receiver',
 receiverPhone:'receiver_phone',receiverAddress:'receiver_address',
 settled:'settled',displaySnapshot:'v2_display_snapshot'
} as const;
export function headerSqlValue(key:keyof HeaderCreate,value:HeaderCreate[keyof HeaderCreate]):unknown{
 if(key==='settled')return value?1:0;
 if(key==='displaySnapshot')return value==null?null:JSON.stringify(value);
 return value;
}
