import { expect, it } from 'vitest';
import { wallBodyLimits } from '@skaitch/core/lib/wallContinuity';
import type { IfcWallEntity, ItemsMap } from '@skaitch/core/types/ifc';
const wall = (id: string, x1: number, y1: number, x2: number, y2: number, thickness = 0.2): IfcWallEntity => ({
  id, type: 'Wall', ifcType: 'IfcWall', name: id, Name: id, GlobalId: id, parentId: 's',
  geom: { x1, y1, x2, y2, thickness, height: 2.7 },
});
it('fills a right-angle corner with one through wall, preserving the axes', () => {
  const a = wall('a', 0, 0, 4, 0), b = wall('b', 4, 0, 4, 3);
  const items: ItemsMap = { a, b };
  expect(wallBodyLimits(a, items)).toEqual([0, 4.1]);
  expect(wallBodyLimits(b, items)).toEqual([0, 3]);
  expect(a.geom.x2).toBe(4);
});
it('closes a T-junction stopping just short of the host face', () => {
  const a = wall('a', 0, 0, 4, 0, 0.32), b = wall('b', 2, 2, 2, 0.165, 0.1);
  const items: ItemsMap = { a, b };
  expect(wallBodyLimits(b, items)[1]).toBeCloseTo(2.16);
  expect(wallBodyLimits(a, items)).toEqual([0, 4]);
  const reverse = wall('c', 2, 0.165, 2, 2, 0.1);
  expect(wallBodyLimits(reverse, { a, c: reverse })[0]).toBeCloseTo(-0.325);
});
it('does not bridge deliberate gaps, different storeys or parallel walls', () => {
  const a = wall('a', 0, 0, 4, 0), b = wall('b', 4.5, 0, 4.5, 3);
  expect(wallBodyLimits(a, { a, b })).toEqual([0, 4]);
  b.geom.x1 = b.geom.x2 = 4; b.parentId = 'other';
  expect(wallBodyLimits(a, { a, b })).toEqual([0, 4]);
  const c = wall('c', 4, 0, 7, 0);
  expect(wallBodyLimits(a, { a, c })).toEqual([0, 4]);
});
