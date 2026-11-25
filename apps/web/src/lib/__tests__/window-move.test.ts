/**
 * Integration test: simulate the full onMouseMove flow for a window drag.
 * Verifies that ONLY the dragged window's t is mutated.
 */
import { describe, it, expect, beforeEach } from 'vitest';

const snap = (v: number) => v;
const wallLength = (g: any) => Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
const wallAngle = (g: any) => Math.atan2(g.y2 - g.y1, g.x2 - g.x1);

function snapshotItems(src: Record<string, any>) {
  const s: Record<string, any> = {};
  for (const id of Object.keys(src)) s[id] = JSON.parse(JSON.stringify(src[id]));
  return s;
}

function applyMove(items: Record<string, any>, drag: any, wx: number, wy: number) {
  const dx = wx - drag.startX, dy = wy - drag.startY;
  const sdx = snap(dx), sdy = snap(dy);
  const selectedIds = new Set(drag.ids);
  const movedWallIds = new Set(drag.ids.filter((id: string) => drag.originals[id]?.type === 'Wall'));
  const updates: Record<string, any> = {};
  for (const id of drag.ids) {
    const it = drag.originals[id]; if (!it) continue;
    if (it.type === 'Wall') {
      const g = (it as any).geom;
      const nextGeom = { ...g, x1: g.x1 + sdx, y1: g.y1 + sdy, x2: g.x2 + sdx, y2: g.y2 + sdy };
      updates[id] = { geom: nextGeom };
    } else if (it.type === 'Door' || it.type === 'Window') {
      if (movedWallIds.has((it as any).geom.wallId)) continue;
      const wallFromOriginals = drag.originals[(it as any).geom.wallId];
      const w = wallFromOriginals ?? items[(it as any).geom.wallId];
      if (!w) continue;
      const wGeom = (w as any).geom;
      const wallLen = wallLength(wGeom) || 1;
      const ang = wallAngle(wGeom);
      const halfSpan = Math.min(0.49, Math.max(0.01, (((it as any).geom.width ?? 1) / 2) / wallLen));
      const alongM = dx * Math.cos(ang) + dy * Math.sin(ang);
      const along = snap(alongM) / wallLen;
      const origT = (it as any).geom.t;
      const nt = Math.max(halfSpan, Math.min(1 - halfSpan, origT + along));
      updates[id] = { geom: { ...(it as any).geom, t: nt } };
    }
  }
  // apply updates
  for (const [id, patch] of Object.entries(updates)) {
    items[id] = { ...items[id], ...patch };
  }
}

describe('window drag on a wall', () => {
  let items: Record<string, any>;
  beforeEach(() => {
    items = {
      w1: { id: 'w1', type: 'Wall', geom: { x1: 0, y1: 0, x2: 5, y2: 0, thickness: 0.2, height: 2.7 } },
      winA: { id: 'winA', type: 'Window', geom: { wallId: 'w1', t: 0.2, width: 1.0, height: 1.2 } },
      winB: { id: 'winB', type: 'Window', geom: { wallId: 'w1', t: 0.5, width: 1.0, height: 1.2 } },
      winC: { id: 'winC', type: 'Window', geom: { wallId: 'w1', t: 0.8, width: 1.0, height: 1.2 } },
    };
  });

  it('dragging a single window mutates ONLY that window t', () => {
    const orig = { ...items };
    const drag = { kind: 'move' as const, startX: 0, startY: 0, ids: ['winA'], originals: snapshotItems(items) };
    // drag 0.5m to the right (wall along +x, so alongM = 0.5, along = 0.1)
    applyMove(items, drag, 0.5, 0);

    // The dragged window's t should change by along (0.1)
    expect(items.winA.geom.t).toBeCloseTo(0.3, 5);
    // All OTHER items must be unchanged (deep equal)
    expect(items.w1).toEqual(orig.w1);
    expect(items.winB).toEqual(orig.winB);
    expect(items.winC).toEqual(orig.winC);
  });
});
