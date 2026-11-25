import { describe, it, expect } from 'vitest';
import { buildRoof, roofFaces, roofCreases, roofEdges, roofHeightAt } from '@skaitch/core/lib/roofGeometry';

type P = [number, number];
const rect: P[] = [[0, 0], [10, 0], [10, 6], [0, 6]];
// L: horizontal wing 12×4, vertical wing 4×10
const L: P[] = [[0, 0], [12, 0], [12, 4], [4, 4], [4, 10], [0, 10]];
// T: bar 12×4 on top of a 4-wide, 6-long stem
const T: P[] = [[0, 6], [4, 6], [4, 0], [8, 0], [8, 6], [12, 6], [12, 10], [0, 10]];
const U: P[] = [[0, 0], [12, 0], [12, 9], [9, 9], [9, 3], [3, 3], [3, 9], [0, 9]];
const H: P[] = [[0, 0], [3, 0], [3, 4], [9, 4], [9, 0], [12, 0], [12, 10], [9, 10], [9, 6], [3, 6], [3, 10], [0, 10]];
const area = (p: P[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2);
const base = { pitch: 45, overhang: 0 };

describe('roofGeometry', () => {
  it('builds the same pitched roof with duplicate clicks and a repeated closing vertex', () => {
    const clean = buildRoof({ polygon: rect, roofType: 'gable', ...base })!;
    const duplicate = buildRoof({ polygon: [rect[0], ...rect, rect[0]], roofType: 'gable', ...base })!;
    expect(duplicate.approximate).toBeUndefined();
    expect(duplicate.ridgeHeight).toBeCloseTo(clean.ridgeHeight);
    expect(duplicate.top).toEqual(clean.top);
  });
  it('includes eave corners, gable boundaries and the ridge when finding wall heights', () => {
    const solid = buildRoof({ polygon: rect, roofType: 'gable', ...base })!;
    for (const p of rect) expect(roofHeightAt(solid, p)).toBeCloseTo(0);
    expect(roofHeightAt(solid, [10, 3])).toBeCloseTo(3);
    expect(roofHeightAt(solid, [5, 3])).toBeCloseTo(3);
    expect(roofHeightAt(solid, [10.01, 3])).toBeNull();
  });
  it('gable: two faces, ridge along the long side at the right height', () => {
    const s = buildRoof({ polygon: rect, roofType: 'gable', ...base })!;
    expect(s.approximate).toBeUndefined();
    expect(s.top).toHaveLength(2);
    expect(s.ridgeHeight).toBeCloseTo(3, 5);
    const creases = roofCreases(s);
    expect(creases).toHaveLength(1);
    expect(creases[0][0][1]).toBeCloseTo(3); expect(creases[0][1][1]).toBeCloseTo(3);
    expect(roofEdges({ polygon: rect, roofType: 'gable', ...base }).map((e) => e.gable)).toEqual([false, true, false, true]);
  });

  it('gable with rotated ridge', () => {
    const s = buildRoof({ polygon: rect, roofType: 'gable', ridgeSwap: true, ...base })!;
    expect(s.ridgeHeight).toBeCloseTo(5, 5);
  });

  it('hip: four faces on a rectangle, ridge + 4 hips', () => {
    const s = buildRoof({ polygon: rect, roofType: 'hip', ...base })!;
    expect(s.top).toHaveLength(4);
    expect(s.ridgeHeight).toBeCloseTo(3, 5);
    expect(roofCreases(s)).toHaveLength(5);
  });

  it('flat and shed', () => {
    const flat = buildRoof({ polygon: rect, roofType: 'flat' })!;
    expect(flat.ridgeHeight).toBe(0);
    expect(flat.approximate).toBeUndefined();
    const shed = buildRoof({ polygon: rect, roofType: 'shed', ...base })!;
    expect(shed.ridgeHeight).toBeCloseTo(6, 5);
    expect(shed.top).toHaveLength(1);
  });

  it('overhang expands the footprint', () => {
    const s = buildRoof({ polygon: rect, roofType: 'flat', overhang: 0.5 })!;
    const xs = s.outline.pts.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(-0.5);
    expect(Math.max(...xs)).toBeCloseTo(10.5);
  });

  for (const [name, poly] of Object.entries({ L, T, U, H })) {
    for (const roofType of ['hip', 'gable'] as const) {
      it(`${name}-shaped ${roofType}: exact cover, one ridge per wing`, () => {
        const s = buildRoof({ polygon: poly, roofType, ...base })!;
        expect(s.approximate).toBeUndefined();
        const covered = s.top.reduce((sum, f) => sum + area(f.pts), 0);
        expect(covered).toBeCloseTo(area(poly), 4);
        // every sloped face rises at 45° from its own edge
        for (const f of s.top) for (const z of f.z) expect(z).toBeGreaterThanOrEqual(-1e-9);
      });
    }
  }

  it('L-shaped hip: ridge heights of both wings and the valley', () => {
    const s = buildRoof({ polygon: L, roofType: 'hip', ...base })!;
    expect(s.ridgeHeight).toBeCloseTo(2, 5);
    expect(roofHeightAt(s, [8, 2])).toBeCloseTo(2, 5);   // ridge of the horizontal wing
    expect(roofHeightAt(s, [2, 7])).toBeCloseTo(2, 5);   // ridge of the vertical wing
    expect(roofHeightAt(s, [8, 1])).toBeCloseTo(1, 5);
    expect(roofHeightAt(s, [3.5, 3.5])).toBeCloseTo(0.5, 5); // on the valley
  });

  it('L-shaped gable: the two wing ends become gables', () => {
    const e = roofEdges({ polygon: L, roofType: 'gable', ...base });
    expect(e.map((x) => x.gable)).toEqual([false, true, false, false, true, false]);
    const s = buildRoof({ polygon: L, roofType: 'gable', ...base })!;
    expect(roofHeightAt(s, [11.9, 2])).toBeCloseTo(2, 5); // ridge runs to the gable end
  });

  it('T with wings of different widths: ridges at different heights', () => {
    const wide: P[] = [[0, 6], [3, 6], [3, 0], [9, 0], [9, 6], [12, 6], [12, 10], [0, 10]];
    const s = buildRoof({ polygon: wide, roofType: 'hip', ...base })!;
    expect(s.approximate).toBeUndefined();
    expect(roofHeightAt(s, [6, 4])).toBeCloseTo(3, 5);  // stem, 6 wide
    expect(roofHeightAt(s, [1.5, 8])).toBeCloseTo(1.5, 5);
  });

  it('custom edges: per-edge gable and pitch, clockwise input', () => {
    const cw = rect.slice().reverse() as P[]; // [0,6],[10,6],[10,0],[0,0]
    const edges = [
      { gable: false, pitch: 45 }, // top side
      { gable: true, pitch: 45 },
      { gable: false, pitch: 26.565051 }, // bottom side, slope 1/2
      { gable: true, pitch: 45 },
    ];
    const s = buildRoof({ polygon: cw, roofType: 'custom', edges, ...base })!;
    expect(s.approximate).toBeUndefined();
    // planes z = (6 - y) and z = y / 2 meet at y = 4, z = 2
    expect(s.ridgeHeight).toBeCloseTo(2, 4);
    expect(roofCreases(s)[0][0][1]).toBeCloseTo(4, 4);
    expect(roofEdges({ polygon: cw, roofType: 'custom', edges, ...base })).toEqual(edges);
  });

  it('closed solid: every edge is shared by exactly two faces on simple roofs', () => {
    for (const roofType of ['flat', 'shed', 'gable', 'hip'] as const) {
      const faces = roofFaces(buildRoof({ polygon: rect, roofType, pitch: 30, overhang: 0.3 })!);
      const count = new Map<string, number>();
      const k = (p: number[]) => p.map((v) => v.toFixed(4)).join(',');
      for (const f of faces) f.forEach((a, i) => {
        const b = f[(i + 1) % f.length];
        const key = [k(a), k(b)].sort().join('|');
        count.set(key, (count.get(key) ?? 0) + 1);
      });
      expect([...count.values()].every((c) => c === 2), roofType).toBe(true);
    }
  });

  it('rejects degenerate input', () => {
    expect(buildRoof({ polygon: [[0, 0], [1, 1]] })).toBeNull();
  });
});
