/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SegmentedControl — unified tab/option switcher used for doc-type selection,
 * inventory tabs, etc. Replaces divergent button-group markup.
 */
import React from 'react';

interface Option<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

interface SegmentedControlProps<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  className?: string;
}

export function SegmentedControl<T extends string>({
  options, value, onChange, size = 'md', className = '',
}: SegmentedControlProps<T>) {
  const pad = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm';
  return (
    <div className={`inline-flex bg-slate-100 dark:bg-slate-800 rounded-md p-1 gap-1 ${className}`}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={
              `${pad} inline-flex items-center gap-1.5 font-semibold rounded-[7px] transition-all duration-150 ease-out cursor-pointer ` +
              (active
                ? 'bg-white dark:bg-slate-700 text-brand-700 dark:text-brand-300 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200')
            }
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
