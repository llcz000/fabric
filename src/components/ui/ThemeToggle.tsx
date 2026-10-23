/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ThemeToggle — sun/moon switch for light & dark mode.
 */
import React from 'react';
import { Moon, Sun } from 'lucide-react';

export function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={dark ? '切换到浅色模式' : '切换到深色模式'}
      aria-label="切换主题"
      className="p-2 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
    >
      {dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
    </button>
  );
}
