/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Badge — compact status / category pill with semantic tints.
 */
import React from 'react';

type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const tones: Record<Tone, string> = {
  brand: 'bg-brand-50 text-brand-700 dark:bg-brand-600/15 dark:text-brand-300',
  success: 'bg-success-50 text-success-700 dark:bg-success-600/15 dark:text-success-500',
  warning: 'bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-500',
  danger: 'bg-danger-50 text-danger-600 dark:bg-danger-600/15 dark:text-danger-500',
  info: 'bg-info-50 text-info-600 dark:bg-info-600/15 dark:text-info-500',
  neutral: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = 'neutral', className = '', children, ...rest }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${tones[tone]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}
