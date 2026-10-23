/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useTheme — lightweight dark-mode hook (toggles `.dark` on <html>, persists choice).
 */
import { useEffect, useState } from 'react';

const KEY = 'fabric_theme';

export function useTheme() {
  const [dark, setDark] = useState<boolean>(() => {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', dark);
    localStorage.setItem(KEY, dark ? 'dark' : 'light');
  }, [dark]);

  return { dark, toggle: () => setDark((d) => !d) };
}
