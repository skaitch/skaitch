/**
 * Length units of the survey display and input. The survey itself is always in metres; a unit
 * only changes how a cote is shown and how a typed value is read.
 */
export type LengthUnit = 'm' | 'cm' | 'mm' | 'ft-in';
export const LENGTH_UNITS: LengthUnit[] = ['m', 'cm', 'mm', 'ft-in'];

const INCH = 0.0254;
const FOOT = 12 * INCH;
/** Imperial lengths are rounded to the sixteenth of an inch. */
const FRACTION = 16;

const comma = (v: number, digits: number) => {
  const s = v.toFixed(digits);
  return (digits > 0 && s.includes('.') ? s.replace(/\.?0+$/, '') : s).replace('.', ',');
};

function feetInches(m: number) {
  const sixteenths = Math.round((Math.abs(m) / INCH) * FRACTION);
  const feet = Math.floor(sixteenths / (12 * FRACTION));
  const rest = sixteenths - feet * 12 * FRACTION;
  const inches = Math.floor(rest / FRACTION);
  let num = rest - inches * FRACTION, den = FRACTION;
  while (num && num % 2 === 0) { num /= 2; den /= 2; }
  return { sign: m < 0 ? '-' : '', feet, inches, fraction: num ? `${num}/${den}` : '' };
}

/** A length with its unit, for display: « 3,25 m », « 325 cm », « 3250 mm », « 10′ 8 1/2″ ». */
export function formatLength(m: number, unit: LengthUnit): string {
  if (unit === 'ft-in') {
    const { sign, feet, inches, fraction } = feetInches(m);
    const inch = `${inches}${fraction ? ` ${fraction}` : ''}″`;
    return feet ? `${sign}${feet}′ ${inch}` : `${sign}${inch}`;
  }
  return `${formatLengthValue(m, unit)} ${unit}`;
}

/** A length as typed back in a field of that unit: « 3,25 », « 325 », « 3250 », « 10' 8 1/2" ». */
export function formatLengthValue(m: number, unit: LengthUnit): string {
  switch (unit) {
    case 'm': return m.toFixed(2).replace('.', ',');
    case 'cm': return comma(m * 100, 1);
    case 'mm': return Math.round(m * 1000).toString();
    case 'ft-in': {
      const { sign, feet, inches, fraction } = feetInches(m);
      return `${sign}${feet}' ${inches}${fraction ? ` ${fraction}` : ''}"`;
    }
  }
}

/** Short name of the unit, for field labels: « m », « cm », « mm », « ft-in ». */
export const unitLabel = (unit: LengthUnit) => (unit === 'ft-in' ? 'ft-in' : unit);

/** Example value of the unit, for placeholders. */
export const lengthPlaceholder = (unit: LengthUnit) => ({ m: '0,00', cm: '0', mm: '0', 'ft-in': `0' 0"` })[unit];

const number = (s: string) => (/^\d+(?:[.,]\d+)?$/.test(s) ? parseFloat(s.replace(',', '.')) : NaN);
/** « 8 », « 8,5 », « 8 1/2 », « 1/2 »: a number of inches (or feet), with an optional fraction. */
function mixed(s: string): number {
  const t = s.trim();
  if (!t) return 0;
  const m = /^(?:(\d+(?:[.,]\d+)?)\s+)?(\d+)\/(\d+)$/.exec(t);
  if (m) return (m[1] ? number(m[1]) : 0) + Number(m[2]) / Number(m[3]);
  return number(t);
}

/**
 * Reads a typed length in metres (NaN when it cannot be read). A unit typed with the value wins
 * over the chosen one: « 325 cm », « 3,25 m », « 10' 8" » are read whatever the setting.
 */
export function parseLength(text: string, unit: LengthUnit): number {
  const t = text.trim().replace(/[′’]/g, "'").replace(/[″”]/g, '"').replace(/''/g, '"');
  if (!t) return NaN;
  const metric = /^(\d+(?:[.,]\d+)?)\s*(mm|cm|m)$/i.exec(t);
  if (metric) return number(metric[1]) / { mm: 1000, cm: 100, m: 1 }[metric[2].toLowerCase() as 'mm' | 'cm' | 'm'];
  const feet = /^(\d+(?:[.,]\d+)?)\s*'\s*(.*?)\s*"?$/.exec(t);
  if (feet) return number(feet[1]) * FOOT + mixed(feet[2]) * INCH;
  const inches = /^(.*?)\s*"$/.exec(t);
  if (inches) return mixed(inches[1]) * INCH;
  if (unit === 'ft-in') {
    // « 10 8 » or « 10 8 1/2 »: feet then inches; a single number is in feet.
    const parts = /^(\d+)\s+(.+)$/.exec(t);
    if (parts && !/^\d+\/\d+$/.test(parts[2])) return Number(parts[1]) * FOOT + mixed(parts[2]) * INCH;
    return mixed(t) * FOOT;
  }
  return number(t) / { m: 1, cm: 100, mm: 1000 }[unit];
}
