import React from 'react';
import { AlertTriangle, RefreshCw, LayoutDashboard } from 'lucide-react';
import { ErrorBoundary } from '../ErrorBoundary';

export interface V2ViewBoundaryProps {
 children:React.ReactNode;
 /** 视图名称，用于错误提示中说明是哪个功能出错。 */
 label:string;
 /** 出错后的兜底操作，例如返回经营大盘。 */
 onBack?():void;
 backLabel?:string;
}

/**
 * V2 单个业务视图的异常边界。
 * 任何视图渲染异常都被限制在这一层：侧边栏与顶栏保持可用，用户可重试或返回大盘，
 * 不会整页白屏，也不会连带丢失其他视图已加载的数据。
 */
export function V2ViewBoundary({children,label,onBack,backLabel='返回经营大盘'}:V2ViewBoundaryProps){
 return <ErrorBoundary fallback={reset=>
  <div role="alert" className="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-xl border border-rose-200 bg-white p-8 text-center">
   <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-rose-100 bg-rose-50 text-rose-500">
    <AlertTriangle size={22} aria-hidden="true"/>
   </span>
   <div className="space-y-2">
    <h2 className="text-base font-semibold text-slate-800">{label}加载失败</h2>
    <p className="max-w-md text-sm text-slate-500">该页面在渲染时出现异常，其余功能不受影响。你可以重试，或返回经营大盘继续使用。</p>
   </div>
   <div className="flex flex-wrap items-center justify-center gap-2">
    <button type="button" onClick={reset}
     className="inline-flex items-center gap-2 rounded-lg bg-[#346ef6] px-4 py-2 text-sm font-medium text-white hover:bg-[#275ee0]">
     <RefreshCw size={15} aria-hidden="true"/>重试
    </button>
    {onBack?<button type="button" onClick={onBack}
     className="inline-flex items-center gap-2 rounded-lg border border-[#c3c6d7] bg-white px-4 py-2 text-sm text-[#434655] hover:bg-[#f3f4fa]">
     <LayoutDashboard size={15} aria-hidden="true"/>{backLabel}
    </button>:null}
   </div>
  </div>
 }>{children}</ErrorBoundary>;
}

export default V2ViewBoundary;
