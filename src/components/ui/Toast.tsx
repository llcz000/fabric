/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Toast — global, non-blocking feedback system that replaces native alert().
 * Usage: wrap app in <ToastProvider>, then call useToast().show({...}).
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

type ToastTone = 'success' | 'error' | 'warning' | 'info';
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  show: (t: { tone?: ToastTone; message: string; action?: ToastItem['action'] }) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

const toneStyles: Record<ToastTone, { wrap: string; icon: React.ReactNode }> = {
  success: { wrap: 'bg-slate-900 text-white', icon: <CheckCircle2 className="w-4.5 h-4.5 text-success-500" /> },
  error: { wrap: 'bg-slate-900 text-white', icon: <XCircle className="w-4.5 h-4.5 text-danger-500" /> },
  warning: { wrap: 'bg-slate-900 text-white', icon: <AlertTriangle className="w-4.5 h-4.5 text-warning-500" /> },
  info: { wrap: 'bg-slate-900 text-white', icon: <Info className="w-4.5 h-4.5 text-info-500" /> },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ToastApi['show']>(({ tone = 'info', message, action }) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, tone, message, action }]);
    setTimeout(() => remove(id), action ? 6000 : 3200);
  }, [remove]);

  const api: ToastApi = {
    show,
    success: (m) => show({ tone: 'success', message: m }),
    error: (m) => show({ tone: 'error', message: m }),
    warning: (m) => show({ tone: 'warning', message: m }),
    info: (m) => show({ tone: 'info', message: m }),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="no-print fixed top-4 right-4 z-[100] flex flex-col gap-2 w-[min(92vw,360px)]">
        {items.map((t) => (
          <div
            key={t.id}
            className={`flex items-start gap-3 ${toneStyles[t.tone].wrap} px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-fade-in`}
            role="status"
          >
            <span className="mt-0.5 flex-shrink-0">{toneStyles[t.tone].icon}</span>
            <span className="flex-1 leading-snug">{t.message}</span>
            {t.action && (
              <button
                onClick={() => { t.action!.onClick(); remove(t.id); }}
                className="text-brand-300 hover:text-brand-200 font-semibold text-xs flex-shrink-0"
              >
                {t.action.label}
              </button>
            )}
            <button onClick={() => remove(t.id)} className="text-slate-400 hover:text-white flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
