/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Input + Field wrapper — unified text inputs with label, hint and error states.
 */
import React from 'react';

interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Field({ label, hint, error, required, children, className = '' }: FieldProps) {
  return (
    <label className={`block ${className}`}>
      {label && (
        <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
          {label}
          {required && <span className="text-danger-500 ml-0.5">*</span>}
        </span>
      )}
      {children}
      {error ? (
        <span className="block text-xs text-danger-600 mt-1">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-slate-400 mt-1">{hint}</span>
      ) : null}
    </label>
  );
}

const inputBase =
  'w-full bg-white border rounded-md px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 ' +
  'transition-all duration-150 ease-out ' +
  'focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 ' +
  'disabled:bg-slate-50 disabled:text-slate-400';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  ({ className = '', invalid, ...rest }, ref) => (
    <input
      ref={ref}
      className={`${inputBase} ${invalid ? 'border-danger-500 focus:ring-danger-500/40 focus:border-danger-500' : 'border-slate-200'} ${className}`}
      {...rest}
    />
  ),
);
Input.displayName = 'Input';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  ({ className = '', invalid, children, ...rest }, ref) => (
    <select
      ref={ref}
      className={`${inputBase} ${invalid ? 'border-danger-500' : 'border-slate-200'} appearance-none bg-no-repeat pr-9 ${className}`}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundPosition: 'right 0.6rem center' }}
      {...rest}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';
