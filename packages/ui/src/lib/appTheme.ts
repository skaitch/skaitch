import { useEffect, useState } from 'react';

/**
 * App colour themes, the same three as skAItch Survey: they colour the selected
 * pills, active tools, primary buttons and accents. Light/dark stays a separate
 * setting (data-theme); this one lives on data-accent.
 */
export type AppThemeId = 'noir' | 'vert' | 'or';

export const APP_THEMES: Record<AppThemeId, { fr: string; en: string; swatch: string }> = {
  noir: { fr: 'Noir', en: 'Black', swatch: '#0a0a0a' },
  vert: { fr: 'Vert', en: 'Green', swatch: '#087f84' },
  or: { fr: 'Or', en: 'Gold', swatch: '#FFB000' },
};

const KEY = 'skaitch:app-theme';
const EVENT = 'skaitch:app-theme';

export function getAppTheme(): AppThemeId {
  try { const v = localStorage.getItem(KEY); return v === 'noir' || v === 'or' ? v : 'vert'; } catch { return 'vert'; }
}

/** Puts the theme on the document, so every screen follows it. */
export function applyAppTheme(id: AppThemeId = getAppTheme()) {
  if (typeof document !== 'undefined') document.documentElement.dataset.accent = id;
}

export function setAppTheme(id: AppThemeId) {
  try { localStorage.setItem(KEY, id); } catch { /* private mode: the choice lasts this session */ }
  applyAppTheme(id);
  window.dispatchEvent(new Event(EVENT));
}

export function useAppTheme(): AppThemeId {
  const [id, setId] = useState(getAppTheme);
  useEffect(() => {
    const on = () => setId(getAppTheme());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return id;
}

applyAppTheme();
