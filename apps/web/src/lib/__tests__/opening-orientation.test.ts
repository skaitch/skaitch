import { expect, it } from 'vitest';
import { openingOrientation } from '@skaitch/core/lib/openingOrientation';
import type { IfcWallEntity } from '@skaitch/core/types/ifc';
const wall = (x1: number, y1: number, x2: number, y2: number) => ({ parentId: 's', geom: { x1, y1, x2, y2 } }) as IfcWallEntity;
it('keeps physical hinge and opening side when the wall direction is reversed', () => {
  const args = { width: 1, position: 0.5, hinge_point: [1.5, 0], opening_towards: [2, 2] };
  expect(openingOrientation(args, wall(0, 0, 4, 0), 0.5, 'SINGLE_SWING_LEFT', {})).toMatchObject({ swing: 'left', side: 1, operation: 'SINGLE_SWING_LEFT' });
  expect(openingOrientation(args, wall(4, 0, 0, 0), 0.5, 'SINGLE_SWING_LEFT', {})).toMatchObject({ swing: 'right', side: -1, operation: 'SINGLE_SWING_RIGHT' });
});
it('resolves vertical and diagonal walls without relying on screen left/right', () => {
  expect(openingOrientation({ width: 1, position: 0.5, hinge_point: [0, 1.5], opening_towards: [2, 2] }, wall(0, 0, 0, 4), 0.5, 'SINGLE_SWING_LEFT', {})).toMatchObject({ swing: 'left', side: -1 });
  expect(openingOrientation({ opening_towards: [0, 4], swing: 'right' }, wall(0, 0, 4, 4), 0.5, 'SINGLE_SWING_LEFT', {})).toMatchObject({ swing: 'right', side: 1, operation: 'SINGLE_SWING_RIGHT' });
});
it('rejects ambiguous and conflicting directions before creating an opening', () => {
  for (const args of [{ opening_towards: [3, 0] }, { position: 0.5, hinge_point: [2, 2] }, { opening_towards: [2, 2], side: -1 }, { position: 0.5, hinge_point: [1, 0], swing: 'right' }]) {
    expect(() => openingOrientation(args, wall(0, 0, 4, 0), 0.5, 'SINGLE_SWING_LEFT', {})).toThrow();
  }
});

it('places the opening at its hinge reference instead of the default wall midpoint', () => {
  const placed = openingOrientation({ hinge_point: [1, 0], opening_towards: [2, 1], width: 0.8 }, wall(0, 0, 6, 0), 0.5, 'SINGLE_SWING_LEFT', {});
  expect(placed).toMatchObject({ t: 1.4 / 6, swing: 'left', side: 1 });
});

it('rejects a hinge on the correct side that is not at the actual opening jamb', () => {
  expect(() => openingOrientation({ position: 0.5, width: 0.8, hinge_point: [0.2, 0] }, wall(0, 0, 4, 0), 0.5, 'SINGLE_SWING_LEFT', {})).toThrow();
  expect(() => openingOrientation({ width: 0.8, hinge_point: [1, 2] }, wall(0, 0, 4, 0), 0.5, 'SINGLE_SWING_LEFT', {})).toThrow();
});
it('rejects an opening whose centre is on the wall but whose width crosses its end', () => {
  expect(() => openingOrientation({ width: 0.8, position: 0.02 }, wall(0, 0, 4, 0), 0.02, 'SINGLE_SWING_LEFT', {})).toThrow();
});
