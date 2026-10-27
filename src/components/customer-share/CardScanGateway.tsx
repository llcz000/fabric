import React,{useEffect,useState} from 'react';
import PublicPatternPage from './PublicPatternPage';
import {readSampleCardScanToken} from '../../lib/sampleCardScanLink';

// A browser preference is only a convenience; it never grants internal access.
// Physical QR identity stays in the URL for the existing employee login/resume flow.
const KEY='fabric.card-scan-purpose.v1';
type Purpose='view'|'staff';
function savedPurpose():Purpose|null{
 try{const value=window.localStorage.getItem(KEY);return value==='view'||value==='staff'?value:null;}catch{return null;}
}
export default function CardScanGateway({token,internal}:{token:string;internal:React.ReactNode}){
 const [purpose,setPurpose]=useState<Purpose|null>(savedPurpose);
 const [scanRoute,setScanRoute]=useState(true);
 useEffect(()=>{
  const sync=()=>setScanRoute(readSampleCardScanToken(window.location.hash)===token);
  window.addEventListener('popstate',sync);window.addEventListener('hashchange',sync);window.addEventListener('fabric-route',sync);
  return()=>{window.removeEventListener('popstate',sync);window.removeEventListener('hashchange',sync);window.removeEventListener('fabric-route',sync);};
 },[token]);
 function choose(next:Purpose|null){
  try{if(next)window.localStorage.setItem(KEY,next);else window.localStorage.removeItem(KEY);}catch{/* storage optional */}
  setPurpose(next);
 }
 if(!scanRoute)return <>{internal}</>;
 if(!purpose)return <main aria-label="色卡使用方式" className="min-h-[100dvh] bg-[#f7f7f3] px-4 py-12 text-[#29372e]">
  <div className="mx-auto w-full max-w-sm space-y-4 rounded-2xl border border-[#e5e8df] bg-white p-5 shadow-sm">
   <p className="text-center text-sm font-semibold tracking-widest text-[#2b4235]">FABRIC · 色卡</p>
   <header className="space-y-2 py-4 text-center"><h1 className="text-xl font-semibold">欢迎查看色卡</h1><p className="text-sm text-[#67746b]">请选择使用方式</p></header>
   <button type="button" onClick={()=>choose('view')} className="flex min-h-[76px] w-full items-center justify-between rounded-xl border border-[#d9dfd8] px-4 text-left focus-visible:outline-2 focus-visible:outline-[#477d62]"><span><strong className="block text-base">查看色卡</strong><span className="mt-1 block text-xs text-[#67746b]">无需登录 · 查看图片及面料信息</span></span><span aria-hidden="true">›</span></button>
   <button type="button" onClick={()=>choose('staff')} className="flex min-h-[76px] w-full items-center justify-between rounded-xl border border-[#d9dfd8] px-4 text-left focus-visible:outline-2 focus-visible:outline-[#477d62]"><span><strong className="block text-base">员工选样</strong><span className="mt-1 block text-xs text-[#67746b]">系统账号登录 · 扫码加入客户选样</span></span><span aria-hidden="true">›</span></button>
   <p className="pt-2 text-center text-xs text-[#758075]">图片和规格以当前色卡资料为准</p>
  </div>
 </main>;
 return <div className="min-h-[100dvh]">
  <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[#e5e8df] bg-white px-4 text-xs text-[#67746b]">
   <span>{purpose==='view'?'查看色卡':'员工选样'}</span>
   <button type="button" className="min-h-10 px-2 text-[#245d48] underline underline-offset-2" onClick={()=>choose(null)}>切换用途</button>
  </div>
  {purpose==='view'?<PublicPatternPage token={token} cardOnly scanOnly/>:internal}
 </div>;
}
