import { useEffect, useState } from 'react';
import { DEFAULT_THEME } from '@/config';

export type AppearanceMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'shadow-theme-appearance';

function readMode(): AppearanceMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // Private browsing and blocked storage both fall back to config.
  }
  return DEFAULT_THEME;
}

function systemIsDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

export function useAppearance() {
  const [mode, setMode] = useState<AppearanceMode>(() =>
    typeof window === 'undefined' ? DEFAULT_THEME : readMode()
  );
  const [systemDark, setSystemDark] = useState(systemIsDark);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Keep the in-memory selection when storage is unavailable.
    }
    const dark = mode === 'dark' || (mode === 'system' && systemDark);
    document.documentElement.classList.toggle('dark', dark);
  }, [mode, systemDark]);

  const dark = mode === 'dark' || (mode === 'system' && systemDark);

  return { mode, dark, setMode };
}
