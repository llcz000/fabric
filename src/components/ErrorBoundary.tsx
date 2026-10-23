import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface EBProps {
  children: React.ReactNode;
  /** 静态兜底内容，或接收 reset 回调的渲染函数（供业务自定义「重试」按钮）。 */
  fallback?: React.ReactNode | ((reset: () => void) => React.ReactNode);
}

interface EBState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<EBProps, EBState> {
  state: EBState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): EBState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      const reset = () => this.setState({ hasError: false, error: null });
      const fallback = this.props.fallback;
      if (typeof fallback === 'function') return <>{fallback(reset)}</>;
      return fallback ?? (
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="text-center max-w-md space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center mx-auto border border-rose-100">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-bold text-slate-800">页面出现异常</h2>
            <p className="text-sm text-slate-500">{this.state.error?.message || '未知错误'}</p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-sm font-semibold cursor-pointer shadow-sm"
            >
              <RefreshCw className="w-4 h-4" />
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return <>{this.props.children}</>;
  }
}
