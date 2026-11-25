import { useState, useCallback } from 'react';
import type { TweakValues } from '@skaitch/core/types/ifc';

const DEFAULTS: TweakValues = {
  theme: 'light',
  density: 'comfort',
  showGrid: true,
  snap: true,
  snapSize: 0.25,
  panelsLayout: 'left',
  wallOpacity: 0.92,
  showBgImage: true,
  showLabels: true,
  showDimensions: true,
};

const KEY = 'skaitch:tweaks';

function load(): TweakValues {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch { return DEFAULTS; }
}

export function useTweaks() {
  const [tweaks, setTweaks] = useState<TweakValues>(() => load());

  const setTweak = useCallback(<K extends keyof TweakValues>(key: K, value: TweakValues[K]) => {
    setTweaks((prev) => {
      const next = { ...prev, [key]: value };
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { tweaks, setTweak };
}