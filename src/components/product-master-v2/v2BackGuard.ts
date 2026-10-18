const KEY='__fabricV2BackGuard';
/** One same-URL pair, reused on reload. History state contains no business data. */
export function installV2BackGuard(host:Window,canLeave:()=>boolean):()=>void{
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
  const modal=host.document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]');
  if(modal){if(modal instanceof HTMLDialogElement){if(modal.dispatchEvent(new Event('cancel',{cancelable:true})))modal.close();}else modal.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return;}
  if(host.confirm('确定离开 Fabric 页面吗？未保存的内容可能丢失。')&&canLeave()){leaving=true;host.history.back();}
 }
 function resume(event:PageTransitionEvent){if(!event.persisted)return;leaving=false;const current=host.history.state?.[KEY];if(current?.id===id&&current.position==='base')host.history.pushState(state('guard'),'',host.location.href);}
 host.addEventListener('popstate',back);host.addEventListener('pageshow',resume);return()=>{host.removeEventListener('popstate',back);host.removeEventListener('pageshow',resume);};
}
