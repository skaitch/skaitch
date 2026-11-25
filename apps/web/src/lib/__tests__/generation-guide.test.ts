import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { renderElementSvg } from '@skaitch/ui/data/elementSvg';
import { expect, it } from 'vitest';
import { GENERATION_EXAMPLES } from '@skaitch/core/lib/generationGuide';
import { openingOrientation } from '@skaitch/core/lib/openingOrientation';
import { furniturePlacement } from '@skaitch/core/lib/furniturePlacement';
import { BUILTIN_CATALOGUE } from '@skaitch/core/data/elementCatalogue';
import type { IfcWallEntity } from '@skaitch/core/types/ifc';

it('the door example places the measured hinge on the north jamb and opens west', () => {
  const wall = { parentId: 's', geom: { x1: 0, y1: 0, x2: 0, y2: 4 } } as IfcWallEntity;
  const args = GENERATION_EXAMPLES.door;
  const result = openingOrientation(args, wall, args.position, args.operation_type, {});
  const centreY = result.t * 4;
  expect(centreY + args.width / 2).toBeCloseTo(args.hinge_point[1]);
  expect(result.swing).toBe('right');
  expect(result.side).toBe(1); // Left normal of a northbound wall is west.
});
it('the WC example keeps the width and depth local and puts its back on the east wall', () => {
  const args = GENERATION_EXAMPLES.wc;
  const { geom: g } = furniturePlacement(args, {}, 's', BUILTIN_CATALOGUE);
  expect(g.w).toBe(0.4);
  expect(g.d).toBe(0.65);
  const front = g.rotation - Math.PI / 2;
  expect(Math.cos(front)).toBeCloseTo(-1);
  const cx = g.x + g.w / 2, cy = g.y + g.d / 2;
  expect(cx - Math.cos(front) * g.d / 2).toBeCloseTo(args.point[0]);
  expect(cy - Math.sin(front) * g.d / 2).toBeCloseTo(args.point[1]);
});
it('the shower example touches both inner faces without crossing them', () => {
  const { geom: g } = furniturePlacement(GENERATION_EXAMPLES.shower, {}, 's', BUILTIN_CATALOGUE);
  expect(g.x + g.w).toBeCloseTo(4);
  expect(g.y).toBeCloseTo(0);
});

it('offers concrete catalogue models for the missing garage, sink and water heater symbols', () => {
  const garage = BUILTIN_CATALOGUE.find(d => d.id === 'door-garage-tilt-up')!;
  const heater = BUILTIN_CATALOGUE.find(d => d.id === 'sdb-chauffe-eau')!;
  const sink = BUILTIN_CATALOGUE.find(d => d.id === 'cuisine-evier')!;
  expect(garage.defaults.OperationType).toBe('TILT_UP');
  for (const def of [garage, heater, sink]) {
    const svg = renderToStaticMarkup(createElement('svg', null, renderElementSvg(def.id, 72, 44)));
    expect(svg).toMatch(/<(path|rect|ellipse|circle)/);
  }
  const { geom } = furniturePlacement({ catalogue_id: heater.id, point: [2, 3], anchor: 'center' }, {}, 's', BUILTIN_CATALOGUE);
  expect(geom.x + geom.w / 2).toBeCloseTo(2);
  expect(geom.y + geom.d / 2).toBeCloseTo(3);
});
