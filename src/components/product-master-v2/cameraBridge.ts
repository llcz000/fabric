import {openInlineCardCamera} from './inlineCardCamera';
export const CARD_CAMERA_URL='https://124.223.97.60/v2-camera/';
export const CAMERA_RETURN_ORIGINS=['http://192.168.2.32:52990','http://127.0.0.1:52987','https://124.223.97.60'] as const;
const nonceOk=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{32}$/.test(x);
export function parseCameraLaunch(hash:string):{origin:string;nonce:string}|null{
 const p=new URLSearchParams(hash.replace(/^#/,'')),origin=p.get('origin'),nonce=p.get('nonce');
 if([...p.keys()].length!==2||!CAMERA_RETURN_ORIGINS.some(x=>x===origin)||!nonceOk(nonce))return null;
 return {origin:origin!,nonce};
}
export function cameraLaunchUrl(origin:string,nonce:string):string{
 if(!CAMERA_RETURN_ORIGINS.some(x=>x===origin)||!nonceOk(nonce))throw Error('当前地址未启用实时扫码，请使用已提供的选样地址');
 const url=new URL(CARD_CAMERA_URL);url.hash=new URLSearchParams({origin,nonce}).toString();return url.href;
}
export function validCameraMessage(data:unknown,nonce:string,type:string):boolean{
 if(!nonceOk(nonce)||!['ready','start','result','cancel'].includes(type)||!data||typeof data!=='object'||Array.isArray(data))return false;
 const x=data as Record<string,unknown>,keys=Object.keys(x).sort().join(',');
 return x.type===type&&x.nonce===nonce&&keys===(type==='result'?'nonce,token,type':'nonce,type')&&(type!=='result'||typeof x.token==='string'&&/^[A-Za-z0-9_-]{22,128}$/.test(x.token));
}
/** Private code stays in memory. Source window + exact origin + nonce are all mandatory. */
export function openCardCamera(onDecoded:(token:string)=>void,onClosed:()=>void):()=>void{
 if(globalThis.isSecureContext)return openInlineCardCamera(onDecoded,onClosed);
 const random=crypto.getRandomValues(new Uint8Array(16)),nonce=Array.from(random,x=>x.toString(16).padStart(2,'0')).join(''),url=cameraLaunchUrl(location.origin,nonce),cameraOrigin=new URL(CARD_CAMERA_URL).origin;
 let popup:Window|null=null,done=false,started=false,timer:ReturnType<typeof setInterval>|undefined;
 function finish(token?:string){if(done)return;done=true;window.removeEventListener('message',receive);clearInterval(timer);try{popup?.close();}catch{}if(token)onDecoded(token);onClosed();}
 function receive(event:MessageEvent){if(done||event.origin!==cameraOrigin||event.source!==popup)return;if(validCameraMessage(event.data,nonce,'ready')&&!started){started=true;popup?.postMessage({type:'start',nonce},cameraOrigin);}else if(started&&validCameraMessage(event.data,nonce,'result'))finish(event.data.token);else if(validCameraMessage(event.data,nonce,'cancel'))finish();}
 window.addEventListener('message',receive);
 try{popup=window.open(url,'_blank');if(!popup)throw Error('浏览器阻止打开扫码页，请允许弹出窗口后重试');}catch(cause){window.removeEventListener('message',receive);throw cause;}
 timer=setInterval(()=>{try{if(popup?.closed)finish();}catch{finish();}},400);
 return ()=>finish();
}
