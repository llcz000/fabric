/** QR possession identifies a card; authentication and session permissions remain server-owned. */
const tokenPattern=/^[A-Za-z0-9_-]{22,128}$/;
function originOnly(value:string){
 const url=new URL(value);
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)
  throw Error('色卡扫码地址配置无效');
 return url.origin;
}
export function formatSampleCardScanUrl(origin:string,token:string):string{
 if(!tokenPattern.test(token))throw Error('色卡编码无效');
 return originOnly(origin)+'/#/samples?scan='+token;
}
/** No URL navigation or network fetch: decode only the one known link shape. */
export function readSampleCardScanToken(value:unknown):string|null{
 if(typeof value!=='string'||value.length>1024)return null;
 if(tokenPattern.test(value))return value;
 let hash=value;
 if(!value.startsWith('#')){
  try{const url=new URL(value);originOnly(url.origin);if(url.username||url.password||url.pathname!=='/'||url.search)return null;hash=url.hash;}catch{return null;}
 }
 if(!hash.startsWith('#/cards?')&&!hash.startsWith('#/samples?'))return null;
 const params=new URLSearchParams(hash.slice(hash.indexOf('?')+1));
 if([...params.keys()].length!==1||!params.has('scan'))return null;
 const token=params.get('scan');return token&&tokenPattern.test(token)?token:null;
}
