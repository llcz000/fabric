/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Modal + ConfirmDialog — replaces native confirm()/alert() with styled,
 * accessible dialogs. ConfirmDialog supports an "undo-style" danger action.
 */
import React, { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const sizes = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg' };

export function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="no-print fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className={`relative bg-white dark:bg-slate-900 rounded-lg shadow-lg w-full ${sizes[size]} animate-fade-in`}>
        {title && (
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h3>
          </div>
        )}
        <div className="px-5 py-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{children}</div>
        {footer && (
          <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-b-lg flex justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open, message, title = '请确认', confirmText = '确定', cancelText = '取消',
  tone = 'primary', onConfirm, onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>{cancelText}</Button>
          <Button variant={tone} onClick={onConfirm}>{confirmText}</Button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        {tone === 'danger' && (
          <span className="w-9 h-9 rounded-full bg-danger-50 dark:bg-danger-600/15 text-danger-500 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </span>
        )}
        <span>{message}</span>
      </div>
    </Modal>
  );
}
