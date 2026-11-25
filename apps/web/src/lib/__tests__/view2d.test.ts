import { expect, it } from 'vitest';
import { trackpadView } from '@skaitch/ui/lib/view2d';

it('zooms smoothly at the trackpad pinch centre in both directions', () => {
  const initial = { scale: 40, ox: 70, oy: 30 };
  const zoomed = trackpadView(initial, 320, 180, 0, -4, true);
  expect(zoomed.scale).toBeGreaterThan(initial.scale);
  expect((320 - zoomed.ox) / zoomed.scale).toBeCloseTo((320 - initial.ox) / initial.scale);
  expect((zoomed.oy - 180) / zoomed.scale).toBeCloseTo((initial.oy - 180) / initial.scale);
  const restored = trackpadView(zoomed, 320, 180, 0, 4, true);
  expect(restored.scale).toBeCloseTo(initial.scale);
  expect(restored.ox).toBeCloseTo(initial.ox);
  expect(restored.oy).toBeCloseTo(initial.oy);
});

it('accumulates rapid gesture events using the latest view', () => {
  const initial = { scale: 40, ox: 70, oy: 30 };
  const first = trackpadView(initial, 200, 100, 0, -1, true);
  const next = trackpadView(first, 200, 100, 0, -1, true);
  const combined = trackpadView(initial, 200, 100, 0, -2, true);
  expect(next.scale).toBeCloseTo(combined.scale);
  expect(next.ox).toBeCloseTo(combined.ox);
  expect(next.oy).toBeCloseTo(combined.oy);
});

it('keeps two-finger scrolling and clamps zoom without moving its anchor', () => {
  const view = { scale: 40, ox: 70, oy: 30 };
  expect(trackpadView(view, 100, 100, 12, -5, false)).toEqual({ scale: 40, ox: 58, oy: 35 });
  expect(trackpadView(view, 100, 100, 0, 0, true)).toBe(view);
  expect(trackpadView(view, 100, 100, 0, -10000, true).scale).toBe(200);
  expect(trackpadView(view, 100, 100, 0, 10000, true).scale).toBe(.5);
});
