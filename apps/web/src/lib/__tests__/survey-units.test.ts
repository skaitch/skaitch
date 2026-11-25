import { describe, expect, it } from 'vitest';
import { formatLength, formatLengthValue, parseLength } from '@skaitch/core/survey/units';

describe('length units', () => {
  it('formats metres in each unit', () => {
    expect(formatLength(3.25, 'm')).toBe('3,25 m');
    expect(formatLength(3.253, 'cm')).toBe('325,3 cm');
    expect(formatLength(3.25, 'cm')).toBe('325 cm');
    expect(formatLength(3.2534, 'mm')).toBe('3253 mm');
    expect(formatLength(3.2639, 'ft-in')).toBe('10′ 8 1/2″');
    expect(formatLength(0.2, 'ft-in')).toBe('7 7/8″');
    expect(formatLengthValue(3.2639, 'ft-in')).toBe(`10' 8 1/2"`);
  });

  it('reads typed values in the chosen unit, or in the unit typed with them', () => {
    expect(parseLength('3,25', 'm')).toBeCloseTo(3.25, 9);
    expect(parseLength('325', 'cm')).toBeCloseTo(3.25, 9);
    expect(parseLength('3250', 'mm')).toBeCloseTo(3.25, 9);
    expect(parseLength('325 cm', 'm')).toBeCloseTo(3.25, 9);
    expect(parseLength('3,25m', 'mm')).toBeCloseTo(3.25, 9);
    expect(parseLength(`10' 8 1/2"`, 'm')).toBeCloseTo(3.2639, 4);
    expect(parseLength(`10′8″`, 'm')).toBeCloseTo(3.2512, 4);
    expect(parseLength('10 8 1/2', 'ft-in')).toBeCloseTo(3.2639, 4);
    expect(parseLength('10', 'ft-in')).toBeCloseTo(3.048, 4);
    expect(parseLength('8"', 'm')).toBeCloseTo(0.2032, 4);
    expect(parseLength(formatLengthValue(2.5, 'ft-in'), 'ft-in')).toBeCloseTo(2.5, 3);
    expect(parseLength('abc', 'm')).toBeNaN();
    expect(parseLength('', 'cm')).toBeNaN();
  });
});
