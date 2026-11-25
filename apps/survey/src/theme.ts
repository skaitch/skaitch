import { useEffect, useState } from 'react';
import type { SurveyEditorPalette } from '@skaitch/ui/components/survey/SurveyEditor';


/** Moves the editor's teal-tinted greys to another hue (sat 0 = neutral grey), keeping their lightness. */
function retint(hue: number, satScale: number) {
  return (hex: string) => {
    const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex);
    if (!m) return hex;
    const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return hex;
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    if (h < 150 || h > 215) return hex; // only the teals
    const s = (d / (1 - Math.abs(2 * l - 1))) * satScale;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((hue / 60) % 2) - 1)), o = l - c / 2;
    const [rr, gg, bb] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
    const to = (v: number) => Math.round((v + o) * 255).toString(16).padStart(2, '0');
    return `#${to(rr)}${to(gg)}${to(bb)}${m[2] ?? ''}`;
  };
}

/** App themes: the colour of selected pills, plan strokes and the help banner. */
export type ThemeId = 'noir' | 'vert' | 'or';

export const THEMES: Record<ThemeId, { fr: string; en: string; swatch: string; css: Record<string, string>; editor: SurveyEditorPalette }> = {
  noir: {
    fr: 'Noir', en: 'Black', swatch: '#0a0a0a',
    css: { '--theme': '#0a0a0a', '--theme-ink': '#ffffff' },
    editor: { tint: retint(0, 0), brand: '#0a0a0a', accent: '#5a5a5a', fillSel: '#ececec', hint: '#0a0a0ae8', hintIdle: '#2e2e2ee8', hintInk: '#fff' },
  },
  // The teal of the previous version of the app.
  vert: {
    fr: 'Vert', en: 'Green', swatch: '#087f84',
    css: { '--theme': '#087f84', '--theme-ink': '#ffffff' },
    editor: {},
  },
  // The gold of the logo.
  or: {
    fr: 'Or', en: 'Gold', swatch: '#FFB000',
    css: { '--theme': '#F1C96B', '--theme-ink': '#2a2210' },
    editor: { tint: retint(40, 0.55), brand: '#b77d00', accent: '#FFB000', fillSel: '#fff4d6', hint: '#FFB000f0', hintIdle: '#3a2f12e8', hintInk: '#1a1a1a' },
  },
};

const KEY = 'skaitch-survey:theme';
const EVENT = 'skaitch-survey:theme';

export function getTheme(): ThemeId {
  try { const v = localStorage.getItem(KEY); return v === 'noir' || v === 'or' ? v : 'vert'; } catch { return 'vert'; }
}

/** Puts the theme's colours on the document, so every screen follows it. */
export function applyTheme(id: ThemeId = getTheme()) {
  for (const [k, v] of Object.entries(THEMES[id].css)) document.documentElement.style.setProperty(k, v);
  document.documentElement.dataset.theme = id;
}

export function setTheme(id: ThemeId) {
  try { localStorage.setItem(KEY, id); } catch { /* private mode */ }
  applyTheme(id);
  window.dispatchEvent(new Event(EVENT));
}

export function useTheme(): ThemeId {
  const [id, setId] = useState(getTheme);
  useEffect(() => {
    const on = () => setId(getTheme());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return id;
}
