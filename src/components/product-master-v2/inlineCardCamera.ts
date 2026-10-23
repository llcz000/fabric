import {readLiveCard} from './liveCardCamera';

/** Keep the original customer session mounted; cancellation never navigates or submits. */
export function openInlineCardCamera(onDecoded:(token:string)=>void,onClosed:()=>void):()=>void{
 const previous=document.activeElement,dialog=document.createElement('dialog');
 dialog.setAttribute('aria-label','实时扫码色卡');
 dialog.style.cssText='position:fixed;inset:0;margin:auto;width:min(94vw,560px);max-height:94dvh;overflow:auto;border:1px solid #cbd5e1;border-radius:16px;padding:20px;background:white;color:#0f172a;box-sizing:border-box;';
 dialog.innerHTML='<h2 style="margin:0 0 12px;font-size:20px">对准色卡二维码</h2><video autoplay muted playsinline style="display:block;width:100%;height:min(52vh,440px);object-fit:cover;background:#0f172a;border-radius:10px"></video><p role="status" style="margin:14px 0">请允许使用相机，并对准完整的色卡二维码</p><div style="display:flex;gap:12px"><button type="button" data-camera-retry hidden>重新启动相机</button><button type="button" data-camera-cancel>取消扫码</button></div>';
 const video=dialog.querySelector('video')!,status=dialog.querySelector<HTMLElement>('[role="status"]')!,retry=dialog.querySelector<HTMLButtonElement>('[data-camera-retry]')!,cancel=dialog.querySelector<HTMLButtonElement>('[data-camera-cancel]')!;
 for(const button of [retry,cancel])button.style.cssText='border:1px solid #94a3b8;border-radius:8px;padding:10px 18px;background:white;color:#0f172a;font:inherit;';
 let controller:AbortController|null=null,done=false;
 const leave=()=>finish();
 const pause=()=>{if(document.hidden&&controller){controller.abort();controller=null;status.textContent='相机已暂停，返回后点击重新启动相机';retry.hidden=false;}};
 function finish(token?:string){
  if(done)return;done=true;controller?.abort();controller=null;
  window.removeEventListener('pagehide',leave);document.removeEventListener('visibilitychange',pause);dialog.close();dialog.remove();
  try{if(token)onDecoded(token);}finally{onClosed();}
  requestAnimationFrame(()=>{if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();});
 }
 async function start(){
  if(done||controller)return;const current=new AbortController();controller=current;retry.hidden=true;
  status.textContent='请允许使用相机，并对准完整的色卡二维码';
  try{
   if(!navigator.mediaDevices?.getUserMedia)throw Error('当前浏览器无法使用相机，请使用系统浏览器');
   const token=await readLiveCard(video,current.signal);
   if(!done&&!current.signal.aborted)finish(token);
  }catch(cause){
   if(done||current.signal.aborted)return;
   const name=(cause as {name?:string}).name;
   status.textContent=name==='NotAllowedError'?'相机权限未开启，请允许此浏览器使用相机后重试':name==='NotFoundError'?'未找到可用相机':cause instanceof Error?cause.message:'相机启动失败，请重试';
   retry.hidden=false;
  }finally{if(controller===current)controller=null;}
 }
 cancel.addEventListener('click',leave);retry.addEventListener('click',()=>void start());
 dialog.addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();finish();});
 document.body.append(dialog);
 try{dialog.showModal();}catch(cause){dialog.remove();throw cause;}
 window.addEventListener('pagehide',leave);document.addEventListener('visibilitychange',pause);void start();
 return leave;
}
