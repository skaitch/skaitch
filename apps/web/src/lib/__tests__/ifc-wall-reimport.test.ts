import { expect, it } from 'vitest';
import { buildEmpty, guid } from '@skaitch/core/data/starter';
import { exportIFC } from '@skaitch/core/bim/exportIFC';
import { importIFCBuffer } from '@skaitch/core/bim/importIFC';
import type { IfcDoorEntity, IfcWallEntity, IfcWindowEntity, ItemsMap } from '@skaitch/core/types/ifc';

type Point = [number, number];

function wall(id: string, storeyId: string, [x1, y1]: Point, [x2, y2]: Point): IfcWallEntity {
  return {
    id, type: 'Wall', ifcType: 'IfcWall', name: id, Name: id, GlobalId: guid(id), parentId: storeyId,
    PredefinedType: 'STANDARD', geom: { x1, y1, x2, y2, thickness: 0.2, height: 2.7 },
  } as IfcWallEntity;
}

/** A closed room whose walls are drawn in every direction, plus a partition, all joined at their ends. */
function project(): ItemsMap {
  const items = buildEmpty();
  for (const id of Object.keys(items)) if (items[id].type === 'Wall') delete items[id];
  const storeyId = Object.values(items).find(item => item.type === 'Storey')!.id;
  const walls = [
    wall('south', storeyId, [0, 0], [8, 0]),
    wall('east', storeyId, [8, 6], [8, 0]),
    wall('north', storeyId, [8, 6], [0, 6]),
    wall('west', storeyId, [0, 0], [0, 6]),
    wall('partition', storeyId, [4, 6], [4, 0]),
  ];
  for (const w of walls) items[w.id] = w;
  // Openings on horizontal and vertical walls, drawn in both directions.
  const opening = (type: 'Door' | 'Window', id: string, wallId: string, width: number, extra: object) => ({
    id, type, ifcType: type === 'Door' ? 'IfcDoor' : 'IfcWindow', name: id, Name: id, GlobalId: guid(id), parentId: storeyId,
    OverallWidth: width, OverallHeight: type === 'Door' ? 2.1 : 1.2,
    geom: { wallId, t: 0.25, width, height: type === 'Door' ? 2.1 : 1.2, ...extra },
  });
  items.door_south = opening('Door', 'door_south', 'south', 0.9, { swing: 'left', side: 1 }) as unknown as IfcDoorEntity;
  items.door_east = opening('Door', 'door_east', 'east', 0.9, { swing: 'left', side: 1 }) as unknown as IfcDoorEntity;
  items.window_north = opening('Window', 'window_north', 'north', 1.2, { sill: 0.9 }) as unknown as IfcWindowEntity;
  items.window_west = opening('Window', 'window_west', 'west', 1.2, { sill: 0.9 }) as unknown as IfcWindowEntity;
  return items;
}

const close = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.06;

async function roundTrip(original: ItemsMap) {
  const bytes = new TextEncoder().encode(exportIFC(original));
  const silent = console.log;
  console.log = () => {};
  try { return await importIFCBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer); }
  finally { console.log = silent; }
}

/** World position of an opening: its host wall's axis at parameter t. */
function openingPoint(items: ItemsMap, id: string): Point {
  const { wallId, t } = (items[id] as IfcDoorEntity).geom;
  const g = (items[wallId] as IfcWallEntity).geom;
  return [g.x1 + t * (g.x2 - g.x1), g.y1 + t * (g.y2 - g.y1)];
}

it('re-imports walls exported by skAItch with their ends in place, whatever their drawing direction', async () => {
  const original = project();
  const imported = await roundTrip(original);
  const [ox, oy] = imported.centerOffset ?? [0, 0];
  const walls = Object.values(imported.items).filter((item): item is IfcWallEntity => item.type === 'Wall');
  expect(walls.map(w => w.name).sort()).toEqual(['east', 'north', 'partition', 'south', 'west']);
  for (const w of walls) {
    const expected = (original[w.name] as IfcWallEntity).geom;
    const ends: Point[] = [[w.geom.x1 + ox, w.geom.y1 + oy], [w.geom.x2 + ox, w.geom.y2 + oy]];
    const want: Point[] = [[expected.x1, expected.y1], [expected.x2, expected.y2]];
    const sameOrder = close(ends[0], want[0]) && close(ends[1], want[1]);
    const swapped = close(ends[0], want[1]) && close(ends[1], want[0]);
    expect(sameOrder || swapped, `${w.name}: ${JSON.stringify(ends.map(p => p.map(n => +n.toFixed(2))))} vs ${JSON.stringify(want)}`).toBe(true);
  }
});

it('re-imports doors and windows where they were, including on vertical walls', async () => {
  const original = project();
  const imported = await roundTrip(original);
  const [ox, oy] = imported.centerOffset ?? [0, 0];
  for (const name of ['door_south', 'door_east', 'window_north', 'window_west']) {
    const found = Object.values(imported.items).find(item => item.name === name);
    expect(found, name).toBeDefined();
    const [x, y] = openingPoint(imported.items, found!.id);
    const [ex, ey] = openingPoint(original, name);
    expect(Math.hypot(x + ox - ex, y + oy - ey), name).toBeLessThan(0.1);
  }
});

it('exports surface colours so IFC viewers do not render everything white', () => {
  const text = exportIFC(project());
  expect(text).toMatch(/IFCSURFACESTYLE\('wall'/);
  // Doors and windows use the editor's 3D models: tessellated, several materials, translucent glazing.
  expect(text).toContain("'Body','Tessellation'");
  expect(new Set(text.match(/IFCCOLOURRGB\(\$,[^)]*\)/g)).size).toBeGreaterThanOrEqual(5);
  expect(text).toMatch(/IFCSURFACESTYLERENDERING\(#\d+,0\.[1-9]\d*,/);
  // Every wall, door and window body is styled, and ids stay unique.
  expect(text.match(/IFCSTYLEDITEM\(/g)?.length).toBeGreaterThanOrEqual(8);
  const ids = text.match(/^#\d+=/gm)!;
  expect(new Set(ids).size).toBe(ids.length);
});

it('re-imports doors with the same hinge and opening side, whatever the wall direction', async () => {
  const items = project();
  for (const id of Object.keys(items)) if (items[id].type === 'Door' || items[id].type === 'Window') delete items[id];
  const storeyId = Object.values(items).find(item => item.type === 'Storey')!.id;
  let k = 0;
  for (const wallId of ['south', 'east', 'north', 'west']) for (const swing of ['left', 'right'] as const) for (const side of [1, -1]) {
    const id = `door_${wallId}_${swing}_${side > 0 ? 'p' : 'n'}`;
    items[id] = {
      id, type: 'Door', ifcType: 'IfcDoor', name: id, Name: id, GlobalId: guid(id), parentId: storeyId, OverallWidth: 0.9, OverallHeight: 2.1,
      geom: { wallId, t: 0.15 + 0.2 * (k++ % 4), width: 0.9, height: 2.1, swing, side },
    } as unknown as IfcDoorEntity;
  }
  const imported = await roundTrip(items);
  const [ox, oy] = imported.centerOffset ?? [0, 0];
  // Hinge position and opening direction in plan, which do not depend on the wall's drawing direction.
  const inPlan = (all: ItemsMap, door: IfcDoorEntity, dx = 0, dy = 0) => {
    const g = (all[door.geom.wallId] as IfcWallEntity).geom;
    const length = Math.hypot(g.x2 - g.x1, g.y2 - g.y1), ux = (g.x2 - g.x1) / length, uy = (g.y2 - g.y1) / length;
    const hinge = (door.geom.swing === 'left' ? -1 : 1) * door.geom.width / 2;
    const [cx, cy] = openingPoint(all, door.id);
    return { hinge: [cx + ux * hinge + dx, cy + uy * hinge + dy] as Point, opens: [Math.round(-uy * door.geom.side) + 0, Math.round(ux * door.geom.side) + 0] };
  };
  for (const door of Object.values(items).filter((item): item is IfcDoorEntity => item.type === 'Door')) {
    const found = Object.values(imported.items).find(item => item.name === door.name) as IfcDoorEntity;
    const want = inPlan(items, door), got = inPlan(imported.items, found, ox, oy);
    expect(Math.hypot(got.hinge[0] - want.hinge[0], got.hinge[1] - want.hinge[1]), `${door.name} hinge`).toBeLessThan(0.15);
    expect(got.opens, `${door.name} opening side`).toEqual(want.opens);
  }
});
