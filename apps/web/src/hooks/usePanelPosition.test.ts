import { describe, expect, it } from 'vitest';
import { clampPanelPosition, readPanelPosition } from '@skaitch/ui/hooks/usePanelPosition';

describe('section panel placement', () => {
  it('restores only valid numeric positions from browser storage', () => {
    expect(readPanelPosition('{"x":100,"y":40}')).toEqual({ x: 100, y: 40 });
    for (const raw of [null, 'broken', '{}', '{"x":"100","y":0}', '{"x":1e999,"y":0}']) expect(readPanelPosition(raw)).toBeNull();
  });
  it('keeps the panel reachable after resize and content expansion', () => {
    expect(clampPanelPosition({ x: 700, y: 500 }, 600, 400, 252, 300)).toEqual({ x: 348, y: 100 });
    expect(clampPanelPosition({ x: -50, y: -10 }, 600, 400, 252, 300)).toEqual({ x: 0, y: 0 });
    expect(clampPanelPosition({ x: 100, y: 80 }, 200, 100, 252, 300)).toEqual({ x: 0, y: 0 });
  });
});
