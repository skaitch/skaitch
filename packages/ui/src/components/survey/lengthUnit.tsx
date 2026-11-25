import { useEffect, useState } from 'react';
import { LENGTH_UNITS, type LengthUnit } from '@skaitch/core/survey/units';

/** Length unit chosen on this device (display and input only; surveys stay in metres). */
const KEY = 'skaitch-survey:unit';
const EVENT = 'skaitch-survey:unit-change';

export function getLengthUnit(): LengthUnit {
  try { const v = localStorage.getItem(KEY) as LengthUnit | null; return v && LENGTH_UNITS.includes(v) ? v : 'm'; } catch { return 'm'; }
}

export function setLengthUnit(unit: LengthUnit) {
  try { localStorage.setItem(KEY, unit); } catch { /* private mode */ }
  window.dispatchEvent(new Event(EVENT));
}

/** The current length unit, updated when it changes in the settings. */
export function useLengthUnit(): LengthUnit {
  const [unit, setUnit] = useState(getLengthUnit);
  useEffect(() => {
    const update = () => setUnit(getLengthUnit());
    window.addEventListener(EVENT, update);
    return () => window.removeEventListener(EVENT, update);
  }, []);
  return unit;
}
