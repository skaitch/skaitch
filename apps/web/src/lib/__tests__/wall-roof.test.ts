import { describe, it, expect } from 'vitest';
import { wallRoofProfile, wallRoofShape } from '@skaitch/core/lib/wallRoof';
const wall: any = { id: 'w_test', type: 'Wall', parentId: 's', geom: { x1: 10, y1: 0, x2: 10, y2: 6, height: 2.7, thickness: 0.2, roofId: 'rf_test' } };
const roof: any = { id: 'rf_test', type: 'Roof', parentId: 's', geom: { polygon: [[0, 0], [10, 0], [10, 6], [0, 6]], roofType: 'gable', elevation: 2.7, thickness: 0.25, pitch: 45, overhang: 0 } };
describe('wall attachment to roof', () => {
  it('follows the ridge and updates after a pitch change', () => {
    const items = { rf_test: roof };
    const profile = wallRoofProfile(wall, items)!;
    expect(profile[0]).toEqual([0, 2.45]);
    expect(profile[profile.length - 1][1]).toBeCloseTo(2.45);
    expect(Math.max(...profile.map(p => p[1]))).toBeCloseTo(5.45);
    const lower = { ...roof, geom: { ...roof.geom, pitch: 30 } };
    expect(Math.max(...wallRoofProfile(wall, { rf_test: lower })!.map(p => p[1]))).toBeLessThan(5.45);
  });
  it('checks a window against the roof above that window rather than the lowest eave', () => {
    const window: any = { id: 'wn', type: 'Window', geom: { wallId: wall.id, t: 0.5, width: 1, height: 1.6, sillHeight: 0.9 } };
    expect(wallRoofProfile(wall, { rf_test: roof, wn: window })).not.toBeNull();
    expect(wallRoofProfile(wall, { rf_test: roof, wn: { ...window, geom: { ...window.geom, t: 0.09 } } })).toBeNull();
  });
  it('joins a long facade covered by two adjacent roofs', () => {
    const left = { ...roof, geom: { ...roof.geom, roofType: 'flat', polygon: [[0, 0], [10, 0], [10, 3], [0, 3]] } };
    const right = { ...roof, id: 'rf_other', geom: { ...roof.geom, roofType: 'flat', polygon: [[0, 3], [10, 3], [10, 6], [0, 6]] } };
    expect(wallRoofProfile(wall, { rf_test: left })).toBeNull();
    const attached = { ...wall, geom: { ...wall.geom, roofIds: ['rf_test', 'rf_other'] } };
    const profile = wallRoofProfile(attached, { rf_test: left, rf_other: right })!;
    expect(profile[0][0]).toBe(0);
    expect(profile[profile.length - 1][0]).toBe(6);
    expect(profile.every(p => Math.abs(p[1] - 2.45) < 1e-6)).toBe(true);
  });
  it('rejects walls outside the roof or on another storey', () => {
    expect(wallRoofProfile({ ...wall, parentId: 'other' }, { rf_test: roof })).toBeNull();
    expect(wallRoofProfile({ ...wall, geom: { ...wall.geom, x1: 20, x2: 20 } }, { rf_test: roof })).toBeNull();
  });
  it('exports an elevation profile extruded through wall thickness', () => {
    const lines: string[] = [];
    expect(wallRoofShape(wall, { rf_test: roof }, text => lines.push(text), 1)).toBeGreaterThan(0);
    expect(lines.some(l => l.startsWith('IFCEXTRUDEDAREASOLID(') && l.endsWith(',0.2)'))).toBe(true);
  });
});
