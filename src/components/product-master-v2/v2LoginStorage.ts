export const V2_LOGIN_KEY='fabric-v2-saved-login',V2_TAB_TOKEN='fabric-v2-session';
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
type Session={token:string;expiresAt:number};
const tokenOk=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
/** Only the server grants access. This cache never renews its 12-hour session. */
export function createV2LoginStore(persistent:()=>Store=()=>localStorage,tab:()=>Store=()=>sessionStorage,now:()=>number=Date.now){
 const read=(store:()=>Store,key:string)=>{try{return store().getItem(key);}catch{return null;}};
 const write=(store:()=>Store,key:string,value:string)=>{try{store().setItem(key,value);}catch{/* In-memory login remains usable when browser storage is blocked. */}};
 const remove=(store:()=>Store,key:string)=>{try{store().removeItem(key);}catch{}};
 const clearTab=()=>{remove(tab,V2_LOGIN_KEY);remove(tab,V2_TAB_TOKEN);};
 const clear=(expectedToken?:string)=>{
  if(expectedToken){try{const saved=JSON.parse(read(persistent,V2_LOGIN_KEY)??'null') as Session|null;if(tokenOk(saved?.token)&&saved!.token!==expectedToken)return false;}catch{}}
  remove(persistent,V2_LOGIN_KEY);clearTab();return true;
 };
 function save(token:string,expiresIn:number){
  if(!tokenOk(token)||!Number.isInteger(expiresIn)||expiresIn<1||expiresIn>43200)throw Error('登录会话有效期无效');
  const saved=JSON.stringify({token,expiresAt:now()+expiresIn*1000});write(persistent,V2_LOGIN_KEY,saved);write(tab,V2_LOGIN_KEY,saved);write(tab,V2_TAB_TOKEN,token);
 }
 function restore(persistentOnly=false):string{
  const raw=read(persistent,V2_LOGIN_KEY)??(persistentOnly?null:read(tab,V2_LOGIN_KEY));
  if(raw!==null){try{const saved=JSON.parse(raw) as Session;if(!saved||!tokenOk(saved.token)||!Number.isSafeInteger(saved.expiresAt)||saved.expiresAt<=now())throw Error('Expired login');write(tab,V2_TAB_TOKEN,saved.token);write(tab,V2_LOGIN_KEY,raw);return saved.token;}catch{clear();return '';}}
  if(!persistentOnly){const legacy=read(tab,V2_TAB_TOKEN);if(tokenOk(legacy)){save(legacy,43200);return legacy;}}
  clearTab();return '';
 }
 return {save,restore,clear};
}
