const KEY='__fabricV2BackGuard';
/** Module history and the original exit sentinel use the same modal-first policy. */
export function dismissV2Modal(host:Window):boolean{
 const selector='dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';
 // 多层弹窗时关闭最上层的那个；但某些宿主实现 querySelectorAll 可能返回空集，
 // 此时必须回退到 querySelector，否则会把「关弹窗」误判为「离开模块」。
 const all=typeof host.document.querySelectorAll==='function'?Array.from(host.document.querySelectorAll(selector)):[];
 const modal=all.length?all[all.length-1]:host.document.querySelector(selector);
 if(!modal)return false;
 if(modal instanceof HTMLDialogElement){if(modal.dispatchEvent(new Event('cancel',{cancelable:true})))modal.close();}
 else modal.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
 return true;
}
/**
 * One same-URL pair, reused on reload. History state contains no business data.
 * askExit 存在时使用应用内确认框（异步）；否则回退到浏览器原生 confirm。
 */
export function installV2BackGuard(host:Window,canLeave:()=>boolean|Promise<boolean>,askExit?:()=>Promise<boolean>):()=>void{
 const old=host.history.state?.[KEY],id=typeof old?.id==='string'?old.id:Date.now().toString(36)+Math.random().toString(36).slice(2),state=(position:string)=>({[KEY]:{id,position}});
 if(old?.position!=='guard'){
  host.history.replaceState(state('base'),'',host.location.href);host.history.pushState(state('guard'),'',host.location.href);
 }
 let leaving=false;
 function back(event:PopStateEvent){
  if(event.state?.[KEY]?.id!==id||event.state?.[KEY]?.position!=='base')return;
  if(host.history.state?.[KEY]?.id!==id||host.history.state?.[KEY]?.position!=='base')return;
  if(leaving){host.history.back();return;}
  host.history.pushState(state('guard'),'',host.location.href);
  if(dismissV2Modal(host))return;
  if(askExit){
   // 应用内确认框是异步的：先确认退出，再检查业务守卫。
   void (async()=>{
    if(!await askExit())return;
    if(!(await canLeave()))return;
    leaving=true;host.history.back();
   })();
   return;
  }
  if(host.confirm('确定离开 Fabric 页面吗？未保存的内容可能丢失。')&&canLeave()){leaving=true;host.history.back();}
 }
 function resume(event:PageTransitionEvent){if(!event.persisted)return;leaving=false;const current=host.history.state?.[KEY];if(current?.id===id&&current.position==='base')host.history.pushState(state('guard'),'',host.location.href);}
 host.addEventListener('popstate',back);host.addEventListener('pageshow',resume);return()=>{host.removeEventListener('popstate',back);host.removeEventListener('pageshow',resume);};
}
